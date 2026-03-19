const { supabaseAdmin } = require('../config/supabase');
const scraperService = require('../services/scraperService');

async function isScraperRunning() {
  const { data } = await supabaseAdmin
    .from('scraper_runs')
    .select('id')
    .eq('status', 'running')
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function _trigger(res, triggeredBy, serviceFn) {
  if (await isScraperRunning()) {
    return res.status(409).json({ error: 'Scraper sudah berjalan' });
  }

  const { data: run } = await supabaseAdmin
    .from('scraper_runs')
    .insert({ triggered_by: triggeredBy, status: 'running' })
    .select()
    .single();

  if (!run) return res.status(500).json({ error: 'Gagal membuat log scraper' });

  res.status(202).json({ message: 'Scraper dimulai', runId: run.id });

  serviceFn(run.id);
}

async function triggerRun(req, res) {
  return _trigger(res, 'manual', scraperService.runScraper);
}

async function triggerPrefixRun(req, res) {
  return _trigger(res, 'prefix-manual', scraperService.runPrefixScraperService);
}

async function listRuns(req, res) {
  const { data, error } = await supabaseAdmin
    .from('scraper_runs')
    .select('id, started_at, finished_at, status, modules_added, modules_updated, modules_removed, triggered_by, error_message')
    .order('started_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function getRun(req, res) {
  const { id } = req.params;
  const { data: run, error } = await supabaseAdmin
    .from('scraper_runs')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !run) return res.status(404).json({ error: 'Log scraper tidak ditemukan' });

  const { data: changes } = await supabaseAdmin
    .from('module_history')
    .select('id, change_type, old_data, new_data, changed_at, modules(tbo_code, name)')
    .eq('scraper_run_id', id)
    .order('changed_at', { ascending: false });

  res.json({ run, changes: changes || [] });
}

module.exports = { triggerRun, triggerPrefixRun, listRuns, getRun };
