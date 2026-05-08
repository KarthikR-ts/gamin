import { hasAsset, saveAsset } from './data/db.js';
import { verifyAsset } from './data/verify.js';
import { shouldThrottle } from './p2p/ratelimit.js';

/**
 * Starts the background cache warming process.
 * Fetches assets for priority levels higher than the current level and caches them locally.
 * 
 * @param {Object} p2pClient - The P2P client instance.
 * @param {Object} manifest - The asset manifest mapping paths to CIDs and levels.
 * @param {number} currentLevel - The current active level; assets > this will be warmed.
 * @param {Function} [onProgress] - Optional callback for progress updates.
 * @returns {Promise<Object>} A controller object with stop() and getProgress() methods.
 */
export async function startCacheWarming(p2pClient, manifest, currentLevel, onProgress) {
  // Filter manifest for assets that need warming (level > currentLevel)
  const assetsToWarm = [];
  if (manifest && manifest.assets) {
    for (const [path, info] of Object.entries(manifest.assets)) {
      if (info.level > currentLevel) {
        assetsToWarm.push({
          path,
          cid: info.cid,
          level: info.level
        });
      }
    }
  }

  let totalDone = 0;
  const totalNeeded = assetsToWarm.length;
  let isStopped = false;

  /**
   * Returns current warming progress.
   */
  const getProgress = () => {
    const done = totalDone;
    const total = totalNeeded;
    const percentComplete = total > 0 ? Math.round((done / total) * 100) : 100;
    return { done, total, percentComplete };
  };

  /**
   * Stops the background warming process.
   */
  const stop = () => {
    isStopped = true;
    console.log('[Cache Warmer] Background warming process stop requested.');
  };

  // Start the warming loop in the background (non-blocking)
  (async () => {
    console.log(`[Cache Warmer] Starting background warming for ${totalNeeded} assets...`);
    
    for (const asset of assetsToWarm) {
      // Check if stop() was called
      if (isStopped) {
        console.log('[Cache Warmer] Warming loop interrupted by stop().');
        break;
      }

      try {
        const { cid, path, level } = asset;

        // Check if already in IndexedDB to avoid redundant P2P requests
        if (await hasAsset(cid)) {
          totalDone++;
          if (onProgress) {
            onProgress({ cid, path, level, totalDone, totalNeeded });
          }
          continue;
        }

        // 1. Calls shouldThrottle(dataChannel) from src/p2p/ratelimit.js
        // We attempt to use p2pClient.dataChannel if available for write-buffer checks
        while (shouldThrottle(p2pClient.dataChannel)) {
          if (isStopped) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (isStopped) break;

        // 2. Calls p2pClient.getAsset(cid)
        // This may fallback to the Permanent Seed node and retry several times internally
        const arrayBuffer = await p2pClient.getAsset(cid);

        // 3. Verifies with verifyAsset()
        const isValid = await verifyAsset(arrayBuffer, cid);
        if (!isValid) {
          console.warn(`[Cache Warmer] SECURITY WARNING: Asset verification failed for CID ${cid}. Skipping.`);
          continue;
        }

        // 4. Saves to IndexedDB with saveAsset()
        await saveAsset(cid, path, level, arrayBuffer);

        // 5. Calls onProgress callback
        totalDone++;
        if (onProgress) {
          onProgress({ cid, path, level, totalDone, totalNeeded });
        }
      } catch (error) {
        // Ensure the background loop continues even if one asset fails
        console.warn(`[Cache Warmer] Error warming asset ${asset.cid}:`, error.message);
      }
    }

    if (!isStopped) {
      console.log('[Cache Warmer] Background warming cycle complete.');
    }
  })();

  // Return the controller immediately
  return { stop, getProgress };
}
