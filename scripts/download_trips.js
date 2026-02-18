#!/usr/bin/env node
/**
 * Download Oslo Bysykkel trip data (April 2019 – January 2026).
 * Saves to DATA_DIR/year/MM.json (e.g. raw-data/2019/04.json).
 * Usage: node download_trips.js [DATA_DIR] [YYYY-MM]
 * Examples:
 *   node download_trips.js                    → all months to raw-data
 *   node download_trips.js raw-data           → all months to raw-data
 *   node download_trips.js raw-data 2024-01   → only 2024/01.json
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = "https://data.urbansharing.com/oslobysykkel.no/trips/v1";

// [DATA_DIR] [YYYY-MM] or just [YYYY-MM] (default DATA_DIR)
const arg2 = process.argv[2];
const arg3 = process.argv[3];
const isYearMonth = (s) => /^\d{4}-\d{2}$/.test(s);
const DATA_DIR = path.resolve(
  process.cwd(),
  arg3 ? arg2 : isYearMonth(arg2) ? "raw-data" : arg2 || "raw-data"
);
const SINGLE_MONTH = isYearMonth(arg3) ? arg3 : isYearMonth(arg2) ? arg2 : null;

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

function parseSingleMonth(str) {
  const match = /^(\d{4})-(\d{2})$/.exec(str);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  const config = YEARS.find((c) => c.year === year);
  if (!config || !config.months.includes(month)) return null;
  return { year, month };
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

async function main() {
  let toDownload = YEARS;
  if (SINGLE_MONTH) {
    const parsed = parseSingleMonth(SINGLE_MONTH);
    if (!parsed) {
      console.error("Invalid YYYY-MM or out of range (e.g. 2019: 04–12, 2026: 01):", SINGLE_MONTH);
      process.exit(1);
    }
    toDownload = [{ year: parsed.year, months: [parsed.month] }];
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const { year, months } of toDownload) {
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
