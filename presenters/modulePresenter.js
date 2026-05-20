'use strict';

const { formatIDR, rewriteStorageUrl } = require('../format');

function presentModule(m) {
  if (!m) return m;
  return {
    ...m,
    cover_image_url: rewriteStorageUrl(m.cover_image_url),
    price_student_display: m.price_student != null ? formatIDR(Number(m.price_student)) : null,
    price_general_display: m.price_general != null ? formatIDR(Number(m.price_general)) : null,
  };
}

function presentModuleList(list) {
  return Array.isArray(list) ? list.map(presentModule) : list;
}

module.exports = { presentModule, presentModuleList };
