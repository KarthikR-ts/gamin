// Entry point for the P2P Asset Engine client application.
import { initP2P } from './p2p/client.js';

// Initialize the P2P client subsystems on startup
initP2P()
  .then(async (client) => {
    console.log('Successfully initialized local P2P client wrapper.');
    
    // Demonstrate retrieval of an asset
    // Since there are no active peers initially, it will fallback to the Permanent Seed node.
    // The seed node dial retries will show backoff delays and finally fail after exhaustively retrying.
    try {
      const sampleCid = "test-cid-123";
      console.log(`[P2P Main] Starting demonstration asset fetch for CID: ${sampleCid}`);
      
      const asset = await client.getAsset(sampleCid);
      console.log(`[P2P Main] Fetch Succeeded! Payload:`, new TextDecoder().decode(asset));
    } catch (fetchError) {
      console.error('[P2P Main] Expected failure during demonstration asset fetch:', fetchError.message);
    }
  })
  .catch((err) => {
    console.error('Initialization of local P2P Client failed:', err);
  });
