const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchDailyData } = require('./scraper');
const { getCachedData, saveData, listDates } = require('./db');

const DEFAULT_CATS = [
  'Accionario Nacional',
  'Accionario Nacional Large Cap',
  'Accionario Nacional Otros',
  'Accionario Nacional Small & Mid Cap',
  'Inversionistas Calificados Accionario Nacional',
];

function parseChilean(s) {
  if (!s || s === '-') return 0;
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0;
}

function aggregateRows(rows, headers, cats) {
  const aportesH = (headers || []).find((h) => h.includes('Flujo Aporte'));
  const rescatesH = (headers || []).find((h) => h.includes('Flujo Rescate'));
  const filtered = (rows || []).filter((r) => cats.includes(r['Categoría AFM'] || ''));
  const aportes  = filtered.reduce((s, r) => s + parseChilean(r[aportesH]  || '0'), 0);
  const rescates = filtered.reduce((s, r) => s + parseChilean(r[rescatesH] || '0'), 0);
  return { aportes, rescates, netFlow: aportes - rescates, count: filtered.length };
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getYesterday() {
  const d = new Date();
  // Subtract 1 day in Chile timezone (UTC-3 / UTC-4)
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// GET /api/daily?date=YYYY-MM-DD
app.get('/api/daily', async (req, res) => {
  const date = req.query.date || getYesterday();

  const cached = getCachedData(date);
  if (cached) {
    console.log(`[api] Returning cached data for ${date}`);
    return res.json({ date, source: 'cache', fetched_at: cached.fetched_at, ...cached.data });
  }

  try {
    const result = await fetchDailyData(date);
    saveData(date, result);
    res.json({ date, source: 'aafm', fetched_at: new Date().toISOString(), ...result });
  } catch (err) {
    console.error('[api] Error fetching data:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/refresh?date=YYYY-MM-DD  (force re-fetch)
app.post('/api/refresh', async (req, res) => {
  const date = req.query.date || req.body?.date || getYesterday();
  try {
    const result = await fetchDailyData(date);
    saveData(date, result);
    res.json({ date, source: 'aafm', fetched_at: new Date().toISOString(), ...result });
  } catch (err) {
    console.error('[api] Error refreshing data:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dates  — list cached dates
app.get('/api/dates', (_req, res) => {
  res.json(listDates());
});

// GET /api/monthly-summary?year=YYYY&month=MM&cats=Cat1|Cat2
// Returns daily net flow aggregated for requested categories
app.get('/api/monthly-summary', (req, res) => {
  const now = new Date();
  const year  = parseInt(req.query.year)  || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);
  const cats  = req.query.cats
    ? req.query.cats.split('|')
    : DEFAULT_CATS;

  const yesterday = getYesterday();
  const days = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    const iso = d.toISOString().split('T')[0];
    if (iso <= yesterday && d.getDay() !== 0 && d.getDay() !== 6) days.push(iso);
    d.setDate(d.getDate() + 1);
  }

  const result = days.map((date) => {
    const cached = getCachedData(date);
    if (!cached) return { date, loaded: false };
    return { date, loaded: true, ...aggregateRows(cached.data.rows, cached.data.headers, cats) };
  });

  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Pre-warm cache with yesterday's data in the background
  const yesterday = getYesterday();
  if (!getCachedData(yesterday)) {
    console.log(`[startup] Pre-fetching data for ${yesterday}...`);
    fetchDailyData(yesterday)
      .then((result) => {
        saveData(yesterday, result);
        console.log(`[startup] Cache ready: ${result.rows.length} fondos for ${yesterday}`);
      })
      .catch((err) => console.error('[startup] Pre-fetch failed:', err.message));
  } else {
    console.log(`[startup] Cache already warm for ${yesterday}`);
  }
});
