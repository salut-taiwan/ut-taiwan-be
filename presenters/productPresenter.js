'use strict';

const { formatPriceOrFree, rewriteStorageUrl } = require('../format');

function presentProductListItem(p) {
  return {
    ...p,
    cover_image_url: rewriteStorageUrl(p.cover_image_url),
    base_price_display: formatPriceOrFree(p.base_price),
  };
}

function presentProduct(p) {
  if (!p) return p;
  return {
    ...p,
    product_images: (p.product_images || []).map((img) => ({
      ...img,
      image_url: rewriteStorageUrl(img.image_url),
    })),
    product_skus: (p.product_skus || []).map((sku) => ({
      ...sku,
      price_display: formatPriceOrFree(sku.price),
    })),
    base_price_display: formatPriceOrFree(p.base_price),
  };
}

function presentProductList(list) {
  return Array.isArray(list) ? list.map(presentProductListItem) : list;
}

module.exports = { presentProduct, presentProductList, presentProductListItem };
