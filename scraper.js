const { chromium } = require('playwright');

const BASE_URL = 'https://estadisticas2.aafm.cl';

// Columns we want from AAFM
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
 * Fetches all mutual fund data for a given date.
 * Returns { headers: string[], rows: object[] }
 */
async function fetchDailyData(date) {
  console.log(`[scraper] Fetching AAFM data for date: ${date}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/DailyStadistics`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for jQuery + Select2
    await page.waitForFunction(
      () => window.$ && typeof $.fn.select2 !== 'undefined',
      { timeout: 30000 }
    );

    // Set date
    await page.evaluate((d) => {
      const input = document.getElementById('Date');
      input.removeAttribute('max');
      input.value = d;
    }, date);

    // Category = 0 (all)
    await page.evaluate(() => {
      $('select[name="IdCategoryAafm"]').val(['0']).trigger('change.select2');
    });

    // Wait for admin AJAX reload
    await page
      .waitForResponse((r) => r.url().includes('LoadAdministratorByIdCategoryAafm'), {
        timeout: 12000,
      })
      .catch(() => {});
    await page.waitForTimeout(1500);

    // Set admin, APV, InversionType
    await page.evaluate(() => {
      $('select[name="IdAdministrator"]').val(['0']).trigger('change.select2');
      $('select[name="Apv"]').val('3').trigger('change');
      $('select[name="InversionType"]').val('A').trigger('change');
    });
    await page.waitForTimeout(300);

    // Check column checkboxes using Playwright's check() which fires proper events
    for (const col of COLUMNS) {
      await page.check(`input[name="${col}"]`).catch(() => {
        console.warn(`[scraper] Could not check ${col}`);
      });
    }
    await page.waitForTimeout(300);

    // Capture AJAX response with the table HTML
    let tableHTML = null;
    const responsePromise = page.waitForResponse(
      async (r) => {
        const url = r.url();
        if (
          url.toLowerCase().includes('dailystadistics') &&
          !url.includes('Export') &&
          !url.includes('Load') &&
          r.request().method() === 'POST'
        ) {
          try {
            const body = await r.text();
            // Valid data response contains table HTML
            if (body.length > 500 && (body.includes('<table') || body.includes('<tr'))) {
              tableHTML = body;
              return true;
            }
          } catch (_) {}
        }
        return false;
      },
      { timeout: 90000 }
    );

    // Submit form
    await page
      .click('#formOtherQuerysQuotes [type="submit"]')
      .catch(() =>
        page.evaluate(() =>
          document.querySelector('form#formOtherQuerysQuotes').submit()
        )
      );

    await responsePromise.catch(() => {});

    // Parse the intercepted HTML response
    if (tableHTML) {
      const result = parseHTMLTable(tableHTML);
      if (result.rows.length > 0) {
        console.log(`[scraper] Got ${result.rows.length} rows, ${result.headers.length} columns`);
        return result;
      }
      console.warn('[scraper] HTML parse returned 0 rows, trying DOM fallback');
    }

    // DOM fallback: wait for table then extract ALL rows via DataTables API
    console.log('[scraper] Extracting from DOM via DataTables API...');
    await page.waitForFunction(
      () => window.tableStadistics && tableStadistics.data().length > 0,
      { timeout: 60000 }
    );

    const result = await page.evaluate(() => {
      // Get headers from first header row
      const table = document.querySelector('#datatablesSimple1');
      const headers = [...table.querySelectorAll('thead tr:first-child th')].map((th) =>
        th.textContent.replace(/\s+/g, ' ').trim()
      );

      // Use DataTables API to iterate ALL rows (ignores pagination)
      const rows = [];
      tableStadistics.rows().every(function () {
        const tr = this.node();
        const cells = [...tr.querySelectorAll('td')].map((td) =>
          td.textContent.replace(/\s+/g, ' ').trim()
        );
        const row = {};
        headers.forEach((h, i) => { row[h] = cells[i] !== undefined ? cells[i] : ''; });
        rows.push(row);
      });

      return { headers, rows };
    });

    console.log(`[scraper] Got ${result.rows.length} rows from DOM`);
    return result;
  } finally {
    await browser.close();
  }
}

/**
 * Parse HTML containing a <table> element.
 * Returns { headers: string[], rows: object[] }
 */
function parseHTMLTable(html) {
  // Extract first <thead> and <tbody>
  const theadMatch = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);

  if (!theadMatch || !tbodyMatch) {
    // Maybe no thead/tbody — try raw table
    console.warn('[scraper] No thead/tbody found in response');
    return { headers: [], rows: [] };
  }

  function stripTags(str) {
    return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#[0-9]+;/g, '').replace(/\s+/g, ' ').trim();
  }

  function extractCells(rowHTML, tag = 'td') {
    const cells = [];
    const re = new RegExp(`<t[dh][^>]*>([\\s\\S]*?)<\\/t[dh]>`, 'gi');
    let m;
    while ((m = re.exec(rowHTML)) !== null) {
      cells.push(stripTags(m[1]));
    }
    return cells;
  }

  // First <tr> in thead → headers
  const firstTrMatch = theadMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  if (!firstTrMatch) return { headers: [], rows: [] };
  const headers = extractCells(firstTrMatch[1], 'th').filter((h) => h !== '');

  if (headers.length === 0) return { headers: [], rows: [] };

  // All <tr> in tbody → data rows
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tbodyMatch[1])) !== null) {
    const cells = extractCells(rowMatch[1]);
    if (cells.length === 0) continue;
    const firstCell = cells[0] || '';
    if (!firstCell || firstCell.toLowerCase() === 'no hay información') continue;
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] !== undefined ? cells[i] : ''; });
    rows.push(row);
  }

  return { headers, rows };
}

module.exports = { fetchDailyData };
