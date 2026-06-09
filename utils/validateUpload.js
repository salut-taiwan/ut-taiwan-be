'use strict';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Validate a multer file for the standard proof-upload constraints.
 * Returns null if valid, or an error message string if invalid.
 * @param {import('multer').File|undefined} file
 * @param {string} [missingMessage]
 * @returns {string|null}
 */
function validateUpload(file, missingMessage = 'File wajib diunggah') {
  if (!file) return missingMessage;
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) return 'Format file tidak didukung (JPG, PNG, WebP, atau PDF)';
  if (file.size > MAX_SIZE_BYTES) return 'Ukuran file maksimal 5 MB';
  return null;
}

/**
 * Map a MIME type to a short file extension.
 * @param {string} mime
 * @returns {string}
 */
function extFromMime(mime) {
  return MIME_TO_EXT[mime] || 'bin';
}

module.exports = { validateUpload, extFromMime, ALLOWED_MIME_TYPES, MAX_SIZE_BYTES };
