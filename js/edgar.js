import { CACHE_TTL } from './config.js';

// data/companies.json — bundled ticker→{cik,name} index (no CORS issues, same origin)
const COMPANIES_URL = './data/companies.json';

// data/metrics/{ticker}.json — pre-fetched GAAP metrics per company
const METRICS_URL = (ticker) => `./data/metrics/${ticker}.json`;

// In-memory ticker index: { TICKER: { cik, name } }
let tickersIndex = null;

// ─── Ticker index ─────────────────────────────────────────────────────────────

export async function loadTickersIndex() {
  if (tickersIndex) return;
  const res = await fetch(COMPANIES_URL);
  if (!res.ok) throw new Error('Failed to load company index.');
  tickersIndex = await res.json();
}

export function lookupTicker(ticker) {
  return tickersIndex?.[ticker.toUpperCase()] ?? null;
}

export function searchCompanies(query) {
  if (!tickersIndex || query.length < 2) return [];
  const q = query.toLowerCase();
  return Object.entries(tickersIndex)
    .filter(
      ([ticker, c]) =>
        ticker.toLowerCase().startsWith(q) ||
        c.name.toLowerCase().includes(q)
    )
    .map(([ticker, c]) => ({ ticker, ...c }))
    .slice(0, 20);
}

// ─── Metrics loading ──────────────────────────────────────────────────────────

// Simple in-memory cache to avoid re-fetching within a session
const metricsCache = {};

export async function getCompanyMetrics(ticker) {
  ticker = ticker.toUpperCase();

  if (metricsCache[ticker]) return metricsCache[ticker];

  const company = lookupTicker(ticker);
  if (!company) throw new Error(`Ticker not found: ${ticker}`);

  const res = await fetch(METRICS_URL(ticker));
  if (!res.ok) {
    throw new Error(
      `No data available for ${ticker}. It may not be in our pre-loaded dataset yet.`
    );
  }

  const data = await res.json();
  metricsCache[ticker] = data;
  return data;
}
