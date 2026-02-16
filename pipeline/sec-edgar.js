#!/usr/bin/env node
/**
 * SEC EDGAR Form D Pipeline
 * Discovers investors from Form D filings (filed when startups raise money).
 * Uses the free EDGAR EFTS search API + individual filing XML parsing.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const USER_AGENT = 'MatchCapital himbot2099@gmail.com';
const RATE_LIMIT_MS = 120; // ~8 req/sec, safely under 10
const OUTPUT_FILE = path.join(__dirname, 'discovered.json');

// --- HTTP helper with rate limiting ---
let lastRequestTime = 0;

function fetch(url) {
  return new Promise((resolve, reject) => {
    const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastRequestTime));
    setTimeout(() => {
      lastRequestTime = Date.now();
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json,application/xml,text/xml,*/*' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetch(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${url}\n${body.slice(0, 200)}`)));
          return;
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    }, wait);
  });
}

// --- Search EDGAR for Form D filings ---
async function searchFormD(startDate, endDate, maxResults = 200) {
  const results = [];
  let from = 0;
  const size = 50;

  while (from < maxResults) {
    const url = `https://efts.sec.gov/LATEST/search-index?forms=D,D/A&dateRange=custom&startdt=${startDate}&enddt=${endDate}&from=${from}&size=${size}`;
    console.log(`  Fetching search results ${from}-${from + size}...`);
    try {
      const data = JSON.parse(await fetch(url));
      const hits = data.hits?.hits || [];
      if (hits.length === 0) break;
      results.push(...hits);
      from += size;
      if (from >= (data.hits?.total?.value || 0)) break;
    } catch (err) {
      console.error(`  Search error at offset ${from}: ${err.message}`);
      break;
    }
  }
  return results;
}

// --- Parse Form D XML ---
function extractXmlTag(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractAllBlocks(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(xml))) results.push(m[1]);
  return results;
}

function parseFormD(xml) {
  const issuer = {
    name: extractXmlTag(xml, 'entityName'),
    cik: extractXmlTag(xml, 'cik'),
    city: extractXmlTag(extractXmlTag(xml, 'issuerAddress') || '', 'city'),
    state: extractXmlTag(extractXmlTag(xml, 'issuerAddress') || '', 'stateOrCountryDescription'),
    entityType: extractXmlTag(xml, 'entityType'),
  };

  const relatedPersons = extractAllBlocks(xml, 'relatedPersonInfo').map(block => ({
    firstName: extractXmlTag(extractXmlTag(block, 'relatedPersonName') || '', 'firstName'),
    lastName: extractXmlTag(extractXmlTag(block, 'relatedPersonName') || '', 'lastName'),
    city: extractXmlTag(extractXmlTag(block, 'relatedPersonAddress') || '', 'city'),
    state: extractXmlTag(extractXmlTag(block, 'relatedPersonAddress') || '', 'stateOrCountryDescription'),
    relationships: extractAllBlocks(block, 'relationship'),
    clarification: extractXmlTag(block, 'relationshipClarification'),
  }));

  // Industry group
  const industryBlock = extractXmlTag(xml, 'industryGroup') || '';
  const investmentFund = extractXmlTag(industryBlock, 'investmentFundInfo');
  const industryType = extractXmlTag(industryBlock, 'industryGroupType');

  // Fund type details
  let fundType = null;
  if (investmentFund) {
    fundType = {
      type: extractXmlTag(investmentFund, 'investmentFundType'),
      is40Act: extractXmlTag(investmentFund, 'is40Act'),
    };
  }

  // Offering amounts
  const offeringBlock = extractXmlTag(xml, 'offeringSalesAmounts') || '';
  const offering = {
    totalOffering: extractXmlTag(offeringBlock, 'totalOfferingAmount'),
    totalSold: extractXmlTag(offeringBlock, 'totalAmountSold'),
    totalRemaining: extractXmlTag(offeringBlock, 'totalRemaining'),
  };

  // Filing type
  const submissionType = extractXmlTag(xml, 'submissionType');

  return { issuer, relatedPersons, industryType, fundType, offering, submissionType };
}

// --- Classify if this looks like a VC/PE fund ---
function isLikelyInvestmentFund(parsed) {
  const name = (parsed.issuer.name || '').toLowerCase();
  const entityType = (parsed.issuer.entityType || '').toLowerCase();
  
  // Strong signals it's a fund
  const fundKeywords = ['fund', 'ventures', 'capital', 'partners', 'venture', 'investment', 'equity', 'growth'];
  const hasFundKeyword = fundKeywords.some(k => name.includes(k));
  
  // It's an LP/LLC (typical fund structure)
  const isFundEntity = entityType.includes('limited partnership') || entityType.includes('limited liability');
  
  // Has fund type info from the filing
  const hasFundType = !!parsed.fundType;
  
  // Filter out obvious non-funds
  const excludeKeywords = ['bank', 'insurance', 'realty', 'real estate', 'mortgage', 'housing'];
  const isExcluded = excludeKeywords.some(k => name.includes(k));
  
  return (hasFundKeyword || hasFundType) && isFundEntity && !isExcluded;
}

// --- Transform to investor candidate ---
function toInvestorCandidate(parsed, filing) {
  const name = parsed.issuer.name || 'Unknown';
  // Try to extract firm name (remove fund number suffixes)
  const firmMatch = name.match(/^(.+?)(?:\s+(?:Fund|LP|L\.P\.).*)?$/i);
  const firm = firmMatch ? firmMatch[1].replace(/,?\s*$/, '') : name;
  
  // Get key people
  const people = parsed.relatedPersons
    .filter(p => p.firstName !== '-' && p.lastName)
    .map(p => `${p.firstName} ${p.lastName}`.trim());

  // Parse total sold for check size estimation
  let totalSold = null;
  if (parsed.offering.totalSold && parsed.offering.totalSold !== 'Indefinite') {
    totalSold = parseInt(parsed.offering.totalSold, 10);
  }

  const location = [parsed.issuer.city, parsed.issuer.state].filter(Boolean).join(', ');

  return {
    id: `sec-${filing.adsh || 'unknown'}`,
    fundName: name,
    firm: firm,
    type: parsed.fundType?.type === 'Venture Capital Fund' ? 'vc' : 
          parsed.fundType?.type === 'Private Equity Fund' ? 'vc' :
          parsed.fundType?.type === 'Hedge Fund' ? 'hedge' : 'fund',
    location: location || null,
    state: parsed.issuer.state || null,
    keyPeople: people.length > 0 ? people : null,
    totalOffering: parsed.offering.totalOffering,
    totalSold: totalSold,
    industryType: parsed.industryType || null,
    fundType: parsed.fundType?.type || null,
    entityType: parsed.issuer.entityType || null,
    filingDate: filing.file_date || null,
    filingType: parsed.submissionType || null,
    cik: parsed.issuer.cik,
    accessionNumber: filing.adsh || null,
    source: 'sec-edgar-form-d',
    sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${parsed.issuer.cik}&type=D&dateb=&owner=include&count=10`,
    discoveredAt: new Date().toISOString(),
  };
}

// --- Main ---
async function main() {
  // Default: last 30 days
  const endDate = process.argv[3] || new Date().toISOString().split('T')[0];
  const startDate = process.argv[2] || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const maxResults = parseInt(process.argv[4] || '500', 10);

  console.log(`SEC EDGAR Form D Discovery`);
  console.log(`Date range: ${startDate} to ${endDate}`);
  console.log(`Max results: ${maxResults}`);
  console.log('');

  // Step 1: Search for Form D filings
  console.log('Step 1: Searching EDGAR for Form D filings...');
  const searchResults = await searchFormD(startDate, endDate, maxResults);
  console.log(`  Found ${searchResults.length} filings`);

  // Step 2: Fetch and parse each filing's XML
  console.log('\nStep 2: Fetching and parsing Form D XMLs...');
  const candidates = [];
  let fetched = 0, skipped = 0, errors = 0;

  for (const hit of searchResults) {
    const src = hit._source || {};
    const adsh = src.adsh;
    const cik = (src.ciks || [])[0];
    if (!adsh || !cik) { skipped++; continue; }

    const cikClean = cik.replace(/^0+/, '');
    const adshDash = adsh; // keep dashes for directory
    const adshNoDash = adsh.replace(/-/g, '');
    const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${adshNoDash}/primary_doc.xml`;

    try {
      const xml = await fetch(xmlUrl);
      const parsed = parseFormD(xml);
      
      if (isLikelyInvestmentFund(parsed)) {
        candidates.push(toInvestorCandidate(parsed, { ...src, adsh }));
      } else {
        skipped++;
      }
      fetched++;
    } catch (err) {
      errors++;
      if (errors <= 5) console.error(`  Error fetching ${adsh}: ${err.message}`);
    }

    // Progress
    if ((fetched + errors) % 20 === 0) {
      console.log(`  Progress: ${fetched + errors}/${searchResults.length} (${candidates.length} candidates, ${errors} errors)`);
    }
  }

  console.log(`\nResults: ${candidates.length} investor candidates from ${fetched} filings (${skipped} skipped, ${errors} errors)`);

  // Deduplicate by firm name
  const seen = new Map();
  for (const c of candidates) {
    const key = c.firm.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!seen.has(key) || (c.totalSold || 0) > (seen.get(key).totalSold || 0)) {
      seen.set(key, c);
    }
  }
  const deduplicated = Array.from(seen.values());
  console.log(`After deduplication: ${deduplicated.length} unique funds`);

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(deduplicated, null, 2));
  console.log(`\nOutput written to ${OUTPUT_FILE}`);
  
  return deduplicated;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
