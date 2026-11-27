'use strict';

const SIZE_MAX_LENGTH = 30;

function normalizeTaiwanPhone(value) {
  if (typeof value !== 'string' || value.length > 32) return null;
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (/^09\d{8}$/.test(compact)) return `+886${compact.slice(1)}`;
  if (/^\+?8869\d{8}$/.test(compact)) return `+${compact.replace(/^\+/, '')}`;
  return null;
}

function normalizeAlmamaterSize(value) {
  if (typeof value !== 'string' || /[\r\n\u0000-\u001f\u007f]/.test(value)) return null;
  const size = value.trim();
  return size.length > 0 && size.length <= SIZE_MAX_LENGTH ? size : null;
}

function validateRegistrationProfile(body, { update = false } = {}) {
  const values = {};
  const owns = key => Object.prototype.hasOwnProperty.call(body, key);
  if (!update && owns('profile_fields_version') && body.profile_fields_version !== 1) {
    return { error: 'Versi formulir pendaftaran tidak didukung. Silakan muat ulang halaman.' };
  }
  // Legacy clients remain usable during a rolling deployment. The new form
  // sends version 1 and requires both fields; partial new submissions are refused.
  const required = !update && (body.profile_fields_version === 1 || owns('phone_taiwan') || owns('almamater_size'));
  for (const [key, normalize, message] of [
    ['phone_taiwan', normalizeTaiwanPhone, 'Nomor Taiwan wajib diisi dengan format 09xxxxxxxx atau +8869xxxxxxxx.'],
    ['almamater_size', normalizeAlmamaterSize, 'Ukuran almamater wajib diisi dalam satu baris, maksimal 30 karakter.'],
  ]) {
    if (!owns(key) && !required) continue;
    const value = body[key];
    const empty = value === null || (typeof value === 'string' && value.trim() === '');
    if (update && empty) { values[key] = null; continue; }
    const normalized = normalize(value);
    if (!normalized) return { error: message };
    values[key] = normalized;
  }
  return { values };
}

module.exports = { SIZE_MAX_LENGTH, normalizeTaiwanPhone, normalizeAlmamaterSize, validateRegistrationProfile };
