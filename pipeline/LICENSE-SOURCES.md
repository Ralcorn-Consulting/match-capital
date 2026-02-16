# Data Source Licensing

## SEC EDGAR (Primary Source)
- **URL:** https://www.sec.gov/edgar
- **Data:** Form D filings (offering notices filed by companies raising capital)
- **License:** U.S. government public data — no copyright, no restrictions on commercial use
- **Legal basis:** 17 CFR § 230.503 requires Form D filings; all filings are public record
- **API Terms:** SEC requires a User-Agent header with contact info; max 10 requests/second
- **Reference:** https://www.sec.gov/os/webmaster-faq#developers

## VC Firm Websites (Verification Only)
- **Data:** Publicly available information (investment thesis, team, portfolio)
- **Usage:** Read-only verification of investor attributes; no scraping or bulk collection
- **Legal basis:** Publicly accessible information used for factual verification
- **Note:** No data is copied verbatim; only factual attributes (stage, sector, check size) are extracted

## Excluded Sources
- **Crunchbase:** NOT used (proprietary, requires paid license for commercial use)
- **PitchBook:** NOT used (proprietary database)
- **CB Insights:** NOT used (proprietary)
- **LinkedIn:** NOT used for automated data collection (ToS prohibits scraping)

## Summary
All data sources used in this pipeline are either:
1. U.S. government public records (SEC EDGAR) — free for any use
2. Publicly available web content used for factual verification only

No proprietary databases or paid APIs are used.
