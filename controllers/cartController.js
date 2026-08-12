const { supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { cart_items, modules, packages, product_skus, users } = require('../db/schema');
const { eq, and, sql } = require('drizzle-orm');
const { presentCart } = require('../presenters/cartPresenter');
const { isSalutActive } = require('../config/constants');
const { checkSalutSem1Eligibility, cartContainsProduct } = require('../services/claimRules');
const { deriveModuleCartEntry } = require('../services/cartPricing');

async function getUserSalutActive(userId) {
  const u = await db.query.users.findFirst({
    columns: { salut_approved_at: true },
    where: eq(users.id, userId),
  });
  return isSalutActive(u?.salut_approved_at);
}

async function respondWithCart(req, res, status = 200) {
  const dto = await buildCartDTO(req.user.id);
  if (!dto) return res.status(500).json({ error: 'Gagal memuat keranjang' });
  const active = await getUserSalutActive(req.user.id);
  return res.status(status).json(presentCart(dto, { isSalutActive: active }));
}

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
  await respondWithCart(req, res);
}

async function addItem(req, res) {
  const { moduleId, quantity: rawQuantity = 1 } = req.body;
  if (!moduleId) return res.status(400).json({ error: 'moduleId wajib diisi' });

  // Unvalidated, a negative quantity reached the conflict clause and
  // *decremented* an existing line.
  const quantity = Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'Jumlah tidak valid' });
  }

  try {
    const mod = await db.query.modules.findFirst({
      columns: { id: true, price_student: true, is_available: true, deleted_at: true },
      where: eq(modules.id, moduleId),
    });

    if (!mod || mod.deleted_at) return res.status(404).json({ error: 'Modul tidak ditemukan' });

    const { priceSnapshot, isRequest } = deriveModuleCartEntry(mod);

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
          // Increment existing qty rather than overwrite it — matches the user's
          // expectation when they tap "Add to cart" twice on the same module.
          quantity: sql`${cart_items.quantity} + ${quantity}`,
          price_snapshot: priceSnapshot,
          is_request: isRequest,
        },
      });

    await respondWithCart(req, res, 201);
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
      .map(pm => {
        const { priceSnapshot, isRequest } = deriveModuleCartEntry(pm.modules);
        return {
          cart_id: cart.id,
          module_id: pm.modules.id,
          quantity: 1,
          price_snapshot: priceSnapshot,
          is_request: isRequest,
        };
      });

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

    await respondWithCart(req, res);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function updateItem(req, res) {
  const { itemId } = req.params;
  const { quantity } = req.body;

  // An omitted quantity used to slip past both guards below (undefined is
  // neither < 0 nor === 0) and be written to the column verbatim.
  if (quantity === undefined || quantity === null || !Number.isInteger(Number(quantity))) {
    return res.status(400).json({ error: 'Jumlah tidak valid' });
  }
  if (quantity < 0) return res.status(400).json({ error: 'Jumlah tidak valid' });
  if (Number(quantity) === 0) {
    return removeItem(req, res);
  }

  try {
    const cart = await getOrCreateCart(req.user.id);

    // Guard claim-gated SKUs: quantity must stay at 1. Reject (don't silently clamp)
    // so any tampering attempt is visible.
    const existing = await db.query.cart_items.findFirst({
      columns: { id: true },
      where: and(eq(cart_items.id, itemId), eq(cart_items.cart_id, cart.id)),
      with: { product_skus: { columns: { id: true }, with: { products: { columns: { claim_rule: true } } } } },
    });
    if (!existing) return res.status(404).json({ error: 'Item tidak ditemukan' });
    if (existing.product_skus?.products?.claim_rule === 'salut_sem1_once' && quantity !== 1) {
      return res.status(400).json({ error: 'Almet gratis hanya bisa diklaim 1 unit per anggota' });
    }

    const [data] = await db.update(cart_items)
      .set({ quantity })
      .where(and(eq(cart_items.id, itemId), eq(cart_items.cart_id, cart.id)))
      .returning({ id: cart_items.id });

    if (!data) return res.status(404).json({ error: 'Item tidak ditemukan' });

    await respondWithCart(req, res);
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

    await respondWithCart(req, res);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function clearCart(req, res) {
  try {
    const cart = await getOrCreateCart(req.user.id);
    await db.delete(cart_items).where(eq(cart_items.cart_id, cart.id));
    await respondWithCart(req, res);
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

    await respondWithCart(req, res);
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
      with: { products: { columns: { id: true, name: true, claim_rule: true } } },
    });

    if (!sku) return res.status(404).json({ error: 'SKU tidak ditemukan' });

    const variantLabel = Array.isArray(sku.option_names) && sku.option_names.length > 0
      ? sku.option_names.join(' / ')
      : null;

    const cart = await getOrCreateCart(req.user.id);

    // Claim-gated products: enforce eligibility, qty=1, and one entry per product.
    const isClaimGated = sku.products.claim_rule === 'salut_sem1_once';
    let qty;
    if (isClaimGated) {
      qty = 1;
      const eligibility = await checkSalutSem1Eligibility(req.user.id, sku.products.id);
      if (!eligibility.ok) return res.status(eligibility.status).json({ error: eligibility.error });
      if (await cartContainsProduct(cart.id, sku.products.id)) {
        return res.status(409).json({ error: 'Almet gratis sudah ada di keranjang' });
      }
    } else {
      qty = Math.max(1, parseInt(quantity) || 1);
    }

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
          // Claim-gated SKUs are pinned to qty=1; everything else bumps by qty.
          quantity: isClaimGated ? sql`1` : sql`${cart_items.quantity} + ${qty}`,
          price_snapshot: sku.price,
          variant_label: variantLabel,
          product_name_snapshot: sku.products.name,
        },
      });

    await respondWithCart(req, res, 201);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { getCart, addItem, addPackage, updateItem, removeItem, clearCart, convertItemToRequest, addMerch };