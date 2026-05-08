import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';

/**
 * Protocol ID string for P2P asset transfer.
 */
export const PROTOCOL_ID = "/p2p-asset/1.0.0";

/**
 * Reads a single newline-delimited JSON message from the stream.source async iterable.
 * Accumulates incoming chunks and extracts the first message, leaving any remaining bytes
 * that belong to the subsequent raw binary payload.
 * 
 * @param {AsyncIterable<Uint8Array>} source - Stream source async iterable.
 * @returns {Promise<{message: any, remainingBytes: Uint8Array}>} Parsed JSON message and remaining bytes.
 */
async function readJsonMessage(source) {
  let buffer = new Uint8Array(0);
  
  for await (const chunk of source) {
    // Handle both Uint8Array and Uint8ArrayList cleanly
    const chunkBytes = chunk.subarray ? chunk.subarray() : new Uint8Array(chunk);
    
    // Concatenate current chunk to our accumulated buffer
    const newBuffer = new Uint8Array(buffer.length + chunkBytes.length);
    newBuffer.set(buffer);
    newBuffer.set(chunkBytes, buffer.length);
    buffer = newBuffer;
    
    // Look for newline character (ASCII code 10 for '\n')
    const newlineIndex = buffer.indexOf(10);
    if (newlineIndex !== -1) {
      const lineBytes = buffer.subarray(0, newlineIndex);
      const remainingBytes = buffer.subarray(newlineIndex + 1);
      
      const lineStr = uint8ArrayToString(lineBytes);
      const message = JSON.parse(lineStr);
      
      return { message, remainingBytes };
    }
  }
  
  throw new Error('Stream ended prematurely without finding newline delimiter.');
}

/**
 * Reads the remaining stream source data into a single ArrayBuffer.
 * Pre-fills with any leftover bytes already read during message parsing, and respects
 * the expected size of the asset.
 * 
 * @param {AsyncIterable<Uint8Array>} source - Stream source async iterable.
 * @param {Uint8Array} initialBytes - Pre-read leftover bytes.
 * @param {number} [expectedSize] - Expected size of the asset payload.
 * @returns {Promise<ArrayBuffer>} Complete asset payload in an ArrayBuffer.
 */
async function readRemainingPayload(source, initialBytes, expectedSize) {
  const chunks = [initialBytes];
  let totalLength = initialBytes.length;
  
  for await (const chunk of source) {
    const chunkBytes = chunk.subarray ? chunk.subarray() : new Uint8Array(chunk);
    chunks.push(chunkBytes);
    totalLength += chunkBytes.length;
    
    if (expectedSize !== undefined && totalLength >= expectedSize) {
      break;
    }
  }
  
  // Flatten chunks into a single Uint8Array
  const flattened = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    flattened.set(chunk, offset);
    offset += chunk.length;
  }
  
  // Trim to expectedSize if specified (in case extra bytes were read)
  const finalBytes = expectedSize !== undefined ? flattened.subarray(0, expectedSize) : flattened;
  
  // Return the underlying ArrayBuffer slice
  return finalBytes.buffer.slice(finalBytes.byteOffset, finalBytes.byteOffset + finalBytes.byteLength);
}

/**
 * Registers the /p2p-asset/1.0.0 protocol handler on the libp2p node.
 * When a peer connects and sends a WANT request, the handler queries local storage
 * via getLocalAsset(cid) and responds with either HAVE + raw binary or NOT_FOUND.
 * 
 * @param {import('libp2p').Libp2p} node - The local libp2p node instance.
 * @param {function(string): Promise<ArrayBuffer|null>} getLocalAsset - Callback to query local storage.
 */
export function handleIncomingStream(node, getLocalAsset) {
  node.handle(PROTOCOL_ID, async ({ stream, connection }) => {
    const remotePeerStr = connection.remotePeer.toString();
    console.log(`[P2P Protocol] Incoming stream on ${PROTOCOL_ID} from: ${remotePeerStr}`);
    
    try {
      // 1. Read WANT control message
      const { message } = await readJsonMessage(stream.source);
      
      if (!message || message.type !== 'WANT') {
        throw new Error(`Invalid protocol message: expected WANT, received ${message?.type}`);
      }
      
      const cid = message.cid;
      console.log(`[P2P Protocol] Peer ${remotePeerStr} requested WANTRx: ${cid}`);
      
      // 2. Fetch asset from local storage
      const assetData = await getLocalAsset(cid);
      
      if (assetData) {
        // Safe conversion of callback return to Uint8Array
        const assetBytes = new Uint8Array(assetData);
        const size = assetBytes.byteLength;
        console.log(`[P2P Protocol] Asset found locally (${size} bytes). Sending HAVE for CID: ${cid}`);
        
        // Construct HAVE response control line
        const haveMsg = JSON.stringify({ type: "HAVE", cid, size }) + '\n';
        const haveBytes = uint8ArrayFromString(haveMsg);
        
        // Write the control message followed by the raw payload bytes
        await stream.sink([haveBytes, assetBytes]);
      } else {
        console.log(`[P2P Protocol] Asset NOT found locally for CID: ${cid}`);
        
        // Construct NOT_FOUND response control line
        const notFoundMsg = JSON.stringify({ type: "NOT_FOUND", cid }) + '\n';
        const notFoundBytes = uint8ArrayFromString(notFoundMsg);
        
        await stream.sink([notFoundBytes]);
      }
    } catch (error) {
      console.error(`[P2P Protocol] Stream handling error with peer ${remotePeerStr}:`, error);
    } finally {
      try {
        await stream.close();
        console.log(`[P2P Protocol] Safely closed stream with ${remotePeerStr}`);
      } catch (_) {}
    }
  });
  console.log(`[P2P Protocol] Registered incoming stream handler on protocol: ${PROTOCOL_ID}`);
}

/**
 * Opens a stream to the given peerId, requests an asset by its CID, and reads the response.
 * Implements a strict 15-second request timeout.
 * 
 * @param {import('libp2p').Libp2p} node - The local libp2p node instance.
 * @param {import('@libp2p/interface-peer-id').PeerId} peerId - Peer ID to dial and request from.
 * @param {string} cid - Asset identifier.
 * @returns {Promise<ArrayBuffer|null>} Complete asset data if found, or null if NOT_FOUND or on timeout.
 */
export async function requestAssetFromPeer(node, peerId, cid) {
  let stream = null;
  const timeoutMs = 15000;
  
  // 15-second timeout promise wrapper
  const timeoutPromise = new Promise((_, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`[P2P Protocol] Request for CID ${cid} to peer ${peerId.toString()} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    // Attach timer id to allow clearing it on success
    timeoutPromise.timerId = id;
  });
  
  try {
    const fetchPromise = (async () => {
      console.log(`[P2P Protocol] Dialing protocol ${PROTOCOL_ID} to peer: ${peerId.toString()}`);
      stream = await node.dialProtocol(peerId, PROTOCOL_ID);
      
      // Send WANT message
      const wantMsg = JSON.stringify({ type: "WANT", cid }) + '\n';
      const wantBytes = uint8ArrayFromString(wantMsg);
      await stream.sink([wantBytes]);
      
      // Read response control message
      console.log(`[P2P Protocol] Waiting for response for CID: ${cid}`);
      const { message, remainingBytes } = await readJsonMessage(stream.source);
      
      if (message.type === 'HAVE') {
        const size = message.size;
        console.log(`[P2P Protocol] Peer has asset (${size} bytes). Downloading payload...`);
        
        const payloadBuffer = await readRemainingPayload(stream.source, remainingBytes, size);
        console.log(`[P2P Protocol] Successfully downloaded asset ${cid} (${size} bytes)`);
        
        await stream.close();
        return payloadBuffer;
      } else if (message.type === 'NOT_FOUND') {
        console.log(`[P2P Protocol] Peer reported NOT_FOUND for CID: ${cid}`);
        await stream.close();
        return null;
      } else {
        throw new Error(`Unexpected message type received: ${message.type}`);
      }
    })();
    
    // Race connection/download against the strict 15s timeout
    const result = await Promise.race([fetchPromise, timeoutPromise]);
    
    // Clear the active timeout
    clearTimeout(timeoutPromise.timerId);
    
    return result;
  } catch (error) {
    console.error(`[P2P Protocol] Failed request for CID ${cid} from peer ${peerId.toString()}:`, error);
    if (stream) {
      try {
        await stream.close();
      } catch (_) {}
    }
    throw error;
  }
}
