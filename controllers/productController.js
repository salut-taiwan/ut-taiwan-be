const { db } = require('../db');
const { products } = require('../db/schema');
const { eq, asc, sql } = require('drizzle-orm');
const { presentProduct, presentProductList } = require('../presenters/productPresenter');

const PRODUCTS_DEFAULT_LIMIT = 24;
const PRODUCTS_MAX_LIMIT = 100;

function clampInt(raw, min, max, fallback) {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function listProducts(req, res) {
  const { category, limit: limitRaw, offset: offsetRaw } = req.query;
  const limit = clampInt(limitRaw, 1, PRODUCTS_MAX_LIMIT, PRODUCTS_DEFAULT_LIMIT);
  const offset = Math.max(0, clampInt(offsetRaw, 0, Number.MAX_SAFE_INTEGER, 0));

  try {
    const whereClause = category ? eq(products.category, category) : undefined;

    const [data, countResult] = await Promise.all([
      db.query.products.findMany({
        columns: {
          id: true, tokopedia_id: true, category: true, name: true,
          base_price: true, weight_grams: true,
        },
        where: whereClause,
        orderBy: asc(products.name),
        limit,
        offset,
        with: {
          product_images: { columns: { image_url: true, sort_order: true } },
        },
      }),
      db.select({ count: sql`count(*)::int` }).from(products).where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    const result = data.map(p => {
      const images = (p.product_images || []).sort((a, b) => a.sort_order - b.sort_order);
      return {
        id: p.id,
        tokopedia_id: p.tokopedia_id,
        category: p.category,
        name: p.name,
        base_price: p.base_price,
        weight_grams: p.weight_grams,
        cover_image_url: images[0]?.image_url ?? null,
      };
    });

    res.json({
      rows: presentProductList(result),
      total,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getProduct(req, res) {
  const { id } = req.params;
  try {
    const data = await db.query.products.findFirst({
      where: eq(products.id, id),
      with: {
        product_images: { columns: { id: true, image_url: true, sort_order: true } },
        product_variant_types: {
          columns: { id: true, name: true, identifier: true, sort_order: true },
          with: {
            product_variant_options: {
              columns: { id: true, value: true, hex_color: true, sort_order: true },
            },
          },
        },
        product_skus: {
          columns: { id: true, tokopedia_sku_id: true, price: true, option_names: true },
        },
      },
    });

    if (!data) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    const product = {
      ...data,
      product_images: (data.product_images || []).sort((a, b) => a.sort_order - b.sort_order),
      product_variant_types: (data.product_variant_types || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(vt => ({
          ...vt,
          product_variant_options: (vt.product_variant_options || [])
            .sort((a, b) => a.sort_order - b.sort_order),
        })),
    };

    res.json(presentProduct(product));
  } catch (err) {
    res.status(404).json({ error: 'Produk tidak ditemukan' });
  }
}

module.exports = { listProducts, getProduct };
