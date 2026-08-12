'use strict';

const { sql, eq, and } = require('drizzle-orm');
const { db } = require('../db');
const { users, cart_items, product_skus } = require('../db/schema');
const { isSalutActive } = require('../config/constants');

/**
 * Verify a user can claim a product gated by claim_rule = 'salut_sem1_once'.
 * Returns:
 *   { ok: true }
 *   { ok: false, status: number, error: string }
 *
 * The lock predicate treats payments with status IN ('paid', 'refunded') as
 * claim-consumed (a refund does not unlock — see plan section 4).
 */
async function checkSalutSem1Eligibility(userId, productId) {
  const u = await db.query.users.findFirst({
    columns: { current_semester: true, salut_approved_at: true },
    where: eq(users.id, userId),
  });

  if (!isSalutActive(u?.salut_approved_at)) {
    return { ok: false, status: 403, error: 'Klaim almet gratis hanya tersedia untuk anggota SALUT aktif' };
  }
  if (u?.current_semester !== 1) {
    return { ok: false, status: 403, error: 'Klaim almet gratis hanya untuk mahasiswa semester 1' };
  }

  const claimed = await db.execute(sql`
    SELECT 1
      FROM order_items oi
      JOIN orders   o  ON o.id  = oi.order_id
      JOIN payments p  ON p.order_id = o.id
      JOIN product_skus ps ON ps.id = oi.sku_id
     WHERE ps.product_id = ${productId}
       AND o.user_id     = ${userId}
       AND p.status      IN ('paid', 'refunded')
     LIMIT 1
  `);
  // postgres.js returns a Result that extends Array — there is no `.rows`.
  // Reading one made this guard dead code, so the claim could be spent twice.
  if (claimed.length > 0) {
    return { ok: false, status: 409, error: 'Almet gratis sudah pernah diklaim' };
  }

  return { ok: true };
}

/**
 * Returns true if the user's cart already contains any SKU under the given product.
 * Used to prevent adding the free almet twice (also future-proofs against multi-SKU
 * variants of the same gated product).
 */
async function cartContainsProduct(cartId, productId) {
  const existing = await db
    .select({ id: cart_items.id })
    .from(cart_items)
    .innerJoin(product_skus, eq(cart_items.sku_id, product_skus.id))
    .where(and(eq(cart_items.cart_id, cartId), eq(product_skus.product_id, productId)))
    .limit(1);
  return existing.length > 0;
}

module.exports = { checkSalutSem1Eligibility, cartContainsProduct };
