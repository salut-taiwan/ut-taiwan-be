'use strict';

const SUPABASE_HOST_RE = /^https:\/\/[^/]+\.supabase\.co\/storage\/(.+)$/;

/**
 * Rewrites Supabase storage URLs to the proxied `/api/storage/<path>` form.
 *
 * Returns a RELATIVE URL on purpose: the browser loads it from whatever
 * origin the frontend is served from (Next.js dev or prod), and Next.js
 * is configured to rewrite `/api/storage/*` to the backend's storage proxy.
 * This avoids CORS, CORP, and Next.js `images.remotePatterns` headaches
 * that would arise if we emitted absolute URLs to the backend's origin.
 *
 * Idempotent: paths that are already `/api/storage/...` pass through
 * unchanged. Non-Supabase URLs (Tokopedia, etc.) pass through unchanged.
 */
function rewriteStorageUrl(url) {
  if (url === null || url === undefined || url === '') return null;
  if (typeof url !== 'string') return url;
  if (url.startsWith('/api/storage/')) return url;
  const m = url.match(SUPABASE_HOST_RE);
  if (!m) return url;
  return `/api/storage/${m[1]}`;
}

module.exports = { rewriteStorageUrl };
