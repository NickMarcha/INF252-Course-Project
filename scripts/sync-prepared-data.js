#!/usr/bin/env node
/**
 * Sync prepared-data from project root to frontend/public/prepared-data.
 * Run before build/preview so the frontend can fetch the JSON files.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'prepared-data');
const targetDir = path.join(projectRoot, 'frontend', 'public', 'prepared-data');

if (!fs.existsSync(sourceDir)) {
  console.log('prepared-data/ not found, skipping sync.');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });
console.log('Synced prepared-data to frontend/public/prepared-data');
