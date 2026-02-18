#!/usr/bin/env node
/**
 * Download Oslo Bysykkel trip data (April 2019 – January 2026).
 * Saves to DATA_DIR/year/MM.json (e.g. raw-data/2019/04.json).
 * Usage: node download_trips.js [DATA_DIR]
 * Example: DATA_DIR=/data node download_trips.js
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = "https://data.urbansharing.com/oslobysykkel.no/trips/v1";
const DATA_DIR = path.resolve(process.cwd(), process.argv[2] || "raw-data");

const YEARS = [
  { year: 2019, months: [4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { year: 2020, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { year: 2021, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { year: 2022, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { year: 2023, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { year: 2024, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { year: 2025, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { year: 2026, months: [1] },
];

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const { year, months } of YEARS) {
    const yearDir = path.join(DATA_DIR, String(year));
    fs.mkdirSync(yearDir, { recursive: true });

    for (const month of months) {
      const mm = String(month).padStart(2, "0");
      const url = `${BASE_URL}/${year}/${mm}.json`;
      const outPath = path.join(yearDir, `${mm}.json`);

      if (fs.existsSync(outPath)) {
        console.log("Skip (exists):", outPath);
        continue;
      }

      try {
        console.log("Download:", url, "->", outPath);
        const body = await download(url);
        fs.writeFileSync(outPath, body, "utf8");
      } catch (err) {
        console.error("Failed:", url, err.message);
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      }
    }
  }

  console.log("Done. Files in", DATA_DIR);
}

main();
