'use strict';

/**
 * Derive the cart-line pricing for a module.
 *
 * A module becomes a request when it is out of stock or has no usable price
 * (null, or 0 from a placeholder/unscraped row): the admin fills in the price
 * before the order can be paid. Merchandise never takes this path — its SKU
 * price is always known, including the free SALUT almet at 0.
 *
 * Prices are read as numbers (db/schema.js `money`), but this coerces anyway so
 * a raw db.execute() row or a legacy string snapshot cannot resurrect the
 * "0.00 is truthy" bug.
 */
function deriveModuleCartEntry(mod) {
  const raw = Number(mod?.price_student ?? 0);
  const priceSnapshot = Number.isFinite(raw) ? raw : 0;
  return {
    priceSnapshot,
    isRequest: !mod?.is_available || priceSnapshot <= 0,
  };
}

module.exports = { deriveModuleCartEntry };
