/* ============================================================
 * 스피또 1000 — 클라이언트 로직
 *
 * 섹션 구성
 *   1. 상수 · 상태
 *   2. 영속화 (localStorage 저장 / 복원)
 *   3. 일일 한도 · 구매 가능 여부
 *   4. DOM 레퍼런스
 *   5. 오디오 (스크래치 / 당첨 / 꽝)
 *   6. 파티클 · 폭죽 FX
 *   7. 유틸 (포맷, 시리얼, 셔플, 가중 추첨)
 *   8. 상금 테이블 · 티켓 생성
 *      - 6칸에 이천만원 / 오억원 무조건 등장
 *      - 같은 금액 최대 2번까지
 *      - 당첨 등급 사전 추첨 → lucky 번호 배치
 *   9. UI 렌더 (잔액 · 티켓)
 *  10. 스크래치 캔버스 (코팅 · 긁기 · 진척률)
 *  11. 결과 모달
 *  12. 통계 모달 (집계 · 히스토리 · 일일 한도 편집)
 *  13. 충전 모달
 *  14. 라운드 시작 / 컨트롤 핸들러
 *  15. 커서 (스크래치 중 커스텀 원형)
 *  16. 초기화 (load + 첫 렌더)
 * ============================================================ */

(function () {

  /* ===== 1. 상수 · 상태 ================================== */
  const KO            = ['','일','이','삼','사','오','육','칠','팔','구','십'];
  const STORAGE_KEY   = 'spitto1000_v1';
  const TICKET_PRICE  = 1000;
  const HISTORY_MAX   = 100;

  const state = {
    balance: 10000,
    phase: 'idle',          // 'idle' | 'playing'
    ticket: null,
    revealed: false,
    scratching: false,
    lastProgressCheck: 0,
    brush: 38,
    audio: true,
    history: [],            // [{ts, serial, cost, win}, ...] 최신순
    dailyLimit: null,       // null = 한도 없음
    dailySpent: { date: '', amount: 0 },
    _lastTs: 0, _lastCX: 0, _lastCY: 0,
  };


  /* ===== 2. 영속화 ====================================== */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.balance === 'number' && isFinite(data.balance)) state.balance = data.balance;
      if (Array.isArray(data.history)) state.history = data.history.slice(0, HISTORY_MAX);
      if (typeof data.dailyLimit === 'number' && data.dailyLimit > 0) state.dailyLimit = data.dailyLimit;
      if (data.dailySpent && typeof data.dailySpent.amount === 'number') {
        state.dailySpent = { date: String(data.dailySpent.date||''), amount: data.dailySpent.amount };
      }
    } catch (e) {}
    ensureToday();
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        balance: state.balance,
        history: state.history,
        dailyLimit: state.dailyLimit,
        dailySpent: state.dailySpent,
      }));
    } catch (e) {}
  }


  /* ===== 3. 일일 한도 · 구매 가능 여부 =================== */
  function todayStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function ensureToday() {
    const t = todayStr();
    if (state.dailySpent.date !== t) state.dailySpent = { date: t, amount: 0 };
  }
  function canBuy() {
    if (state.balance < TICKET_PRICE) {
      return { ok:false, reason:'low_balance', msg:'잔액이 부족합니다' };
    }
    ensureToday();
    if (state.dailyLimit && state.dailySpent.amount + TICKET_PRICE > state.dailyLimit) {
      return { ok:false, reason:'daily_limit', msg:'오늘 한도에 도달했습니다' };
    }
    return { ok:true };
  }


  /* ===== 4. DOM 레퍼런스 ================================= */
  const el = {
    // HUD · 시작 화면
    startOverlay:  document.getElementById('startOverlay'),
    startBalance:  document.getElementById('startBalance'),
    hudBalance:    document.getElementById('hudBalance'),
    btnBuy:        document.getElementById('btnBuy'),
    buyHint:       document.getElementById('buyHint'),
    audioToggle:   document.getElementById('audioToggle'),

    // 티켓 · 캔버스
    canvasLucky:   document.getElementById('canvasLucky'),
    canvasGame:    document.getElementById('canvasGame'),
    ticketWrap:    document.getElementById('ticketWrap'),
    luckyDisplay:  document.getElementById('luckyDisplay'),
    luckyKorean:   document.getElementById('luckyKorean'),
    cellsGrid:     document.getElementById('cellsGrid'),
    serialNo:      document.getElementById('serialNo'),

    // 컨트롤
    btnReveal:     document.getElementById('btnReveal'),
    btnAgain:      document.getElementById('btnAgain'),
    brushSize:     document.getElementById('brushSize'),
    brushVal:      document.getElementById('brushVal'),

    // FX · 커서
    fxLayer:       document.getElementById('fxLayer'),
    scratchCursor: document.getElementById('scratchCursor'),

    // 결과 모달
    resultModal:   document.getElementById('resultModal'),
    resultTitle:   document.getElementById('resultTitle'),
    resultBody:    document.getElementById('resultBody'),
    btnModalClose: document.getElementById('btnModalClose'),
    confettiHost:  document.getElementById('confettiHost'),

    // 통계 모달
    btnStats:      document.getElementById('btnStats'),
    statsModal:    document.getElementById('statsModal'),
    btnStatsClose: document.getElementById('btnStatsClose'),
    btnResetStats: document.getElementById('btnResetStats'),
    historyList:   document.getElementById('historyList'),
    statCount:     document.getElementById('statCount'),
    statRate:      document.getElementById('statRate'),
    statCost:      document.getElementById('statCost'),
    statWin:       document.getElementById('statWin'),
    statProfit:    document.getElementById('statProfit'),
    statMax:       document.getElementById('statMax'),
    dailySpentVal: document.getElementById('dailySpentVal'),
    dailyLimitVal: document.getElementById('dailyLimitVal'),
    btnEditLimit:  document.getElementById('btnEditLimit'),
    dailyBar:      document.getElementById('dailyBar'),
    dailyBarFill:  document.getElementById('dailyBarFill'),

    // 충전 모달
    btnRecharge:      document.getElementById('btnRecharge'),
    rechargeModal:    document.getElementById('rechargeModal'),
    rechargeBalance:  document.getElementById('rechargeBalance'),
    btnRechargeClose: document.getElementById('btnRechargeClose'),
  };


  /* ===== 5. 오디오 ====================================== */
  let audioCtx = null;
  function ctx() {
    if (!state.audio) return null;
    if (!audioCtx) try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ return null; }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // 스크래치 노이즈 (속도에 비례한 음량)
  let lastScratchSnd = 0;
  function playScratch(speed) {
    const c = ctx(); if (!c) return;
    const now = performance.now();
    if (now - lastScratchSnd < 35) return;   // 너무 자주 안 울리도록 throttle
    lastScratchSnd = now;
    const dur = 0.035;
    const vol = Math.min(0.18, 0.06 + speed * 0.14);
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = c.createBufferSource(); src.buffer = buf;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 7000;
    const g  = c.createGain(); g.gain.value = vol;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(c.destination);
    src.start(); src.stop(c.currentTime + dur);
  }

  // 당첨 효과음 (도-미-솔-도 아르페지오)
  function playWin() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    [[523.25, 0], [659.25, 0.1], [783.99, 0.2], [1046.5, 0.32]].forEach(([freq, delay]) => {
      const osc = c.createOscillator();
      const g   = c.createGain();
      const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 3000;
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.12, t + delay + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.5);
      osc.connect(flt); flt.connect(g); g.connect(c.destination);
      osc.start(t + delay); osc.stop(t + delay + 0.55);
    });
  }

  // 꽝 효과음 (하강 글라이드)
  function playLose() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(160, t + 0.4);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.5);
  }


  /* ===== 6. 파티클 · 폭죽 FX ============================ */
  // 스크래치 중 커서 위치에서 튀는 금속 가루
  function spawnParticles(cx, cy, speed) {
    if (!el.fxLayer) return;
    const n = Math.min(8, 1 + Math.floor(speed * 60));
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'scratch-particle metal';
      const ang = Math.random() * Math.PI * 2;
      const dist = 12 + speed * 200 + Math.random() * 20;
      p.style.cssText = `left:${cx}px;top:${cy}px;`;
      p.style.setProperty('--tx', Math.cos(ang)*dist+'px');
      p.style.setProperty('--ty', Math.sin(ang)*dist+'px');
      const dur = 0.28 + Math.random()*0.18;
      p.style.animation = `particleFly ${dur}s ease-out forwards`;
      el.fxLayer.appendChild(p);
      setTimeout(() => p.remove(), 600);
    }
  }

  // 당첨 모달 위에서 떨어지는 폭죽 조각
  function spawnConfetti() {
    const colors = ['#1a1a1a','#888','#ccc','#444','#666'];
    for (let i=0;i<24;i++) {
      const p=document.createElement('div');
      p.className='confetti-piece';
      p.style.left=`${15+Math.random()*70}%`;
      p.style.top=`${5+Math.random()*25}%`;
      p.style.background=colors[i%colors.length];
      p.style.animationDelay=`${Math.random()*0.25}s`;
      el.confettiHost.appendChild(p);
    }
  }


  /* ===== 7. 유틸 ======================================== */
  function fmt(n) { return n.toLocaleString('ko-KR') + '원'; }

  function serial() {
    return [5,4,3].map(l => String(Math.floor(Math.random()*Math.pow(10,l))).padStart(l,'0')).join('-');
  }

  function shuffle(arr) {
    for (let i = arr.length-1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function weightedPick(weights) {
    const total = weights.reduce((s,w)=>s+w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      if (r < weights[i]) return i;
      r -= weights[i];
    }
    return weights.length - 1;
  }


  /* ===== 8. 상금 테이블 · 티켓 생성 ===================== */
  // 표시 가능한 상금은 정확히 6종
  const PRIZES = [
    {label:'일천원',   amount:1000},
    {label:'오천원',   amount:5000},
    {label:'일만원',   amount:10000},
    {label:'오만원',   amount:50000},
    {label:'이천만원', amount:20000000},
    {label:'오억원',   amount:500000000},
  ];
  const MAX_DUP             = 2;          // 6칸 중 같은 금액은 최대 2번
  const REQUIRED_PRIZE_IDXS = [4, 5];     // 이천만원·오억원은 매 티켓 필수 노출

  // 데코이(미당첨 칸) 가중치 — 작은 금액 위주, 대박은 가끔 살짝 보임
  const DECOY_WEIGHTS = [40, 35, 15, 8, 1.5, 0.5];

  function pickDecoyUnique(counts) {
    for (let i = 0; i < 30; i++) {
      const p = PRIZES[weightedPick(DECOY_WEIGHTS)];
      if ((counts[p.amount] || 0) < MAX_DUP) return p;
    }
    // 가중 추첨이 계속 한도 초과면 사용 가능한 후보 중 무작위
    const avail = PRIZES.filter(p => (counts[p.amount] || 0) < MAX_DUP);
    return avail[Math.floor(Math.random()*avail.length)] || PRIZES[0];
  }

  // 당첨 등급을 먼저 결정. 반환값:
  //   -1   = 미당첨
  //   0..5 = PRIZES 인덱스
  function rollWinTier() {
    const r = Math.random();
    if (r < 0.50)      return -1;   // 미당첨   50%
    if (r < 0.78)      return 0;    // 일천원   28%
    if (r < 0.94)      return 1;    // 오천원   16%
    if (r < 0.985)     return 2;    // 일만원    4.5%
    if (r < 0.99905)   return 3;    // 오만원    1.405%
    if (r < 0.99995)   return 4;    // 이천만원  0.09%
    return 5;                       // 오억원    0.005%
  }

  // 한 장의 티켓을 생성
  //   1) lucky 숫자 + 당첨 등급 사전 결정
  //   2) 당첨이면 lucky를 6칸 중 한 자리에 배치, 아니면 lucky 제외 6칸
  //   3) 당첨 칸에 해당 등급 상금 → 이천만원·오억원이 비어있으면 채워넣음
  //   4) 남은 칸은 가중 데코이로 채움 (중복 한도 준수)
  function generateTicket() {
    const lucky  = Math.floor(Math.random()*10)+1;
    const winIdx = rollWinTier();

    // (2) 6칸의 숫자 결정
    const others = shuffle([1,2,3,4,5,6,7,8,9,10].filter(n => n !== lucky));
    let cellNumbers;
    if (winIdx >= 0) {
      cellNumbers = others.slice(0,5);
      const winPos = Math.floor(Math.random()*6);
      cellNumbers.splice(winPos, 0, lucky);
    } else {
      cellNumbers = others.slice(0,6);
    }

    // (3) 상금 배정
    const cellPrizes = new Array(6);
    const counts = {};
    if (winIdx >= 0) {
      const winPos = cellNumbers.indexOf(lucky);
      cellPrizes[winPos] = PRIZES[winIdx];
      counts[PRIZES[winIdx].amount] = 1;
    }

    const remaining = [];
    for (let i = 0; i < 6; i++) if (cellPrizes[i] === undefined) remaining.push(i);
    shuffle(remaining);

    // 필수 노출 (이천만원·오억원)
    for (const reqIdx of REQUIRED_PRIZE_IDXS) {
      const reqAmt = PRIZES[reqIdx].amount;
      if ((counts[reqAmt] || 0) >= 1) continue;
      const slot = remaining.shift();
      cellPrizes[slot] = PRIZES[reqIdx];
      counts[reqAmt] = 1;
    }

    // (4) 나머지 칸 채우기
    for (const slot of remaining) {
      const p = pickDecoyUnique(counts);
      cellPrizes[slot] = p;
      counts[p.amount] = (counts[p.amount] || 0) + 1;
    }

    const cells = cellNumbers.map((num, i) => ({
      num, ko: KO[num],
      match: num === lucky,
      prize: cellPrizes[i],
    }));
    const winAmount = cells.filter(c=>c.match).reduce((m,c)=>Math.max(m,c.prize.amount),0);
    return { lucky, ko:KO[lucky], cells, winAmount, isWin:winAmount>0, serial:serial() };
  }


  /* ===== 9. UI 렌더 (잔액 · 티켓) ======================= */
  function updateBalance() {
    const t = fmt(state.balance);
    el.startBalance.textContent = t;
    el.hudBalance.textContent   = t;
    if (el.rechargeBalance) el.rechargeBalance.textContent = t;
    const ok = canBuy();
    el.btnBuy.disabled = !ok.ok;
    if (ok.ok) {
      el.buyHint.style.display = 'none';
    } else {
      el.buyHint.textContent = ok.msg;
      el.buyHint.style.display = 'block';
    }
  }

  function renderTicket() {
    const t = state.ticket;
    el.luckyDisplay.textContent = String(t.lucky);
    el.luckyKorean.textContent  = t.ko;
    el.serialNo.textContent     = t.serial;
    el.cellsGrid.innerHTML = '';
    t.cells.forEach(c => {
      const d = document.createElement('div');
      d.className = 'cell';
      d.innerHTML = `
        <div class="cell-num">${c.num}</div>
        <div class="cell-ko">${c.ko}</div>
        <div class="cell-prize-amount">${c.prize.label}</div>`;
      el.cellsGrid.appendChild(d);
    });
  }


  /* ===== 10. 스크래치 캔버스 ============================ */
  // 은회색 코팅을 노이즈와 함께 그림
  function drawCoating(ctx2d, w, h) {
    const g = ctx2d.createLinearGradient(0, 0, w, h);
    g.addColorStop(0,   '#d8d8d6');
    g.addColorStop(0.4, '#c0c0be');
    g.addColorStop(0.6, '#b4b4b2');
    g.addColorStop(1,   '#cacac8');
    ctx2d.save();
    ctx2d.fillStyle = g;
    ctx2d.fillRect(0, 0, w, h);
    const img = ctx2d.getImageData(0,0,w,h);
    const d = img.data;
    for (let i = 0; i < d.length; i+=4) {
      const n = (Math.random()-.5)*18;
      d[i]   = Math.min(255,Math.max(0,d[i]+n));
      d[i+1] = Math.min(255,Math.max(0,d[i+1]+n));
      d[i+2] = Math.min(255,Math.max(0,d[i+2]+n));
    }
    ctx2d.putImageData(img,0,0);
    ctx2d.restore();
  }

  const luckyMeta = {ctx:null,w:0,h:0,dpr:1};
  const gameMeta  = {ctx:null,w:0,h:0,dpr:1};

  // DPR 보정 + 코팅 초기화
  function setupCanvas(canvas, panelEl, meta) {
    const dpr  = Math.min(window.devicePixelRatio||1, 2);
    const rect = panelEl.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width  = w;
    canvas.height = h;
    const c = canvas.getContext('2d', {alpha:true});
    drawCoating(c, w, h);
    Object.assign(meta, {ctx:c, w, h, dpr});
  }

  function resizeCanvases() {
    setupCanvas(el.canvasLucky, document.querySelector('.lucky-panel'), luckyMeta);
    setupCanvas(el.canvasGame,  document.querySelector('.cells-panel'), gameMeta);
  }

  function canvasPos(canvas, cx, cy) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((cx-r.left)/r.width)  * canvas.width,
      y: ((cy-r.top) /r.height) * canvas.height,
    };
  }

  // 코팅 위에 destination-out 으로 한 줄을 지움
  function scratchLine(canvas, c, x1, y1, x2, y2, w) {
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.lineWidth  = w * (canvas.width / canvas.getBoundingClientRect().width);
    c.lineCap    = 'round';
    c.lineJoin   = 'round';
    c.beginPath(); c.moveTo(x1,y1); c.lineTo(x2,y2); c.stroke();
    c.restore();
  }

  // 게임 칸 코팅의 투명 비율 (자동 결과 공개 임계값 판정용)
  function clearedRatio() {
    const {ctx,w,h} = gameMeta;
    if (!ctx||w<8||h<8) return 0;
    const step=6; let total=0, cleared=0;
    try {
      const img=ctx.getImageData(0,0,w,h), d=img.data;
      for (let y=0;y<h;y+=step) for (let x=0;x<w;x+=step) {
        total++;
        if (d[(y*w+x)*4+3]<48) cleared++;
      }
    } catch(e){ return 0; }
    return total ? cleared/total : 0;
  }

  function clearMeta(meta) {
    if (!meta.ctx) return;
    meta.ctx.save();
    meta.ctx.globalCompositeOperation='destination-out';
    meta.ctx.fillStyle='rgba(0,0,0,1)';
    meta.ctx.fillRect(0,0,meta.w,meta.h);
    meta.ctx.restore();
  }
  function revealAll() { clearMeta(luckyMeta); clearMeta(gameMeta); }

  // 한 캔버스에 포인터 이벤트 묶기 (down/move/up)
  let lastX=0, lastY=0, activeCanvas=null;
  function bindScratch(canvas, meta) {
    function down(e) {
      if (state.phase!=='playing'||state.revealed) return;
      e.preventDefault();
      state.scratching=true; activeCanvas=canvas;
      state._lastTs=performance.now(); state._lastCX=e.clientX; state._lastCY=e.clientY;
      const p=canvasPos(canvas,e.clientX,e.clientY); lastX=p.x; lastY=p.y;
      canvas.setPointerCapture(e.pointerId);
    }
    function move(e) {
      if (!state.scratching||state.revealed||activeCanvas!==canvas) return;
      if ((e.buttons&1)===0&&e.pointerType!=='touch') return;
      e.preventDefault();
      const now=performance.now();
      const dt=Math.max(8,now-(state._lastTs||now));
      const speed=Math.hypot(e.clientX-state._lastCX,e.clientY-state._lastCY)/dt;
      state._lastTs=now; state._lastCX=e.clientX; state._lastCY=e.clientY;
      const p=canvasPos(canvas,e.clientX,e.clientY);
      scratchLine(canvas,meta.ctx,lastX,lastY,p.x,p.y,state.brush);
      spawnParticles(e.clientX,e.clientY,speed);
      lastX=p.x; lastY=p.y;
      playScratch(speed);
      // 게임 칸이 70% 이상 긁히면 자동으로 결과 공개
      if (canvas===el.canvasGame && now-state.lastProgressCheck>200) {
        state.lastProgressCheck=now;
        if (clearedRatio()>=0.7) { revealAll(); showResult(); }
      }
    }
    function up(e) {
      state.scratching=false; activeCanvas=null;
      try { canvas.releasePointerCapture(e.pointerId); } catch(_){}
    }
    canvas.addEventListener('pointerdown',  down,  {passive:false});
    canvas.addEventListener('pointermove',  move,  {passive:false});
    canvas.addEventListener('pointerup',    up);
    canvas.addEventListener('pointercancel',up);
    canvas.addEventListener('pointerleave', e=>{if(activeCanvas===canvas)up(e);});
  }


  /* ===== 11. 결과 모달 ================================== */
  function showResult() {
    if (state.revealed) return;
    state.revealed = true;
    el.scratchCursor.style.display = 'none';
    setCursorDefault();
    const t = state.ticket;
    if (t.isWin) { state.balance += t.winAmount; updateBalance(); }

    // 히스토리에 누적 (최신순)
    state.history.unshift({
      ts: Date.now(),
      serial: t.serial,
      cost: TICKET_PRICE,
      win: t.winAmount,
    });
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    saveState();

    el.confettiHost.innerHTML = '';

    if (t.isWin) {
      el.resultTitle.textContent = '당첨!';
      el.resultTitle.className   = 'modal-title';
      el.resultBody.innerHTML    = `<span class="amount">${fmt(t.winAmount)}</span><span class="sub">일치 칸 최고 상금 지급</span>`;

      // 티켓 가볍게 펄스 + 폭죽 + 효과음
      el.ticketWrap.classList.remove('win-bounce');
      void el.ticketWrap.offsetWidth;
      el.ticketWrap.classList.add('win-bounce');
      setTimeout(()=>el.ticketWrap.classList.remove('win-bounce'),900);

      spawnConfetti(); playWin();
    } else {
      el.resultTitle.textContent = '아쉽네요';
      el.resultTitle.className   = 'modal-title lose-shake';
      el.resultBody.textContent  = '꽝! 다음 기회에';
      playLose();
    }

    el.resultModal.style.display = 'flex';
    el.btnAgain.disabled = !canBuy().ok;
  }


  /* ===== 12. 통계 모달 ================================== */
  function computeStats() {
    const h = state.history;
    let totalCost = 0, totalWin = 0, winCount = 0, maxWin = 0;
    for (const e of h) {
      totalCost += e.cost;
      totalWin  += e.win;
      if (e.win > 0) { winCount++; if (e.win > maxWin) maxWin = e.win; }
    }
    return {
      count: h.length,
      totalCost, totalWin,
      profit: totalWin - totalCost,
      rate: h.length ? (winCount / h.length) * 100 : 0,
      maxWin,
    };
  }

  function formatTs(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2,'0');
    return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderStats() {
    const s = computeStats();
    el.statCount.textContent = s.count.toLocaleString('ko-KR');
    el.statRate.textContent  = s.rate.toFixed(1) + '%';
    el.statCost.textContent  = fmt(s.totalCost);
    el.statWin.textContent   = fmt(s.totalWin);
    el.statMax.textContent   = fmt(s.maxWin);

    el.statProfit.textContent = (s.profit > 0 ? '+' : '') + fmt(s.profit);
    el.statProfit.className   = 'stat-val ' + (s.profit > 0 ? 'pos' : s.profit < 0 ? 'neg' : '');

    // 일일 한도 진행률
    ensureToday();
    const spent = state.dailySpent.amount;
    const limit = state.dailyLimit;
    el.dailySpentVal.textContent = fmt(spent);
    el.dailyLimitVal.textContent = limit ? fmt(limit) : '없음';
    if (limit) {
      const ratio = Math.min(1, spent / limit);
      el.dailyBar.style.display = 'block';
      el.dailyBarFill.style.width = (ratio * 100).toFixed(1) + '%';
      const over = spent >= limit;
      el.dailyBarFill.classList.toggle('over', over);
      el.dailySpentVal.classList.toggle('over', over);
    } else {
      el.dailyBar.style.display = 'none';
      el.dailySpentVal.classList.remove('over');
    }

    // 최근 100건 히스토리
    if (state.history.length === 0) {
      el.historyList.innerHTML = '<div class="history-empty">아직 기록이 없습니다</div>';
    } else {
      el.historyList.innerHTML = state.history.map(e => {
        const win = e.win > 0;
        const right = win
          ? `<span class="history-result win">+${fmt(e.win)}</span>`
          : `<span class="history-result lose">꽝</span>`;
        return `<div class="history-item">
          <span class="history-serial">${formatTs(e.ts)} · ${e.serial}</span>
          ${right}
        </div>`;
      }).join('');
    }
  }

  // 통계 모달 열기/닫기/초기화
  el.btnStats.addEventListener('click', () => {
    renderStats();
    el.statsModal.style.display = 'flex';
  });
  el.btnStatsClose.addEventListener('click', () => {
    el.statsModal.style.display = 'none';
  });
  el.btnResetStats.addEventListener('click', () => {
    if (!confirm('기록을 모두 삭제하시겠습니까? 잔액은 유지됩니다.')) return;
    state.history = [];
    saveState();
    renderStats();
  });
  el.statsModal.addEventListener('click', (e) => {
    if (e.target === el.statsModal) el.statsModal.style.display = 'none';
  });

  // 일일 한도 편집 (prompt 사용)
  el.btnEditLimit.addEventListener('click', () => {
    const cur = state.dailyLimit ? String(state.dailyLimit) : '';
    const input = window.prompt('일일 한도 금액(원). 비우면 한도 해제.', cur);
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed === '') {
      state.dailyLimit = null;
    } else {
      const n = Number(trimmed.replace(/[^0-9]/g,''));
      if (!isFinite(n) || n <= 0) { alert('0보다 큰 숫자를 입력하세요.'); return; }
      state.dailyLimit = Math.floor(n);
    }
    saveState();
    renderStats();
    updateBalance();
  });


  /* ===== 13. 충전 모달 ================================== */
  function recharge(amt) {
    state.balance += amt;
    saveState();
    updateBalance();
  }
  el.btnRecharge.addEventListener('click', () => {
    el.rechargeBalance.textContent = fmt(state.balance);
    el.rechargeModal.style.display = 'flex';
  });
  el.btnRechargeClose.addEventListener('click', () => {
    el.rechargeModal.style.display = 'none';
  });
  el.rechargeModal.addEventListener('click', (e) => {
    if (e.target === el.rechargeModal) el.rechargeModal.style.display = 'none';
  });
  el.rechargeModal.querySelectorAll('.recharge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amt = Number(btn.getAttribute('data-amt'));
      if (!isFinite(amt) || amt <= 0) return;
      recharge(amt);
    });
  });


  /* ===== 14. 라운드 시작 / 컨트롤 ======================= */
  function startRound() {
    ensureToday();
    state.dailySpent.amount += TICKET_PRICE;
    state.balance  -= TICKET_PRICE;
    state.ticket    = generateTicket();
    state.phase     = 'playing';
    state.revealed  = false;
    state.lastProgressCheck = 0;
    setCursorNone();
    updateBalance();
    renderTicket();
    saveState();
    el.btnAgain.disabled = !canBuy().ok;
    requestAnimationFrame(() => requestAnimationFrame(resizeCanvases));
  }

  // 시작 화면 "티켓 구매"
  el.btnBuy.addEventListener('click', () => {
    const ok = canBuy();
    if (!ok.ok) {
      el.buyHint.textContent = ok.msg;
      el.buyHint.style.display = 'block';
      return;
    }
    el.buyHint.style.display = 'none';
    el.startOverlay.style.display = 'none';
    startRound();
  });

  el.audioToggle.addEventListener('change', () => { state.audio = el.audioToggle.checked; });

  // 전부 벗기기 (강제 공개)
  el.btnReveal.addEventListener('click', () => {
    if (state.phase!=='playing'||state.revealed) return;
    revealAll(); showResult();
  });

  // 다시 긁기 (잔액·한도 OK면 새 라운드, 아니면 시작 화면 복귀)
  el.btnAgain.addEventListener('click', () => {
    el.resultModal.style.display = 'none';
    if (!canBuy().ok) {
      updateBalance();
      el.startOverlay.style.display = 'flex';
      state.phase = 'idle';
      return;
    }
    startRound();
  });

  el.btnModalClose.addEventListener('click', () => {
    el.resultModal.style.display = 'none';
  });

  window.addEventListener('resize', () => {
    if (state.phase==='playing'&&!state.revealed) resizeCanvases();
  });

  bindScratch(el.canvasLucky, luckyMeta);
  bindScratch(el.canvasGame,  gameMeta);


  /* ===== 15. 커서 ======================================= */
  // 스크래치 중에는 시스템 커서를 숨기고 원형 가이드 표시
  const scratchCanvases = [el.canvasLucky, el.canvasGame];
  const ticketBody = document.querySelector('.ticket-body');

  function applyCursorSize() {
    const d = state.brush + 'px';
    el.scratchCursor.style.width  = d;
    el.scratchCursor.style.height = d;
  }

  function setCursorNone() {
    ticketBody.style.cursor = 'none';
    scratchCanvases.forEach(c => { c.style.cursor = 'none'; });
  }
  function setCursorDefault() {
    ticketBody.style.cursor = '';
    scratchCanvases.forEach(c => { c.style.cursor = 'default'; });
  }

  ticketBody.addEventListener('pointerenter', () => {
    if (state.phase !== 'playing' || state.revealed) return;
    applyCursorSize();
    el.scratchCursor.style.display = 'block';
  }, { passive: true });

  ticketBody.addEventListener('pointerleave', () => {
    el.scratchCursor.style.display = 'none';
  }, { passive: true });

  ticketBody.addEventListener('pointermove', e => {
    if (state.phase !== 'playing' || state.revealed) return;
    el.scratchCursor.style.left = e.clientX + 'px';
    el.scratchCursor.style.top  = e.clientY + 'px';
  }, { passive: true });

  el.brushSize.addEventListener('input', () => {
    state.brush = Number(el.brushSize.value);
    el.brushVal.textContent = el.brushSize.value;
    applyCursorSize();
  });
  el.brushVal.textContent = el.brushSize.value;


  /* ===== 16. 초기화 ===================================== */
  loadState();
  updateBalance();
})();
