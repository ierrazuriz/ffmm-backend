const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_data (
        date TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      )
    `);
  }
  return db;
}

function getCachedData(date) {
  const row = getDB().prepare('SELECT data, fetched_at FROM daily_data WHERE date = ?').get(date);
  if (!row) return null;
  return { data: JSON.parse(row.data), fetched_at: row.fetched_at };
}

function saveData(date, data) {
  getDB().prepare(`
    INSERT OR REPLACE INTO daily_data (date, data, fetched_at)
    VALUES (?, ?, ?)
  `).run(date, JSON.stringify(data), new Date().toISOString());
}

function listDates() {
  return getDB().prepare('SELECT date, fetched_at FROM daily_data ORDER BY date DESC LIMIT 30').all();
}

module.exports = { getCachedData, saveData, listDates };
