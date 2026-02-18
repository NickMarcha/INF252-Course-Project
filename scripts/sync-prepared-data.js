#!/usr/bin/env node
/**
 * Sync prepared-data from project root to frontend/public/prepared-data.
 * Run before build/preview so the frontend can fetch the JSON files.
 * Validates file sizes per GitHub limits before copying.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'prepared-data');
const targetDir = path.join(projectRoot, 'frontend', 'public', 'prepared-data');

const MIB = 1024 * 1024;
const WARN_25 = 25 * MIB;
const WARN_50 = 50 * MIB;
const FAIL_100 = 100 * MIB;
const TOTAL_WARN = 100 * MIB;

function collectFiles(dir, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...collectFiles(full, base));
    } else {
      files.push(path.relative(base, full));
    }
  }
  return files;
}

function validateSizes() {
  const files = collectFiles(sourceDir);
  let totalBytes = 0;
  let hasFail = false;

  for (const rel of files) {
    const full = path.join(sourceDir, rel);
    const stat = fs.statSync(full);
    if (!stat.isFile()) continue;
    const size = stat.size;
    totalBytes += size;

    if (size >= FAIL_100) {
      console.error(`[FAIL] ${rel} is ${(size / MIB).toFixed(1)} MiB (GitHub blocks >100 MiB)`);
      hasFail = true;
    } else if (size >= WARN_50) {
      console.warn(`[WARN] ${rel} is ${(size / MIB).toFixed(1)} MiB (Git will warn on push)`);
    } else if (size >= WARN_25) {
      console.warn(`[WARN] ${rel} is ${(size / MIB).toFixed(1)} MiB (approaching browser upload limit)`);
    }
  }

  if (totalBytes > TOTAL_WARN) {
    console.warn(`[WARN] Total prepared-data/ is ${(totalBytes / MIB).toFixed(1)} MiB (early repo-size signal)`);
  }

  if (hasFail) {
    console.error('Aborting sync due to file(s) exceeding 100 MiB.');
    process.exit(1);
  }
}

if (!fs.existsSync(sourceDir)) {
  console.log('prepared-data/ not found, skipping sync.');
  process.exit(0);
}

validateSizes();
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });
console.log('Synced prepared-data to frontend/public/prepared-data');
