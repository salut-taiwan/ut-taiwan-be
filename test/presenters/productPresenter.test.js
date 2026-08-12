'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  presentProduct,
  presentProductList,
  presentProductListItem,
} = require('../../presenters/productPresenter');

const NBSP = '\u00a0';
const SUPABASE_URL = 'https://project.supabase.co/storage/v1/object/public/products/almet.jpg';

const listRow = (over = {}) => ({
  id: 'p-1',
  category: 'jas-almamater',
  name: 'Jas Almamater UT',
  base_price: 350000,
  cover_image_url: SUPABASE_URL,
  claim_rule: null,
  ...over,
});

describe('presentProductListItem', () => {
  test('rewrites the cover image to the proxy path and keeps every other field', () => {
    const out = presentProductListItem(listRow());
    assert.ok(out.cover_image_url.startsWith('/api/storage/'));
    assert.equal(out.id, 'p-1');
    assert.equal(out.category, 'jas-almamater');
    assert.equal(out.name, 'Jas Almamater UT');
    assert.equal(out.base_price, 350000);
  });

  test('a missing cover image stays null rather than becoming a broken path', () => {
    assert.equal(presentProductListItem(listRow({ cover_image_url: null })).cover_image_url, null);
  });

  test('a priced product renders its price as IDR', () => {
    assert.equal(presentProductListItem(listRow()).base_price_display, `Rp${NBSP}350.000`);
  });

  test('the free SALUT almet renders as "Gratis", not "Rp 0"', () => {
    assert.equal(presentProductListItem(listRow({ base_price: 0 })).base_price_display, 'Gratis');
  });

  test('a numeric-string price is coerced before formatting', () => {
    assert.equal(presentProductListItem(listRow({ base_price: '0.00' })).base_price_display, 'Gratis');
    assert.equal(presentProductListItem(listRow({ base_price: '350000.00' })).base_price_display, `Rp${NBSP}350.000`);
  });

  test('claim_rule passes through — the frontend gates the claim CTA on it', () => {
    assert.equal(presentProductListItem(listRow({ claim_rule: 'salut_sem1_once' })).claim_rule, 'salut_sem1_once');
  });
});

describe('presentProduct', () => {
  const detail = (over = {}) => ({
    ...listRow(),
    product_images: [{ id: 'i-1', image_url: SUPABASE_URL, sort_order: 0 }],
    product_skus: [{ id: 's-1', price: 350000, option_names: ['L'] }],
    ...over,
  });

  test('a falsy product is returned untouched so the caller can 404', () => {
    assert.equal(presentProduct(null), null);
    assert.equal(presentProduct(undefined), undefined);
  });

  test('every gallery image is rewritten to the proxy', () => {
    const out = presentProduct(detail({
      product_images: [
        { id: 'i-1', image_url: SUPABASE_URL, sort_order: 0 },
        { id: 'i-2', image_url: SUPABASE_URL, sort_order: 1 },
      ],
    }));
    for (const img of out.product_images) assert.ok(img.image_url.startsWith('/api/storage/'));
  });

  test('image metadata other than the url survives the rewrite', () => {
    const [img] = presentProduct(detail()).product_images;
    assert.equal(img.id, 'i-1');
    assert.equal(img.sort_order, 0);
  });

  test('every SKU gains a price display', () => {
    const out = presentProduct(detail({
      product_skus: [
        { id: 's-1', price: 350000, option_names: ['L'] },
        { id: 's-2', price: 0, option_names: ['XL'] },
      ],
    }));
    assert.equal(out.product_skus[0].price_display, `Rp${NBSP}350.000`);
    assert.equal(out.product_skus[1].price_display, 'Gratis');
  });

  test('SKU option names are preserved for variant matching', () => {
    const [sku] = presentProduct(detail()).product_skus;
    assert.deepEqual(sku.option_names, ['L']);
  });

  test('missing images or SKUs default to empty arrays instead of throwing', () => {
    const out = presentProduct({ id: 'p-2', base_price: 0 });
    assert.deepEqual(out.product_images, []);
    assert.deepEqual(out.product_skus, []);
  });
});

describe('presentProductList', () => {
  test('maps every row', () => {
    const out = presentProductList([listRow(), listRow({ id: 'p-2' })]);
    assert.equal(out.length, 2);
    assert.equal(out[1].id, 'p-2');
    for (const row of out) assert.ok(row.base_price_display);
  });

  test('a non-array is passed through unchanged so an error payload survives', () => {
    assert.equal(presentProductList(null), null);
    assert.equal(presentProductList(undefined), undefined);
  });

  test('an empty list stays empty', () => {
    assert.deepEqual(presentProductList([]), []);
  });
});
