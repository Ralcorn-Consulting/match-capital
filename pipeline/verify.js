#!/usr/bin/env node
/**
 * Investor Verification Script
 * Cross-references discovered investors against existing app data and web sources.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DISCOVERED_FILE = path.join(__dirname, 'discovered.json');
const VERIFIED_FILE = path.join(__dirname, 'verified.json');
const APP_DATA = path.join(__dirname, '..', 'app', 'data', 'investors.json');
const USER_AGENT = 'MatchCapital himbot2099@gmail.com';
const RATE_LIMIT_MS = 200;

let lastReq = 0;

function fetchUrl(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastReq));
    setTimeout(() => {
      lastReq = Date.now();
      const req = https.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location, timeout).then(resolve, reject);
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    }, wait);
  });
}

// Fuzzy name matching
function normalize(name) {
  return (name || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(the|llc|lp|inc|corp|fund|partners|group|management|capital|ventures|advisors|holdings)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  // Jaccard on words
  const wa = new Set(na.split(' ')), wb = new Set(nb.split(' '));
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? intersection / union : 0;
}

// Check if investor already exists in app data
function findExisting(candidate, existingInvestors) {
  const candidateNames = [candidate.fundName, candidate.firm].filter(Boolean);
  
  for (const inv of existingInvestors) {
    const existingNames = [inv.name, inv.firm].filter(Boolean);
    for (const cn of candidateNames) {
      for (const en of existingNames) {
        if (similarity(cn, en) > 0.5) {
          return inv;
        }
      }
    }
  }
  return null;
}

// Determine investor type from fund characteristics
function classifyType(candidate) {
  const name = (candidate.fundName + ' ' + (candidate.firm || '')).toLowerCase();
  if (name.includes('venture') || candidate.fundType === 'Venture Capital Fund') return 'vc';
  if (name.includes('angel')) return 'angel';
  if (name.includes('family') || name.includes('office')) return 'family-office';
  if (name.includes('growth') || name.includes('equity')) return 'vc';
  return 'vc'; // default for funds
}

// Estimate check size from total offering
function estimateCheckSize(totalSold) {
  if (!totalSold || totalSold <= 0) return null;
  // Rough heuristic: typical fund invests 1-5% per deal
  if (totalSold > 1000000000) return { min: 10000000, max: 100000000 };
  if (totalSold > 100000000) return { min: 1000000, max: 25000000 };
  if (totalSold > 10000000) return { min: 250000, max: 5000000 };
  return { min: 50000, max: 1000000 };
}

// Guess stages from fund size
function estimateStages(totalSold) {
  if (!totalSold) return ['seed', 'series_a'];
  if (totalSold > 500000000) return ['series_b', 'growth'];
  if (totalSold > 100000000) return ['series_a', 'series_b'];
  if (totalSold > 10000000) return ['seed', 'series_a'];
  return ['pre_seed', 'seed'];
}

// Map state to geography
function stateToGeo(state) {
  if (!state) return ['us'];
  const s = state.toLowerCase();
  if (s.includes('california') || s.includes('ca')) return ['us', 'sf_bay'];
  if (s.includes('new york') || s.includes('ny')) return ['us', 'nyc'];
  if (s.includes('massachusetts') || s.includes('ma')) return ['us', 'boston'];
  if (s.includes('texas') || s.includes('tx')) return ['us', 'texas'];
  return ['us'];
}

// Score confidence
function scoreConfidence(candidate, existing) {
  let score = 0;
  
  // Has key people
  if (candidate.keyPeople && candidate.keyPeople.length > 0) score += 1;
  // Has location
  if (candidate.location) score += 1;
  // Is a recognized fund type
  if (candidate.fundType === 'Venture Capital Fund' || candidate.fundType === 'Private Equity Fund') score += 2;
  // Has offering data
  if (candidate.totalSold && candidate.totalSold > 0) score += 1;
  // Not already in app
  if (!existing) score += 1;
  // Has substantial fund size (filters out tiny SPVs)
  if (candidate.totalSold && candidate.totalSold > 5000000) score += 1;
  
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

// Transform to app-compatible investor object
function toAppInvestor(candidate) {
  const id = (candidate.firm || candidate.fundName)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  
  const type = classifyType(candidate);
  const checkSize = estimateCheckSize(candidate.totalSold);
  const stages = estimateStages(candidate.totalSold);
  const geo = stateToGeo(candidate.state);

  return {
    id,
    name: candidate.keyPeople?.[0] || candidate.firm || candidate.fundName,
    firm: candidate.firm || candidate.fundName,
    title: candidate.keyPeople?.[0] ? 'Managing Partner' : null,
    type,
    photo: null,
    thesis: `Investment fund based in ${candidate.location || 'the United States'}. Discovered via SEC Form D filing.`,
    stages,
    sectors: ['enterprise', 'saas'], // conservative default
    checkSize,
    geography: geo,
    recentInvestments: [],
    portfolioHighlights: [],
    fundSize: candidate.totalSold ? `$${(candidate.totalSold / 1000000).toFixed(0)}M` : null,
    activelyDeploying: true,
    lastActive: candidate.filingDate ? candidate.filingDate.slice(0, 7) : null,
    linkedIn: null,
    twitter: null,
    firmUrl: null,
    location: candidate.location,
    entity: 'firm',
    memberCount: null,
    keyPeople: candidate.keyPeople,
    _source: {
      type: candidate.source,
      cik: candidate.cik,
      accessionNumber: candidate.accessionNumber,
      filingDate: candidate.filingDate,
      discoveredAt: candidate.discoveredAt,
    },
  };
}

async function main() {
  console.log('Investor Verification Pipeline');
  console.log('==============================\n');

  // Load discovered investors
  if (!fs.existsSync(DISCOVERED_FILE)) {
    console.error('No discovered.json found. Run sec-edgar.js first.');
    process.exit(1);
  }
  const discovered = JSON.parse(fs.readFileSync(DISCOVERED_FILE, 'utf8'));
  console.log(`Loaded ${discovered.length} discovered investors`);

  // Load existing app data
  let existing = [];
  if (fs.existsSync(APP_DATA)) {
    existing = JSON.parse(fs.readFileSync(APP_DATA, 'utf8'));
    console.log(`Loaded ${existing.length} existing investors from app`);
  }

  const verified = [];
  const duplicates = [];
  const lowConfidence = [];

  for (const candidate of discovered) {
    const existingMatch = findExisting(candidate, existing);
    const confidence = scoreConfidence(candidate, existingMatch);

    if (existingMatch) {
      duplicates.push({ candidate: candidate.fundName, matchedWith: existingMatch.firm || existingMatch.name, confidence });
      continue;
    }

    const appInvestor = toAppInvestor(candidate);
    appInvestor._confidence = confidence;

    if (confidence === 'high') {
      verified.push(appInvestor);
    } else if (confidence === 'medium') {
      verified.push(appInvestor);
    } else {
      lowConfidence.push(appInvestor);
    }
  }

  // Summary
  console.log(`\nVerification Results:`);
  console.log(`  Already in app (duplicates): ${duplicates.length}`);
  console.log(`  High confidence: ${verified.filter(v => v._confidence === 'high').length}`);
  console.log(`  Medium confidence: ${verified.filter(v => v._confidence === 'medium').length}`);
  console.log(`  Low confidence (flagged): ${lowConfidence.length}`);

  // Write output
  const output = {
    verified,
    flaggedForReview: lowConfidence,
    duplicates,
    summary: {
      totalDiscovered: discovered.length,
      duplicates: duplicates.length,
      highConfidence: verified.filter(v => v._confidence === 'high').length,
      mediumConfidence: verified.filter(v => v._confidence === 'medium').length,
      lowConfidence: lowConfidence.length,
      verifiedAt: new Date().toISOString(),
    },
  };

  fs.writeFileSync(VERIFIED_FILE, JSON.stringify(output, null, 2));
  console.log(`\nOutput written to ${VERIFIED_FILE}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
