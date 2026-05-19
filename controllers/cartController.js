const { supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { cart_items, modules, packages, product_skus } = require('../db/schema');
const { eq, and, sql } = require('drizzle-orm');

async function getOrCreateCart(userId) {
  // RPC stays on Supabase client (stored procedure)
  const { data: cartId, error } = await supabaseAdmin.rpc('get_or_create_cart', { p_user_id: userId });
  if (error || !cartId) return null;
  return { id: cartId };
}

async function buildCartDTO(userId) {
  const cart = await getOrCreateCart(userId);
  if (!cart) return null;

  try {
    const data = await db.query.cart_items.findMany({
      columns: {
        id: true, quantity: true, price_snapshot: true, is_request: true,
        sku_id: true, variant_label: true, product_name_snapshot: true,
      },
      where: eq(cart_items.cart_id, cart.id),
      with: {
        modules: {
          columns: { id: true, tbo_code: true, name: true, cover_image_url: true, price_student: true, is_available: true },
        },
        product_skus: {
          columns: { id: true, price: true, option_names: true },
          with: {
            products: {
              columns: { id: true, name: true },
              with: { product_images: { columns: { image_url: true, sort_order: true } } },
            },
          },
        },
      },
    });

    const items = data.map(item => {
      if (item.modules) {
        return {
          id: item.id,
          itemType: 'module',
          moduleId: item.modules.id,
          tboCode: item.modules.tbo_code,
          moduleName: item.modules.name,
          coverImageUrl: item.modules.cover_image_url,
          quantity: item.quantity,
          priceSnapshot: Number(item.price_snapshot),
          subtotal: Number(item.price_snapshot) * item.quantity,
          isAvailable: item.modules.is_available,
          isRequest: item.is_request,
          isStale: !item.modules.is_available && !item.is_request,
          isPricePending: item.is_request && !Number(item.price_snapshot),
        };
      }
      // Merchandise item
      const imgs = (item.product_skus?.products?.product_images || [])
        .sort((a, b) => a.sort_order - b.sort_order);
      return {
        id: item.id,
        itemType: 'merch',
        skuId: item.sku_id,
        variantLabel: item.variant_label,
        productNameSnapshot: item.product_name_snapshot,
        coverImageUrl: imgs[0]?.image_url ?? null,
        quantity: item.quantity,
        priceSnapshot: Number(item.price_snapshot),
        subtotal: Number(item.price_snapshot) * item.quantity,
        isAvailable: true,
        isRequest: item.is_request,
      };
    });

    return {
      id: cart.id,
      userId,
      items,
      subtotal: items.reduce((sum, i) => sum + i.subtotal, 0),
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      hasStaleItems: items.some(i => i.isStale),
    };
  } catch (err) {
    return null;
  }
}

async function getCart(req, res) {
  const dto = await buildCartDTO(req.user.id);
  if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
  res.json(dto);
}

async function addItem(req, res) {
  const { moduleId, quantity = 1 } = req.body;
  if (!moduleId) return res.status(400).json({ error: 'moduleId wajib diisi' });

  try {
    const mod = await db.query.modules.findFirst({
      columns: { id: true, price_student: true, is_available: true, deleted_at: true },
      where: eq(modules.id, moduleId),
    });

    if (!mod || mod.deleted_at) return res.status(404).json({ error: 'Modul tidak ditemukan' });

    const priceSnapshot = mod.price_student ?? 0;
    const isRequest = !mod.is_available || !mod.price_student;

    const cart = await getOrCreateCart(req.user.id);

    await db.insert(cart_items)
      .values({
        cart_id: cart.id,
        module_id: moduleId,
        quantity,
        price_snapshot: priceSnapshot,
        is_request: isRequest,
      })
      .onConflictDoUpdate({
        target: [cart_items.cart_id, cart_items.module_id],
        set: {
          quantity,
          price_snapshot: priceSnapshot,
          is_request: isRequest,
        },
      });

    const dto = await buildCartDTO(req.user.id);
    if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
    res.status(201).json(dto);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function addPackage(req, res) {
  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ error: 'packageId wajib diisi' });

  try {
    const pkg = await db.query.packages.findFirst({
      where: and(eq(packages.id, packageId), eq(packages.is_active, true)),
      with: {
        package_modules: {
          with: {
            modules: {
              columns: { id: true, price_student: true, is_available: true },
            },
          },
        },
      },
    });

    if (!pkg) return res.status(404).json({ error: 'Paket tidak ditemukan' });

    const cart = await getOrCreateCart(req.user.id);
    const items = (pkg.package_modules || [])
      .filter(pm => pm.modules)
      .map(pm => ({
        cart_id: cart.id,
        module_id: pm.modules.id,
        quantity: 1,
        price_snapshot: pm.modules.price_student ?? 0,
        is_request: !pm.modules.is_available || !pm.modules.price_student,
      }));

    if (items.length === 0) {
      return res.status(400).json({ error: 'Tidak ada modul dalam paket ini' });
    }

    await db.insert(cart_items)
      .values(items)
      .onConflictDoUpdate({
        target: [cart_items.cart_id, cart_items.module_id],
        set: {
          quantity: sql`excluded.quantity`,
          price_snapshot: sql`excluded.price_snapshot`,
          is_request: sql`excluded.is_request`,
        },
      });

    const dto = await buildCartDTO(req.user.id);
    if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
    res.json(dto);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function updateItem(req, res) {
  const { itemId } = req.params;
  const { quantity } = req.body;

  if (quantity < 0) return res.status(400).json({ error: 'Jumlah tidak valid' });
  if (quantity === 0) {
    return removeItem(req, res);
  }

  try {
    const cart = await getOrCreateCart(req.user.id);

    const [data] = await db.update(cart_items)
      .set({ quantity })
      .where(and(eq(cart_items.id, itemId), eq(cart_items.cart_id, cart.id)))
      .returning({ id: cart_items.id });

    if (!data) return res.status(404).json({ error: 'Item tidak ditemukan' });

    const dto = await buildCartDTO(req.user.id);
    if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
    res.json(dto);
  } catch (err) {
    res.status(404).json({ error: 'Item tidak ditemukan' });
  }
}

async function removeItem(req, res) {
  const { itemId } = req.params;
  try {
    const cart = await getOrCreateCart(req.user.id);

    await db.delete(cart_items)
      .where(and(eq(cart_items.id, itemId), eq(cart_items.cart_id, cart.id)));

    const dto = await buildCartDTO(req.user.id);
    if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
    res.json(dto);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function clearCart(req, res) {
  try {
    const cart = await getOrCreateCart(req.user.id);
    await db.delete(cart_items).where(eq(cart_items.cart_id, cart.id));
    res.json({ message: 'Keranjang berhasil dikosongkan' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function convertItemToRequest(req, res) {
  const { itemId } = req.params;
  try {
    const cart = await getOrCreateCart(req.user.id);

    const cartItem = await db.query.cart_items.findFirst({
      columns: { id: true, module_id: true },
      where: and(eq(cart_items.id, itemId), eq(cart_items.cart_id, cart.id)),
    });

    if (!cartItem) return res.status(404).json({ error: 'Item tidak ditemukan' });

    const mod = await db.query.modules.findFirst({
      columns: { is_available: true },
      where: eq(modules.id, cartItem.module_id),
    });

    if (mod?.is_available) {
      return res.status(400).json({ error: 'Modul sudah tersedia kembali, tidak perlu dijadikan permintaan' });
    }

    const [data] = await db.update(cart_items)
      .set({ is_request: true })
      .where(and(eq(cart_items.id, itemId), eq(cart_items.cart_id, cart.id)))
      .returning({ id: cart_items.id });

    if (!data) return res.status(404).json({ error: 'Item tidak ditemukan' });

    const dto = await buildCartDTO(req.user.id);
    if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
    res.json(dto);
  } catch (err) {
    res.status(404).json({ error: 'Item tidak ditemukan' });
  }
}

async function addMerch(req, res) {
  const { skuId, quantity = 1 } = req.body;
  if (!skuId) return res.status(400).json({ error: 'skuId wajib diisi' });

  try {
    const sku = await db.query.product_skus.findFirst({
      columns: { id: true, price: true, option_names: true },
      where: eq(product_skus.id, skuId),
      with: { products: { columns: { id: true, name: true } } },
    });

    if (!sku) return res.status(404).json({ error: 'SKU tidak ditemukan' });

    const variantLabel = Array.isArray(sku.option_names) && sku.option_names.length > 0
      ? sku.option_names.join(' / ')
      : null;

    const cart = await getOrCreateCart(req.user.id);
    const qty = Math.max(1, parseInt(quantity) || 1);

    await db.insert(cart_items)
      .values({
        cart_id: cart.id,
        module_id: null,
        sku_id: skuId,
        quantity: qty,
        price_snapshot: sku.price,
        variant_label: variantLabel,
        product_name_snapshot: sku.products.name,
        is_request: false,
      })
      .onConflictDoUpdate({
        target: [cart_items.cart_id, cart_items.sku_id],
        set: {
          quantity: qty,
          price_snapshot: sku.price,
          variant_label: variantLabel,
          product_name_snapshot: sku.products.name,
        },
      });

    const dto = await buildCartDTO(req.user.id);
    if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
    res.status(201).json(dto);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { getCart, addItem, addPackage, updateItem, removeItem, clearCart, convertItemToRequest, addMerch };