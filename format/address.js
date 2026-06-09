'use strict';

function nonEmpty(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/**
 * Compose a Taiwanese street address line from structured fields.
 * @param {{ zh_road?: string, zh_number?: string, zh_floor?: string }|null} addr
 * @returns {string|null}
 */
function composeShippingAddressLine(addr) {
  if (!addr) return null;
  const parts = [
    nonEmpty(addr.zh_road) ? addr.zh_road : null,
    nonEmpty(addr.zh_number) ? `${addr.zh_number}號` : null,
    nonEmpty(addr.zh_floor) ? addr.zh_floor : null,
  ].filter((p) => p !== null);
  if (parts.length === 0) return null;
  return parts.join(' ');
}

function composeCityLine(addr) {
  if (!addr) return null;
  const districtCity = [
    nonEmpty(addr.zh_district) ? addr.zh_district : '',
    nonEmpty(addr.zh_city) ? addr.zh_city : '',
  ].join('');
  if (!districtCity) return null;
  return nonEmpty(addr.postal_code)
    ? `${districtCity} ${addr.postal_code}`
    : districtCity;
}

/**
 * Convert a structured address object to an array of display lines.
 * @param {{ zh_road?: string, zh_number?: string, zh_floor?: string, zh_district?: string, zh_city?: string, postal_code?: string, country?: string, phone?: string }|null} addr
 * @returns {string[]}
 */
function addressToLines(addr) {
  if (!addr) return [];
  const lines = [
    composeShippingAddressLine(addr),
    composeCityLine(addr),
    nonEmpty(addr.country) ? addr.country : null,
    nonEmpty(addr.phone) ? addr.phone : null,
  ].filter((l) => l !== null && l !== '');
  return lines;
}

module.exports = {
  composeShippingAddressLine,
  addressToLines,
};
