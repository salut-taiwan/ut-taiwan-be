'use strict';

const path = require('path');
const fs = require('fs');
const { runTokopediaScraper } = require('./tokopediaScraper');

async function main() {
  const start = Date.now();
  console.log('[Tokopedia Runner] Starting scrape of karunikasouvenir...\n');

  let products;
  try {
    products = await runTokopediaScraper();
  } catch (err) {
    console.error('\n[Tokopedia Runner] Fatal error:', err.message);
    process.exit(1);
  }

  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outputDir, `tokopedia_${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(products, null, 2), 'utf-8');

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const withWeight = products.filter(p => p.weight !== null).length;
  const withDesc = products.filter(p => p.description).length;

  console.log('\n[Tokopedia Runner] Complete');
  console.log(`  Products scraped : ${products.length}`);
  console.log(`  With weight      : ${withWeight}/${products.length}`);
  console.log(`  With description : ${withDesc}/${products.length}`);
  console.log(`  Time taken       : ${elapsed}s`);
  console.log(`  Saved to         : ${outPath}`);
}

main();
