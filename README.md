# 10-K Explorer
**NYU Stern Learning Science Lab**

A client-side web app for intro accounting students to explore and compare key GAAP financial metrics from public company 10-K filings, sourced from SEC EDGAR.

Live app: https://seandiaz-nyu.github.io/10k-explorer/

---

## What it does

- Side-by-side comparison of up to 4 companies
- Pre-built industry peer groups (Airlines, Big Tech, Beverages, etc.)
- Search across S&P 500 companies by name or ticker
- 15 key GAAP metrics across Income Statement, Balance Sheet, Cash Flow, and derived Ratios
- Most recent annual 10-K filing data only (V1)

---

## Current architecture

The app is fully static and hosted on GitHub Pages. There is no backend.

Financial data is **pre-fetched from SEC EDGAR** using a local Node.js script (`scripts/fetch-data.js`) and stored as small JSON files in `data/metrics/`. The browser loads these static files directly — no live API calls are made at runtime.

This covers all S&P 500 companies (~502 tickers). Data should be refreshed quarterly as new 10-Ks are filed:

```bash
node scripts/fetch-data.js --force
git add data/metrics/
git commit -m "Refresh EDGAR data"
git push
```

To add a company not in the current dataset:

```bash
node scripts/fetch-data.js TICKER
git add data/metrics/TICKER.json
git push
```

---

## Why real-time EDGAR fetching requires a backend

The ideal version of this app would let students search for **any** public company and fetch its data live from SEC EDGAR. The technical reason this isn't possible in a purely client-side app comes down to two browser security constraints:

**1. CORS (Cross-Origin Resource Sharing)**
Browsers block JavaScript from fetching data from a different domain unless that domain explicitly permits it. SEC EDGAR (`data.sec.gov`) does not include the required CORS headers for browser-initiated requests, so the browser refuses to complete the fetch — even though the data is publicly available.

**2. The User-Agent requirement**
EDGAR requires all API requests to include a `User-Agent` header that identifies the application making the request (e.g. `NYUSternLSL contact@stern.nyu.edu`). Browsers treat `User-Agent` as a forbidden header — JavaScript running in a browser cannot set it. Without it, EDGAR rejects the request with a 403 error.

Both of these restrictions exist by design: CORS protects users from malicious cross-site requests, and the User-Agent requirement lets the SEC identify and rate-limit automated traffic. Neither can be worked around from a browser.

**The fix** is a lightweight server-side proxy — a small Node.js/Express endpoint that:
1. Receives a request from the browser (same origin, no CORS issue)
2. Adds the correct `User-Agent` header
3. Forwards the request to EDGAR
4. Returns the result to the browser

This proxy can also cache results in SQLite so that repeat lookups are instant and EDGAR isn't hit redundantly. Hosting options include Stern IT infrastructure, a university-managed cloud environment (NYU has Azure/AWS agreements), or a serverless platform like Vercel or Cloudflare Workers.

---

## Project structure

```
10k-explorer/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js        # State management and event wiring
│   ├── config.js     # Metrics definitions, industry groups, constants
│   ├── edgar.js      # Data loading (static files + in-memory cache)
│   └── ui.js         # All DOM rendering
├── data/
│   ├── companies.json        # Ticker → CIK/name index (all SEC filers)
│   └── metrics/              # Pre-fetched GAAP metrics, one file per ticker
│       ├── AAPL.json
│       ├── MSFT.json
│       └── ...
└── scripts/
    └── fetch-data.js         # Node.js script to fetch/refresh EDGAR data
```
