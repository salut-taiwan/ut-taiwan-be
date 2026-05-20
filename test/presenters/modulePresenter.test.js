'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { presentModule, presentModuleList } = require('../../presenters/modulePresenter');

const NBSP = '\u00a0';

describe('presentModule', () => {
  test('adds price_student_display and rewrites cover URL', () => {
    const out = presentModule({
      id: 'm1',
      tbo_code: 'MKDU4109',
      name: 'Bahasa Inggris',
      price_student: 50000,
      price_general: 75000,
      cover_image_url: 'https://abc.supabase.co/storage/v1/object/public/m/foo.jpg',
      is_available: true,
    });
    assert.equal(out.price_student_display, `Rp${NBSP}50.000`);
    assert.equal(out.price_general_display, `Rp${NBSP}75.000`);
    assert.equal(out.cover_image_url, '/api/storage/v1/object/public/m/foo.jpg');
  });

  test('null price -> null display', () => {
    const out = presentModule({ id: 'm', price_student: null, price_general: null, cover_image_url: null });
    assert.equal(out.price_student_display, null);
    assert.equal(out.price_general_display, null);
    assert.equal(out.cover_image_url, null);
  });

  test('preserves all raw fields', () => {
    const raw = { id: 'm', tbo_code: 'X', name: 'Y', is_available: true, price_student: 100, price_general: 200, cover_image_url: null };
    const out = presentModule(raw);
    for (const k of Object.keys(raw)) {
      if (k === 'cover_image_url' || k === 'price_student' || k === 'price_general') continue;
      assert.equal(out[k], raw[k]);
    }
  });
});

describe('presentModuleList', () => {
  test('maps array', () => {
    const out = presentModuleList([
      { id: 'a', price_student: 1000, cover_image_url: null },
      { id: 'b', price_student: 2000, cover_image_url: null },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].price_student_display, `Rp${NBSP}1.000`);
  });

  test('passes through non-array unchanged', () => {
    assert.equal(presentModuleList(null), null);
  });
});
