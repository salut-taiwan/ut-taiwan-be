'use strict';

const env = require('../config/env');

/**
 * Streams Supabase Storage objects through this server.
 *
 * Why: lets DTOs return URLs anchored to this API instead of leaking the
 * Supabase project URL to the frontend, and avoids the public-bucket URL
 * being scattered across pages. Cache-Control: public, max-age=31536000,
 * immutable mirrors the prior Next.js route at app/api/storage/[...].
 *
 * Security: path is concatenated to a fixed SUPABASE_URL/storage/ prefix —
 * no SSRF risk because the host is hard-coded.
 */
async function proxyStorage(req, res) {
  // req.params[0] is everything matched by '*'
  const path = req.params[0] || '';
  if (!env.SUPABASE_URL) {
    return res.status(500).json({ error: 'SUPABASE_URL not configured' });
  }

  const upstream = `${env.SUPABASE_URL}/storage/${path}`;
  try {
    const upstreamRes = await fetch(upstream);
    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).end();
    }
    res.setHeader(
      'Content-Type',
      upstreamRes.headers.get('Content-Type') || 'application/octet-stream'
    );
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Stream the body. fetch in Node 18+ exposes res.body as a ReadableStream.
    const reader = upstreamRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('[storage proxy]', err.message);
    res.status(502).json({ error: 'Gagal mengambil file' });
  }
}

module.exports = { proxyStorage };
