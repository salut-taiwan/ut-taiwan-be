const { supabaseAdmin } = require('../config/supabase');
const scraperService = require('../services/scraperService');

let isRunning = false;

async function triggerRun(req, res) {
  if (isRunning) {
    return res.status(409).json({ error: 'Scraper sudah berjalan' });
  }

  // Create run record
  const { data: run } = await supabaseAdmin
    .from('scraper_runs')
    .insert({ triggered_by: 'manual', status: 'running' })
    .select()
    .single();

  if (!run) return res.status(500).json({ error: 'Gagal membuat log scraper' });

  // Respond immediately, run scraper in background
  res.status(202).json({ message: 'Scraper dimulai', runId: run.id });

  isRunning = true;
  scraperService.runScraper(run.id).finally(() => {
    isRunning = false;
  });
}

async function listRuns(req, res) {
  const { data, error } = await supabaseAdmin
    .from('scraper_runs')
    .select('id, started_at, finished_at, status, modules_added, modules_updated, modules_removed, triggered_by')
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

async function triggerPrefixRun(req, res) {
  if (isRunning) {
    return res.status(409).json({ error: 'Scraper sudah berjalan' });
  }

  const { data: run } = await supabaseAdmin
    .from('scraper_runs')
    .insert({ triggered_by: 'prefix-manual', status: 'running' })
    .select()
    .single();

  if (!run) return res.status(500).json({ error: 'Gagal membuat log scraper' });

  res.status(202).json({ message: 'Scraper prefix dimulai', runId: run.id });

  isRunning = true;
  scraperService.runPrefixScraperService(run.id).finally(() => {
    isRunning = false;
  });
}

module.exports = { triggerRun, triggerPrefixRun, listRuns, getRun };
