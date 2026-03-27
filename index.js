const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchDailyData } = require('./scraper');
const { getCachedData, saveData, listDates } = require('./db');

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
