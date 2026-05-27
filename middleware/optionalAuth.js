const { supabase } = require('../config/supabase');

/**
 * Parse Authorization: Bearer <token> if present. Sets req.user on success.
 * Never returns 401 — if the header is missing or invalid, next() is called
 * with req.user undefined. Use this on routes that need to render slightly
 * different responses for authenticated vs anonymous callers, without
 * requiring auth.
 */
async function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);
  try {
    const { data } = await supabase.auth.getUser(token);
    if (data?.user) {
      req.user = data.user;
      req.token = token;
    }
  } catch {
    // ignore — treat as anonymous
  }
  return next();
}

module.exports = optionalAuthMiddleware;
