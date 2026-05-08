/**
 * Shuffles an array in-place using the Fisher-Yates algorithm.
 * 
 * @param {Array} array - Array to shuffle.
 * @returns {Array} Shuffled copy of the array.
 */
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Manages active peers and orchestrates resilient asset querying over the P2P swarm.
 * Keeps track of peer health and blacklists persistently failing peers.
 */
export class SwarmManager {
  /**
   * @param {import('libp2p').Libp2p} node - The local libp2p node instance.
   */
  constructor(node) {
    this.node = node;
    /** @type {Set<string>} Set of blacklisted peer ID strings */
    this.blacklistedPeers = new Set();
    /** @type {Map<string, { lastCid: string, count: number }>} Map of peer ID strings to consecutive failure records */
    this.peerFailures = new Map();
  }

  /**
   * Permanently blacklists a peer from receiving future asset requests and logs a warning.
   * 
   * @param {string|import('@libp2p/interface-peer-id').PeerId} peerId - The Peer ID to blacklist.
   */
  blacklistPeer(peerId) {
    const peerIdStr = peerId.toString();
    this.blacklistedPeers.add(peerIdStr);
    console.warn(`[P2P Swarm] ⚠️ Peer blacklisted: ${peerIdStr}`);
  }

  /**
   * Returns a list of currently connected peers, excluding any that are blacklisted.
   * 
   * @returns {import('@libp2p/interface-peer-id').PeerId[]} List of available Peer ID objects.
   */
  getAvailablePeers() {
    const connectedPeers = this.node.getPeers();
    return connectedPeers.filter(peerId => !this.blacklistedPeers.has(peerId.toString()));
  }

  /**
   * Iterates over all available peers in a randomized order and attempts to download the asset.
   * If a peer throws an exception or returns null twice in a row for the same CID,
   * it is blacklisted to maintain optimal swarm performance.
   * 
   * @param {string} cid - The unique content identifier of the requested asset.
   * @param {function(import('@libp2p/interface-peer-id').PeerId, string): Promise<ArrayBuffer|null>} requestAssetFn - Request callback function.
   * @returns {Promise<ArrayBuffer|null>} The asset data if retrieved, or null if all peers fail.
   */
  async findAndFetch(cid, requestAssetFn) {
    const availablePeers = this.getAvailablePeers();
    const shuffledPeers = shuffle(availablePeers);

    console.log(`[P2P Swarm] Starting findAndFetch for CID: ${cid}. Available peers: ${availablePeers.length}`);

    for (const peerId of shuffledPeers) {
      const peerIdStr = peerId.toString();
      console.log(`[P2P Swarm] Attempting to download CID ${cid} from peer: ${peerIdStr}`);

      try {
        const result = await requestAssetFn(peerId, cid);

        if (result !== null) {
          console.log(`[P2P Swarm] ✅ Successfully fetched CID ${cid} from peer: ${peerIdStr}`);
          // On successful request, clear any previous failures
          this.peerFailures.delete(peerIdStr);
          return result;
        } else {
          console.warn(`[P2P Swarm] Peer ${peerIdStr} reported NOT_FOUND for CID: ${cid}`);
          this._registerFailure(peerIdStr, cid);
        }
      } catch (error) {
        console.error(`[P2P Swarm] Error querying peer ${peerIdStr} for CID ${cid}:`, error);
        this._registerFailure(peerIdStr, cid);
      }
    }

    console.log(`[P2P Swarm] CID ${cid} could not be retrieved from any connected peer.`);
    return null;
  }

  /**
   * Internal helper to register a peer's request failure.
   * If the peer has failed twice consecutively for the exact same CID, it is blacklisted.
   * 
   * @param {string} peerIdStr - String representation of the Peer ID.
   * @param {string} cid - Asset identifier.
   */
  _registerFailure(peerIdStr, cid) {
    const record = this.peerFailures.get(peerIdStr);

    if (record && record.lastCid === cid) {
      record.count++;
      console.warn(`[P2P Swarm] Peer ${peerIdStr} has consecutively failed ${record.count} times for CID: ${cid}`);
      
      if (record.count >= 2) {
        this.blacklistPeer(peerIdStr);
        this.peerFailures.delete(peerIdStr);
      }
    } else {
      this.peerFailures.set(peerIdStr, { lastCid: cid, count: 1 });
    }
  }
}
