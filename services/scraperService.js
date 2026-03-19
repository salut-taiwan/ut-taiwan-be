const { supabaseAdmin } = require('../config/supabase');
const { runTboScraper, runPrefixScraper, runFullScraper } = require('../scraper/tboScraper');
const { detectChanges } = require('../scraper/diffDetector');
const {
  SCRAPER_PAGE_SIZE,
  SCRAPER_UPLOAD_CONCURRENCY,
  SCRAPER_UPLOAD_BATCH_DELAY_MS,
} = require('../config/constants');

const CATALOG_PREFIXES = [
  'ADBI','ADPU','ASIP','BING','BIOL','EACC','ECON','EKAP','EKMA','EKSA',
  'EKSI','EMBS','EPFA','ESBI','ESHA','ESPA','ESTA','FSAB','FSAP','FSAR',
  'FSDP','FSIH','FSIK','FSIP','FSKI','FSPE','FSSI','FSSO','FSSP','HKUM',
  'HKUW','IDIK','IPEM','ISIP','LUHT','MATA','MDKK','MKD','MKDI','MKDJ',
  'MKDK','MKDM','MKDU','MKK','MKKI','MKW','MKWI','MKWJ','MKWN','MKWU',
  'MSIM','PAJA','PANG','PAUD','PBIN','PBIS','PBN','PDGK','PEBI','PEFI',
  'PEKI','PEMA','PGTK','PKNI','PKOP','PSOS','PUST','PWKL','SATS','SIPA',
  'SIPK','SIPS','SKOM','SOSI','SPAD','SPAI','SPAR','SPBI','SPBO','SPDA',
  'SPEK','SPFI','SPGK','SPIK','SPIKI','SPIKM','SPIN','SPKI','SPKM','SPKN',
  'SPMT','SPPK','SPTP','STAG','STAT','STB','STBI','STBJ','STDA','STIK',
  'STM','STMA','STPL','STSI','STTP','TPEN',
];

const COVER_BUCKET = 'module-covers';

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
  console.log(`[Scraper] Uploading ${withImages.length} cover images (concurrency=${SCRAPER_UPLOAD_CONCURRENCY})`);
  for (let i = 0; i < withImages.length; i += SCRAPER_UPLOAD_CONCURRENCY) {
    await Promise.all(
      withImages.slice(i, i + SCRAPER_UPLOAD_CONCURRENCY).map(async m => {
        const publicUrl = await uploadCoverImage(m.tbo_code, m.tbo_image_url);
        if (publicUrl) m.cover_image_url = publicUrl;
      })
    );
    if (i + SCRAPER_UPLOAD_CONCURRENCY < withImages.length) {
      await new Promise(r => setTimeout(r, SCRAPER_UPLOAD_BATCH_DELAY_MS));
    }
  }
}

async function loadAllDbModules() {
  const dbModules = [];
  let from = 0;
  while (true) {
    const { data: page, error: selectError } = await supabaseAdmin
      .from('modules')
      .select('id, tbo_code, name, price_student, price_general, is_available, cover_image_url, tbo_url')
      .range(from, from + SCRAPER_PAGE_SIZE - 1);
    if (selectError) throw new Error(`Failed to load modules from DB: ${selectError.message}`);
    if (!page || page.length === 0) break;
    dbModules.push(...page);
    if (page.length < SCRAPER_PAGE_SIZE) break;
    from += SCRAPER_PAGE_SIZE;
  }
  return dbModules;
}

async function _runScraperCore(runId, scraperFn, label) {
  let modulesAdded = 0;
  let modulesUpdated = 0;
  let modulesRemoved = 0;

  try {
    console.log(`[${label}] Starting run ${runId}`);

    const scraped = await scraperFn(CATALOG_PREFIXES);
    console.log(`[${label}] Scraped ${scraped.length} modules from TBO`);

    await processCoverImages(scraped);

    const dbModules = await loadAllDbModules();
    const { toAdd, toUpdate, toRemove } = detectChanges(scraped, dbModules);

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

    console.log(`[${label}] Run ${runId} complete: +${modulesAdded} ~${modulesUpdated} -${modulesRemoved}`);
  } catch (err) {
    console.error(`[${label}] Run ${runId} failed:`, err.message);
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

async function runScraper(runId) {
  return _runScraperCore(runId, runFullScraper, 'Scraper');
}

async function runPrefixScraperService(runId) {
  return _runScraperCore(runId, runPrefixScraper, 'Scraper-Prefix');
}

module.exports = { runScraper, runPrefixScraperService };
