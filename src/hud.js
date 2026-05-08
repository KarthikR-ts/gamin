/**
 * src/hud.js
 * Three.js-independent HUD overlay for P2P network monitoring and cache status.
 */

/**
 * Creates and returns a HUD object for monitoring P2P activity.
 * @param {Object} p2pClient - The P2P client instance.
 * @param {Object} cacheWarmer - The cache warmer controller returned by startCacheWarming.
 * @returns {Object} HUD controller {showTransfer, showCacheHit, showSeedFallback, mount, unmount}
 */
export function createHUD(p2pClient, cacheWarmer) {
  // 1. Create and Style Container
  const container = document.createElement('div');
  container.id = 'p2p-hud-overlay';
  Object.assign(container.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    width: '260px',
    padding: '15px',
    backgroundColor: 'rgba(10, 10, 10, 0.85)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    color: '#ffffff',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '11px',
    zIndex: '1000',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
    pointerEvents: 'none',
    userSelect: 'none'
  });

  // 2. Initial HTML Structure
  container.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 12px; color: #4facfe; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px; letter-spacing: 1px;">P2P SYSTEM HUD</div>
    
    <!-- PEER MAP -->
    <div style="margin-bottom: 15px;">
      <div style="margin-bottom: 6px; opacity: 0.7;">PEER MAP:</div>
      <div id="hud-peer-map" style="display: flex; gap: 12px; align-items: center;">
        <div class="peer-dot" id="dot-0" title="Laptop 1"></div>
        <div class="peer-dot" id="dot-1" title="Laptop 2"></div>
        <div class="peer-dot" id="dot-2" title="Laptop 3"></div>
        <div class="peer-dot" id="dot-3" title="Laptop 4"></div>
      </div>
    </div>

    <!-- TRANSFER INDICATOR -->
    <div style="margin-bottom: 15px; min-height: 1.4em;">
      <div id="hud-status" style="transition: color 0.3s ease;">IDLE</div>
    </div>

    <!-- CACHE WARMING BAR -->
    <div style="margin-bottom: 15px;">
      <div id="hud-warming-text" style="margin-bottom: 6px; display: flex; justify-content: space-between;">
        <span>WARMING:</span>
        <span id="hud-warming-stats">L2: 0% L3: 0%</span>
      </div>
      <div style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
        <div id="hud-warming-progress" style="height: 100%; width: 0%; background: #4facfe; transition: width 0.5s ease;"></div>
      </div>
    </div>

    <!-- EFFICIENCY STAT -->
    <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">
      <div id="hud-efficiency" style="color: #00ff41;">Saved 0.0 MB from server</div>
    </div>

    <style>
      .peer-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #333;
        border: 1px solid rgba(255,255,255,0.2);
        transition: all 0.4s ease;
      }
      .peer-dot.connected {
        background: #00ff41;
        box-shadow: 0 0 8px rgba(0, 255, 65, 0.5);
      }
      .peer-dot.blacklisted {
        background: #ff3e3e;
        box-shadow: 0 0 8px rgba(255, 62, 62, 0.5);
      }
      
      @keyframes hud-flash {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      .flashing {
        animation: hud-flash 1s infinite;
      }
    </style>
  `;

  // 3. Persistent State
  let totalSavedBytes = 0;
  let statusTimeout = null;

  // 4. Update Loops
  
  // Peer Map Update (every 2s)
  const peerInterval = setInterval(() => {
    const connectedPeers = p2pClient.node.getPeers(); // All connected peers
    const blacklisted = p2pClient.swarmManager.blacklistedPeers;
    
    // Map slots 0-3
    for (let i = 0; i < 4; i++) {
      const dot = container.querySelector(`#dot-${i}`);
      dot.className = 'peer-dot';
      
      if (i < connectedPeers.length) {
        const pId = connectedPeers[i].toString();
        if (blacklisted.has(pId)) {
          dot.classList.add('blacklisted');
        } else {
          dot.classList.add('connected');
        }
      }
    }
  }, 2000);

  // Cache Warming Update (every 500ms)
  const warmingInterval = setInterval(() => {
    if (!cacheWarmer) return;
    const progress = cacheWarmer.getProgress();
    
    // Update bar
    container.querySelector('#hud-warming-progress').style.width = `${progress.percentComplete}%`;
    
    // Update labels (e.g., L2: 73% L3: 12%)
    let labels = '';
    if (progress.levels) {
      Object.entries(progress.levels).forEach(([lvl, stats]) => {
        labels += `L${lvl}: ${stats.percent}% `;
      });
    } else {
      labels = `TOTAL: ${progress.percentComplete}%`;
    }
    container.querySelector('#hud-warming-stats').textContent = labels.trim();
  }, 500);

  // 5. Public Methods
  
  const setStatus = (text, color, isFlashing = false) => {
    if (statusTimeout) clearTimeout(statusTimeout);
    const el = container.querySelector('#hud-status');
    el.textContent = text;
    el.style.color = color;
    if (isFlashing) el.classList.add('flashing');
    else el.classList.remove('flashing');

    // Return to IDLE after 3 seconds
    statusTimeout = setTimeout(() => {
      el.textContent = 'IDLE';
      el.style.color = '#ffffff';
      el.classList.remove('flashing');
    }, 3000);
  };

  const showTransfer = (peerId) => {
    const shortId = peerId.toString().slice(-6);
    setStatus(`Sourcing from Peer [${shortId}]`, '#4facfe', true);
  };

  const showCacheHit = (sizeInBytes = 0) => {
    setStatus('Cache hit', '#00ff41', false);
    
    // Efficiency update
    totalSavedBytes += sizeInBytes;
    const mb = (totalSavedBytes / (1024 * 1024)).toFixed(1);
    container.querySelector('#hud-efficiency').textContent = `Saved ${mb} MB from server`;
  };

  const showSeedFallback = () => {
    setStatus('Seed fallback', '#ffcc00', false);
  };

  return {
    showTransfer,
    showCacheHit,
    showSeedFallback,
    mount: () => {
      document.body.appendChild(container);
    },
    unmount: () => {
      clearInterval(peerInterval);
      clearInterval(warmingInterval);
      if (statusTimeout) clearTimeout(statusTimeout);
      container.remove();
    }
  };
}
