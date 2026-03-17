const { supabaseAdmin } = require('../config/supabase');
const { runTboScraper } = require('../scraper/tboScraper');
const { detectChanges } = require('../scraper/diffDetector');

const COVER_BUCKET = 'module-covers';
const UPLOAD_CONCURRENCY = 3;
const UPLOAD_BATCH_DELAY_MS = 500;

async function uploadCoverImage(tbo_code, tboImageUrl) {
  try {
    const response = await fetch(tboImageUrl);
    if (!response.ok) {
      console.warn(`[Scraper] Image fetch failed for ${tbo_code}: HTTP ${response.status}`);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = `covers/${tbo_code}.jpg`;
    const { error } = await supabaseAdmin.storage
      .from(COVER_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.warn(`[Scraper] Storage upload failed for ${tbo_code}:`, error.message);
      return null;
    }
    return supabaseAdmin.storage.from(COVER_BUCKET).getPublicUrl(filePath).data.publicUrl || null;
  } catch (err) {
    console.warn(`[Scraper] uploadCoverImage error for ${tbo_code}:`, err.message);
    return null;
  }
}

async function processCoverImages(modules) {
  const withImages = modules.filter(m => m.tbo_image_url);
  console.log(`[Scraper] Uploading ${withImages.length} cover images (concurrency=${UPLOAD_CONCURRENCY})`);
  for (let i = 0; i < withImages.length; i += UPLOAD_CONCURRENCY) {
    await Promise.all(
      withImages.slice(i, i + UPLOAD_CONCURRENCY).map(async m => {
        const publicUrl = await uploadCoverImage(m.tbo_code, m.tbo_image_url);
        if (publicUrl) m.cover_image_url = publicUrl;
      })
    );
    if (i + UPLOAD_CONCURRENCY < withImages.length) {
      await new Promise(r => setTimeout(r, UPLOAD_BATCH_DELAY_MS));
    }
  }
}

/**
 * Full scraper run: scrape TBO → diff against DB → persist changes.
 */
async function runScraper(runId) {
  let modulesAdded = 0;
  let modulesUpdated = 0;
  let modulesRemoved = 0;

  try {
    console.log(`[Scraper] Starting run ${runId}`);

    // 1. Scrape all modules from TBO (public pages)
    const scraped = await runTboScraper();
    console.log(`[Scraper] Scraped ${scraped.length} modules from TBO`);

    // 1b. Resolve cover images BEFORE diff (so cover_image_url is populated for diff)
    await processCoverImages(scraped);

    // 2. Load current DB state (paginated to bypass Supabase 1000-row default cap)
    const PAGE_SIZE = 1000;
    const dbModules = [];
    let from = 0;
    while (true) {
      const { data: page, error: selectError } = await supabaseAdmin
        .from('modules')
        .select('id, tbo_code, name, price_student, price_general, is_available, cover_image_url, tbo_url')
        .range(from, from + PAGE_SIZE - 1);
      if (selectError) throw new Error(`Failed to load modules from DB: ${selectError.message}`);
      if (!page || page.length === 0) break;
      dbModules.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    // 3. Detect changes
    const { toAdd, toUpdate, toRemove } = detectChanges(scraped, dbModules || []);

    // 4–7. Apply all changes atomically via RPC (adds, updates, removes + run record)
    const addsPayload    = toAdd.map(({ stock: _s, tbo_image_url: _i, ...mod }) => mod);
    const updatesPayload = toUpdate.map(({ id, changes, oldData }) => ({ id, changes, old_data: oldData }));
    const removesPayload = toRemove.map(({ id, oldData }) => ({ id, old_data: oldData }));

    const { data: result, error: rpcError } = await supabaseAdmin.rpc('apply_scraper_changes', {
      p_run_id:  runId,
      p_adds:    addsPayload,
      p_updates: updatesPayload,
      p_removes: removesPayload,
    });
    if (rpcError) throw new Error(`apply_scraper_changes RPC failed: ${rpcError.message}`);

    modulesAdded   = result.added;
    modulesUpdated = result.updated;
    modulesRemoved = result.removed;

    console.log(`[Scraper] Run ${runId} complete: +${modulesAdded} ~${modulesUpdated} -${modulesRemoved}`);
  } catch (err) {
    console.error(`[Scraper] Run ${runId} failed:`, err.message);
    await supabaseAdmin
      .from('scraper_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'failed',
        modules_added: modulesAdded,
        modules_updated: modulesUpdated,
        modules_removed: modulesRemoved,
        error_message: err.message,
      })
      .eq('id', runId);
  }
}

module.exports = { runScraper };
