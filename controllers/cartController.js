const { supabaseAdmin } = require('../config/supabase');

async function getOrCreateCart(userId) {
  const { data: cartId, error } = await supabaseAdmin.rpc('get_or_create_cart', { p_user_id: userId });
  if (error || !cartId) return null;
  return { id: cartId };
}

async function buildCartDTO(userId) {
  const cart = await getOrCreateCart(userId);
  if (!cart) return null;

  const { data, error } = await supabaseAdmin
    .from('cart_items')
    .select(`
      id, quantity, price_snapshot,
      modules(id, tbo_code, name, cover_image_url, price_student, is_available)
    `)
    .eq('cart_id', cart.id);

  if (error) return null;

  const items = data.map(item => ({
    id: item.id,
    moduleId: item.modules.id,
    tboCode: item.modules.tbo_code,
    moduleName: item.modules.name,
    coverImageUrl: item.modules.cover_image_url,
    quantity: item.quantity,
    priceSnapshot: item.price_snapshot,
    subtotal: item.price_snapshot * item.quantity,
    isAvailable: item.modules.is_available,
  }));

  return {
    id: cart.id,
    userId,
    items,
    subtotal: items.reduce((sum, i) => sum + i.subtotal, 0),
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
  };
}

async function getCart(req, res) {
  const dto = await buildCartDTO(req.user.id);
  if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
  res.json(dto);
}

async function addItem(req, res) {
  const { moduleId, quantity = 1 } = req.body;
  if (!moduleId) return res.status(400).json({ error: 'moduleId wajib diisi' });

  // Check module exists and is available
  const { data: mod } = await supabaseAdmin
    .from('modules')
    .select('id, price_student, is_available')
    .eq('id', moduleId)
    .is('deleted_at', null)
    .single();

  if (!mod) return res.status(404).json({ error: 'Modul tidak ditemukan' });
  if (!mod.is_available) return res.status(400).json({ error: 'Modul tidak tersedia' });

  const cart = await getOrCreateCart(req.user.id);

  const { error } = await supabaseAdmin
    .from('cart_items')
    .upsert({
      cart_id: cart.id,
      module_id: moduleId,
      quantity,
      price_snapshot: mod.price_student,
    }, { onConflict: 'cart_id,module_id' });

  if (error) return res.status(400).json({ error: error.message });

  const dto = await buildCartDTO(req.user.id);
  if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
  res.status(201).json(dto);
}

async function addPackage(req, res) {
  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ error: 'packageId wajib diisi' });

  const { data: pkg } = await supabaseAdmin
    .from('packages')
    .select('package_modules(modules(id, price_student, is_available))')
    .eq('id', packageId)
    .eq('is_active', true)
    .single();

  if (!pkg) return res.status(404).json({ error: 'Paket tidak ditemukan' });

  const cart = await getOrCreateCart(req.user.id);
  const cartItems = (pkg.package_modules || [])
    .filter(pm => pm.modules?.is_available)
    .map(pm => ({
      cart_id: cart.id,
      module_id: pm.modules.id,
      quantity: 1,
      price_snapshot: pm.modules.price_student,
    }));

  if (cartItems.length === 0) {
    return res.status(400).json({ error: 'Tidak ada modul tersedia dalam paket ini' });
  }

  const { error } = await supabaseAdmin
    .from('cart_items')
    .upsert(cartItems, { onConflict: 'cart_id,module_id' });

  if (error) return res.status(400).json({ error: error.message });

  const dto = await buildCartDTO(req.user.id);
  if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
  res.json(dto);
}

async function updateItem(req, res) {
  const { itemId } = req.params;
  const { quantity } = req.body;

  if (quantity === 0) {
    return removeItem(req, res);
  }

  const cart = await getOrCreateCart(req.user.id);

  const { data, error } = await supabaseAdmin
    .from('cart_items')
    .update({ quantity })
    .eq('id', itemId)
    .eq('cart_id', cart.id)
    .select('id')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Item tidak ditemukan' });

  const dto = await buildCartDTO(req.user.id);
  if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
  res.json(dto);
}

async function removeItem(req, res) {
  const { itemId } = req.params;
  const cart = await getOrCreateCart(req.user.id);

  const { error } = await supabaseAdmin
    .from('cart_items')
    .delete()
    .eq('id', itemId)
    .eq('cart_id', cart.id);

  if (error) return res.status(400).json({ error: error.message });

  const dto = await buildCartDTO(req.user.id);
  if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
  res.json(dto);
}

async function clearCart(req, res) {
  const cart = await getOrCreateCart(req.user.id);

  const { error } = await supabaseAdmin
    .from('cart_items')
    .delete()
    .eq('cart_id', cart.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Keranjang berhasil dikosongkan' });
}

module.exports = { getCart, addItem, addPackage, updateItem, removeItem, clearCart };
