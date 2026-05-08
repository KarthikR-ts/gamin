import { saveAsset } from '../src/data/db.js';
import { verifyAsset } from '../src/data/verify.js';
import { SEED_MULTIADDR } from '../src/p2p/discovery.js';

/**
 * Message bridge between the Service Worker and the P2P Client.
 * Runs in the main thread.
 */

// Map of pending CID requests to their associated MessagePorts
const pendingRequests = new Map();

// Extract seed peer ID for identification in HUD
const SEED_PEER_ID = SEED_MULTIADDR.split('/p2p/')[1];

/**
 * Initializes the message bridge.
 * @param {Object} p2pClient - The P2P client instance for asset retrieval.
 * @param {Object} hud - The HUD controller instance for UI updates.
 */
export async function initBridge(p2pClient, hud) {
  navigator.serviceWorker.addEventListener('message', async (event) => {
    const { type, cid, size } = event.data;
    
    // Handle cache hits from Service Worker
    if (type === 'CACHE_HIT' && hud) {
      hud.showCacheHit(size);
      return;
    }

    // The port might be explicitly in the data or in the ports array
    const port = event.data.port || event.ports[0];

    if (type === 'GET_ASSET' && cid && port) {
      // Deduplicate requests for the same asset
      if (pendingRequests.has(cid)) {
        pendingRequests.get(cid).add(port);
        return;
      }

      const ports = new Set([port]);
      pendingRequests.set(cid, ports);

      try {
        const arrayBuffer = await fetchAndVerify(p2pClient, hud, cid);
        
        // Final cleanup and response dispatch
        if (pendingRequests.has(cid)) {
          const activePorts = pendingRequests.get(cid);
          pendingRequests.delete(cid);
          
          if (arrayBuffer) {
            for (const p of activePorts) {
              p.postMessage({ type: 'ASSET_RESPONSE', cid, arrayBuffer });
            }
          }
        }
      } catch (error) {
        pendingRequests.delete(cid);
        console.error(`[Bridge] Failed to resolve asset ${cid}:`, error);
      }
    }
  });
}

/**
 * Handles the fetch, verification, and retry logic for a CID.
 */
async function fetchAndVerify(p2pClient, hud, cid, isRetry = false) {
  try {
    // 1. Calls p2pClient.getAsset(cid) - now returns { data, peer }
    const result = await p2pClient.getAsset(cid);
    const { data: arrayBuffer, peer } = result;

    if (!arrayBuffer) {
      throw new Error(`P2P client returned no data for ${cid}`);
    }

    // Update HUD
    if (hud && peer) {
      const peerIdStr = peer.toString();
      if (peerIdStr === SEED_PEER_ID) {
        hud.showSeedFallback();
      } else {
        hud.showTransfer(peerIdStr);
      }
    }

    // 2. Calls verifyAsset(arrayBuffer, cid) from src/data/verify.js
    const isValid = await verifyAsset(arrayBuffer, cid);

    if (isValid) {
      // 3. If verification passes: saves to IndexedDB via saveAsset()
      await saveAsset(cid, `p2p_asset_${cid}`, 0, arrayBuffer);
      
      // ...then returns the buffer to be posted back
      return arrayBuffer;
    } else {
      // 4. If verification FAILS: logs a security warning
      console.warn(`[Bridge] SECURITY WARNING: Verification failed for CID ${cid}`);
      
      // ...calls p2pClient blacklistPeer (the peer that returned it)
      if (peer && p2pClient.swarmManager?.blacklistPeer) {
        p2pClient.swarmManager.blacklistPeer(peer);
      }

      if (!isRetry) {
        // ...retries getAsset once more
        console.log(`[Bridge] Retrying getAsset for ${cid}...`);
        return await fetchAndVerify(p2pClient, hud, cid, true);
      } else {
        // ...then responds with the fallback or throws
        throw new Error(`Verification failed after retry for CID ${cid}`);
      }
    }
  } catch (error) {
    if (!isRetry) {
      console.warn(`[Bridge] Error fetching ${cid}, retrying...`, error);
      return await fetchAndVerify(p2pClient, hud, cid, true);
    }
    throw error;
  }
}

/**
 * Registers the Service Worker and waits for the claim notification.
 * @returns {Promise<boolean>} True if registration and claim were successful.
 */
export async function registerAndClaim() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Workers are not supported');
  }

  // Registers the Service Worker at '/sw/service-worker.js' with {type:'module'}
  const registration = await navigator.serviceWorker.register('/sw/service-worker.js', {
    type: 'module'
  });

  return new Promise((resolve, reject) => {
    // Has a 5-second timeout, throws if SW does not claim in time
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onClaimed);
      reject(new Error('Service Worker registration timeout: SW_CLAIMED not received within 5s'));
    }, 5000);

    function onClaimed(event) {
      // Waits for the SW to post {type: 'SW_CLAIMED'}
      if (event.data && event.data.type === 'SW_CLAIMED') {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', onClaimed);
        resolve(true);
      }
    }

    navigator.serviceWorker.addEventListener('message', onClaimed);
  });
}
