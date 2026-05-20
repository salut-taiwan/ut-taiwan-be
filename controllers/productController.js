const { db } = require('../db');
const { products } = require('../db/schema');
const { eq, asc } = require('drizzle-orm');
const { presentProduct, presentProductList } = require('../presenters/productPresenter');

async function listProducts(req, res) {
  const { category } = req.query;
  try {
    const data = await db.query.products.findMany({
      columns: {
        id: true, tokopedia_id: true, category: true, name: true,
        base_price: true, weight_grams: true,
      },
      where: category ? eq(products.category, category) : undefined,
      orderBy: asc(products.name),
      with: {
        product_images: { columns: { image_url: true, sort_order: true } },
      },
    });

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
    res.json(presentProductList(result));
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
