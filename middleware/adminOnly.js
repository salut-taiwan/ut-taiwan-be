const { supabaseAdmin } = require('../config/supabase');

/**
 * Must be used after authMiddleware.
 * Checks the users table for role = 'admin'.
 */
async function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', req.user.id)
    .single();

  if (error || !data) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (data.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

module.exports = adminOnly;
