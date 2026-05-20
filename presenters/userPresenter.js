'use strict';

const { addressToLines, formatDate, formatNTD } = require('../format');

function presentUser(row) {
  const lines = addressToLines({
    zh_road: row.address_zh_road,
    zh_number: row.address_zh_number,
    zh_floor: row.address_zh_floor,
    zh_city: row.address_zh_city,
    zh_district: row.address_zh_district,
    postal_code: row.postal_code,
    country: row.country,
    phone: row.phone,
  });
  const display = lines.length > 0 ? lines.join('\n') : null;

  const status = row.salut_status;
  const isActive = Boolean(row.is_salut_active);
  const isMember = isActive && status === 'approved';

  const feeRaw = row.salut_applied_fee_amount;
  const feeDisplay = feeRaw === null || feeRaw === undefined
    ? null
    : (Number.isFinite(Number(feeRaw)) ? formatNTD(Number(feeRaw)) : null);

  return {
    ...row,
    shipping_address_lines: lines,
    shipping_address_display: display,
    is_member: isMember,
    is_pending: status === 'pending',
    salut_approved_at_display: formatDate(row.salut_approved_at),
    salut_applied_at_display: formatDate(row.salut_applied_at),
    salut_applied_fee_amount_display: feeDisplay,
  };
}

module.exports = { presentUser };
