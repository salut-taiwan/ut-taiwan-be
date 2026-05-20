'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

before(() => {
  process.env.API_PUBLIC_URL = 'https://api.example.com';
});

const { presentPackage } = require('../../presenters/packagePresenter');

const NBSP = '\u00a0';

function pkg(over = {}) {
  return {
    id: 'p1',
    name: 'Paket Semester 1',
    semester: 1,
    program_id: 'prog-1',
    package_modules: [
      { modules: { id: 'm1', is_available: true, price_student: 50000, cover_image_url: 'https://abc.supabase.co/storage/v1/object/public/m/a.jpg' } },
      { modules: { id: 'm2', is_available: true, price_student: 30000, cover_image_url: null } },
      { modules: { id: 'm3', is_available: false, price_student: 20000, cover_image_url: null } },
    ],
    totalPrice: 100000,
    ...over,
  };
}

describe('presentPackage', () => {
  test('counts available + request modules', () => {
    const out = presentPackage(pkg());
    assert.equal(out.available_count, 2);
    assert.equal(out.request_count, 1);
    assert.equal(out.total_modules, 3);
  });

  test('summary_label with both counts', () => {
    const out = presentPackage(pkg());
    assert.equal(out.summary_label, '2 langsung tersedia · 1 request');
  });

  test('summary_label when all available', () => {
    const out = presentPackage(pkg({
      package_modules: [
        { modules: { id: 'm1', is_available: true, price_student: 100, cover_image_url: null } },
        { modules: { id: 'm2', is_available: true, price_student: 100, cover_image_url: null } },
      ],
    }));
    assert.equal(out.available_count, 2);
    assert.equal(out.request_count, 0);
    assert.equal(out.summary_label, 'Semua langsung tersedia');
  });

  test('summary_label when all request', () => {
    const out = presentPackage(pkg({
      package_modules: [
        { modules: { id: 'm1', is_available: false, price_student: 100, cover_image_url: null } },
      ],
    }));
    assert.equal(out.available_count, 0);
    assert.equal(out.request_count, 1);
    assert.equal(out.summary_label, 'Semua memerlukan request');
  });

  test('summary_label when empty', () => {
    const out = presentPackage(pkg({ package_modules: [] }));
    assert.equal(out.total_modules, 0);
    assert.equal(out.summary_label, 'Tidak ada modul');
  });

  test('adds totalPrice_display', () => {
    const out = presentPackage(pkg());
    assert.equal(out.totalPrice_display, `Rp${NBSP}100.000`);
  });

  test('rewrites module cover_image_url to proxy URL', () => {
    const out = presentPackage(pkg());
    assert.equal(
      out.package_modules[0].modules.cover_image_url,
      'https://api.example.com/api/storage/v1/object/public/m/a.jpg'
    );
  });

  test('null cover_image_url stays null', () => {
    const out = presentPackage(pkg());
    assert.equal(out.package_modules[1].modules.cover_image_url, null);
  });
});
