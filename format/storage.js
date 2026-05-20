'use strict';

const SUPABASE_HOST_RE = /^https:\/\/[^/]+\.supabase\.co\/storage\/(.+)$/;

function getApiPublicUrl() {
  const v = process.env.API_PUBLIC_URL;
  if (!v) return '';
  return v.endsWith('/') ? v.slice(0, -1) : v;
}

function rewriteStorageUrl(url) {
  if (url === null || url === undefined || url === '') return null;
  if (typeof url !== 'string') return url;

  const apiBase = getApiPublicUrl();
  if (apiBase && url.startsWith(`${apiBase}/api/storage/`)) {
    return url;
  }

  const m = url.match(SUPABASE_HOST_RE);
  if (!m) return url;

  return `${apiBase}/api/storage/${m[1]}`;
}

module.exports = { rewriteStorageUrl };
