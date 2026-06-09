const { supabase } = require('../config/supabase');
const { db } = require('../db');
const { users } = require('../db/schema');
const { eq, and } = require('drizzle-orm');

/**
 * Verify Supabase JWT from Authorization: Bearer <token>
 * Attaches req.user on success. Lazy-heals users.is_verified when the JWT
 * shows email_confirmed_at but the DB column hasn't been mirrored yet.
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = data.user;
  req.token = token;

  if (data.user.email_confirmed_at) {
    try {
      await db.update(users)
        .set({ is_verified: true })
        .where(and(eq(users.id, data.user.id), eq(users.is_verified, false)));
    } catch (err) {
      console.error('[auth] is_verified heal failed:', err.message);
    }
  }

  next();
}

async function authenticateSSE(req, res, next) {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Unauthorized' });

    if (data.user.email_confirmed_at) {
      try {
        await db.update(users)
          .set({ is_verified: true })
          .where(and(eq(users.id, data.user.id), eq(users.is_verified, false)));
      } catch (err) {
        console.error('[authenticateSSE] is_verified heal failed:', err.message);
      }
    }

    req.user = data.user;
    req.token = token;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = authMiddleware;
module.exports.authenticateSSE = authenticateSSE;
