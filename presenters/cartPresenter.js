'use strict';

const { formatIDR, rewriteStorageUrl } = require('../format');
const { SALUT_FEES } = require('../config/constants');

const FEE_LINE_DEFS = [
  { key: 'shipping', label: 'Ongkir',      amount: SALUT_FEES.ONGKIR },
  { key: 'box',      label: 'Biaya Box',   amount: SALUT_FEES.BOX },
  { key: 'admin',    label: 'Biaya Admin', amount: SALUT_FEES.ADMIN },
];

function buildFeeLines({ isSalutActive }) {
  return FEE_LINE_DEFS.map((def) => {
    if (isSalutActive) {
      return {
        key: def.key,
        label: def.label,
        amount: 0,
        amount_display: formatIDR(0),
        is_waived: true,
        original_amount: def.amount,
        original_amount_display: formatIDR(def.amount),
      };
    }
    return {
      key: def.key,
      label: def.label,
      amount: def.amount,
      amount_display: formatIDR(def.amount),
      is_waived: false,
    };
  });
}

function buildCartTotalBreakdown({ subtotal, isSalutActive, uniqueCode = null }) {
  const fee_lines = buildFeeLines({ isSalutActive });
  const feeSum = fee_lines.reduce((acc, l) => acc + l.amount, 0);
  const code = uniqueCode || 0;
  const total = subtotal + feeSum + code;
  return {
    subtotal_display: formatIDR(subtotal),
    fee_lines,
    unique_code_display: uniqueCode != null ? formatIDR(uniqueCode) : null,
    total_display: formatIDR(total),
  };
}

function presentCartItem(item) {
  return {
    ...item,
    coverImageUrl: rewriteStorageUrl(item.coverImageUrl),
    priceSnapshotDisplay: formatIDR(item.priceSnapshot),
    subtotalDisplay: formatIDR(item.subtotal),
  };
}

function presentCart(dto, { isSalutActive } = { isSalutActive: false }) {
  const items = (dto.items || []).map(presentCartItem);
  return {
    ...dto,
    items,
    subtotal_display: formatIDR(dto.subtotal),
    total_breakdown: buildCartTotalBreakdown({
      subtotal: dto.subtotal,
      isSalutActive: Boolean(isSalutActive),
    }),
  };
}

module.exports = { presentCart, presentCartItem, buildCartTotalBreakdown, buildFeeLines };
