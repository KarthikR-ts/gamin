import Dexie from 'dexie';

/**
 * Dexie database configuration for P2P asset caching.
 */
export const db = new Dexie('P2PAssetCache');

// Define schema version 1
db.version(1).stores({
  assets: 'cid, path, level, cachedAt'
});

/**
 * Stores an asset in the local cache.
 * @param {string} cid - The content identifier of the asset.
 * @param {string} path - The original path of the asset.
 * @param {number} level - The priority level of the asset.
 * @param {ArrayBuffer} arrayBuffer - The asset data.
 * @returns {Promise<boolean>}
 */
export async function saveAsset(cid, path, level, arrayBuffer) {
  try {
    const blob = new Blob([arrayBuffer]);
    await db.assets.put({
      cid,
      path,
      level,
      data: blob,
      cachedAt: Date.now()
    });
    return true;
  } catch (error) {
    console.error(`Error saving asset ${cid}:`, error);
    return false;
  }
}

/**
 * Retrieves an asset's data from the cache.
 * @param {string} cid - The content identifier of the asset.
 * @returns {Promise<ArrayBuffer|null>}
 */
export async function getAsset(cid) {
  try {
    const asset = await db.assets.get(cid);
    if (!asset) return null;
    return await asset.data.arrayBuffer();
  } catch (error) {
    console.error(`Error retrieving asset ${cid}:`, error);
    return null;
  }
}

/**
 * Checks if an asset exists in the cache.
 * @param {string} cid - The content identifier of the asset.
 * @returns {Promise<boolean>}
 */
export async function hasAsset(cid) {
  try {
    const count = await db.assets.where('cid').equals(cid).count();
    return count > 0;
  } catch (error) {
    console.error(`Error checking existence of asset ${cid}:`, error);
    return false;
  }
}

/**
 * Returns a list of cached assets for a specific level.
 * @param {number} level - The level number.
 * @returns {Promise<Array<{cid: string, path: string}>|null>}
 */
export async function getAssetsByLevel(level) {
  try {
    const assets = await db.assets.where('level').equals(level).toArray();
    return assets.map(a => ({ cid: a.cid, path: a.path }));
  } catch (error) {
    console.error(`Error retrieving assets for level ${level}:`, error);
    return null;
  }
}

/**
 * Deletes all cached assets for a given level.
 * @param {number} level - The level number to clear.
 * @returns {Promise<boolean>}
 */
export async function clearLevel(level) {
  try {
    await db.assets.where('level').equals(level).delete();
    return true;
  } catch (error) {
    console.error(`Error clearing level ${level}:`, error);
    return false;
  }
}

/**
 * Provides statistics about the local asset cache.
 * @returns {Promise<{totalAssets: number, totalLevels: number, estimatedSizeMB: number}|null>}
 */
export async function getCacheStats() {
  try {
    const allAssets = await db.assets.toArray();
    const totalAssets = allAssets.length;
    
    const levelSet = new Set();
    let totalBytes = 0;
    
    for (const asset of allAssets) {
      levelSet.add(asset.level);
      if (asset.data && asset.data.size) {
        totalBytes += asset.data.size;
      }
    }
    
    const estimatedSizeMB = parseFloat((totalBytes / (1024 * 1024)).toFixed(2));
    
    return {
      totalAssets,
      totalLevels: levelSet.size,
      estimatedSizeMB
    };
  } catch (error) {
    console.error('Error fetching cache stats:', error);
    return null;
  }
}
