const { db } = require('../db');
const { products, users } = require('../db/schema');
const { eq, asc, sql } = require('drizzle-orm');
const { presentProduct, presentProductList } = require('../presenters/productPresenter');
const { isSalutActive } = require('../config/constants');

const { clampInt } = require('../utils/pagination');

const PRODUCTS_DEFAULT_LIMIT = 24;
const PRODUCTS_MAX_LIMIT = 100;

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
          base_price: true, weight_grams: true, claim_rule: true,
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
        claim_rule: p.claim_rule ?? null,
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
    res.status(500).json({ error: err.message });
  }
}

/**
 * Resolve the claim-CTA for a given product + caller (auth-optional).
 * The frontend renders whatever this returns without re-deriving state.
 * Response carries Cache-Control: no-store to prevent any intermediate caching.
 */
async function getClaimCta(req, res) {
  const { id } = req.params;
  res.set('Cache-Control', 'no-store');

  try {
    const product = await db.query.products.findFirst({
      columns: { id: true, claim_rule: true },
      where: eq(products.id, id),
    });
    if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    // For products without a claim rule, the FE uses the default CTA — return null.
    if (product.claim_rule !== 'salut_sem1_once') {
      return res.json({ claim_cta: null });
    }

    const loginHref = `/login?redirect=/toko/${product.id}`;

    if (!req.user?.id) {
      return res.json({
        claim_cta: {
          state: 'need_login',
          label: 'Login untuk klaim',
          href: loginHref,
          disabled: false,
        },
      });
    }

    // Already claimed? Once a payment was paid OR refunded, the claim is consumed.
    const claimedResult = await db.execute(sql`
      SELECT 1
        FROM order_items oi
        JOIN orders   o  ON o.id  = oi.order_id
        JOIN payments p  ON p.order_id = o.id
        JOIN product_skus ps ON ps.id = oi.sku_id
       WHERE ps.product_id = ${product.id}
         AND o.user_id     = ${req.user.id}
         AND p.status      IN ('paid', 'refunded')
       LIMIT 1
    `);
    // postgres.js returns a Result that extends Array — there is no `.rows`.
    if (claimedResult.length > 0) {
      return res.json({
        claim_cta: { state: 'already_claimed', label: 'Sudah Diklaim', disabled: true },
      });
    }

    const u = await db.query.users.findFirst({
      columns: { current_semester: true, salut_approved_at: true },
      where: eq(users.id, req.user.id),
    });

    if (!isSalutActive(u?.salut_approved_at)) {
      return res.json({
        claim_cta: {
          state: 'need_salut',
          label: 'Daftar SALUT untuk klaim',
          href: '/salut',
          disabled: false,
        },
      });
    }
    if (u?.current_semester !== 1) {
      return res.json({
        claim_cta: { state: 'not_sem1', label: 'Khusus SALUT semester 1', disabled: true },
      });
    }
    return res.json({
      claim_cta: { state: 'eligible', label: 'Klaim Gratis', addToCart: true, disabled: false },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listProducts, getProduct, getClaimCta };
