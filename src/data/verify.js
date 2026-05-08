/**
 * Computes the SHA-256 hash (CID) of an asset's data.
 * This is used to uniquely identify chunks and ensure data integrity.
 * 
 * @param {ArrayBuffer} arrayBuffer - The asset data to hash.
 * @returns {Promise<string>} The SHA-256 hash as a hex string.
 */
export async function computeCid(arrayBuffer) {
  // Use the Web Crypto API to digest the data with SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  
  // Convert the hash ArrayBuffer to a hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

/**
 * Verifies if the provided asset data matches the expected content identifier (CID).
 * This prevents data corruption or tampering during peer-to-peer transmission.
 * 
 * @param {ArrayBuffer} arrayBuffer - The asset data to verify.
 * @param {string} expectedCid - The expected SHA-256 hash.
 * @returns {Promise<boolean>} True if the computed hash matches the expected hash.
 */
export async function verifyAsset(arrayBuffer, expectedCid) {
  if (!expectedCid) return false;
  
  const computedCid = await computeCid(arrayBuffer);
  
  // Case-insensitive comparison of hex strings
  return computedCid.toLowerCase() === expectedCid.toLowerCase();
}
