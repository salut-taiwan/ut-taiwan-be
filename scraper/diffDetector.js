/**
 * Compare scraped modules vs DB state to detect changes.
 *
 * @param {Array} scraped - Array of modules from TBO scraper
 * @param {Array} dbModules - Array of modules from DB
 * @returns {{ toAdd, toUpdate, toRemove }}
 */
function detectChanges(scraped, dbModules) {
  const scrapedMap = new Map(scraped.map(m => [m.tbo_code, m]));
  const dbMap = new Map(dbModules.map(m => [m.tbo_code, m]));

  const toAdd = [];
  const toUpdate = [];
  const toRemove = [];

  // Check scraped against DB
  for (const [code, scrapedMod] of scrapedMap) {
    const dbMod = dbMap.get(code);

    if (!dbMod) {
      // New module
      toAdd.push(scrapedMod);
    } else {
      // Check for changes in tracked fields
      const changes = {};
      const trackFields = ['name', 'price_student', 'price_general', 'cover_image_url', 'tbo_url', 'is_available'];

      for (const field of trackFields) {
        if (scrapedMod[field] !== undefined && scrapedMod[field] !== dbMod[field]) {
          changes[field] = scrapedMod[field];
        }
      }

      // Always restore availability if it was previously marked unavailable
      if (!dbMod.is_available) {
        changes.is_available = true;
      }

      if (Object.keys(changes).length > 0) {
        toUpdate.push({ id: dbMod.id, changes, oldData: dbMod });
      }
    }
  }

  // Check DB modules not seen in scrape (removed from TBO)
  for (const [code, dbMod] of dbMap) {
    if (!scrapedMap.has(code) && dbMod.is_available) {
      toRemove.push({ id: dbMod.id, oldData: dbMod });
    }
  }

  return { toAdd, toUpdate, toRemove };
}

module.exports = { detectChanges };
