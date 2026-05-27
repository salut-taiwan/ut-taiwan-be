/**
 * Import merchandise products from the Tokopedia scraper output into Supabase.
 *
 * Usage:
 *   SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-products.mjs
 *
 * What it does:
 *   1. Reads scraper/output/tokopedia_2026-05-19.json
 *   2. Creates the 'products' storage bucket if it doesn't exist
 *   3. Downloads each product image and uploads to Supabase Storage
 *   4. Upserts products, images, variant types, options, and SKUs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = 'products';

// Mirrors migrations/023_backfill_variant_hex_colors.sql.
// Keep these two lists in sync when adding new color names.
const NAMED_COLOR_HEX = {
  // English: base
  navy: '#000080',
  black: '#000000',
  white: '#FFFFFF',
  'off white': '#FAF9F6',
  'off-white': '#FAF9F6',
  'broken white': '#F5F5F0',
  ivory: '#FFFFF0',
  red: '#E11D48',
  blue: '#2563EB',
  green: '#16A34A',
  yellow: '#FACC15',
  purple: '#7C3AED',
  orange: '#F97316',
  pink: '#EC4899',
  brown: '#92400E',
  gray: '#6B7280',
  grey: '#6B7280',
  beige: '#F5F5DC',
  cream: '#FFFDD0',
  maroon: '#800000',
  burgundy: '#800020',
  olive: '#808000',
  army: '#4B5320',
  'army green': '#4B5320',
  teal: '#0D9488',
  turquoise: '#40E0D0',
  tosca: '#14B8A6',
  mint: '#98FF98',
  emerald: '#10B981',
  lime: '#BFFF00',
  cyan: '#06B6D4',
  magenta: '#D946EF',
  indigo: '#4F46E5',
  lavender: '#E6E6FA',
  peach: '#FFCBA4',
  salmon: '#FA8072',
  coral: '#FF7F50',
  mustard: '#D4A017',
  khaki: '#C3B091',
  mocca: '#6F4E37',
  mocha: '#6F4E37',
  taupe: '#483C32',
  charcoal: '#36454F',
  terracotta: '#E2725B',
  nude: '#E3BC9A',
  silver: '#C0C0C0',
  gold: '#D4AF37',
  'rose gold': '#B76E79',

  // English: light / dark modifiers
  'light blue': '#60A5FA',
  'dark blue': '#1E3A8A',
  'light green': '#86EFAC',
  'dark green': '#166534',
  'light gray': '#D1D5DB',
  'light grey': '#D1D5DB',
  'dark gray': '#374151',
  'dark grey': '#374151',
  'light pink': '#FBCFE8',
  'hot pink': '#EC4899',
  'light brown': '#B97A56',
  'dark brown': '#5C3317',
  'light yellow': '#FEF08A',
  'light purple': '#C4B5FD',
  'dark purple': '#4C1D95',
  'baby blue': '#89CFF0',
  'baby pink': '#F4C2C2',

  // Indonesian: base
  hitam: '#000000',
  putih: '#FFFFFF',
  gading: '#FFFFF0',
  merah: '#E11D48',
  biru: '#2563EB',
  hijau: '#16A34A',
  kuning: '#FACC15',
  ungu: '#7C3AED',
  oranye: '#F97316',
  jingga: '#F97316',
  coklat: '#92400E',
  cokelat: '#92400E',
  abu: '#6B7280',
  'abu-abu': '#6B7280',
  'abu abu': '#6B7280',
  krem: '#FFFDD0',
  dongker: '#1E3A8A',
  pirus: '#40E0D0',
  emas: '#D4AF37',
  perak: '#C0C0C0',

  // Indonesian: tua (dark) / muda (light) modifiers
  'merah tua': '#7F1D1D',
  'merah muda': '#F472B6',
  'merah bata': '#B0413E',
  'biru tua': '#1E3A8A',
  'biru muda': '#60A5FA',
  'biru dongker': '#1E3A8A',
  'biru toska': '#06B6D4',
  'hijau tua': '#166534',
  'hijau muda': '#86EFAC',
  'hijau army': '#4B5320',
  'hijau tosca': '#14B8A6',
  'hijau mint': '#98FF98',
  'kuning tua': '#CA8A04',
  'kuning muda': '#FEF08A',
  'ungu tua': '#4C1D95',
  'ungu muda': '#C4B5FD',
  'coklat tua': '#5C3317',
  'coklat muda': '#B97A56',
  'cokelat tua': '#5C3317',
  'cokelat muda': '#B97A56',
  'abu tua': '#374151',
  'abu muda': '#D1D5DB',
  'abu-abu tua': '#374151',
  'abu-abu muda': '#D1D5DB',
  'pink tua': '#DB2777',
  'pink muda': '#FBCFE8',
  'oranye tua': '#C2410C',
  'oranye muda': '#FDBA74',
};

function resolveNamedColor(value) {
  if (typeof value !== 'string') return null;
  // Collapse internal whitespace so "biru   tua" still matches "biru tua".
  const key = value.toLowerCase().trim().replace(/\s+/g, ' ');
  return NAMED_COLOR_HEX[key] ?? null;
}

function inferCategory(name) {
  const n = name.toLowerCase();
  if (n.includes('jas almamater')) return 'jas-almamater';
  if (n.includes('jaket')) return 'jaket';
  if (n.includes('jersey')) return 'jersey';
  if (n.includes('training set') || n.includes('training set')) return 'training-set';
  if (n.includes('kaos')) return 'kaos';
  if (n.includes('bagpack') || n.includes('bag pack') || n.includes('clutch') ||
      n.includes('handbag') || n.includes('paket souvenir')) return 'tas';
  return 'aksesoris';
}

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.find(b => b.name === BUCKET)) return;
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error) throw new Error(`Failed to create bucket: ${error.message}`);
  console.log(`Created storage bucket: ${BUCKET}`);
}

async function uploadImage(tokopediaId, index, url) {
  const storagePath = `${tokopediaId}/${index}.jpg`;

  // Check if already uploaded
  const { data: existing } = await supabase.storage.from(BUCKET).list(tokopediaId);
  if (existing?.find(f => f.name === `${index}.jpg`)) {
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return publicUrl;
  }

  let buffer;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(`  ⚠ Image ${index} download failed: ${err.message}`);
    return null;
  }

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) {
    console.warn(`  ⚠ Image ${index} upload failed: ${error.message}`);
    return null;
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return publicUrl;
}

async function importProduct(product) {
  console.log(`\n[${product.id}] ${product.name.slice(0, 60)}`);

  const category = inferCategory(product.name);

  // Upsert product
  const { data: saved, error: prodError } = await supabase
    .from('products')
    .upsert({
      tokopedia_id: product.id,
      category,
      name: product.name,
      description: product.description || null,
      base_price: product.price,
      weight_grams: product.weight || 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tokopedia_id' })
    .select('id')
    .single();

  if (prodError) throw new Error(`Product upsert failed: ${prodError.message}`);
  const productId = saved.id;

  // Clear and re-insert dependent rows so re-runs are idempotent
  await supabase.from('product_images').delete().eq('product_id', productId);
  await supabase.from('product_variant_types').delete().eq('product_id', productId);

  // Upload and insert images
  const images = product.images || [];
  const imageRows = [];
  for (let i = 0; i < images.length; i++) {
    const publicUrl = await uploadImage(product.id, i, images[i]);
    if (publicUrl) imageRows.push({ product_id: productId, image_url: publicUrl, sort_order: i });
  }
  if (imageRows.length > 0) {
    const { error } = await supabase.from('product_images').insert(imageRows);
    if (error) console.warn(`  ⚠ Images insert error: ${error.message}`);
  }
  console.log(`  images: ${imageRows.length}/${images.length}`);

  // Insert variant types + options
  const types = product.variants?.types || [];
  for (let ti = 0; ti < types.length; ti++) {
    const vt = types[ti];
    const { data: vtRow, error: vtErr } = await supabase
      .from('product_variant_types')
      .insert({ product_id: productId, name: vt.name, identifier: vt.identifier, sort_order: ti })
      .select('id')
      .single();
    if (vtErr) { console.warn(`  ⚠ Variant type insert error: ${vtErr.message}`); continue; }

    const options = (vt.options || []).map((opt, oi) => ({
      variant_type_id: vtRow.id,
      value: opt.value,
      hex_color: opt.hex || resolveNamedColor(opt.value),
      sort_order: oi,
    }));
    if (options.length > 0) {
      const { error: optErr } = await supabase.from('product_variant_options').insert(options);
      if (optErr) console.warn(`  ⚠ Variant options insert error: ${optErr.message}`);
    }
  }

  // Insert SKUs
  await supabase.from('product_skus').delete().eq('product_id', productId);
  const skus = product.variants?.skus || [];

  if (skus.length === 0) {
    // No variants — create a single default SKU
    await supabase.from('product_skus').insert({
      product_id: productId,
      tokopedia_sku_id: null,
      price: product.price,
      option_names: [],
    });
    console.log(`  skus: 1 (default, no variants)`);
  } else {
    const skuRows = skus
      .filter(s => s.is_available !== false)
      .map(s => ({
        product_id: productId,
        tokopedia_sku_id: s.product_id,
        price: s.price,
        option_names: s.option_names || [],
      }));
    if (skuRows.length > 0) {
      const { error: skuErr } = await supabase.from('product_skus').insert(skuRows);
      if (skuErr) console.warn(`  ⚠ SKU insert error: ${skuErr.message}`);
    }
    console.log(`  skus: ${skuRows.length}/${skus.length}`);
  }

  console.log(`  ✓ category: ${category}, price: ${product.price}`);
}

async function main() {
  const jsonPath = join(__dirname, '../scraper/output/tokopedia_2026-05-19.json');
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const products = raw.filter(Boolean);
  console.log(`Loaded ${products.length} products`);

  await ensureBucket();

  let success = 0;
  for (const product of products) {
    try {
      await importProduct(product);
      success++;
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }

  console.log(`\nDone: ${success}/${products.length} products imported`);
}

main().catch(err => { console.error(err); process.exit(1); });
