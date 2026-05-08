import { createLibp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';

/**
 * Initializes and returns a started libp2p node using:
 * - @libp2p/webrtc transport (listening on WebRTC addresses)
 * - @libp2p/circuit-relay-v2 transport (required for browser WebRTC signalling)
 * - @chainsafe/libp2p-noise for encryption/security
 * - @libp2p/mplex for stream multiplexing
 * - @libp2p/identify for identifying node protocols and address capabilities
 * 
 * The node starts automatically on creation and exposes its Peer ID
 * and Multiaddresses via console.log.
 * 
 * @returns {Promise<import('libp2p').Libp2p>} Started libp2p node instance
 */
export async function createP2PNode() {
  try {
    const node = await createLibp2p({
      addresses: {
        listen: [
          '/webrtc',
          '/p2p-circuit'
        ]
      },
      transports: [
        webRTC(),
        circuitRelayTransport()
      ],
      connectionEncryption: [
        noise()
      ],
      streamMuxers: [
        mplex()
      ],
      services: {
        identify: identify()
      }
    });

    // Start the node automatically on creation
    await node.start();

    // Expose PeerID and Multiaddresses after starting
    console.log('libp2p Node started successfully!');
    console.log('Peer ID:', node.peerId.toString());
    console.log('Listening on Multiaddresses:', node.getMultiaddrs().map(ma => ma.toString()));

    return node;
  } catch (error) {
    console.error('Failed to start libp2p node:', error);
    throw error;
  }
}

export default createP2PNode;
