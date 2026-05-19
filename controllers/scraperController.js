const { db } = require('../db');
const { scraper_runs, module_history } = require('../db/schema');
const { eq, desc } = require('drizzle-orm');
const scraperService = require('../services/scraperService');

async function isScraperRunning() {
  const [row] = await db
    .select({ id: scraper_runs.id })
    .from(scraper_runs)
    .where(eq(scraper_runs.status, 'running'))
    .limit(1);
  return !!row;
}

async function _trigger(res, triggeredBy, serviceFn) {
  try {
    if (await isScraperRunning()) {
      return res.status(409).json({ error: 'Scraper sudah berjalan' });
    }

    const [run] = await db
      .insert(scraper_runs)
      .values({ triggered_by: triggeredBy, status: 'running' })
      .returning();

    if (!run) return res.status(500).json({ error: 'Gagal membuat log scraper' });

    res.status(202).json({ message: 'Scraper dimulai', runId: run.id });

    serviceFn(run.id);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function triggerRun(req, res) {
  return _trigger(res, 'manual', scraperService.runScraper);
}

async function triggerPrefixRun(req, res) {
  return _trigger(res, 'prefix-manual', scraperService.runPrefixScraperService);
}

async function listRuns(req, res) {
  try {
    const data = await db
      .select({
        id: scraper_runs.id,
        started_at: scraper_runs.started_at,
        finished_at: scraper_runs.finished_at,
        status: scraper_runs.status,
        modules_added: scraper_runs.modules_added,
        modules_updated: scraper_runs.modules_updated,
        modules_removed: scraper_runs.modules_removed,
        triggered_by: scraper_runs.triggered_by,
        error_message: scraper_runs.error_message,
      })
      .from(scraper_runs)
      .orderBy(desc(scraper_runs.started_at))
      .limit(50);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getRun(req, res) {
  const { id } = req.params;
  try {
    const run = await db.query.scraper_runs.findFirst({
      where: eq(scraper_runs.id, id),
    });

    if (!run) return res.status(404).json({ error: 'Log scraper tidak ditemukan' });

    const changes = await db.query.module_history.findMany({
      columns: { id: true, change_type: true, old_data: true, new_data: true, changed_at: true },
      where: eq(module_history.scraper_run_id, id),
      orderBy: desc(module_history.changed_at),
      with: { modules: { columns: { tbo_code: true, name: true } } },
    });

    res.json({ run, changes });
  } catch (err) {
    res.status(404).json({ error: 'Log scraper tidak ditemukan' });
  }
}

module.exports = { triggerRun, triggerPrefixRun, listRuns, getRun };
