const { chromium } = require('playwright');
const env = require('../config/env');

const TBO_BASE = env.TBO_BASE_URL;

/**
 * Scrape all module listings from TBO Karunika public pages.
 * Returns an array of module objects (no login required).
 */
async function runTboScraper() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'id-ID' });
  const page = await context.newPage();

  const modules = [];

  try {
    const programs = await scrapeAllPrograms(page);
    console.log(`[TBO] Found ${programs.length} programs to scrape`);

    for (const program of programs) {
      console.log(`[TBO] Scraping program: ${program.code}`);
      try {
        const programModules = await scrapeProgramModules(page, program.url);
        modules.push(...programModules);
      } catch (err) {
        console.warn(`[TBO] Error scraping program ${program.code}:`, err.message);
      }
    }
  } finally {
    await browser.close();
  }

  // Deduplicate by tbo_code (keep last seen)
  const seen = new Map();
  for (const m of modules) {
    seen.set(m.tbo_code, m);
  }

  return Array.from(seen.values());
}

async function scrapeAllPrograms(page) {
  await page.goto(`${TBO_BASE}/book_list`, { timeout: 30000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('div.panel-body', { timeout: 15000, state: 'attached' });

  const programs = await page.$$eval('div.panel-body ul li a', els =>
    els.map(a => ({
      code: a.textContent.trim().split(/\s+/)[0],
      url: a.href,
    }))
  );

  return programs.filter(p => p.code && p.url);
}

async function scrapeProgramModules(page, url) {
  await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.panel.panel-default, .no-result', { timeout: 15000 }).catch(() => {});

  const noResult = await page.$('.no-result');
  if (noResult) return [];

  const raw = await page.$$eval('.panel.panel-default', (panels, pageUrl) => {
    function parseIDR(str) {
      str = (str || '').trim();
      // Western decimal format: e.g. "15,000.00" — ends in .XX
      if (/\.\d{1,2}$/.test(str)) {
        return parseInt(str.replace(/\.\d+$/, '').replace(/[^0-9]/g, '')) || 0;
      }
      // Indonesian format: "Rp 15.000,00" or "15.000" — remove comma-decimal then non-digits
      return parseInt(str.replace(/,\d+$/, '').replace(/[^0-9]/g, '')) || 0;
    }

    return panels.map(panel => {
      const tbo_code = panel.querySelector('.panel-title a')?.textContent.trim() || null;

      const paragraphs = Array.from(panel.querySelectorAll('.productinfo p'));

      function getParagraphValue(keyword) {
        const p = paragraphs.find(el => el.textContent.includes(keyword));
        return p ? (p.querySelector('b')?.textContent.trim() || null) : null;
      }

      function getParagraphText(keyword) {
        const p = paragraphs.find(el => el.textContent.includes(keyword));
        return p ? p.textContent : null;
      }

      const nameRaw = getParagraphValue('Judul');
      const name = nameRaw ? nameRaw.replace(/^[:\s]+/, '').trim() : null;

      const priceStudentRaw = getParagraphValue('Harga Mahasiswa');
      const price_student = parseIDR(priceStudentRaw);

      const priceGeneralRaw = getParagraphValue('Harga Umum');
      const price_general = parseIDR(priceGeneralRaw);

      const stockText = getParagraphText('Ketersediaan');
      const stockMatch = stockText ? stockText.match(/Ketersediaan\s*:\s*(\d+)/) : null;
      const stock = stockMatch ? parseInt(stockMatch[1]) : 0;

      const tbo_image_url = panel.querySelector('img')?.src || null;

      return {
        tbo_code,
        name,
        price_student: price_student || null,
        price_general: price_general || null,
        cover_image_url: null,
        tbo_url: pageUrl,
        is_available: stock > 0,
        stock,
        tbo_image_url,
      };
    });
  }, url);

  return raw.filter(m => m.tbo_code && m.name);
}

module.exports = { runTboScraper };
