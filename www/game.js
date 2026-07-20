(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const UI = Object.fromEntries([
    'score','level','highScore','pauseBtn','startScreen','startBtn','howBtn','howScreen','howCloseBtn',
    'pauseScreen','resumeBtn','restartPauseBtn','gameOverScreen','finalScore','newRecord','restartBtn',
    'leftBtn','rightBtn','climbBtn'
  ].map(id => [id, document.querySelector('#' + id)]));

  const assets = {
    bg: image('assets/warehouse-bg.png'),
    worker: image('assets/worker-sheet.png'),
    crates: image('assets/crates-sheet.png')
  };

  const COLS = 10;
  const ROWS = 7;
  const CELL = 58;
  const BOARD_X = (W - COLS * CELL) / 2;
  const BOARD_Y = 106;
  const FLOOR_Y = BOARD_Y + ROWS * CELL;
  const CRATE_SEGMENTS = 5;
  const WORKER_SEGMENTS = 6;

  let state = 'menu';
  let board, player, falling, particles, floaters;
  let score = 0, level = 1, lines = 0, nextDrop = 0, lastTime = 0;
  let shake = 0, flash = 0, moveCooldown = 0;
  let highScore = Number(localStorage.getItem('cargoPanicHighScore') || 0);
  UI.highScore.textContent = highScore;

  function image(src) {
    const img = new Image();
    img.src = src;
    return img;
  }

  function reset() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    player = { col: 4, row: ROWS - 1, facing: 1, frame: 0, walking: 0, squash: 0 };
    falling = null;
    particles = [];
    floaters = [];
    score = 0; level = 1; lines = 0; nextDrop = 1150; shake = 0; flash = 0;
    updateHud();
  }

  function startGame() {
    reset();
    hideAll();
    state = 'playing';
    lastTime = performance.now();
  }

  function hideAll() {
    document.querySelectorAll('.overlay').forEach(x => x.classList.remove('visible'));
  }

  function togglePause(forceResume = false) {
    if (state === 'playing' && !forceResume) {
      state = 'paused'; UI.pauseScreen.classList.add('visible');
    } else if (state === 'paused') {
      state = 'playing'; UI.pauseScreen.classList.remove('visible'); lastTime = performance.now();
    }
  }

  function gameOver() {
    if (state !== 'playing') return;
    state = 'over';
    UI.finalScore.textContent = score.toLocaleString('ru-RU');
    const isRecord = score > highScore;
    if (isRecord) {
      highScore = score;
      localStorage.setItem('cargoPanicHighScore', highScore);
      UI.highScore.textContent = highScore.toLocaleString('ru-RU');
    }
    UI.newRecord.classList.toggle('visible', isRecord);
    setTimeout(() => UI.gameOverScreen.classList.add('visible'), 380);
    vibrate([80, 40, 180]);
  }

  function crateType() {
    const r = Math.random();
    return r < .55 ? 0 : r < .76 ? 1 : r < .89 ? 2 : r < .96 ? 3 : 4;
  }

  function spawnCrate() {
    if (falling) return;
    const preferred = Math.floor(Math.random() * COLS);
    const available = [...Array(COLS).keys()].filter(c => !board[0][c] && !(player.row === 0 && player.col === c));
    if (!available.length) return gameOver();
    const col = available.includes(preferred) ? preferred : available[Math.floor(Math.random() * available.length)];
    falling = { col, y: BOARD_Y - CELL * 1.2, row: -1, type: crateType(), speed: 130 + level * 13, warning: 380 };
  }

  function update(dt) {
    if (state !== 'playing') return;
    moveCooldown = Math.max(0, moveCooldown - dt);
    player.walking = Math.max(0, player.walking - dt);
    player.squash = Math.max(0, player.squash - dt);
    shake = Math.max(0, shake - dt * 20);
    flash = Math.max(0, flash - dt * 3);
    particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt; p.life -= dt; p.rot += p.spin * dt; });
    particles = particles.filter(p => p.life > 0);
    floaters.forEach(f => { f.y -= 32 * dt; f.life -= dt; });
    floaters = floaters.filter(f => f.life > 0);

    if (!falling) {
      nextDrop -= dt * 1000;
      if (nextDrop <= 0) spawnCrate();
    } else if (falling.warning > 0) {
      falling.warning -= dt * 1000;
    } else {
      const targetRow = landingRow(falling.col);
      const targetY = BOARD_Y + targetRow * CELL;
      falling.y += falling.speed * dt;
      if (falling.y >= targetY) {
        falling.y = targetY;
        landCrate(targetRow);
      } else if (player.col === falling.col) {
        const py = BOARD_Y + player.row * CELL;
        if (falling.y + CELL * .7 > py && falling.y < py + CELL * .7) gameOver();
      }
    }
    applyPlayerGravity();
  }

  function landingRow(col) {
    let row = ROWS - 1;
    while (row >= 0 && board[row][col]) row--;
    return row;
  }

  function landCrate(row) {
    if (row < 0 || (player.col === falling.col && player.row === row)) return gameOver();
    const landed = falling;
    board[row][landed.col] = { type: landed.type };
    falling = null;
    shake = 5;
    vibrate(22);
    burst(BOARD_X + landed.col * CELL + CELL / 2, BOARD_Y + row * CELL + CELL, landed.type);
    if (landed.type === 4) addScore(250, landed.col, row);
    if (landed.type === 2) explodeHazard(landed.col, row);
    clearRows();
    nextDrop = Math.max(430, 1420 - level * 80);
  }

  function explodeHazard(col, row) {
    // Hazard crates are valuable but unstable: clear one random adjacent occupied crate.
    const near = [[col-1,row],[col+1,row],[col,row+1]].filter(([c,r]) => inBounds(c,r) && board[r][c]);
    if (near.length && Math.random() < .42) {
      const [c,r] = near[Math.floor(Math.random()*near.length)];
      board[r][c] = null;
      addScore(80, c, r);
      burst(BOARD_X + c*CELL + CELL/2, BOARD_Y + r*CELL + CELL/2, 2, 16);
    }
  }

  function clearRows() {
    const full = [];
    for (let r = 0; r < ROWS; r++) if (board[r].every(Boolean)) full.push(r);
    if (!full.length) return;
    full.forEach(r => {
      for (let c = 0; c < COLS; c++) burst(BOARD_X + c*CELL + CELL/2, BOARD_Y + r*CELL + CELL/2, board[r][c].type, 5);
      board.splice(r, 1); board.unshift(Array(COLS).fill(null));
    });
    lines += full.length;
    level = Math.floor(lines / 3) + 1;
    addScore(1000 * full.length * level, 5, 3);
    flash = .55;
    updateHud();
  }

  function addScore(value, col, row) {
    score += value;
    floaters.push({ text: '+' + value, x: BOARD_X + col*CELL, y: BOARD_Y + row*CELL, life: 1 });
    updateHud();
  }

  function updateHud() {
    UI.score.textContent = score.toLocaleString('ru-RU');
    UI.level.textContent = level;
  }

  function move(dir) {
    if (state !== 'playing' || moveCooldown > 0) return;
    player.facing = dir;
    const nc = player.col + dir;
    if (nc < 0 || nc >= COLS) return;
    const target = board[player.row][nc];
    if (!target) {
      player.col = nc; player.walking = .18; moveCooldown = .09;
    } else {
      const beyond = nc + dir;
      if (beyond >= 0 && beyond < COLS && !board[player.row][beyond] && !(falling && falling.col === beyond && Math.abs(falling.y - (BOARD_Y + player.row*CELL)) < CELL)) {
        board[player.row][beyond] = target;
        board[player.row][nc] = null;
        player.col = nc; player.frame = 3; player.walking = .2; moveCooldown = .16;
        addScore(target.type === 3 ? 35 : 15, beyond, player.row);
        if (target.type === 3) {
          board[player.row][beyond] = null;
          burst(BOARD_X + beyond*CELL + CELL/2, BOARD_Y + player.row*CELL + CELL/2, 3, 18);
        }
        clearRows(); vibrate(12);
      }
    }
    applyPlayerGravity();
  }

  function climb() {
    if (state !== 'playing' || moveCooldown > 0) return;
    const front = player.col + player.facing;
    const up = player.row - 1;
    if (up < 0) return;
    if (front >= 0 && front < COLS && board[player.row][front] && !board[up][front] && !board[up][player.col]) {
      player.col = front; player.row = up; player.walking = .22; moveCooldown = .2; vibrate(10);
    }
  }

  function applyPlayerGravity() {
    while (player.row < ROWS - 1 && !board[player.row + 1][player.col]) player.row++;
  }

  function inBounds(c,r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }

  function burst(x, y, type = 0, count = 8) {
    const colors = ['#b86a2e','#7e9aab','#f6b21c','#e4553d','#ffd85a'];
    for (let i=0;i<count;i++) particles.push({ x, y, vx:(Math.random()-.5)*210, vy:-50-Math.random()*190, life:.35+Math.random()*.5, rot:0, spin:(Math.random()-.5)*9, color:colors[type] });
  }

  function draw() {
    ctx.save();
    if (shake) ctx.translate((Math.random()-.5)*shake, (Math.random()-.5)*shake);
    drawBackground();
    drawBoard();
    drawFalling();
    drawPlayer();
    drawEffects();
    ctx.restore();
    if (flash) { ctx.fillStyle = `rgba(255,227,151,${flash*.42})`; ctx.fillRect(0,0,W,H); }
  }

  function drawBackground() {
    if (assets.bg.complete) ctx.drawImage(assets.bg, 0, 0, W, H);
    else { ctx.fillStyle = '#b96832'; ctx.fillRect(0,0,W,H); }
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'rgba(20,32,35,.22)'); g.addColorStop(.55,'rgba(255,170,72,.02)'); g.addColorStop(1,'rgba(20,26,29,.28)');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = 'rgba(23,36,42,.60)';
    roundRect(BOARD_X-10, BOARD_Y-10, COLS*CELL+20, ROWS*CELL+20, 15); ctx.fill();
    for (let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) {
      ctx.fillStyle = (r+c)%2 ? 'rgba(255,255,255,.025)' : 'rgba(0,0,0,.025)';
      ctx.fillRect(BOARD_X+c*CELL,BOARD_Y+r*CELL,CELL,CELL);
    }
    ctx.strokeStyle = 'rgba(255,244,220,.12)'; ctx.lineWidth=1;
    for(let c=0;c<=COLS;c++){ ctx.beginPath();ctx.moveTo(BOARD_X+c*CELL,BOARD_Y);ctx.lineTo(BOARD_X+c*CELL,FLOOR_Y);ctx.stroke(); }
    ctx.fillStyle='#121e22'; ctx.fillRect(BOARD_X-18,FLOOR_Y, COLS*CELL+36,8);
  }

  function drawBoard() {
    for (let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(board[r][c]) drawCrate(c,r,board[r][c].type);
  }

  function drawCrate(col,row,type,yOverride=null) {
    const x=BOARD_X+col*CELL+2, y=yOverride ?? BOARD_Y+row*CELL+2, size=CELL-4;
    if (!assets.crates.complete) { ctx.fillStyle='#b76b2e';ctx.fillRect(x,y,size,size);return; }
    const sw=assets.crates.naturalWidth/CRATE_SEGMENTS, sh=assets.crates.naturalHeight;
    ctx.drawImage(assets.crates, type*sw,0,sw,sh, x,y,size,size);
  }

  function drawFalling() {
    if(!falling) return;
    const x=BOARD_X+falling.col*CELL+CELL/2;
    if(falling.warning>0){
      const pulse=.55+.45*Math.sin(performance.now()*.018);
      ctx.fillStyle=`rgba(239,76,54,${pulse})`;
      ctx.beginPath();ctx.moveTo(x,BOARD_Y-5);ctx.lineTo(x-13,BOARD_Y-28);ctx.lineTo(x+13,BOARD_Y-28);ctx.closePath();ctx.fill();
    }
    ctx.strokeStyle='#282f30';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,falling.y+5);ctx.stroke();
    drawCrate(falling.col,0,falling.type,falling.y);
  }

  function drawPlayer() {
    if(!player || !assets.worker.complete) return;
    let frame = 0;
    if(player.walking>0) frame = player.frame===3 ? 3 : (Math.floor(performance.now()/110)%2)+1;
    const sw=assets.worker.naturalWidth/WORKER_SEGMENTS, sh=assets.worker.naturalHeight;
    const h=CELL*1.34, w=h*(sw/sh);
    const x=BOARD_X+player.col*CELL+CELL/2;
    const y=BOARD_Y+player.row*CELL+CELL-h;
    ctx.save();ctx.translate(x,y+h/2);ctx.scale(player.facing,1);ctx.drawImage(assets.worker,frame*sw,0,sw,sh,-w/2,-h/2,w,h);ctx.restore();
  }

  function drawEffects() {
    particles.forEach(p=>{ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.fillStyle=p.color;ctx.fillRect(-3,-3,6,6);ctx.restore();});
    ctx.textAlign='center';ctx.font='900 22px system-ui';ctx.strokeStyle='#17242a';ctx.lineWidth=5;
    floaters.forEach(f=>{ctx.globalAlpha=Math.max(0,f.life);ctx.strokeText(f.text,f.x,f.y);ctx.fillStyle='#fff4dc';ctx.fillText(f.text,f.x,f.y);});ctx.globalAlpha=1;
  }

  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
  function vibrate(pattern){ if(navigator.vibrate) navigator.vibrate(pattern); }

  function bindHold(el, action) {
    let timer=null;
    const start=e=>{e.preventDefault();action();timer=setInterval(action,115);};
    const end=e=>{e.preventDefault();clearInterval(timer);timer=null;};
    el.addEventListener('pointerdown',start); ['pointerup','pointercancel','pointerleave'].forEach(n=>el.addEventListener(n,end));
  }

  bindHold(UI.leftBtn,()=>move(-1)); bindHold(UI.rightBtn,()=>move(1));
  UI.climbBtn.addEventListener('pointerdown',e=>{e.preventDefault();climb();});
  UI.startBtn.onclick=startGame; UI.restartBtn.onclick=startGame; UI.restartPauseBtn.onclick=startGame;
  UI.pauseBtn.onclick=()=>togglePause(); UI.resumeBtn.onclick=()=>togglePause(true);
  UI.howBtn.onclick=()=>UI.howScreen.classList.add('visible');
  UI.howCloseBtn.onclick=()=>UI.howScreen.classList.remove('visible');
  addEventListener('keydown',e=>{
    if(['ArrowLeft','KeyA'].includes(e.code)) move(-1);
    if(['ArrowRight','KeyD'].includes(e.code)) move(1);
    if(['ArrowUp','KeyW','Space'].includes(e.code)) climb();
    if(['Escape','KeyP'].includes(e.code)) togglePause();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden && state==='playing') togglePause();});

  function loop(now) {
    const dt=Math.min(.034,(now-lastTime)/1000||0); lastTime=now;
    update(dt); draw(); requestAnimationFrame(loop);
  }
  reset(); requestAnimationFrame(loop);
  if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
