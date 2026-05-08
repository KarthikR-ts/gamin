import { hasAsset, getAsset } from '../src/data/db.js';

/**
 * Service Worker for P2P Asset Interception.
 * Intercepts /assets/ requests and attempts to serve from IndexedDB or P2P network.
 */

let manifest = null;

/**
 * Loads the asset manifest from the server.
 * Cached in a module-level variable after the first successful fetch.
 */
async function getManifest() {
  if (manifest) return manifest;
  try {
    const response = await fetch('/src/data/manifest.json');
    if (!response.ok) throw new Error(`Manifest fetch failed: ${response.status}`);
    manifest = await response.json();
    return manifest;
  } catch (error) {
    console.error('[SW] Error loading manifest:', error);
    return null;
  }
}

/**
 * Maps a request URL to a Content Identifier (CID) using the manifest.
 * @param {string} url - The full request URL.
 */
async function lookupCidFromPath(url) {
  const pathname = new URL(url).pathname;
  // Extract the relative path by removing the '/assets/' prefix
  const assetPath = pathname.startsWith('/assets/') ? pathname.slice(8) : pathname;
  
  const m = await getManifest();
  if (m && m.assets && m.assets[assetPath]) {
    return m.assets[assetPath].cid;
  }
  return null;
}

/**
 * Returns the appropriate MIME type based on the file extension.
 */
function getMimeType(url) {
  const ext = url.split('.').pop().toLowerCase();
  const mimeTypes = {
    'gltf': 'model/gltf+json',
    'glb': 'model/gltf-binary',
    'bin': 'application/octet-stream',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'json': 'application/json',
    'js': 'application/javascript',
    'wasm': 'application/wasm'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// 1. Install Event: Skip waiting to ensure the new SW activates immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 2. Activate Event: Claim clients and notify them
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.postMessage({ type: 'SW_CLAIMED' });
      }
    })()
  );
});

// 3. Fetch Event: Intercept /assets/ requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(handleAssetFetch(event));
  }
});

/**
 * Orchestrates the asset retrieval process: Cache -> P2P -> Network.
 */
async function handleAssetFetch(event) {
  const url = event.request.url;
  
  try {
    const cid = await lookupCidFromPath(url);
    if (!cid) return fetch(event.request);

    // a. Check IndexedDB cache
    const exists = await hasAsset(cid);
    if (exists) {
      const arrayBuffer = await getAsset(cid);
      if (arrayBuffer) {
        console.log(`[SW] Serving ${cid} from IndexedDB cache`);
        return new Response(arrayBuffer, {
          headers: { 'Content-Type': getMimeType(url) }
        });
      }
    }

    // c. Not found in cache: Ask clients (P2P Bridge) via MessageChannel
    const arrayBuffer = await requestAssetFromClients(cid);
    if (arrayBuffer) {
      console.log(`[SW] Serving ${cid} from P2P Bridge`);
      return new Response(arrayBuffer, {
        headers: { 'Content-Type': getMimeType(url) }
      });
    }
  } catch (error) {
    console.error(`[SW] Error fetching ${url}, falling back to network:`, error);
  }

  // Fallback to normal network fetch
  return fetch(event.request);
}

/**
 * Broadcasts a request for an asset to all controlled window clients.
 * Uses MessageChannel to await the response.
 */
async function requestAssetFromClients(cid) {
  const clients = await self.clients.matchAll({ type: 'window' });
  if (!clients || clients.length === 0) return null;

  return new Promise((resolve) => {
    // Set a 10s timeout as requested
    const timeout = setTimeout(() => {
      console.warn(`[SW] Timeout requesting CID ${cid} from clients`);
      resolve(null);
    }, 10000);

    let resolved = false;

    // Post to all clients to increase chances of a hit
    for (const client of clients) {
      const channel = new MessageChannel();
      
      channel.port1.onmessage = (event) => {
        if (!resolved && event.data && event.data.type === 'ASSET_RESPONSE' && event.data.arrayBuffer) {
          resolved = true;
          clearTimeout(timeout);
          resolve(event.data.arrayBuffer);
        }
      };

      client.postMessage({ type: 'GET_ASSET', cid }, [channel.port2]);
    }
  });
}

// 4. Message Event: General message handler
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'ASSET_RESPONSE') {
    // This handler can be used for unsolicited asset delivery 
    // or as a fallback for non-channel communication.
    console.log(`[SW] Received ASSET_RESPONSE for CID: ${event.data.cid}`);
  }
});
