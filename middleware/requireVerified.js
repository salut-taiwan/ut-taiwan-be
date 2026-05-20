/**
 * Reject the request if the authenticated user's email is unconfirmed.
 * Must run AFTER authMiddleware (depends on req.user.email_confirmed_at).
 */
function requireVerified(req, res, next) {
  if (!req.user?.email_confirmed_at) {
    return res.status(403).json({
      error: 'Email belum diverifikasi. Silakan cek inbox Anda atau kirim ulang email verifikasi.',
      code: 'EMAIL_NOT_VERIFIED',
    });
  }
  next();
}

module.exports = requireVerified;
