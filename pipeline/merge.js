#!/usr/bin/env node
/**
 * Merge Script
 * Merges verified investors into the app's investors.json data file.
 * Only adds high-confidence investors automatically.
 */

const fs = require('fs');
const path = require('path');

const VERIFIED_FILE = path.join(__dirname, 'verified.json');
const APP_DATA = path.join(__dirname, '..', 'app', 'data', 'investors.json');
const REPORT_FILE = path.join(__dirname, 'merge-report.json');

// Fuzzy dedup
function normalize(name) {
  return (name || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(the|llc|lp|inc|corp|fund|partners|group|management|capital|ventures|advisors|holdings)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDuplicate(newInvestor, existing) {
  const n1 = normalize(newInvestor.firm || newInvestor.name);
  for (const inv of existing) {
    const n2 = normalize(inv.firm || inv.name);
    if (n1 === n2) return true;
    if (n1.length > 3 && n2.length > 3 && (n1.includes(n2) || n2.includes(n1))) return true;
    // Check ID collision
    if (inv.id === newInvestor.id) return true;
  }
  return false;
}

function main() {
  console.log('Merge Pipeline');
  console.log('==============\n');

  if (!fs.existsSync(VERIFIED_FILE)) {
    console.error('No verified.json found. Run verify.js first.');
    process.exit(1);
  }

  const { verified, flaggedForReview, summary } = JSON.parse(fs.readFileSync(VERIFIED_FILE, 'utf8'));
  let appData = [];
  if (fs.existsSync(APP_DATA)) {
    appData = JSON.parse(fs.readFileSync(APP_DATA, 'utf8'));
  }

  console.log(`Existing investors: ${appData.length}`);
  console.log(`Verified candidates: ${verified.length}`);
  console.log(`Flagged for review: ${flaggedForReview.length}`);

  const added = [];
  const skippedDuplicate = [];
  const skippedLowConfidence = [];

  // Only auto-add high confidence
  for (const inv of verified) {
    if (isDuplicate(inv, appData)) {
      skippedDuplicate.push({ name: inv.firm, reason: 'duplicate' });
      continue;
    }

    if (inv._confidence !== 'high') {
      skippedLowConfidence.push({ name: inv.firm, confidence: inv._confidence, reason: 'not high confidence' });
      continue;
    }

    // Clean up internal fields before adding
    const clean = { ...inv };
    delete clean._confidence;
    delete clean._source;
    
    // Ensure unique ID
    let id = clean.id;
    let counter = 1;
    while (appData.some(i => i.id === id)) {
      id = `${clean.id}-${counter++}`;
    }
    clean.id = id;

    appData.push(clean);
    added.push({ name: clean.firm, id: clean.id, location: clean.location });
  }

  // Write updated app data
  if (added.length > 0) {
    // Backup first
    const backupPath = APP_DATA + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(APP_DATA, backupPath);
    console.log(`\nBackup created: ${path.basename(backupPath)}`);

    fs.writeFileSync(APP_DATA, JSON.stringify(appData, null, 2));
    console.log(`Updated ${APP_DATA}`);
  }

  // Report
  const report = {
    timestamp: new Date().toISOString(),
    previousCount: appData.length - added.length,
    newCount: appData.length,
    added,
    skippedDuplicate,
    skippedLowConfidence,
    flaggedForReview: flaggedForReview.map(f => ({
      name: f.firm,
      location: f.location,
      confidence: f._confidence,
      fundSize: f.fundSize,
    })),
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log(`\n=== Merge Report ===`);
  console.log(`Added: ${added.length} investors`);
  console.log(`Skipped (duplicate): ${skippedDuplicate.length}`);
  console.log(`Skipped (low confidence): ${skippedLowConfidence.length}`);
  console.log(`Flagged for manual review: ${flaggedForReview.length}`);
  console.log(`Total investors now: ${appData.length}`);
  console.log(`\nReport saved to ${REPORT_FILE}`);

  if (added.length > 0) {
    console.log(`\n--- Added Investors ---`);
    for (const a of added) {
      console.log(`  ✓ ${a.name} (${a.location || 'Unknown location'}) [${a.id}]`);
    }
  }

  if (flaggedForReview.length > 0) {
    console.log(`\n--- Flagged for Review ---`);
    for (const f of report.flaggedForReview.slice(0, 10)) {
      console.log(`  ? ${f.name} (${f.location || '?'}) — ${f.confidence} confidence, ${f.fundSize || 'unknown size'}`);
    }
    if (report.flaggedForReview.length > 10) {
      console.log(`  ... and ${report.flaggedForReview.length - 10} more`);
    }
  }
}

main();
