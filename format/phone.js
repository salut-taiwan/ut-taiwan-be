'use strict';

/**
 * Normalize a WhatsApp number to bare international digits, e.g. "628123456789",
 * so it can be dropped straight into a wa.me/<digits> link.
 *
 * Handles the three shapes students actually type: local Indonesian "08…",
 * "+62…"/"62…", and Taiwanese "09…" (mapped to +886). Anything else keeps its
 * digits as given — better to store what they wrote than to guess a country.
 *
 * Returns null when there are too few digits to be a real number.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function normalizeWaNumber(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (!hasPlus) {
    if (digits.startsWith('08')) digits = `62${digits.slice(1)}`;
    else if (digits.startsWith('09')) digits = `886${digits.slice(1)}`;
  }

  // Shortest plausible international number is ~8 digits (country code included).
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

module.exports = { normalizeWaNumber };
