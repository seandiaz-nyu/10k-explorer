/**
 * fetch-data.js
 *
 * Fetches key GAAP metrics from SEC EDGAR for a curated list of companies
 * and writes the results to data/metrics/{ticker}.json.
 *
 * Run: node scripts/fetch-data.js
 * or:  node scripts/fetch-data.js AAPL MSFT TSLA   (fetch specific tickers only)
 *
 * Requires Node 18+ (native fetch). Uses the EDGAR company concept API.
 * Rate limited to ~8 req/sec to stay within SEC guidelines.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const USER_AGENT = 'NYUSternLSL ilabed@stern.nyu.edu';
const API_BASE   = 'https://data.sec.gov';
const OUT_DIR    = path.join(__dirname, '..', 'data', 'metrics');
const CIK_MAP    = path.join(__dirname, '..', 'data', 'companies.json');

// ─── Metrics to fetch ────────────────────────────────────────────────────────
const METRICS = [
  { id: 'revenue',            concepts: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'] },
  { id: 'cogs',               concepts: ['CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfGoodsSold'] },
  { id: 'grossProfit',        concepts: ['GrossProfit'] },
  { id: 'operatingIncome',    concepts: ['OperatingIncomeLoss'] },
  { id: 'netIncome',          concepts: ['NetIncomeLoss'] },
  { id: 'currentAssets',      concepts: ['AssetsCurrent'] },
  { id: 'totalAssets',        concepts: ['Assets'] },
  { id: 'currentLiabilities', concepts: ['LiabilitiesCurrent'] },
  { id: 'totalLiabilities',   concepts: ['Liabilities'] },
  { id: 'shareholdersEquity', concepts: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  { id: 'operatingCashFlow',  concepts: ['NetCashProvidedByUsedInOperatingActivities'] },
  { id: 'capex',              concepts: ['PaymentsToAcquirePropertyPlantAndEquipment'] },
];

// ─── Default company list ─────────────────────────────────────────────────────
const DEFAULT_TICKERS = [
  // Industry groups (always included)
  'KO','PEP',
  'DAL','UAL','AAL','LUV',
  'AAPL','MSFT','GOOGL','META',
  'WMT','TGT','COST',
  'F','GM','TSLA',
  'JNJ','PFE','MRK',
  'JPM','BAC','WFC',
  'NFLX','DIS','WBD',
  // Additional major companies
  'AMZN','NVDA','ORCL','INTC','AMD','CSCO','IBM','QCOM','TXN','AVGO',
  'GS','MS','C','USB','AXP',
  'XOM','CVX','COP','SLB','BP',
  'UNH','CVS','CI','HUM','ANTM',
  'HD','LOW','NKE','SBUX','MCD','YUM',
  'BA','RTX','LMT','GD','NOC',
  'GE','MMM','HON','CAT','DE',
  'ABBV','AMGN','GILD','BMY','LLY',
  'T','VZ','TMUS','CMCSA','CHTR',
  'V','MA','PYPL','SQ',
  'BRK-B','CB','TRV',
  'NEE','DUK','SO','D',
  'PLD','AMT','CCI','EQIX',
  'SPG','O',
  'UBER','LYFT','ABNB','BKNG',
  'ZM','SNOW','CRM','ADBE','NOW','WDAY','TEAM',
];

// ─── Rate limiter (8 req/sec) ─────────────────────────────────────────────────
let lastRequestTime = 0;
async function rateLimit() {
  const minGap = 125; // ms between requests (~8/sec)
  const now = Date.now();
  const wait = minGap - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 404) { res.resume(); return resolve(null); }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

async function edgarGet(url) {
  await rateLimit();
  return httpsGet(url);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function padCik(cik) {
  return String(cik).padStart(10, '0');
}

function extractAnnualValue(units) {
  const entries = units?.USD;
  if (!entries) return null;
  const hit = entries
    .filter(d => d.form === '10-K' && d.fp === 'FY')
    .sort((a, b) => b.end.localeCompare(a.end))[0];
  return hit ? { value: hit.val, year: hit.fy, periodEnd: hit.end } : null;
}

async function fetchConceptValue(cik, concept) {
  const data = await edgarGet(
    `${API_BASE}/api/xbrl/companyconcept/CIK${padCik(cik)}/us-gaap/${concept}.json`
  );
  return data ? extractAnnualValue(data.units) : null;
}

async function fetchCompanyMetrics(ticker, cik, name) {
  const metrics = {};
  let fiscalYear = null;

  for (const metric of METRICS) {
    for (const concept of metric.concepts) {
      const result = await fetchConceptValue(cik, concept);
      if (result) {
        metrics[metric.id] = result;
        if (!fiscalYear) fiscalYear = result.year;
        break;
      }
    }
    if (!metrics[metric.id]) metrics[metric.id] = null;
  }

  return { ticker, name, cik, fiscalYear, metrics, fetchedAt: new Date().toISOString() };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const companiesRaw = JSON.parse(fs.readFileSync(CIK_MAP, 'utf8'));

  // CLI args override the default list
  const tickers = process.argv.slice(2).length
    ? process.argv.slice(2).map(t => t.toUpperCase())
    : DEFAULT_TICKERS;

  console.log(`Fetching data for ${tickers.length} companies...\n`);

  let success = 0, skipped = 0, failed = 0;

  for (const ticker of tickers) {
    const company = companiesRaw[ticker];
    if (!company) {
      console.warn(`  [SKIP] ${ticker} — not found in company index`);
      skipped++;
      continue;
    }

    const outFile = path.join(OUT_DIR, `${ticker}.json`);

    // Skip if recently fetched (within 24h) — use --force to override
    if (!process.argv.includes('--force') && fs.existsSync(outFile)) {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      const age = Date.now() - new Date(existing.fetchedAt).getTime();
      if (age < 24 * 60 * 60 * 1000) {
        console.log(`  [CACHED] ${ticker}`);
        success++;
        continue;
      }
    }

    try {
      process.stdout.write(`  [FETCH] ${ticker} (${company.name})...`);
      const data = await fetchCompanyMetrics(ticker, company.cik, company.name);
      fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
      console.log(` FY${data.fiscalYear ?? '?'} ✓`);
      success++;
    } catch (err) {
      console.error(` ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} succeeded, ${skipped} skipped, ${failed} failed.`);
}

main().catch(err => { console.error(err); process.exit(1); });
