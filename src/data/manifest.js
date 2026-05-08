/**
 * @typedef {Object} AssetMetadata
 * @property {string} cid - The SHA-256 hex string hash of the file content.
 * @property {number} size - The size of the file in bytes.
 * @property {1 | 2 | 3} level - The level of the asset (1-3), indicating priority.
 */

/**
 * @typedef {Object} Manifest
 * @property {string} version - The version of the manifest format (e.g., "1.0.0").
 * @property {string} generatedAt - ISO timestamp string when the manifest was generated.
 * @property {Object<string, AssetMetadata>} assets - A mapping of relative file paths to their metadata.
 */

// This file is currently used for type definitions only.
export {};
