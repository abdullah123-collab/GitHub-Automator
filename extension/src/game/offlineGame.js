// Offline balloon game for the network-error webview
// This file contains pure browser JavaScript (no Node.js APIs)
// It is read by extension.js and injected into the webview HTML template

let animationFrameId = null;
function initOfflineGame() {
  const canvas = document.getElementById('offlineGameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('game-overlay');
  const playAgainBtn = document.getElementById('play-again-btn');
  const scoreEl = document.getElementById('game-score');
  const bestEl = document.getElementById('game-best');
  const statusIndicator = document.getElementById('network-status-indicator');
  const onlineNotification = document.getElementById('network-online-notification');
  const container = document.getElementById('offline-game-container');
  
  let gameRunning = false;
  let score = 0;
  let bestScore = 0;
  
  let balloon = {
    x: 35,
    y: 50,
    width: 20,
    height: 30,
    vy: 0,
    gravity: 0.08,
    lift: -0.22,
    descendForce: 0.22,
    friction: 0.95,
    maxSpeed: 3.0,
    angle: 0
  };
  
  let obstacles = [];
  let clouds = [];
  let keysPressed = {};
  let isMousePressed = false;
  let obstacleSpawnTimer = 0;
  let gameSpeed = 1.8;
  let time = 0;
  let lastTime = 0;
  
  if (window.balloonGameCleanup) {
    window.balloonGameCleanup();
  }
  
  const listeners = [];
  function addLoggedListener(target, event, callback, options) {
    target.addEventListener(event, callback, options);
    listeners.push({ target, event, callback, options });
  }
  
  window.balloonGameCleanup = function() {
    gameRunning = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    for (const l of listeners) {
      l.target.removeEventListener(l.event, l.callback, l.options);
    }
    listeners.length = 0;
  };
  
  function loadBestScore() {
    let storedBest = 0;
    try {
      const localVal = localStorage.getItem('balloon_best_score');
      if (localVal !== null) {
        storedBest = parseInt(localVal, 10) || 0;
      }
    } catch (e) {}
    bestScore = storedBest;
    if (bestEl) bestEl.innerText = Math.floor(bestScore);
  }
  
  function saveBestScore() {
    if (score > bestScore) {
      bestScore = score;
      if (bestEl) bestEl.innerText = Math.floor(bestScore);
      try {
        localStorage.setItem('balloon_best_score', Math.floor(bestScore));
      } catch (e) {}
    }
  }
  
  function resize() {
    if (container && canvas) {
      const width = container.clientWidth;
      const height = Math.max(80, container.clientHeight - 22);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
  }
  
  function initClouds() {
    clouds = [];
    const numClouds = 3;
    for (let i = 0; i < numClouds; i++) {
      clouds.push({
        x: Math.random() * (canvas.width || 280),
        y: 10 + Math.random() * ((canvas.height || 120) - 30),
        size: 8 + Math.random() * 12,
        speed: 0.15 + Math.random() * 0.15
      });
    }
  }
  
  function drawCloud(ctx, x, y, size) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.arc(x + size * 0.6, y - size * 0.4, size * 0.8, 0, Math.PI * 2);
    ctx.arc(x + size * 1.2, y, size * 0.7, 0, Math.PI * 2);
    ctx.arc(x + size * 0.6, y + size * 0.2, size * 0.6, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }
  
  function drawBalloon(ctx, x, y, isThrusting, angle) {
    ctx.save();
    ctx.translate(x + 10, y + 15);
    ctx.rotate(angle);
    ctx.strokeStyle = 'var(--vscode-foreground, #cccccc)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5, 2);
    ctx.lineTo(-4, 10);
    ctx.moveTo(5, 2);
    ctx.lineTo(4, 10);
    ctx.stroke();
    ctx.fillStyle = '#8d6e63';
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 1;
    ctx.fillRect(-5, 10, 10, 6);
    ctx.strokeRect(-5, 10, 10, 6);
    if (isThrusting && Math.random() > 0.2) {
      ctx.fillStyle = '#ff9100';
      ctx.beginPath();
      ctx.moveTo(-2, 8);
      ctx.lineTo(0, 1 + Math.random() * 3);
      ctx.lineTo(2, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff3d00';
      ctx.beginPath();
      ctx.moveTo(-1, 8);
      ctx.lineTo(0, 3 + Math.random() * 2);
      ctx.lineTo(1, 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, -6, 9, 0.15 * Math.PI, 0.85 * Math.PI, true);
    ctx.lineTo(-3, 2);
    ctx.lineTo(3, 2);
    ctx.closePath();
    const grad = ctx.createLinearGradient(-9, -6, 9, -6);
    grad.addColorStop(0, '#e53935');
    grad.addColorStop(0.3, '#fdd835');
    grad.addColorStop(0.7, '#fdd835');
    grad.addColorStop(1, '#e53935');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
  
  function drawBird(ctx, x, y, flap) {
    ctx.save();
    ctx.strokeStyle = 'var(--vscode-errorForeground, #f48771)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (flap) {
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 4, y - 5, x + 8, y - 2);
      ctx.quadraticCurveTo(x + 12, y - 5, x + 16, y);
    } else {
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 4, y + 3, x + 8, y);
      ctx.quadraticCurveTo(x + 12, y + 3, x + 16, y);
    }
    ctx.stroke();
    ctx.fillStyle = 'var(--vscode-foreground, #cccccc)';
    ctx.beginPath();
    ctx.arc(x + 8, y - 1, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  
  function drawStormCloud(ctx, x, y, time) {
    ctx.save();
    ctx.fillStyle = 'rgba(70, 80, 95, 0.85)';
    ctx.beginPath();
    ctx.arc(x + 7, y + 8, 7, 0, Math.PI * 2);
    ctx.arc(x + 14, y + 5, 10, 0, Math.PI * 2);
    ctx.arc(x + 21, y + 8, 7, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (Math.floor(time / 15) % 4 === 0) {
      ctx.fillStyle = '#ffeb3b';
      ctx.beginPath();
      ctx.moveTo(x + 14, y + 12);
      ctx.lineTo(x + 11, y + 17);
      ctx.lineTo(x + 13, y + 17);
      ctx.lineTo(x + 10, y + 22);
      ctx.lineTo(x + 16, y + 15);
      ctx.lineTo(x + 13, y + 15);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  
  function updateNetworkStatus() {
    const offline = !navigator.onLine;
    if (statusIndicator) {
      statusIndicator.style.display = offline ? 'flex' : 'none';
    }
  }
  
  function handleKeyDown(e) {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'arrowup' || key === 'w' || key === ' ' || key === 'arrowdown' || key === 's') {
      keysPressed[key] = true;
      e.preventDefault();
      if (!gameRunning) {
        resetGame();
      }
    }
  }
  
  function handleKeyUp(e) {
    const key = e.key.toLowerCase();
    if (key === 'arrowup' || key === 'w' || key === ' ' || key === 'arrowdown' || key === 's') {
      keysPressed[key] = false;
      e.preventDefault();
    }
  }
  
  function handleMouseDown(e) {
    e.preventDefault();
    if (!gameRunning) {
      resetGame();
    } else {
      isMousePressed = true;
    }
  }
  
  function handleMouseUp() {
    isMousePressed = false;
  }
  
  function handleTouchStart(e) {
    e.preventDefault();
    if (!gameRunning) {
      resetGame();
    } else {
      isMousePressed = true;
    }
  }
  
  function handleTouchEnd() {
    isMousePressed = false;
  }
  
  function handleOnline() {
    updateNetworkStatus();
    if (onlineNotification) {
      onlineNotification.style.display = 'block';
      setTimeout(() => {
        onlineNotification.style.display = 'none';
      }, 2500);
    }
  }
  
  function handleOffline() {
    updateNetworkStatus();
  }
  
  addLoggedListener(window, 'keydown', handleKeyDown);
  addLoggedListener(window, 'keyup', handleKeyUp);
  addLoggedListener(canvas, 'mousedown', handleMouseDown);
  addLoggedListener(window, 'mouseup', handleMouseUp);
  addLoggedListener(canvas, 'touchstart', handleTouchStart, { passive: false });
  addLoggedListener(window, 'touchend', handleTouchEnd);
  addLoggedListener(window, 'resize', resize);
  addLoggedListener(window, 'online', handleOnline);
  addLoggedListener(window, 'offline', handleOffline);
  
  if (playAgainBtn) {
    playAgainBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetGame();
    };
  }
  
  function resetGame() {
    score = 0;
    if (scoreEl) scoreEl.innerText = '0';
    balloon.y = canvas.height / 2 - balloon.height / 2;
    balloon.vy = 0;
    balloon.angle = 0;
    obstacles = [];
    obstacleSpawnTimer = 0;
    gameSpeed = 1.8;
    time = 0;
    initClouds();
    gameRunning = true;
    overlay.style.display = 'none';
    lastTime = performance.now();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(gameLoop);
  }
  
  function updateGamePhysics(dtRatio) {
    time++;
    const thrustUp = keysPressed['arrowup'] || keysPressed['w'] || keysPressed[' '] || isMousePressed;
    const thrustDown = keysPressed['arrowdown'] || keysPressed['s'];
    let targetVy = balloon.vy;
    if (thrustUp) {
      targetVy += balloon.lift * dtRatio;
    } else if (thrustDown) {
      targetVy += balloon.descendForce * dtRatio;
    } else {
      targetVy += balloon.gravity * dtRatio;
    }
    targetVy *= Math.pow(balloon.friction, dtRatio);
    targetVy = Math.max(-balloon.maxSpeed, Math.min(balloon.maxSpeed, targetVy));
    balloon.vy = targetVy;
    balloon.y += balloon.vy * dtRatio;
    balloon.angle = balloon.vy * 0.05;
    if (balloon.y < 3) {
      balloon.y = 3;
      balloon.vy = 0;
    }
    if (balloon.y > canvas.height - balloon.height - 3) {
      balloon.y = canvas.height - balloon.height - 3;
      balloon.vy = 0;
    }
    for (const cloud of clouds) {
      cloud.x -= cloud.speed * gameSpeed * dtRatio;
      if (cloud.x + cloud.size * 2 < 0) {
        cloud.x = canvas.width + 10;
        cloud.y = 10 + Math.random() * (canvas.height - 30);
      }
    }
    obstacleSpawnTimer += dtRatio;
    const spawnInterval = Math.max(50, 110 - Math.floor(score / 50) * 8);
    if (obstacleSpawnTimer >= spawnInterval) {
      obstacleSpawnTimer = 0;
      const type = Math.random() > 0.5 ? 0 : 1;
      const obsHeight = type === 0 ? 10 : 16;
      const obsY = 10 + Math.random() * (canvas.height - obsHeight - 15);
      obstacles.push({
        x: canvas.width + 10,
        y: obsY,
        type: type,
        width: type === 0 ? 16 : 28,
        height: obsHeight,
        speed: gameSpeed + (type === 0 ? 0.4 : 0)
      });
    }
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obs = obstacles[i];
      obs.x -= obs.speed * dtRatio;
      const bLeft = balloon.x + 3;
      const bRight = balloon.x + balloon.width - 3;
      const bTop = balloon.y + 3;
      const bBottom = balloon.y + balloon.height - 3;
      const oLeft = obs.x;
      const oRight = obs.x + obs.width;
      const oTop = obs.y;
      const oBottom = obs.y + obs.height;
      if (bLeft < oRight && bRight > oLeft && bTop < oBottom && bBottom > oTop) {
        gameOver();
        return;
      }
      if (obs.x + obs.width < 0) {
        obstacles.splice(i, 1);
        score += 10;
        if (scoreEl) scoreEl.innerText = Math.floor(score);
        saveBestScore();
        if (score > 0 && score % 100 === 0) {
          gameSpeed += 0.25;
        }
      }
    }
    score += 0.05 * dtRatio;
    if (scoreEl) scoreEl.innerText = Math.floor(score);
    saveBestScore();
  }
  
  function renderGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const cloud of clouds) {
      drawCloud(ctx, cloud.x, cloud.y, cloud.size);
    }
    for (const obs of obstacles) {
      if (obs.type === 0) {
        const flap = Math.floor(time / 10) % 2 === 0;
        drawBird(ctx, obs.x, obs.y, flap);
      } else {
        drawStormCloud(ctx, obs.x, obs.y, time);
      }
    }
    const thrustUp = keysPressed['ArrowUp'] || keysPressed['w'] || keysPressed['W'] || keysPressed[' '] || isMousePressed;
    drawBalloon(ctx, balloon.x, balloon.y, thrustUp, balloon.angle);
  }
  
  function gameOver() {
    gameRunning = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    saveBestScore();
    if (overlay && playAgainBtn) {
      const overlayTitle = document.getElementById('overlay-title');
      const overlayInstructions = document.getElementById('overlay-instructions');
      if (overlayTitle) {
        overlayTitle.innerText = 'Game Over';
        overlayTitle.style.color = '#f48771';
      }
      if (overlayInstructions) {
        overlayInstructions.innerHTML = 'SCORE: ' + Math.floor(score) + '<br>BEST: ' + Math.floor(bestScore);
      }
      playAgainBtn.innerText = 'PLAY AGAIN';
      overlay.style.display = 'flex';
    }
  }
  
  function gameLoop(timestamp) {
    if (!gameRunning) return;
    const dt = Math.min(timestamp - lastTime, 50);
    lastTime = timestamp;
    const dtRatio = dt / 16.67;
    updateGamePhysics(dtRatio);
    renderGame();
    if (gameRunning) {
      animationFrameId = requestAnimationFrame(gameLoop);
    }
  }
  
  resize();
  initClouds();
  loadBestScore();
  updateNetworkStatus();
  renderGame();
}
