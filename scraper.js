const cheerio = require('cheerio');

const BASE_URL = 'https://estadisticas2.aafm.cl';

const COLUMNS = [
  'ContributedFlow',
  'RescuedFlow',
  'CirculationQuote',
  'QuoteValue',
  'TotalParticipants',
  'NetPatrimony',
  'Money',
  'CategoryCmf',
];

/**
 * Fetches all mutual fund data for a given date via direct HTTP POST.
 * Returns { headers: string[], rows: object[] }
 */
async function fetchDailyData(date) {
  console.log(`[scraper] Fetching AAFM data for date: ${date}`);

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
  };

  // Step 1: GET page to obtain session cookies
  const getResp = await fetch(`${BASE_URL}/DailyStadistics`, { headers });
  if (!getResp.ok) throw new Error(`GET failed: ${getResp.status}`);

  const setCookies = getResp.headers.getSetCookie?.() ?? [];
  const cookieStr = setCookies.map((c) => c.split(';')[0]).join('; ');

  // Step 2: POST form with all desired columns
  const colFlags = Object.fromEntries(
    COLUMNS.map((c) => [c, 'true'])
  );

  const body = new URLSearchParams({
    Date: date,
    IdCategoryAafm: '0',
    IdAdministrator: '0',
    Apv: '3',
    InversionType: 'A',
    ...colFlags,
  });

  const postResp = await fetch(`${BASE_URL}/DailyStadistics`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${BASE_URL}/DailyStadistics`,
      ...(cookieStr ? { Cookie: cookieStr } : {}),
    },
    body: body.toString(),
  });

  if (!postResp.ok) throw new Error(`POST failed: ${postResp.status}`);

  const html = await postResp.text();

  if (!html.includes('<table') && !html.includes('<tr')) {
    throw new Error('Response does not contain table data');
  }

  const result = parseHTMLTable(html);
  console.log(`[scraper] Got ${result.rows.length} rows, ${result.headers.length} columns`);
  return result;
}

/**
 * Parse the HTML table from AAFM response using cheerio.
 */
function parseHTMLTable(html) {
  const $ = cheerio.load(html);
  const table = $('table').first();

  if (!table.length) return { headers: [], rows: [] };

  // First row of thead = real column headers
  const headers = [];
  table.find('thead tr').first().find('th').each((_, th) => {
    headers.push($(th).text().replace(/\s+/g, ' ').trim());
  });

  if (!headers.length) return { headers: [], rows: [] };

  const rows = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = [];
    $(tr).find('td').each((_, td) => {
      cells.push($(td).text().replace(/\s+/g, ' ').trim());
    });
    if (!cells.length || cells[0] === 'No hay información') return;
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    rows.push(row);
  });

  return { headers, rows };
}

module.exports = { fetchDailyData };
