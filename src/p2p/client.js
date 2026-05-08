import createP2PNode from './node.js';
import { connectToSeed } from './discovery.js';
import { handleIncomingStream, requestAssetFromPeer } from './protocol.js';
import { SwarmManager } from './swarm.js';
import { getAsset as getLocalAsset } from '../data/db.js';

/**
 * Boots the entire P2P networking system.
 * Initializes the libp2p node, binds protocol handlers, spins up the SwarmManager,
 * and initiates an asynchronous background dial to the Permanent Seed node.
 * 
 * @returns {Promise<P2PClient>} The client instance representing the public interface.
 */
export async function initP2P() {
  console.log('[P2P Client] Booting P2P client subsystems...');
  
  // 1. Initialize the browser-compatible libp2p node
  const node = await createP2PNode();
  
  // 2. Register the WANT/HAVE protocol handler with our IndexedDB lookup callback
  handleIncomingStream(node, getLocalAsset);
  
  // 3. Initialize the SwarmManager to coordinate peer health and lookups
  const swarmManager = new SwarmManager(node);
  
  // 4. Initiate an asynchronous background dial to the Permanent Seed node
  connectToSeed(node)
    .then(() => {
      console.log('[P2P Client] Background connection to Permanent Seed established successfully.');
    })
    .catch((err) => {
      console.warn('[P2P Client] Background seed dial failed on startup. Will retry on fallback dial if needed. Error:', err.message);
    });

  return new P2PClient(node, swarmManager);
}

/**
 * Public client wrapper representing the API surface exposed to the Service Worker bridge.
 */
export class P2PClient {
  /**
   * @param {import('libp2p').Libp2p} node - The started libp2p node instance.
   * @param {SwarmManager} swarmManager - The active swarm manager instance.
   */
  constructor(node, swarmManager) {
    this.node = node;
    this.swarmManager = swarmManager;
  }

  /**
   * Returns a list of currently connected, non-blacklisted peers.
   * Perfect for binding to HUD displays or connection indicator widgets.
   * 
   * @returns {import('@libp2p/interface-peer-id').PeerId[]} Array of available Peer ID objects.
   */
  get peers() {
    return this.swarmManager.getAvailablePeers();
  }

  /**
   * High-reliability content-addressed asset downloader.
   * 1. Attempts to fetch the asset from non-blacklisted swarm peers.
   * 2. If swarm peers are empty or fail, falls back to dialing and querying the Permanent Seed node.
   * 3. On fail, sleeps 1s and retries up to 2 additional times (3 total cycles) before throwing.
   * 
   * @param {string} cid - Asset content identifier.
   * @returns {Promise<{data: ArrayBuffer, peer: import('@libp2p/interface-peer-id').PeerId}>} Asset data and the peer it was retrieved from.
   * @throws {Error} If retrieval fails across all peers, seed fallback, and retries.
   */
  async getAsset(cid) {
    const maxAttempts = 3; // Initial attempt + 2 retries
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      console.log(`[P2P Client] Asset retrieve cycle ${attempt}/${maxAttempts} for CID: ${cid}`);

      try {
        // Step A: Attempt to fetch from active peers in the swarm
        // SwarmManager.findAndFetch should be updated to return { data, peer }
        const swarmResult = await this.swarmManager.findAndFetch(cid, async (peerId, targetCid) => {
          const data = await requestAssetFromPeer(this.node, peerId, targetCid);
          return data ? { data, peer: peerId } : null;
        });

        if (swarmResult !== null) {
          console.log(`[P2P Client] Successfully downloaded CID ${cid} from active swarm on cycle ${attempt}.`);
          return swarmResult;
        }

        console.warn(`[P2P Client] CID ${cid} not found in active swarm on cycle ${attempt}. Falling back to Permanent Seed...`);

        // Step B: Connect and fetch from the Permanent Seed Node
        const seedConn = await connectToSeed(this.node);
        const seedPeerId = seedConn.remotePeer;

        const seedData = await requestAssetFromPeer(this.node, seedPeerId, cid);
        if (seedData !== null) {
          console.log(`[P2P Client] Successfully downloaded CID ${cid} from Permanent Seed on cycle ${attempt}.`);
          return { data: seedData, peer: seedPeerId };
        }

        console.warn(`[P2P Client] Permanent Seed reported NOT_FOUND for CID ${cid} on cycle ${attempt}.`);
      } catch (error) {
        console.error(`[P2P Client] Cycle ${attempt} failed with error during CID retrieve:`, error);
      }

      // If we have more attempts, wait 1 second before retrying the full loop
      if (attempt < maxAttempts) {
        console.log(`[P2P Client] Waiting 1 second before starting retry cycle ${attempt + 1}...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Exhausted all retries and fallbacks
    throw new Error(`[P2P Client] Failed to download asset ${cid} after ${maxAttempts} fetch attempts from active swarm and Permanent Seed fallback.`);
  }
}
