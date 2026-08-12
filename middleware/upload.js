const multer = require('multer');
const { ALLOWED_MIME_TYPES, MAX_SIZE_BYTES } = require('../utils/validateUpload');

// The limit and the allow-list come from utils/validateUpload so the two agree.
// They used to diverge — multer accepted 10 MB while validateUpload refused
// anything over 5 MB, so the same file was accepted on the payment-proof route
// and refused on the SKS one.
//
// A disallowed type is reported as a 400 rather than dropped silently: a bare
// cb(null, false) leaves req.file undefined, and the controller then reports
// "file wajib diunggah" to someone who did attach a file.
module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) return cb(null, true);
    const err = new Error('Format file tidak didukung (JPG, PNG, WebP, atau PDF)');
    err.status = 400;
    cb(err);
  },
});
