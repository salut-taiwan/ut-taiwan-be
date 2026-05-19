'use strict';

const SHOP_DOMAIN = 'karunikasouvenir';
const SHOP_URL = `https://www.tokopedia.com/${SHOP_DOMAIN}`;
const DEBUG = process.argv.includes('--debug');

const PAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// ── Helpers ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, { retries = 3, baseDelay = 1000, maxDelay = 15000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const exp = Math.min(baseDelay * 2 ** attempt, maxDelay);
      const jitter = exp * (0.8 + Math.random() * 0.4);
      console.warn(
        `[Tokopedia] Attempt ${attempt + 1} failed: ${err.message}. Retry in ${Math.round(jitter)}ms...`
      );
      await sleep(jitter);
    }
  }
}

function parsePrice(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

// ── Cookie-preserving HTML fetcher ─────────────────────────────────────────

const cookieJar = {};

async function fetchPage(url) {
  const cookieStr = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
  const headers = { ...PAGE_HEADERS, ...(cookieStr ? { Cookie: cookieStr } : {}) };

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const rawCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') || '').split(/,(?=[^ ])/).filter(Boolean);

  for (const raw of rawCookies) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookieJar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }

  return res.text();
}

// ── Apollo Client normalized cache extraction ──────────────────────────────

function extractWindowCache(html) {
  const marker = 'window.__cache=';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  let vs = idx + marker.length;
  while (vs < html.length && /\s/.test(html[vs])) vs++;

  const opener = html[vs];
  if (opener !== '{' && opener !== '[') return null;
  const closer = opener === '{' ? '}' : ']';

  let depth = 0, inStr = false, escape = false;
  for (let i = vs; i < html.length; i++) {
    const c = html[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(vs, i + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

// Dereference an Apollo normalized cache reference: { type:'id', id:'$...', generated:... }
function resolveRef(cache, val) {
  if (val && typeof val === 'object' && val.type === 'id' && typeof val.id === 'string') {
    return cache[val.id] || null;
  }
  return val;
}

function extractProductsFromCache(cache) {
  const listNode = Object.values(cache).find(
    v => v && typeof v === 'object' && v.__typename === 'ShopProductList'
  );
  if (!listNode) return [];

  const dataRefs = listNode.data;
  if (!Array.isArray(dataRefs) || dataRefs.length === 0) return [];

  const products = [];
  for (const ref of dataRefs) {
    const node = resolveRef(cache, ref);
    if (!node) continue;

    const priceNode   = resolveRef(cache, node.price)         || {};
    const imageNode   = resolveRef(cache, node.primary_image) || {};
    const statsNode   = resolveRef(cache, node.stats)         || {};
    const campaignNode = resolveRef(cache, node.campaign)     || {};

    products.push({
      id:                  node.product_id,
      name:                node.name,
      product_url:         node.product_url,
      price:               priceNode.text_idr,
      original_price:      campaignNode.original_price_fmt || null,
      discount_percentage: campaignNode.discounted_percentage
        ? parseInt(campaignNode.discounted_percentage, 10)
        : 0,
      primary_image:       { original: imageNode.original || imageNode.thumbnail || '' },
      rating:              statsNode.averageRating || null,
      sold:                null,
      stock:               null,
    });
  }
  return products;
}

// ── Bracket-count extraction (fallback for non-Apollo pages) ───────────────

function extractJsonForKey(text, key) {
  const needle = `"${key}":`;
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const idx = text.indexOf(needle, searchFrom);
    if (idx === -1) return null;

    let vs = idx + needle.length;
    while (vs < text.length && /\s/.test(text[vs])) vs++;

    const opener = text[vs];
    if (opener !== '[' && opener !== '{') { searchFrom = idx + 1; continue; }
    const closer = opener === '[' ? ']' : '}';

    let depth = 0, inStr = false, escape = false;
    for (let i = vs; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === opener) depth++;
      else if (c === closer) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(vs, i + 1)); }
          catch { searchFrom = idx + 1; break; }
        }
      }
    }
    if (depth > 0) break;
  }
  return null;
}

function looksLikeProductArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const first = arr[0];
  return (
    first !== null &&
    typeof first === 'object' &&
    ('id' in first || 'name' in first || 'product_id' in first || 'productID' in first)
  );
}

function extractProductsFallback(html, pageNum) {
  const candidateKeys = ['products', 'productList', 'items', 'data'];

  for (const key of candidateKeys) {
    const result = extractJsonForKey(html, key);
    if (looksLikeProductArray(result)) return result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      for (const sub of candidateKeys) {
        if (looksLikeProductArray(result[sub])) return result[sub];
      }
    }
  }

  if (DEBUG) {
    const fs = require('fs');
    const path = require('path');
    const outDir = path.join(__dirname, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const debugPath = path.join(outDir, `debug_page_${pageNum}.html`);
    fs.writeFileSync(debugPath, html);
    console.log(`[Tokopedia DEBUG] Saved page ${pageNum} HTML → ${debugPath}`);
  }

  return [];
}

// ── Phase 1: product listing ───────────────────────────────────────────────

function normalizeProduct(p) {
  const price = parsePrice(
    p.price?.text_idr ??
    p.price?.textIDR ??
    p.price?.value ??
    p.price?.min ??
    p.priceInt ??
    p.price
  );
  const image =
    p.primary_image?.original ??
    p.imageURL ??
    p.image_url ??
    p.primary_image?.original ??
    p.image ??
    p.thumbnail ??
    '';
  const url = p.product_url ?? p.url ?? p.productURL ?? '';

  return {
    id: String(p.id ?? p.product_id ?? p.productID ?? ''),
    name: (p.name ?? p.productName ?? p.product_name ?? '').trim(),
    url: url.startsWith('http') ? url : `https://www.tokopedia.com${url}`,
    price,
    original_price: parsePrice(
      p.original_price?.value ??
      p.original_price ??
      p.slashedPrice?.value ??
      p.originalPrice ??
      null
    ),
    discount_percentage:
      p.discount_percentage ?? p.discount ?? p.discountPercentage ?? p.campaign?.discounted_percentage ?? 0,
    images: [image].filter(Boolean),
    stock: p.stock ?? p.stockCount ?? null,
    sold: p.sold ?? p.countSold ?? p.soldCount ?? null,
    rating: p.rating?.averageRating ?? p.rating?.value ?? p.rating ?? p.stats?.rating ?? null,
    // Filled in Phase 2:
    description: '',
    weight: null,
    specifications: {},
    variants: null,
  };
}

async function scrapeProductList() {
  const allProducts = [];
  const seenIds = new Set();
  let pageNum = 1;

  while (true) {
    console.log(`[Tokopedia] Listing page ${pageNum}...`);
    const html = await withRetry(() => fetchPage(`${SHOP_URL}?page=${pageNum}`));

    if (pageNum === 1) {
      console.log(`[Tokopedia] Session cookies: ${Object.keys(cookieJar).length}`);
    }

    // Primary: Apollo normalized cache
    const cache = extractWindowCache(html);
    let raw = cache ? extractProductsFromCache(cache) : [];

    if (raw.length === 0) {
      // Fallback: simple key search (handles non-Apollo layouts)
      raw = extractProductsFallback(html, pageNum);
    }

    if (raw.length === 0) {
      if (pageNum === 1) {
        throw new Error(
          'No products found in page 1 HTML. Re-run with --debug to save the HTML for inspection.'
        );
      }
      break;
    }

    let newCount = 0;
    for (const p of raw) {
      const product = normalizeProduct(p);
      if (!product.id || seenIds.has(product.id)) continue;
      seenIds.add(product.id);
      allProducts.push(product);
      newCount++;
    }

    console.log(`  → ${newCount} new products (total: ${allProducts.length})`);
    if (newCount === 0) break;

    pageNum++;
    await sleep(800 + Math.random() * 400);
  }

  return allProducts;
}

// ── Phase 2: extract detail from product page HTML ─────────────────────────

function parsePdpFromHtml(html) {
  let description = '';
  let weight = null;
  let variants = null;
  let stockTotal = null;
  const images = [];
  const specifications = {};

  const cache = extractWindowCache(html);

  if (cache) {
    for (const node of Object.values(cache)) {
      if (!node || typeof node !== 'object') continue;

      if (node.__typename === 'pdpDataProductDetailDescription' && node.content) {
        description = node.content.trim();
      }

      if (node.__typename === 'pdpBasicInfo' && node.weight != null && weight === null) {
        let w = parseFloat(node.weight);
        if (!isNaN(w)) {
          if ((node.weightUnit || '').toUpperCase() === 'KILOGRAM') w *= 1000;
          weight = Math.round(w);
        }
      }

      if (node.__typename === 'pdpContentSnapshotMedia') {
        const url = node.URLMaxRes || node.URLOriginal || node.URLThumbnail;
        if (url && !images.includes(url)) images.push(url);
      }

      if (node.__typename === 'pdpDataProductVariant') {
        const types = (node.variants || []).map(ref => {
          const vt = resolveRef(cache, ref);
          if (!vt) return null;
          return {
            name: vt.name,
            identifier: vt.identifier,
            options: (vt.option || []).map(oRef => {
              const opt = resolveRef(cache, oRef);
              return opt ? { value: opt.value, hex: opt.hex || null } : null;
            }).filter(Boolean),
          };
        }).filter(Boolean);

        const skus = (node.children || []).map(ref => {
          const child = resolveRef(cache, ref);
          if (!child) return null;
          const stockNode = resolveRef(cache, child.stock) || {};
          return {
            product_id: child.productID,
            option_names: child.optionName?.json ?? [],
            price: child.price ?? null,
            stock: stockNode.stock != null ? parseInt(stockNode.stock, 10) : null,
            is_available: stockNode.isBuyable ?? null,
          };
        }).filter(Boolean);

        if (types.length > 0 || skus.length > 0) variants = { types, skus };

        if (node.totalStockFmt) {
          const n = parseInt(String(node.totalStockFmt).replace(/\D/g, ''), 10);
          if (!isNaN(n)) stockTotal = n;
        }
      }
    }
  }

  // Fallback: JSON-LD (covers non-Apollo page layouts)
  if (!description) {
    const ldRe = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = ldRe.exec(html)) !== null) {
      try {
        const ld = JSON.parse(m[1]);
        for (const item of Array.isArray(ld) ? ld : [ld]) {
          if (item['@type'] !== 'Product') continue;
          if (item.description) description = item.description;
          const imgs = Array.isArray(item.image) ? item.image : [item.image].filter(Boolean);
          for (const img of imgs) {
            const url = typeof img === 'string' ? img : (img.url || img.contentUrl || '');
            if (url && !images.includes(url)) images.push(url);
          }
        }
      } catch {}
    }
  }

  return { description, weight, images, specifications, variants, stockTotal };
}

async function enrichProduct(product) {
  if (!product.url) return product;
  try {
    const detail = await withRetry(async () => {
      const html = await fetchPage(product.url);
      return parsePdpFromHtml(html);
    });

    if (detail.description) product.description = detail.description;
    if (detail.weight !== null) product.weight = detail.weight;
    if (Object.keys(detail.specifications).length) product.specifications = detail.specifications;
    if (detail.images.length > 0) product.images = detail.images;
    if (detail.variants) product.variants = detail.variants;
    if (detail.stockTotal !== null) product.stock = detail.stockTotal;
  } catch (err) {
    console.warn(`  [!] Detail fetch failed for "${product.name}": ${err.message}`);
  }
  return product;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function runTokopediaScraper() {
  const products = await scrapeProductList();
  console.log(`\n[Tokopedia] Phase 1 done: ${products.length} products. Enriching details...\n`);

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    process.stdout.write(
      `[Tokopedia] Enriching ${i + 1}/${products.length}: ${p.name.slice(0, 55)}\r`
    );
    await enrichProduct(p);
    await sleep(400 + Math.random() * 300);
  }
  process.stdout.write('\n');

  return products;
}

module.exports = { runTokopediaScraper };
