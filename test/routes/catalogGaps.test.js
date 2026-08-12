'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, adminUser, selectChain, selectQueue,
  deleteChain, insertChain, freshIp,
} = require('../helpers/testApp');

// The endpoints students reach before they ever place an order: module search,
// the guide library, and the package-to-module sync an admin runs after the
// scraper. Each of these was reachable in production with nothing exercising
// it.

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

const pub = (path) => request(app).get(path).set('X-Forwarded-For', freshIp());
const post = (path) =>
  request(app).post(path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');

const mod = (over = {}) => ({
  id: 'm-1', tbo_code: 'MKDU4109', name: 'Bahasa Inggris I',
  edition: '2', cover_image_url: null, price_student: 50000,
  is_available: true, ...over,
});

describe('searching for a module', () => {
  test('a real search returns matches', async () => {
    harness = stubBackend({ user: null, select: selectChain([mod()]) });

    const res = await pub('/api/modules/search?q=bahasa');

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].tbo_code, 'MKDU4109');
  });

  test('a one-letter query is refused rather than scanning the whole catalogue', async () => {
    harness = stubBackend({ user: null, select: selectChain([]) });

    const res = await pub('/api/modules/search?q=b');

    assert.equal(res.status, 400);
    assert.match(res.body.error, /minimal 2 karakter/);
  });

  test('a query of only spaces is refused too', async () => {
    harness = stubBackend({ user: null, select: selectChain([]) });

    const res = await pub('/api/modules/search?q=%20%20%20');

    assert.equal(res.status, 400);
  });

  test('no query at all is refused', async () => {
    harness = stubBackend({ user: null, select: selectChain([]) });

    const res = await pub('/api/modules/search');

    assert.equal(res.status, 400);
  });

  test('searching is public — no sign-in needed to browse', async () => {
    harness = stubBackend({ user: null, select: selectChain([mod()]) });

    const res = await pub('/api/modules/search?q=bahasa');

    assert.equal(res.status, 200);
  });

  test('a database failure reports an error rather than an empty result set', async () => {
    // An empty array would read as "no such module", sending the student off
    // to request one that already exists.
    harness = stubBackend({
      user: null,
      select: () => { throw new Error('connection terminated'); },
    });

    const res = await pub('/api/modules/search?q=bahasa');

    assert.equal(res.status, 500);
  });

  test('a module with no price is shown as needing a request, not as free', async () => {
    harness = stubBackend({ user: null, select: selectChain([mod({ price_student: null })]) });

    const res = await pub('/api/modules/search?q=bahasa');

    assert.equal(res.status, 200);
    assert.notEqual(res.body[0]._display?.price, 'Gratis');
  });
});

describe('the guide library', () => {
  test('it lists categories without a sign-in', async () => {
    harness = stubBackend({ user: null });

    const res = await pub('/api/panduan');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
  });

  test('every guide carries a title and a reachable URL', async () => {
    harness = stubBackend({ user: null });

    const res = await pub('/api/panduan');

    for (const category of res.body) {
      assert.ok(category.id, 'category needs an id');
      assert.ok(category.guides.length > 0, `${category.id} has no guides`);
      for (const guide of category.guides) {
        assert.ok(guide.title, 'guide needs a title');
        assert.match(guide.url, /^https?:\/\//);
        assert.match(guide.url, /\.pdf$/);
      }
    }
  });
});

describe('linking packages to their modules', () => {
  // syncPackages rebuilds every package's module list from the program and
  // semester. It deletes all the links first, so a half-finished run leaves
  // packages empty — worth knowing exactly what it does.
  const asAdmin = () => post('/api/packages/sync');

  function syncSetup({ packages: pkgs = [], selects = [], insert = insertChain([]) } = {}) {
    harness = stubBackend({
      user: adminUser(),
      select: selectQueue([pkgs, ...selects]),
      delete: deleteChain([]),
      insert,
    });
    return harness;
  }

  test('with no packages at all it does nothing and says so', async () => {
    // Notably it returns before the delete, so an empty catalogue cannot wipe
    // links that a concurrent import just wrote.
    const h = syncSetup({ packages: [] });

    const res = await asAdmin();

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { linked: 0, packages: 0 });
    assert.equal(h.calls.delete.length, 0);
  });

  test('a package linked to its subjects\' modules reports what it linked', async () => {
    const h = syncSetup({
      packages: [{ id: 'pk-1', program_id: 'pr-1', semester: 1 }],
      selects: [
        [{ id: 's-1' }],                                  // subjects
        [{ module_id: 'm-1' }, { module_id: 'm-2' }],     // subject_modules
      ],
    });

    const res = await asAdmin();

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { linked: 2, packages: 1 });
    assert.equal(h.calls.delete.length, 1, 'stale links must be cleared first');
    assert.equal(h.calls.values[0].length, 2);
  });

  test('a module reached through two subjects is linked once, not twice', async () => {
    const h = syncSetup({
      packages: [{ id: 'pk-1', program_id: 'pr-1', semester: 1 }],
      selects: [
        [{ id: 's-1' }, { id: 's-2' }],
        [{ module_id: 'm-1' }, { module_id: 'm-1' }, { module_id: 'm-2' }],
      ],
    });

    const res = await asAdmin();

    assert.equal(res.body.linked, 2);
    assert.equal(h.calls.values[0].length, 2);
  });

  test('links are numbered from one so the package reads in a stable order', async () => {
    const h = syncSetup({
      packages: [{ id: 'pk-1', program_id: 'pr-1', semester: 1 }],
      selects: [[{ id: 's-1' }], [{ module_id: 'm-1' }, { module_id: 'm-2' }]],
    });

    await asAdmin();

    assert.deepEqual(h.calls.values[0].map(r => r.sort_order), [1, 2]);
  });

  test('a package with no program is skipped rather than linked to everything', async () => {
    const h = syncSetup({ packages: [{ id: 'pk-1', program_id: null, semester: 1 }] });

    const res = await asAdmin();

    assert.deepEqual(res.body, { linked: 0, packages: 1 });
    assert.equal(h.calls.insert.length, 0);
  });

  test('a package with no semester is skipped too', async () => {
    const h = syncSetup({ packages: [{ id: 'pk-1', program_id: 'pr-1', semester: null }] });

    const res = await asAdmin();

    assert.deepEqual(res.body, { linked: 0, packages: 1 });
    assert.equal(h.calls.insert.length, 0);
  });

  test('a semester with no subjects yet links nothing', async () => {
    const h = syncSetup({
      packages: [{ id: 'pk-1', program_id: 'pr-1', semester: 9 }],
      selects: [[]],
    });

    const res = await asAdmin();

    assert.equal(res.body.linked, 0);
    assert.equal(h.calls.insert.length, 0);
  });

  test('subjects whose modules are not yet imported link nothing', async () => {
    const h = syncSetup({
      packages: [{ id: 'pk-1', program_id: 'pr-1', semester: 1 }],
      selects: [[{ id: 's-1' }], []],
    });

    const res = await asAdmin();

    assert.equal(res.body.linked, 0);
    assert.equal(h.calls.insert.length, 0);
  });

  test('one package failing to insert does not abandon the rest', async () => {
    // The whole run is not transactional, so giving up halfway would leave
    // most of the catalogue with no modules at all.
    let call = 0;
    syncSetup({
      packages: [
        { id: 'pk-1', program_id: 'pr-1', semester: 1 },
        { id: 'pk-2', program_id: 'pr-1', semester: 2 },
      ],
      selects: [
        [{ id: 's-1' }], [{ module_id: 'm-1' }],
        [{ id: 's-2' }], [{ module_id: 'm-2' }],
      ],
      insert: () => {
        call += 1;
        if (call === 1) throw new Error('duplicate key');
        return insertChain([])();
      },
    });

    const res = await asAdmin();

    assert.equal(res.status, 200);
    assert.equal(res.body.packages, 2);
    assert.equal(res.body.linked, 1, 'only the package that inserted counts');
  });

  test('a student cannot rebuild the catalogue', async () => {
    harness = stubBackend({ user: studentUser(), select: selectChain([]) });

    const res = await asAdmin();

    assert.equal(res.status, 403);
  });

  test('a failure reading the packages is reported, not swallowed', async () => {
    harness = stubBackend({
      user: adminUser(),
      select: () => { throw new Error('connection terminated'); },
    });

    const res = await asAdmin();

    assert.equal(res.status, 500);
  });
});
