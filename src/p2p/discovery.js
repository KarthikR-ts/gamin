import { multiaddr } from '@multiformats/multiaddr';

/**
 * Hardcoded Permanent Seed Node multiaddress placeholder.
 * Uses a valid-length Peer ID format so that multiaddr parses successfully.
 */
export const SEED_MULTIADDR = "/ip4/192.168.1.10/tcp/8080/ws/p2p/12D3KooWBBnP6TiKZeBmvdbsJLQhbm7dYDmmDcMQg3HULDq5rNk5";

/**
 * Dials the permanent seed node with retry logic.
 * If dialing fails, it waits 2 seconds and retries up to 3 times (4 total attempts)
 * before finally throwing an error.
 * Logs each attempt and its success/failure status with precise timestamps.
 * 
 * @param {import('libp2p').Libp2p} node - The local libp2p node instance.
 * @param {string} seedMultiaddr - The multiaddress of the seed node to dial (defaults to SEED_MULTIADDR).
 * @returns {Promise<import('@libp2p/interface-connection').Connection>} The active Connection object.
 */
export async function connectToSeed(node, seedMultiaddr = SEED_MULTIADDR) {
  const maxRetries = 3;
  let attempt = 0;
  
  const targetMa = multiaddr(seedMultiaddr);

  while (attempt <= maxRetries) {
    attempt++;
    const timestamp = new Date().toISOString();
    console.log(`[P2P Discovery] [${timestamp}] Attempting to dial seed node (attempt ${attempt}/${maxRetries + 1}): ${seedMultiaddr}`);
    
    try {
      // Dial the multiaddr using the libp2p node
      const connection = await node.dial(targetMa);
      console.log(`[P2P Discovery] [${new Date().toISOString()}] Successfully connected to seed node: ${seedMultiaddr}`);
      return connection;
    } catch (error) {
      console.error(`[P2P Discovery] [${new Date().toISOString()}] Attempt ${attempt} failed to dial seed node. Error:`, error);
      
      if (attempt <= maxRetries) {
        console.log(`[P2P Discovery] [${new Date().toISOString()}] Waiting 2 seconds before retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error(`[P2P Discovery] [${new Date().toISOString()}] Max retries reached. Connection to seed node failed.`);
        throw new Error(`Failed to connect to seed node after ${attempt} attempts: ${error.message}`);
      }
    }
  }
}

/**
 * Helper function that returns true if a peer with the seed's PeerId
 * is in node.getPeers() (representing the currently connected peers).
 * 
 * @param {import('libp2p').Libp2p} node - The local libp2p node instance.
 * @returns {boolean} True if the seed peer is connected, false otherwise.
 */
export function isSeedConnected(node) {
  try {
    const parts = SEED_MULTIADDR.split('/p2p/');
    const seedPeerIdStr = parts[1];
    if (!seedPeerIdStr) {
      console.error('[P2P Discovery] Seed multiaddr does not contain a Peer ID.');
      return false;
    }
    
    // node.getPeers() returns an array of currently connected PeerId objects
    const connectedPeers = node.getPeers();
    return connectedPeers.some(peerId => peerId.toString() === seedPeerIdStr);
  } catch (error) {
    console.error('[P2P Discovery] Error checking if seed is connected:', error);
    return false;
  }
}
