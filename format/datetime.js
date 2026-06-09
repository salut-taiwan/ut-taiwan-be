'use strict';

const DEFAULT_TZ = 'Asia/Taipei';

const datetimeFormatters = new Map();

function getDatetimeFormatter(timeZone) {
  if (!datetimeFormatters.has(timeZone)) {
    datetimeFormatters.set(
      timeZone,
      new Intl.DateTimeFormat('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      })
    );
  }
  return datetimeFormatters.get(timeZone);
}

const expiryFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Taipei',
});

function parseDate(iso) {
  if (iso === null || iso === undefined || iso === '') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Format an ISO date string using the Asia/Taipei timezone by default.
 * @param {string|Date|null|undefined} iso
 * @param {{ timeZone?: string }} [opts]
 * @returns {string|null}
 */
function formatDate(iso, opts = {}) {
  const d = parseDate(iso);
  if (!d) return null;
  const tz = opts.timeZone || DEFAULT_TZ;
  return getDatetimeFormatter(tz).format(d);
}

/**
 * Format an ISO date string as a SALUT membership expiry date (date only,
 * no time, Asia/Taipei timezone).
 * @param {string|Date|null|undefined} iso
 * @returns {string|null}
 */
function formatExpiryDate(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  return expiryFormatter.format(d);
}

module.exports = { formatDate, formatExpiryDate };
