const { subscribeUserStatus } = require('../services/userStatusEventBus');
const { db } = require('../db');
const { users } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { isSalutActive } = require('../config/constants');

async function userStatusStream(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const dbUser = await db.query.users.findFirst({
      columns: { is_salut: true, salut_status: true, salut_approved_at: true },
      where: eq(users.id, req.user.id),
    });

    res.write(`data: ${JSON.stringify({
      is_salut: dbUser?.is_salut ?? false,
      is_salut_active: isSalutActive(dbUser?.salut_approved_at ?? null),
      salut_status: dbUser?.salut_status ?? 'none',
    })}\n\n`);
  } catch {
    res.write(`data: ${JSON.stringify({ is_salut: false, is_salut_active: false, salut_status: 'none' })}\n\n`);
  }

  const unsubscribe = subscribeUserStatus(req.user.id, (payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch { /* client gone; 'close' handler will clean up */ }
  });

  // Keep-alive ping every 25s (prevents proxy/load-balancer timeouts)
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
      unsubscribe();
    }
  }, 25_000);

  req.on('close', () => {
    unsubscribe();
    clearInterval(keepAlive);
    res.end();
  });
}

module.exports = { userStatusStream };
