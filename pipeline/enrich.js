#!/usr/bin/env node
/**
 * Match Capital — Investor Enrichment & Filtering Pipeline
 * 
 * 1. Filters out non-VC entities (hedge funds, credit, RE, commodities, PE buyout)
 * 2. Enriches remaining VC funds with curated data (enrichment-data.json)
 * 3. Quality scores and categorizes (deploy/review/drop)
 * 4. Updates investors.json — removes filtered + unenrichable skeletons
 */

const fs = require('fs');
const path = require('path');

const INVESTORS_PATH = path.resolve(__dirname, '../app/data/investors.json');
const ENRICHMENT_DATA_PATH = path.resolve(__dirname, 'enrichment-data.json');
const ENRICHMENT_REPORT_PATH = path.resolve(__dirname, 'enrichment-report.json');

// ─── NON-VC FILTER PATTERNS ───
const NON_VC_PATTERNS = [
  /credit/i, /CLO\b/i, /\bloan/i, /\bdebt/i, /\byield/i, /\bincome/i,
  /fixed.?income/i, /\bbond/i, /floating.?rate/i, /leveraged.?loan/i,
  /short.?duration/i, /\blien/i, /trade.?finance/i,
  /hedge/i, /long.?short/i, /\bL\/S\b/, /macro/i, /event.?driven/i,
  /multi.?strategy/i, /activist/i, /\balpha/i, /directional/i,
  /hedged.?equity/i, /\bswap\b/i, /unconstrained/i, /structured.?alpha/i,
  /real.?estate/i, /\bREIF\b/i, /\bproperty/i, /\bproperties/i,
  /\bRE\b.*(?:fund|partners|capital)/i, /NorthPoint.*Industrial/i, /CAPROCK.*INDUSTRIAL/i,
  /cattle/i, /\bPRISA\b/i, /CLARION.*LION/i, /TriGate.*Property/i,
  /commodity/i, /\bMLP\b/i, /oil.?&.?gas/i, /energy.*(?:MLP|midstream|swap)/i,
  /\bmidstream/i, /futures/i, /SummerHaven/i,
  /buyout/i, /secondary/i, /\bLBO\b/i,
  /municipal/i, /\bmuni\b/i, /government.*credit/i,
  /structured.?credit/i, /\bCCS\b.*credit/i, /Yokahu/i,
  /equity.?strateg/i, /select.?equity/i, /defensive.?equity/i,
  /international.?equity/i, /\bUS\b.*equity.*strateg/i, /emerging.*markets.*(?:equity|macro)/i,
  /small.?cap.*(?:growth|equity)/i, /mid.?cap/i, /micro.?cap/i, /large.?cap/i,
  /stalwarts/i, /long.?only/i, /concentrated.*(?:growth|L\/S)/i,
  /international.*(?:growth|small.*cap)/i, /diversified.*(?:international|equity)/i,
  /\bIR&M\b/i, /\bIR&amp;M\b/i, /\bFIAM\b/i, /Lazard/i, /Loomis.?Sayles/i,
  /Parametric/i, /Acadian/i, /Invesco/i, /Ullico/i, /Grandeur.?Peak/i,
  /Wellington.*Compound/i, /Hirtle.*Callaghan/i, /\bCFM\b.*Discus/i,
  /Apollo.*(?:IG|Infrastructure|Aligned)/i,
  /\bfeeder\b/i, /\boffshore\b/i, /\bonshore\b.*access/i,
  /Conway.*Access/i, /iCapital/i,
  /dental/i, /cyclist/i, /yacht/i, /solar.*finance/i,
  /\bLLC\b.*Series\s+\d/i,
  /Moelis.*Catalyst/i, /Pentwater/i, /Star\s*Mountain/i,
  /Hamlin/i, /Radcliffe/i, /Treville/i, /Commonwealth.*Structured/i,
  /Long Angle/i, /Standard Investment Research/i, /Eminence/i, /North Haven/i,
];

const VC_POSITIVE_PATTERNS = [
  /venture/i, /\bVC\b/i, /seed/i, /accelerat/i, /angel/i,
  /startup/i, /incubat/i, /growth.?equity/i, /early.?stage/i,
  /climate.*venture/i, /impact.*venture/i,
];

// Additional specific removes (ambiguous names confirmed non-VC)
const SPECIFIC_REMOVES = new Set([
  'Red Neck Yacht', 'Pro Cyclist', 'Providence Dental Partners LLC',
  'Pinnacle Arcadia Cattle Partners I', 'Fundamental Solar Finance',
  'Halle Parachute Holdings, LLC', 'PRPS LLC', 'AFG-CCT LLC',
  'MILLENNIUM SMC LLC', 'NI-1203', 'AU-1201', 'HY-1203', 'N3L',
  'OHPC', 'DTLA', 'INTERVAL', 'Worcester', 'Oceana', 'Swingsville',
  'Asturias', 'FRAMTIDEN', 'TREN 4 LLC', 'OFPP LLC', 'Solus 2 LLC',
  'KUROTO', 'THELEME', 'Recurrent', 'ALTS PLUS',
  'Seacoast Service Partners, LLC', 'City Finance Co IV LLC',
  'Gulf View', 'Atlas', 'Pier61', 'Snowy Owl', 'Owlhouse Onshore',
  'Split Onshore', 'Austen Access', '3G', '3G Langtry',
  'Woodline Spire', 'Singh Capital Rolling', '59 North Partners',
  'Situational Awareness Partners', 'Kepler Operator',
  'Sandstone Pointe TH Investment LLC', 'MCM AMP I', 'Marnell Management',
  'PENGLAI PEAK', 'EP TFF', 'AIMS Sidecar I', 'Napier Park Eton',
  'Cornwall Domestic', 'Khaner Capital', 'Charter Oak Alta',
  'LCG2 INDUSTRIAL', 'Eos Partners', 'Eos Credit Opportunities',
  'Laird Group', 'LPG Capital Partners', 'Alchemy Special Opportunities',
  'Man GPM CRS Evergreen (US)', 'Flowing River Capital Investors',
  'Lumen Holding', 'Riva Ridge Capital Partners', 'Engine Airflow Capital',
  'Stellar Wealth Partners India', 'New Vernon Financial Sector',
  'Antares European', 'Crossway Point', 'Harmonic Investors LLC',
  'MSCP VIII Employees', 'OneTail Hedgehog', 'GEM Impact Endowment',
  'GCP-Emerald', 'West Egg Investors', 'WILLIAM JAMES CAPITAL',
  'AnKap Partners', 'Cypress Ascendant Events SPV', 'Adara Sidecar II SCSp',
  'W FINANCIAL', 'MARVIN & PALMER US EQUITY', 'JVM Preferred Equity',
  'Unity Select', 'Tolou Investment', 'Violin Equity',
  'Portfolio Advisors Private Equity', 'Enhalus Intertidal Domestic',
  'Manteio GALIS', 'New Holland Special Opportunities Aggregator',
  'Altai Capital Osprey, LLC', 'FEG Select LLC',
  'Gresham Real Assets Strategies', 'MASON HILL PARTNERS',
  'Graham Institutional Partners', 'DL Partners Opportunities',
  'Fifth Lane Partners', 'Chatham Investment',
  'Non-US Equity Managers: Portfolio 4 LLC', 'ISQ Energy Transition',
  'Lionschain Capital LLC', 'Diadema Strategic', 'EVR Opportunity',
  'Jericho Capital Partners', 'National Diversified', 'Iron Triangle',
  'Condire Resource Partners', 'Carl Marks Strategic Opportunities',
  'Cohen Capital Value', 'Diadema Partners Onshore',
  'Parkside Energy & Infrastructure', 'OCM AMERICAN RIVER LLC',
  'Long Pond Capital QP', 'Seaward Partners 1', 'Engine Lift Capital',
  'North Point Investment', 'Stripes VII Private Investors, LLC',
  'SIP Warwick Partners I QP - R&M', 'Accolade Partners Digital Evolution',
  'Constellation Wealth Capital', 'CEDAR STREET EMERGING MARKETS VALUE',
  'Tensor Edge Capital', 'Mara River Special Opportunities',
  'TPG Healthcare Partners III', 'FIVE CORNERS PARTNERS',
  'ECP VI Private Investors, LLC', 'Maple Rock US',
  'Alta Park Private Opportunities', 'DLV Capital Partners',
  'Flying Fish Opportunity', 'Orchard Investment Partners',
  'RCP SMALL & EMERGING', 'Vedanta R2 Partners',
  'HEDGEFORUM RENAISSANCE EQUITIES, LLC', 'Avlok Capital',
  'Old Kings Capital', 'Health Wealth', 'AUA Private Equity',
  'HAMLIN YIELD PARTNERS', 'F.Inc Capital',
  'Macquarie Green Energy Transition Solutions (Direct) SCSp',
  'Macquarie Green Energy Transition Solutions (TC Direct) SCSp',
  'Macquarie Green Energy Transition Solutions SCSp',
  'Securis Opportunities', 'North Rock', 'Monaco Capital',
  'KC GAMMA OPPORTUNITY', 'Crystal Capital', 'Resolute Capital Asset Partners',
  'GAF-RE II', 'LIGHTHOUSE OPPORTUNITIES', 'LIGHTHOUSE STRATEGIES',
  'LIGHTHOUSE DIVERSIFIED', 'LIGHTHOUSE AGGRESSIVE GROWTH',
  'Lighthouse Palmetto Strategic Partnership', 'SANSONE PARTNERS (QP)',
  'ACACIA CAPITAL', 'Generation Food Rural Partners I',
  'Highgate Partners', 'EAGLE FREEDOM', 'P.I. Gateway & Co.',
  'Glen Capital Partners Focus', 'PEAK ROCK CAPITAL',
  'SCP Masters Equity Long', 'StepStone Climate',
  'Peachhtree Media Opportunity', 'Roadmap', 'New Paradigm',
  'NOVA Infrastructure', 'Provenire Technology Partners',
  'Ping Emerging Markets Macro', 'Gresham Private Equity Strategies',
  'New Holland Tactical Alpha Domestic', 'Evolution Credit Partners Trade Finance',
  'Aquiline Credit Opportunities', 'Apollo Aligned Alternatives (A)',
  'Apollo Aligned Alternatives (C)', 'SUMMIT PARTNERS CONCENTRATED GROWTH L/S QP',
  'SUMMIT PARTNERS TECHNOLOGY L/S QP', 'FIAM SELECT INTERNATIONAL EQUITY',
  'FIAM CORE PLUS', 'FIAM Small/Mid Cap Opportunities',
  'FIAM SELECT EMERGING MARKETS EQUITY', 'FIAM High Yield',
  'FIAM Leveraged Loan', 'Three Circles Enhanced Growth & Income',
  'Apollo Infrastructure Opportunities', 'Guilford Capital Credit III U.S. LLC',
  'CEDAR STREET INTERNATIONAL SMALL CAP', 'STANDARD INVESTMENT RESEARCH ENERGY OPPORTUNITIES',
  'STANDARD INVESTMENT RESEARCH HEDGED EQUITY',
  'Standard Investment Research SPV Holdings, LLC - Series 2',
  'Standard Investment Research SPV Holdings, LLC - Series 3',
  'Standard Investment Research SPV Holdings, LLC - Series 4',
  'Conway RIEF Onshore Access', 'Conway Onshore Access',
  'Platinum Credit Opportunities', 'Mesirow Institutional Multi-Strategy',
  'Central Park Group Activist', 'OWS Credit Opportunity',
  'LONG ANGLE INVESTMENTS LLC - LAECF IV 2023 SPV',
  'Long Angle Investments LLC - LS Coinvest 1 2025 SPV',
  'Long Angle Investments LLC - LSVP OF III 2025 SPV',
  'LONG ANGLE INVESTMENTS LLC - LAALP 2024 SPV',
  'Long Angle Investments LLC - SPRIM SPV 2024',
  'LONG ANGLE INVESTMENTS LLC - LAHIG 2023 SPV',
  'iCapital-CFM Discus Access', 'Moelis Asset Catalyst (Master)',
  'Moelis Asset Catalyst (Offshore)', 'Pentwater Credit',
  'Pentwater Unconstrained', 'PENTWATER EVENT',
  'Northern Right Long Only', 'Star Mountain Strategic Credit Income',
  'Star Mountain U.S. Lower Middle-Market Secondary',
  'CCS Structured Credit Onshore', '13D Activist',
  'Donald Smith Futures', 'Loomis Sayles Senior Floating Rate',
  'ASOF V Feeder', 'Eminence Partners Long', 'Eminence Capital Opportunity',
  'Eminence Partners II', 'Valence8 Directional (Onshore)',
  'Valence8 Diversified (Onshore)', 'North Haven Capital Partners VIII-A',
  'North Haven Capital Partners VIII U.S. Wealth Management Partners',
  'North Haven Capital Partners VIII Non-U.S. Wealth Management Partners',
  'Contrarian Credit Feeder', 'Maverick Lien',
]);

function isNonVC(investor) {
  const name = investor.firm || '';
  if (SPECIFIC_REMOVES.has(name)) return true;
  for (const p of VC_POSITIVE_PATTERNS) {
    if (p.test(name)) return false;
  }
  for (const p of NON_VC_PATTERNS) {
    if (p.test(name)) return true;
  }
  return false;
}

function scoreInvestor(inv) {
  let score = 0;
  if (inv.thesis && !inv.thesis.includes('Discovered via SEC Form D filing') && inv.thesis.length > 50) score += 2;
  if (inv.portfolioHighlights && inv.portfolioHighlights.length > 0) score += 2;
  if (inv.recentInvestments && inv.recentInvestments.length > 0) score += 2;
  if (inv.photo) score += 1;
  if (inv.linkedIn) score += 1;
  if (inv.firmUrl) score += 1;
  return score;
}

function main() {
  console.log('Loading investors.json...');
  const investors = JSON.parse(fs.readFileSync(INVESTORS_PATH, 'utf8'));
  
  // Load enrichment data
  let enrichmentData = {};
  if (fs.existsSync(ENRICHMENT_DATA_PATH)) {
    enrichmentData = JSON.parse(fs.readFileSync(ENRICHMENT_DATA_PATH, 'utf8'));
    console.log(`Loaded enrichment data for ${Object.keys(enrichmentData).length} funds`);
  }
  
  const original = [];
  const skeletons = [];
  
  for (const inv of investors) {
    if (inv.thesis && inv.thesis.includes('Discovered via SEC Form D filing')) {
      skeletons.push(inv);
    } else {
      original.push(inv);
    }
  }
  
  console.log(`Original (untouched): ${original.length}`);
  console.log(`SEC EDGAR skeletons: ${skeletons.length}`);
  
  // Phase 1: Filter + Enrich
  const enriched = [];
  const filtered = [];
  const dropped = [];
  
  for (const inv of skeletons) {
    const firmName = inv.firm || '';
    
    // Check enrichment data first
    const eData = enrichmentData[firmName];
    
    // If enrichment data says remove, remove
    if (eData && eData._remove) {
      filtered.push({ id: inv.id, firm: firmName, reason: eData._reason || 'non-vc (enrichment)' });
      continue;
    }
    
    // Check non-VC filter
    if (isNonVC(inv)) {
      filtered.push({ id: inv.id, firm: firmName, reason: 'non-vc (heuristic)' });
      continue;
    }
    
    // Apply enrichment data if available
    if (eData) {
      if (eData.thesis) inv.thesis = eData.thesis;
      if (eData.firmUrl) inv.firmUrl = eData.firmUrl;
      if (eData.linkedIn) inv.linkedIn = eData.linkedIn;
      if (eData.twitter) {
        inv.twitter = eData.twitter;
        inv.photo = `https://unavatar.io/twitter/${eData.twitter}`;
      }
      if (eData.stages) inv.stages = eData.stages;
      if (eData.sectors) inv.sectors = eData.sectors;
      if (eData.portfolioHighlights) inv.portfolioHighlights = eData.portfolioHighlights;
      if (eData.type) inv.type = eData.type;
    }
    
    // Score
    const score = scoreInvestor(inv);
    if (score >= 2) {
      enriched.push(inv);
    } else {
      // Unenrichable skeleton — drop it
      dropped.push({ id: inv.id, firm: firmName, score });
    }
  }
  
  console.log(`\nResults:`);
  console.log(`  Filtered (non-VC): ${filtered.length}`);
  console.log(`  Enriched & kept (score >= 2): ${enriched.length}`);
  console.log(`  Dropped (unenrichable, score < 2): ${dropped.length}`);
  
  // Final list
  const finalInvestors = [...original, ...enriched];
  console.log(`\nFinal total: ${finalInvestors.length} (${original.length} original + ${enriched.length} enriched)`);
  
  // Save
  fs.writeFileSync(INVESTORS_PATH, JSON.stringify(finalInvestors, null, 2));
  console.log(`Saved to investors.json`);
  
  // Report
  const report = {
    timestamp: new Date().toISOString(),
    original: original.length,
    skeletonsProcessed: skeletons.length,
    filtered: filtered.length,
    enrichedKept: enriched.length,
    dropped: dropped.length,
    finalTotal: finalInvestors.length,
    keptFunds: enriched.map(i => ({
      firm: i.firm, 
      score: scoreInvestor(i),
      firmUrl: i.firmUrl,
      thesis: i.thesis?.substring(0, 80) + '...'
    })),
    droppedFunds: dropped,
    filteredFunds: filtered.slice(0, 20).map(f => `${f.firm} (${f.reason})`),
  };
  
  fs.writeFileSync(ENRICHMENT_REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Saved enrichment report`);
  
  console.log(`\n─── Kept Funds ───`);
  for (const inv of enriched) {
    console.log(`  [${scoreInvestor(inv)}] ${inv.firm} — ${inv.firmUrl || 'no url'}`);
  }
}

main();
