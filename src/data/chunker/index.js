import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Node.js CLI script to generate an asset manifest.
 * Recursively scans an assets directory, computes SHA-256 hashes,
 * and builds a JSON manifest mapping file paths to metadata.
 */

// 1. Accept CLI argument for assets directory, default to ../../../public/assets
const assetsDirArg = process.argv[2] || path.join(__dirname, '../../../public/assets');
const assetsDir = path.resolve(assetsDirArg);
const manifestPath = path.resolve(__dirname, '../manifest.json');

/**
 * Infers level number from file path.
 * Folders containing "level1", "level2", or "level3" determine the level.
 * Defaults to 1 if ambiguous.
 */
function inferLevel(filePath) {
  const normalized = filePath.toLowerCase().replace(/\\/g, '/');
  if (normalized.includes('/level3/')) return 3;
  if (normalized.includes('/level2/')) return 2;
  if (normalized.includes('/level1/')) return 1;
  
  // Fallback check if it's just "levelX" in the path string anywhere
  if (normalized.includes('level3')) return 3;
  if (normalized.includes('level2')) return 2;
  if (normalized.includes('level1')) return 1;
  
  return 1;
}

/**
 * Recursively scans directory for files.
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

async function run() {
  console.log(`Scanning assets in: ${assetsDir}`);
  
  if (!fs.existsSync(assetsDir)) {
    console.warn(`Warning: Assets directory does not exist at ${assetsDir}`);
    // We'll create an empty manifest if the dir doesn't exist, or exit?
    // The prompt says "Recursively scan every file", implying it should exist.
    // I'll exit with an error to be safe, but maybe I should create a dummy dir for the demo?
    // Actually, I'll just proceed and if it fails to read, it fails.
    try {
      fs.mkdirSync(assetsDir, { recursive: true });
      console.log(`Created empty assets directory at ${assetsDir}`);
    } catch (e) {
      console.error(`Failed to access or create assets directory: ${e.message}`);
      process.exit(1);
    }
  }

  const filePaths = getAllFiles(assetsDir);
  const assets = {};
  const summaryTable = [];

  for (const filePath of filePaths) {
    const relativePath = path.relative(assetsDir, filePath).replace(/\\/g, '/');
    const fileBuffer = fs.readFileSync(filePath);
    
    // 3. Compute SHA-256 hash
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const size = fileBuffer.length;
    const level = inferLevel(filePath);

    // 5. Build manifest entry
    assets[relativePath] = {
      cid: hash,
      size: size,
      level: level
    };

    // 7. Collect summary data
    summaryTable.push({
      filename: relativePath,
      size: size,
      CID: hash.substring(0, 12),
      level: level
    });
  }

  const manifest = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    assets: assets
  };

  // 6. Write to src/data/manifest.json
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nManifest successfully generated at: ${manifestPath}`);

  // 7. Print summary table
  if (summaryTable.length > 0) {
    console.table(summaryTable);
  } else {
    console.log("No assets found.");
  }
}

run().catch(err => {
  console.error("Error generating manifest:", err);
  process.exit(1);
});
