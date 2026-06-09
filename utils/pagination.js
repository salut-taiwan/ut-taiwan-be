'use strict';

/**
 * Parse a raw query-param string to an integer clamped within [min, max].
 * Returns `fallback` when the input is missing or not a valid integer.
 * @param {string|undefined} raw
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(raw, min, max, fallback) {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Escape ILIKE wildcard characters so user-supplied strings are treated as
 * literals rather than patterns. Escapes: backslash, percent, underscore.
 * @param {string} s
 * @returns {string}
 */
function escapeIlike(s) {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

module.exports = { clampInt, escapeIlike };
