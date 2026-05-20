'use strict';

const { formatIDR, rewriteStorageUrl } = require('../format');

function summaryLabel(availableCount, requestCount, total) {
  if (total === 0) return 'Tidak ada modul';
  if (requestCount === 0) return 'Semua langsung tersedia';
  if (availableCount === 0) return 'Semua memerlukan request';
  return `${availableCount} langsung tersedia · ${requestCount} request`;
}

function presentPackage(pkg) {
  const mods = pkg.package_modules || [];
  let available = 0;
  let request = 0;

  const decoratedMods = mods.map((pm) => {
    const m = pm.modules;
    if (m) {
      if (m.is_available) available += 1;
      else request += 1;
    }
    return {
      ...pm,
      modules: m
        ? { ...m, cover_image_url: rewriteStorageUrl(m.cover_image_url) }
        : null,
    };
  });
  const total = decoratedMods.filter((pm) => pm.modules).length;

  return {
    ...pkg,
    package_modules: decoratedMods,
    available_count: available,
    request_count: request,
    total_modules: total,
    summary_label: summaryLabel(available, request, total),
    totalPrice_display: formatIDR(pkg.totalPrice ?? 0),
  };
}

module.exports = { presentPackage };
