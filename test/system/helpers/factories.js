'use strict';

// Row builders for the system tier. They take the raw postgres client rather
// than drizzle, so they stay independent of the ORM mapping several of these
// tests are checking. Every id is a fresh uuid: ids are never recycled between
// tests, which also keeps the adminOnly role cache from serving a stale role.

const { randomUUID } = require('node:crypto');

const short = () => randomUUID().slice(0, 8);

/** postgres.js wants a string for timestamptz parameters, not a Date. */
const ts = (value) => (value instanceof Date ? value.toISOString() : value);

/** auth.users and public.users together — the foreign key from 001 needs both. */
async function makeUser(sql, over = {}) {
  const id = over.id ?? randomUUID();
  const email = over.email ?? `u-${short()}@test.local`;
  const confirmedAt = over.email_confirmed_at === undefined ? new Date() : over.email_confirmed_at;

  await sql`
    INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (${id}, ${email}, ${ts(confirmedAt)})`;

  const [row] = await sql`
    INSERT INTO users (id, email, name, role, is_verified, is_salut,
                       salut_status, salut_approved_at, current_semester)
    VALUES (${id}, ${email}, ${over.name ?? 'Test User'},
            ${over.role ?? 'student'}, ${over.is_verified ?? true},
            ${over.is_salut ?? false}, ${over.salut_status ?? 'none'},
            ${ts(over.salut_approved_at ?? null)}, ${over.current_semester ?? 3})
    RETURNING *`;
  return row;
}

const makeAdmin = (sql, over = {}) => makeUser(sql, { ...over, role: 'admin' });

/** A member whose approval falls inside the current cycle. */
const makeSalutMember = (sql, over = {}) => makeUser(sql, {
  ...over,
  is_salut: true,
  salut_status: 'approved',
  salut_approved_at: over.salut_approved_at ?? new Date(),
});

async function makeModule(sql, over = {}) {
  // `??` would swallow an explicit null, which several tests need in order to
  // distinguish "unpriced" from "free".
  const priceStudent = 'price_student' in over ? over.price_student : 50000;
  const priceGeneral = 'price_general' in over ? over.price_general : 60000;
  const [row] = await sql`
    INSERT INTO modules (tbo_code, name, price_student, price_general, is_available)
    VALUES (${over.tbo_code ?? `TEST${short()}`}, ${over.name ?? 'Modul Uji'},
            ${priceStudent}, ${priceGeneral},
            ${over.is_available ?? true})
    RETURNING *`;
  return row;
}

async function makeProductWithSku(sql, over = {}) {
  const [product] = await sql`
    INSERT INTO products (category, name, base_price, weight_grams, claim_rule)
    VALUES (${over.category ?? 'kaos'}, ${over.name ?? 'Kaos Uji'},
            ${over.base_price ?? 120000}, ${over.weight_grams ?? 300},
            ${over.claim_rule ?? null})
    RETURNING *`;
  const [sku] = await sql`
    INSERT INTO product_skus (product_id, price, option_names)
    VALUES (${product.id}, ${over.price ?? over.base_price ?? 120000},
            ${sql.json(over.option_names ?? ['M'])})
    RETURNING *`;
  return { product, sku };
}

async function makeCart(sql, userId) {
  const [row] = await sql`INSERT INTO carts (user_id) VALUES (${userId}) RETURNING *`;
  return row;
}

async function addModuleToCart(sql, cartId, mod, over = {}) {
  const [row] = await sql`
    INSERT INTO cart_items (cart_id, module_id, quantity, price_snapshot, is_request)
    VALUES (${cartId}, ${mod.id}, ${over.quantity ?? 1},
            ${over.price_snapshot ?? mod.price_student}, ${over.is_request ?? false})
    RETURNING *`;
  return row;
}

async function addSkuToCart(sql, cartId, sku, over = {}) {
  const [row] = await sql`
    INSERT INTO cart_items (cart_id, sku_id, quantity, price_snapshot,
                            variant_label, product_name_snapshot, is_request)
    VALUES (${cartId}, ${sku.id}, ${over.quantity ?? 1},
            ${over.price_snapshot ?? sku.price},
            ${over.variant_label ?? 'M'},
            ${over.product_name_snapshot ?? 'Kaos Uji'}, ${over.is_request ?? false})
    RETURNING *`;
  return row;
}

/** An order with items and a payment, built directly — for the cancel and
 *  confirm paths, which start from an order that already exists. */
async function makeOrder(sql, user, over = {}) {
  const subtotal = over.subtotal ?? 100000;
  const fees = { shipping_cost: 300000, box_fee: 100000, admin_fee: 25000, ...over.fees };
  const total = over.total_amount ?? subtotal + fees.shipping_cost + fees.box_fee + fees.admin_fee;

  const [order] = await sql`
    INSERT INTO orders (order_number, user_id, status, subtotal, shipping_cost,
                        box_fee, admin_fee, is_salut_order, total_amount,
                        shipping_name, shipping_address, shipping_city,
                        shipping_province, shipping_postal, shipping_country, shipping_phone)
    VALUES (${over.order_number ?? `UT-2026-${short()}`}, ${user.id},
            ${over.status ?? 'pending'}, ${subtotal}, ${fees.shipping_cost},
            ${fees.box_fee}, ${fees.admin_fee}, ${over.is_salut_order ?? false}, ${total},
            'Andi', 'Jl. Uji 1', 'Taipei', 'Taiwan', '10001', 'Taiwan', '+886912345678')
    RETURNING *`;

  const items = [];
  for (const it of over.items ?? [{}]) {
    const [row] = await sql`
      INSERT INTO order_items (order_id, module_id, module_code, module_name, quantity,
                               unit_price, subtotal, is_request, request_status, sku_id, variant_label)
      VALUES (${order.id}, ${it.module_id ?? null}, ${it.module_code ?? 'MKDU4109'},
              ${it.module_name ?? 'Bahasa Inggris'}, ${it.quantity ?? 2},
              ${it.unit_price ?? 50000}, ${it.subtotal ?? 100000},
              ${it.is_request ?? false}, ${it.request_status ?? null},
              ${it.sku_id ?? null}, ${it.variant_label ?? null})
      RETURNING *`;
    items.push(row);
  }

  const uniqueCode = over.unique_code ?? 123;
  const [payment] = await sql`
    INSERT INTO payments (order_id, gateway, method, bank, amount, unique_code, status, expires_at)
    VALUES (${order.id}, 'manual', 'transfer', 'BCA',
            ${over.payment_amount ?? total + uniqueCode}, ${uniqueCode},
            ${over.payment_status ?? 'pending'},
            ${(over.expires_at ?? new Date(Date.now() + 5 * 86400000)).toISOString()})
    RETURNING *`;

  return { order, items, payment };
}

/** The p_* payload checkout_order expects, with sensible defaults. */
function checkoutParams(user, over = {}) {
  const subtotal = over.p_subtotal ?? 100000;
  return {
    p_user_id: user.id,
    p_order_number: over.p_order_number ?? `UT-2026-${short()}`,
    p_subtotal: subtotal,
    p_shipping_cost: over.p_shipping_cost ?? 300000,
    p_box_fee: over.p_box_fee ?? 100000,
    p_admin_fee: over.p_admin_fee ?? 25000,
    p_is_salut_order: over.p_is_salut_order ?? false,
    p_total_amount: over.p_total_amount ?? subtotal + 425000,
    p_shipping_name: 'Andi',
    p_shipping_address: 'Jl. Uji 1',
    p_shipping_city: 'Taipei',
    p_shipping_province: 'Taiwan',
    p_shipping_postal: '10001',
    p_shipping_country: 'Taiwan',
    p_shipping_phone: '+886912345678',
    p_notes: null,
    p_payment_gateway: 'manual',
    p_payment_method: 'transfer',
    p_payment_bank: 'BCA',
    p_payment_amount: over.p_payment_amount ?? subtotal + 425000 + 123,
    p_unique_code: over.p_unique_code ?? 123,
    p_payment_expires_at: over.p_payment_expires_at ?? new Date(Date.now() + 5 * 86400000).toISOString(),
    p_gateway_payment_id: null,
    p_gateway_billing_no: null,
    p_gateway_response: null,
    p_order_items: over.p_order_items ?? [],
  };
}

/**
 * Call an RPC by name with named arguments, the way PostgREST does.
 *
 * Arrays and objects are handed to the driver as-is and cast at the call site.
 * Pre-stringifying them does not work: the driver then encodes the JSON text
 * as a JSON *string*, and the function receives a scalar it cannot iterate.
 */
async function callRpc(sql, fn, params) {
  const keys = Object.keys(params);
  const isJson = (v) => v !== null && typeof v === 'object' && !(v instanceof Date);
  const args = keys
    .map((k, i) => `"${k}" => $${i + 1}${isJson(params[k]) ? '::jsonb' : ''}`)
    .join(', ');
  const values = keys.map(k => params[k]);
  const rows = await sql.unsafe(`SELECT "${fn}"(${args}) AS result`, values);
  return rows[0]?.result ?? null;
}

module.exports = {
  makeUser, makeAdmin, makeSalutMember, makeModule, makeProductWithSku,
  makeCart, addModuleToCart, addSkuToCart, makeOrder, checkoutParams, callRpc,
};
