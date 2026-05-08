/**
 * src/main.js
 * Game bootstrap sequence with P2P Swarm integration.
 */

import { registerAndClaim, initBridge } from '../sw/bridge.js';
import { initP2P } from './p2p/client.js';
import { startCacheWarming } from './cache-warmer.js';
import { createHUD } from './hud.js';

// 1. Setup Aesthetically Pleasing Terminal-style UI
const setupUI = () => {
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
    
    body {
      margin: 0;
      background: #050505;
      color: #00ff41; /* Matrix/Terminal green */
      font-family: 'JetBrains Mono', monospace;
      overflow: hidden;
      height: 100vh;
      width: 100vw;
    }

    #loading-screen {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 50% 50%, #111 0%, #000 100%);
      z-index: 10000;
      text-align: center;
    }

    .terminal-box {
      width: 90%;
      max-width: 600px;
      padding: 2.5rem;
      background: rgba(0, 0, 0, 0.8);
      border: 1px solid #1a1a1a;
      border-radius: 8px;
      box-shadow: 0 0 40px rgba(0, 255, 65, 0.05);
      position: relative;
      overflow: hidden;
    }

    .terminal-box::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 2px;
      background: #00ff41;
      opacity: 0.3;
    }

    .title {
      font-size: 1.5rem;
      margin-bottom: 2rem;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #00ff41;
    }

    .status-area {
      text-align: left;
      font-size: 0.85rem;
      line-height: 1.6;
      height: 200px;
      overflow-y: auto;
      scrollbar-width: none;
      mask-image: linear-gradient(to bottom, transparent, black 20%, black 80%, transparent);
    }

    .status-area::-webkit-scrollbar { display: none; }

    .status-line {
      margin-bottom: 0.4rem;
      opacity: 0;
      transform: translateX(-5px);
      animation: fadeIn 0.3s forwards;
    }

    .status-line::before {
      content: '>';
      margin-right: 12px;
      color: #00ff41;
      opacity: 0.6;
    }

    .error-text {
      color: #ff3e3e;
      font-weight: bold;
    }

    .error-text::before {
      content: '!';
      color: #ff3e3e;
    }

    .ready-text {
      color: #00d2ff;
      text-shadow: 0 0 10px rgba(0, 210, 255, 0.5);
    }

    @keyframes fadeIn {
      to { opacity: 1; transform: translateX(0); }
    }

    /* Scanline overlay */
    .scanlines {
      position: fixed;
      inset: 0;
      background: linear-gradient(
        rgba(18, 16, 16, 0) 50%,
        rgba(0, 0, 0, 0.1) 50%
      );
      background-size: 100% 4px;
      z-index: 10001;
      pointer-events: none;
      opacity: 0.3;
    }
  `;
  document.head.appendChild(style);

  const scanlines = document.createElement('div');
  scanlines.className = 'scanlines';
  document.body.appendChild(scanlines);

  const screen = document.createElement('div');
  screen.id = 'loading-screen';
  screen.innerHTML = `
    <div class="terminal-box">
      <div class="title" id="boot-title">Connecting to swarm...</div>
      <div class="status-area" id="boot-status"></div>
    </div>
  `;
  document.body.appendChild(screen);

  return {
    updateTitle: (t, isReady = false) => { 
      const el = document.getElementById('boot-title');
      el.textContent = t; 
      if (isReady) el.classList.add('ready-text');
    },
    addLog: (msg, isError = false) => {
      const container = document.getElementById('boot-status');
      const line = document.createElement('div');
      line.className = isError ? 'status-line error-text' : 'status-line';
      line.textContent = msg;
      container.appendChild(line);
      container.scrollTop = container.scrollHeight;
    },
    dismiss: () => {
      setTimeout(() => {
        screen.style.transition = 'opacity 1.5s ease-out, filter 1.5s ease-out';
        screen.style.opacity = '0';
        screen.style.filter = 'blur(20px)';
        scanlines.style.opacity = '0';
        setTimeout(() => {
          screen.remove();
          scanlines.remove();
        }, 1500);
      }, 2000);
    }
  };
};

const ui = setupUI();

/**
 * Main Async Bootstrap Flow
 */
try {
  // 1. Service Worker Handshake
  ui.addLog('Initializing Service Worker bridge...');
  try {
    await registerAndClaim();
    ui.addLog('Bridge established: SW_CLAIMED');
  } catch (swError) {
    ui.addLog('Service Worker failed to load', true);
    throw swError;
  }

  // 2. Initialize P2P Client
  ui.addLog('Booting LibP2P networking stack...');
  const p2pClient = await initP2P();
  ui.addLog('P2P Subsystems initialized.');

  // Track and display peer count updates
  let lastPeerCount = -1;
  const peerTracker = setInterval(() => {
    const currentCount = p2pClient.peers.length;
    if (currentCount !== lastPeerCount) {
      ui.addLog(`Swarm update: ${currentCount} peers connected.`);
      lastPeerCount = currentCount;
    }
  }, 1000);

  // 3. Load Asset Manifest
  ui.addLog('Loading resource manifest...');
  const response = await fetch('/src/data/manifest.json');
  if (!response.ok) throw new Error(`Manifest fetch failed [${response.status}]`);
  const manifest = await response.json();
  ui.addLog(`Manifest v${manifest.version} parsed.`);

  // 5. Finalize UI State
  clearInterval(peerTracker);
  const finalPeers = p2pClient.peers.length;
  ui.updateTitle(`Ready — ${finalPeers} peers connected`, true);
  ui.addLog('All systems operational.');

  // 6. Background Cache Warming
  const onWarmingProgress = (prog) => {
    const percent = Math.round((prog.totalDone / prog.totalNeeded) * 100);
    console.log(`[Cache Warmer] ${prog.totalDone}/${prog.totalNeeded} (${percent}%) - Cached: ${prog.path}`);
  };

  ui.addLog('Triggering background cache warming...');
  const cacheWarmer = await startCacheWarming(p2pClient, manifest, 1, onWarmingProgress);
  ui.addLog('Background warming process started.');

  // 7. Initialize HUD
  ui.addLog('Mounting system HUD...');
  const hud = createHUD(p2pClient, cacheWarmer);
  hud.mount();

  // 4. Initialize Bridge (Integrating HUD)
  ui.addLog('Linking P2P client to message bridge...');
  await initBridge(p2pClient, hud);
  ui.addLog('Network bridge finalized.');

  // 8. Start Game (Placeholder)
  console.log("Game would start here");
  ui.dismiss();

} catch (criticalError) {
  console.error('[Bootstrap Critical Failure]', criticalError);
  ui.updateTitle('Bootstrap Failed');
  ui.addLog(criticalError.message, true);
}
