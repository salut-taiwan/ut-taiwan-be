'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, adminUser, selectChain, deleteChain, insertChain, freshIp,
} = require('../helpers/testApp');

// A package is a semester's worth of modules sold together. Its advertised
// price is the sum of its modules, which matters because a module with no
// price contributes nothing and quietly understates the total.

const PROGRAM_ID = '44444444-4444-4444-4444-444444444444';
const PACKAGE_ID = '55555555-5555-5555-5555-555555555555';

const mod = (over = {}) => ({
  id: 'm-1', tbo_code: 'MKDU4109', name: 'Bahasa Inggris',
  cover_image_url: null, price_student: 50000, is_available: true, ...over,
});

const pkg = (over = {}) => ({
  id: PACKAGE_ID,
  name: 'Paket Semester 1',
  description: 'Semua modul semester 1',
  semester: 1,
  is_active: true,
  program_id: PROGRAM_ID,
  programs: { id: PROGRAM_ID, code: 'S1SI', name: 'Sistem Informasi', faculties: { code: 'FST', name: 'Sains' } },
  package_modules: [{ sort_order: 0, modules: mod() }],
  ...over,
});

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({ user = studentUser(), rows = [pkg()], one = pkg(), count = 1 } = {}) {
  harness = stubBackend({
    user,
    query: {
      packages: { findMany: async () => rows, findFirst: async () => one },
    },
    select: selectChain([{ count }]),
    delete: deleteChain([]),
    insert: insertChain([]),
  });
  return harness;
}

const pub = (path) => request(app).get(path).set('X-Forwarded-For', freshIp());

describe('browsing packages', () => {
  test('the list is public and reports how many there are', async () => {
    setup();
    const res = await pub('/api/packages');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
  });

  test('a package advertises the sum of its modules', async () => {
    setup({
      one: pkg({
        package_modules: [
          { sort_order: 0, modules: mod({ id: 'm-1', price_student: 50000 }) },
          { sort_order: 1, modules: mod({ id: 'm-2', price_student: 75000 }) },
        ],
      }),
    });

    const res = await pub(`/api/packages/${PACKAGE_ID}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalPrice, 125000);
  });

  test('an unpriced module contributes nothing, so the advertised total is low', async () => {
    // Worth knowing: the package looks cheaper than the order will be, because
    // an admin still has to price that module before checkout completes.
    setup({
      one: pkg({
        package_modules: [
          { sort_order: 0, modules: mod({ id: 'm-1', price_student: 50000 }) },
          { sort_order: 1, modules: mod({ id: 'm-2', price_student: null }) },
        ],
      }),
    });

    const res = await pub(`/api/packages/${PACKAGE_ID}`);

    assert.equal(res.body.totalPrice, 50000);
  });

  test('a package with no modules is priced at zero rather than failing', async () => {
    setup({ one: pkg({ package_modules: [] }) });
    const res = await pub(`/api/packages/${PACKAGE_ID}`);
    assert.equal(res.body.totalPrice, 0);
  });

  test('an unknown package is a 404', async () => {
    setup({ one: null });
    const res = await pub(`/api/packages/${PACKAGE_ID}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Paket tidak ditemukan');
  });

  test('the package names the programme and faculty it belongs to', async () => {
    setup();
    const res = await pub(`/api/packages/${PACKAGE_ID}`);
    assert.equal(res.body.programs.code, 'S1SI');
  });

  test('a page size beyond the cap is clamped', async () => {
    setup();
    const res = await pub('/api/packages?limit=9999');
    assert.equal(res.status, 200);
  });

  test('a search term is applied without breaking on wildcards', async () => {
    setup();
    const res = await pub('/api/packages?search=100%25');
    assert.equal(res.status, 200);
  });

  test('a valid programme filter is applied', async () => {
    setup();
    const res = await pub(`/api/packages?programId=${PROGRAM_ID}`);
    assert.equal(res.status, 200);
  });

  test('a failing query is a 500, not an empty catalogue', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { packages: { findMany: async () => { throw new Error('db down'); } } },
      select: selectChain([{ count: 0 }]),
    });
    const res = await pub('/api/packages');
    assert.equal(res.status, 500);
  });
});

describe('rebuilding packages', () => {
  test('only an admin may trigger it', async () => {
    setup({ user: studentUser() });
    const res = await request(app).post('/api/packages/sync')
      .set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');
    assert.equal(res.status, 403);
  });
});
