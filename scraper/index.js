require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');
const { runScraper } = require('../services/scraperService');

let isRunning = false;

async function scheduledRun(triggeredBy = 'cron') {
  if (isRunning) {
    console.log('[Cron] Skipping run — scraper already in progress');
    return;
  }

  const { data: run } = await supabaseAdmin
    .from('scraper_runs')
    .insert({ triggered_by: triggeredBy, status: 'running' })
    .select()
    .single();

  if (!run) {
    console.error('[Cron] Failed to create scraper run record');
    return;
  }

  isRunning = true;
  await runScraper(run.id).finally(() => {
    isRunning = false;
  });
}

// Full sync: daily at 02:00 WIB (UTC+7) = 19:00 UTC
cron.schedule('0 19 * * *', () => {
  console.log('[Cron] Starting scheduled full sync');
  scheduledRun('cron');
});

// Availability check: every 6 hours
cron.schedule('0 */6 * * *', () => {
  console.log('[Cron] Starting availability check');
  // TODO: Implement lighter availability-only scrape
});

console.log('[Scraper] Cron scheduler started. Full sync at 02:00 WIB daily.');

if (process.argv.includes('--run-now')) {
  console.log('[Scraper] Running immediately (--run-now flag)');
  scheduledRun('manual');
}
