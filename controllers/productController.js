const { supabaseAdmin } = require('../config/supabase');

async function listProducts(req, res) {
  const { category } = req.query;

  let query = supabaseAdmin
    .from('products')
    .select(`
      id, tokopedia_id, category, name, base_price, weight_grams,
      product_images(image_url, sort_order)
    `)
    .order('name');

  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const products = data.map(p => {
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

  res.json(products);
}

async function getProduct(req, res) {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('products')
    .select(`
      id, tokopedia_id, category, name, description, base_price, weight_grams,
      product_images(id, image_url, sort_order),
      product_variant_types(
        id, name, identifier, sort_order,
        product_variant_options(id, value, hex_color, sort_order)
      ),
      product_skus(id, tokopedia_sku_id, price, option_names)
    `)
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Produk tidak ditemukan' });

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

  res.json(product);
}

module.exports = { listProducts, getProduct };
