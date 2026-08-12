'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, adminUser, insertChain, selectQueue, selectChain, freshIp,
} = require('../helpers/testApp');

// The public read-only catalog: faculties, programs, subjects, modules,
// packages and products. Anonymous visitors browse all of it.

const PROGRAM_ID = '99999999-9999-9999-9999-999999999999';

const moduleRow = (over = {}) => ({
  id: 'm-1', tbo_code: 'MKDU4109', name: 'Bahasa Inggris',
  price_student: 50000, price_general: 60000, is_available: true,
  cover_image_url: null, deleted_at: null, ...over,
});

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({
  user = studentUser(),
  rows = [],
  count = [{ count: 0 }],
  faculty,
  program,
  subject,
  mod,
  pkg,
  modules: moduleList = [],
  insert,
} = {}) {
  harness = stubBackend({
    user,
    query: {
      faculties: { findFirst: async () => faculty, findMany: async () => rows },
      programs: { findFirst: async () => program, findMany: async () => rows },
      subjects: { findFirst: async () => subject, findMany: async () => rows },
      modules: { findFirst: async () => mod, findMany: async () => moduleList },
      packages: { findFirst: async () => pkg, findMany: async () => rows },
      products: { findFirst: async () => undefined, findMany: async () => rows },
    },
    select: selectQueue([rows, count]),
    insert: insert ?? insertChain([moduleRow()]),
  });
  return harness;
}

const pub = (path) => request(app).get(path).set('X-Forwarded-For', freshIp());
const authed = (method, path) =>
  request(app)[method](path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');

describe('catalog browsing is public', () => {
  test('faculties need no account', async () => {
    setup({ rows: [{ id: 'f-1', code: 'FST', name: 'Sains dan Teknologi', description: null }] });
    const res = await pub('/api/catalog/faculties');
    assert.equal(res.status, 200);
    assert.equal(res.body[0].code, 'FST');
  });

  test('programs can be filtered by faculty code', async () => {
    setup({ faculty: { id: 'f-1' }, rows: [{ id: PROGRAM_ID, code: 'S1SI', name: 'Sistem Informasi' }] });
    const res = await pub('/api/catalog/programs?facultyCode=FST');
    assert.equal(res.status, 200);
  });

  test('an unknown faculty code is a 404 rather than an empty list', async () => {
    setup({ faculty: null });
    const res = await pub('/api/catalog/programs?facultyCode=NOPE');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Fakultas tidak ditemukan');
  });

  test('an unknown program is a 404', async () => {
    setup({ program: null });
    const res = await pub(`/api/catalog/programs/${PROGRAM_ID}`);
    assert.equal(res.status, 404);
  });

  test('a faculty listing failure is a 500, not a blank page', async () => {
    harness = stubBackend({
      user: studentUser(),
      select: () => { throw new Error('db down'); },
    });
    const res = await pub('/api/catalog/faculties');
    assert.equal(res.status, 500);
  });
});

describe('module catalog', () => {
  test('the list is public and paginated', async () => {
    setup({ rows: [moduleRow()], count: [{ total: 1 }] });
    const res = await pub('/api/modules');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.page, 1);
  });

  test('a search term must be long enough to be worth running', async () => {
    setup();
    const res = await pub('/api/modules/search?q=a');
    assert.equal(res.status, 400);
  });

  test('an unknown module is a 404', async () => {
    setup({ mod: null });
    const res = await pub('/api/modules/m-404');
    assert.equal(res.status, 404);
  });

  test('a student cannot create a module', async () => {
    setup({ user: studentUser() });
    const res = await authed('post', '/api/modules').send({ tbo_code: 'X', name: 'Y' });
    assert.equal(res.status, 403);
  });

  const newModule = {
    tbo_code: 'MKDU4109', name: 'Bahasa Inggris', price_student: 50000, price_general: 60000,
  };

  test('an admin creating a module must supply a code, a name and both prices', async () => {
    setup({ user: adminUser() });
    for (const field of ['tbo_code', 'name', 'price_student', 'price_general']) {
      const res = await authed('post', '/api/modules').send({ ...newModule, [field]: undefined });
      assert.equal(res.status, 400, `${field} should be required`);
    }
  });

  test('a zero price is accepted — it means "not priced yet", not "missing"', async () => {
    setup({ user: adminUser() });
    const res = await authed('post', '/api/modules').send({ ...newModule, price_student: 0 });
    assert.equal(res.status, 201);
  });

  test('the module code is normalised to upper case', async () => {
    const h = setup({ user: adminUser() });
    await authed('post', '/api/modules').send({ ...newModule, tbo_code: ' mkdu4109 ' });
    assert.equal(h.calls.values[0].tbo_code, 'MKDU4109');
  });

  test('the publisher defaults to Universitas Terbuka', async () => {
    const h = setup({ user: adminUser() });
    await authed('post', '/api/modules').send(newModule);
    assert.equal(h.calls.values[0].publisher, 'Universitas Terbuka');
  });

  test('a duplicate code is reported as a conflict, not a server error', async () => {
    const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
    setup({ user: adminUser(), insert: () => { throw dup; } });
    const res = await authed('post', '/api/modules').send(newModule);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Kode TBO sudah terdaftar');
  });
});

describe('packages', () => {
  test('the list is public', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { packages: { findMany: async () => [], findFirst: async () => undefined } },
      select: selectChain([{ count: 0 }]),
    });
    const res = await pub('/api/packages');
    assert.equal(res.status, 200);
  });

  test('a malformed program filter is ignored rather than erroring', async () => {
    // Anything that is not a uuid simply does not narrow the list — a bad query
    // string from a stale bookmark still renders a page.
    harness = stubBackend({
      user: studentUser(),
      query: { packages: { findMany: async () => [], findFirst: async () => undefined } },
      select: selectChain([{ count: 0 }]),
    });
    const res = await pub('/api/packages?programId=not-a-uuid');
    assert.equal(res.status, 200);
  });

  test('an unknown package is a 404', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { packages: { findFirst: async () => null, findMany: async () => [] } },
      select: selectChain([{ count: 0 }]),
    });
    const res = await pub('/api/packages/p-404');
    assert.equal(res.status, 404);
  });

  test('a student cannot trigger a package rebuild', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { packages: { findMany: async () => [] } },
      select: selectChain([]),
    });
    const res = await authed('post', '/api/packages/sync');
    assert.equal(res.status, 403);
  });
});

describe('products', () => {
  test('the shop list is public', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { products: { findMany: async () => [], findFirst: async () => undefined } },
      select: selectQueue([[], [{ count: 0 }]]),
    });
    const res = await pub('/api/products');
    assert.equal(res.status, 200);
  });

  test('an unknown product is a 404', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { products: { findFirst: async () => null, findMany: async () => [] } },
      select: selectQueue([[], [{ count: 0 }]]),
    });
    const res = await pub('/api/products/p-404');
    assert.equal(res.status, 404);
  });
});
