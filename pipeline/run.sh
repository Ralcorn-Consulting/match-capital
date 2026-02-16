#!/bin/bash
# Match Capital — Investor Discovery Pipeline Runner
# Usage: ./run.sh [start_date] [end_date] [max_results]
#   ./run.sh                          # last 30 days, 500 max
#   ./run.sh 2025-01-01 2025-02-15    # custom date range
#   ./run.sh 2025-01-01 2025-02-15 1000

set -euo pipefail
cd "$(dirname "$0")"

START_DATE="${1:-}"
END_DATE="${2:-}"
MAX_RESULTS="${3:-500}"

echo "============================================"
echo "  Match Capital — Investor Discovery Pipeline"
echo "  $(date)"
echo "============================================"
echo ""

# Step 1: Discover from SEC EDGAR
echo ">>> Step 1: SEC EDGAR Form D Discovery"
node sec-edgar.js $START_DATE $END_DATE $MAX_RESULTS
echo ""

# Step 2: Verify
echo ">>> Step 2: Verification"
node verify.js
echo ""

# Step 3: Merge
echo ">>> Step 3: Merge into app data"
node merge.js
echo ""

# Step 4: Enrich & Filter
echo ">>> Step 4: Enrichment & Filtering"
echo "  - Filtering non-VC entities (hedge funds, credit, RE, commodities)"
echo "  - Enriching VC funds with website data"
echo "  - Quality scoring & categorization"
node enrich.js
echo ""

echo "============================================"
echo "  Pipeline complete!"
echo "============================================"
