'use strict';

const { formatIDR } = require('../format');
const { SALUT_FEES } = require('../config/constants');

/**
 * @typedef {Object} FeeLineDef
 * @property {string} key
 * @property {string} label
 * @property {number} original - canonical SALUT_FEES amount (used as strikethrough for SALUT orders)
 */

/** @type {FeeLineDef[]} */
const FEE_LINE_DEFS = [
  { key: 'shipping', label: 'Ongkir',      original: SALUT_FEES.ONGKIR },
  { key: 'box',      label: 'Biaya Box',   original: SALUT_FEES.BOX },
  { key: 'admin',    label: 'Biaya Admin', original: SALUT_FEES.ADMIN },
];

/**
 * Build the fee line items shared between cart preview and order display.
 *
 * For SALUT (waived) scenarios the original SALUT_FEES constants are used
 * as the strikethrough amount regardless of stored DB values — this preserves
 * the discount display if the user is de-SALUTed after the order was placed.
 *
 * @param {{ amounts: number[], isSalut: boolean }} opts
 *   amounts — [shippingCost, boxFee, adminFee] aligned with FEE_LINE_DEFS order
 *   isSalut — when true all displayed amounts are 0 (waived) with original shown
 * @returns {Array<Object>}
 */
function buildFeeLines({ amounts, isSalut }) {
  return FEE_LINE_DEFS.map((def, i) => {
    if (isSalut) {
      return {
        key: def.key,
        label: def.label,
        amount: 0,
        amount_display: formatIDR(0),
        is_waived: true,
        original_amount: def.original,
        original_amount_display: formatIDR(def.original),
      };
    }
    const amount = Number(amounts[i]) || 0;
    return {
      key: def.key,
      label: def.label,
      amount,
      amount_display: formatIDR(amount),
      is_waived: false,
    };
  });
}

module.exports = { buildFeeLines, FEE_LINE_DEFS };
