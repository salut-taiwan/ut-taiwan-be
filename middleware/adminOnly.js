const { supabaseAdmin } = require('../config/supabase');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** @type {Map<string, { role: string, cachedAt: number }>} */
const roleCache = new Map();

/**
 * Must be used after authMiddleware.
 * Checks the users table for role = 'admin', with a 5-minute in-process cache
 * to avoid a DB round-trip on every admin request.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const userId = req.user.id;
  const cached = roleCache.get(userId);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    if (cached.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    return next();
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();

  if (error || !data) {
    return res.status(403).json({ error: 'Access denied' });
  }

  roleCache.set(userId, { role: data.role, cachedAt: Date.now() });

  if (data.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

module.exports = adminOnly;
