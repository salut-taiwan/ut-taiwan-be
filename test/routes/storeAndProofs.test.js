'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, adminUser, selectChain, insertChain, freshIp,
} = require('../helpers/testApp');

// The merch shop, adding a whole package to a cart, and the signed URLs admins
// use to look at a payment proof. The signed URLs matter most: they are the
// only thing standing between one student's bank slip and another student.

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

const authed = (method, path) =>
  request(app)[method](path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');
const pub = (path) => request(app).get(path).set('X-Forwarded-For', freshIp());

const PRODUCT_ID = '77777777-7777-7777-7777-777777777777';
const PACKAGE_ID = '88888888-8888-8888-8888-888888888888';
const USER_ID = '99999999-9999-9999-9999-999999999999';

describe('browsing the merch shop', () => {
  const product = (over = {}) => ({
    id: PRODUCT_ID, tokopedia_id: 'tp-1', category: 'almet',
    name: 'Almamater UT', base_price: 560, weight_grams: 700,
    claim_rule: null,
    product_images: [
      { image_url: 'https://cdn/2.jpg', sort_order: 2 },
      { image_url: 'https://cdn/1.jpg', sort_order: 1 },
    ],
    ...over,
  });

  function shop({ rows = [product()], count = 1 } = {}) {
    harness = stubBackend({
      user: null,
      query: { products: { findMany: async () => rows, findFirst: async () => rows[0] ?? null } },
      select: selectChain([{ count }]),
    });
    return harness;
  }

  test('the shop is public and reports how many products there are', async () => {
    shop();

    const res = await pub('/api/products');

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.rows.length, 1);
  });

  test('the lowest-sorted image becomes the cover, not whichever came back first', async () => {
    shop();

    const res = await pub('/api/products');

    assert.equal(res.body.rows[0].cover_image_url, 'https://cdn/1.jpg');
  });

  test('a product with no images at all still lists, with no cover', async () => {
    shop({ rows: [product({ product_images: [] })] });

    const res = await pub('/api/products');

    assert.equal(res.status, 200);
    assert.equal(res.body.rows[0].cover_image_url, null);
  });

  test('an empty shop is an empty list, not an error', async () => {
    shop({ rows: [], count: 0 });

    const res = await pub('/api/products');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.rows, []);
    assert.equal(res.body.total, 0);
  });

  test('the page window is echoed back so the client can paginate', async () => {
    shop();

    const res = await pub('/api/products?limit=5&offset=10');

    assert.equal(res.body.limit, 5);
    assert.equal(res.body.offset, 10);
  });

  test('a database failure is reported rather than shown as an empty shop', async () => {
    harness = stubBackend({
      user: null,
      query: { products: { findMany: async () => { throw new Error('connection terminated'); } } },
      select: selectChain([{ count: 0 }]),
    });

    const res = await pub('/api/products');

    assert.equal(res.status, 500);
  });

  test('one product shows its variants with their options in order', async () => {
    harness = stubBackend({
      user: null,
      query: {
        products: {
          findFirst: async () => ({
            ...product(),
            product_images: [
              { id: 'i-2', image_url: 'https://cdn/2.jpg', sort_order: 2 },
              { id: 'i-1', image_url: 'https://cdn/1.jpg', sort_order: 1 },
            ],
            product_variant_types: [
              {
                id: 'vt-2', name: 'Warna', identifier: 'colour', sort_order: 2,
                product_variant_options: [
                  { id: 'o-b', value: 'Biru', hex_color: '#00f', sort_order: 2 },
                  { id: 'o-h', value: 'Hitam', hex_color: '#000', sort_order: 1 },
                ],
              },
              {
                id: 'vt-1', name: 'Ukuran', identifier: 'size', sort_order: 1,
                product_variant_options: [{ id: 'o-m', value: 'M', hex_color: null, sort_order: 1 }],
              },
            ],
            product_skus: [
              { id: 'sku-1', tokopedia_sku_id: 't-1', price: 560, option_names: ['M', 'Hitam'] },
            ],
          }),
        },
      },
      select: selectChain([]),
    });

    const res = await pub(`/api/products/${PRODUCT_ID}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.product_variant_types.map(v => v.identifier), ['size', 'colour']);
    assert.deepEqual(
      res.body.product_variant_types[1].product_variant_options.map(o => o.value),
      ['Hitam', 'Biru'],
    );
    assert.deepEqual(res.body.product_images.map(i => i.image_url), ['https://cdn/1.jpg', 'https://cdn/2.jpg']);
  });

  test('a product that does not exist is a 404, not an empty shell', async () => {
    harness = stubBackend({
      user: null,
      query: { products: { findFirst: async () => null } },
      select: selectChain([]),
    });

    const res = await pub(`/api/products/${PRODUCT_ID}`);

    assert.equal(res.status, 404);
  });
});

describe('adding a whole package to the cart', () => {
  const packageModule = (over = {}) => ({
    modules: { id: 'm-1', price_student: 50000, is_available: true, ...over },
  });

  function cartSetup({ pkg = undefined, insert = insertChain([]) } = {}) {
    const thePackage = pkg === undefined
      ? { id: PACKAGE_ID, is_active: true, package_modules: [packageModule()] }
      : pkg;
    harness = stubBackend({
      user: studentUser(),
      query: {
        packages: { findFirst: async () => thePackage },
        carts: { findFirst: async () => ({ id: 'c-1', user_id: USER_ID }) },
        cart_items: { findMany: async () => [] },
        // The cart DTO reads the member's SALUT state to decide the fee waiver.
        users: { findFirst: async () => ({ id: USER_ID, is_salut: false, salut_status: 'none' }) },
      },
      select: selectChain([]),
      insert,
      rpc: async () => ({ data: 'c-1', error: null }),
    });
    return harness;
  }

  const add = (body) => authed('post', '/api/cart/packages').send(body);

  test('a package puts each of its modules in the cart', async () => {
    const h = cartSetup({
      pkg: {
        id: PACKAGE_ID, is_active: true,
        package_modules: [
          packageModule({ id: 'm-1' }),
          packageModule({ id: 'm-2', price_student: 75000 }),
        ],
      },
    });

    const res = await add({ packageId: PACKAGE_ID });

    assert.equal(res.status, 200);
    assert.equal(h.calls.values[0].length, 2);
  });

  test('adding it twice overwrites rather than doubling the quantities', async () => {
    // A package is a fixed list, so re-adding it must not leave the student
    // with two of every module.
    const h = cartSetup();

    await add({ packageId: PACKAGE_ID });

    assert.ok(h.calls.onConflict[0], 'the insert must upsert');
    assert.deepEqual(h.calls.values[0][0].quantity, 1);
  });

  test('an unpriced module in the package becomes a request, not a free item', async () => {
    const h = cartSetup({
      pkg: {
        id: PACKAGE_ID, is_active: true,
        package_modules: [packageModule({ price_student: null })],
      },
    });

    await add({ packageId: PACKAGE_ID });

    assert.equal(h.calls.values[0][0].is_request, true);
    // An unpriced module snapshots as 0, and is_request is what stops that 0
    // being charged as free — see the deriveModuleCartEntry unit tests.
    assert.equal(h.calls.values[0][0].price_snapshot, 0);
  });

  test('a package with no id is refused', async () => {
    cartSetup();

    const res = await add({});

    assert.equal(res.status, 400);
    assert.match(res.body.error, /packageId/);
  });

  test('an inactive or missing package is a 404', async () => {
    cartSetup({ pkg: null });

    const res = await add({ packageId: PACKAGE_ID });

    assert.equal(res.status, 404);
  });

  test('an empty package is refused rather than silently adding nothing', async () => {
    const h = cartSetup({ pkg: { id: PACKAGE_ID, is_active: true, package_modules: [] } });

    const res = await add({ packageId: PACKAGE_ID });

    assert.equal(res.status, 400);
    assert.equal(h.calls.insert.length, 0);
  });

  test('a package whose modules are all missing is refused too', async () => {
    // package_modules rows can outlive the module they point at.
    const h = cartSetup({
      pkg: { id: PACKAGE_ID, is_active: true, package_modules: [{ modules: null }] },
    });

    const res = await add({ packageId: PACKAGE_ID });

    assert.equal(res.status, 400);
    assert.equal(h.calls.insert.length, 0);
  });

  test('signing in is required', async () => {
    harness = stubBackend({ user: null, select: selectChain([]) });

    const res = await request(app)
      .post('/api/cart/packages')
      .set('X-Forwarded-For', freshIp())
      .send({ packageId: PACKAGE_ID });

    assert.equal(res.status, 401);
  });
});

describe('an admin looking at a SALUT payment proof', () => {
  function proofSetup({ user = { salut_payment_proof_url: 'u/proof.jpg', salut_status: 'pending' }, storage } = {}) {
    harness = stubBackend({
      user: adminUser(),
      query: { users: { findFirst: async () => user } },
      select: selectChain([]),
      storage: storage ?? {
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/proof.jpg' }, error: null }),
      },
    });
    return harness;
  }

  const fetchUrl = () => authed('get', `/api/users/admin/salut/proof-url/${USER_ID}`);

  test('a stored proof comes back as a signed URL', async () => {
    proofSetup();

    const res = await fetchUrl();

    assert.equal(res.status, 200);
    assert.equal(res.body.signedUrl, 'https://signed/proof.jpg');
  });

  test('the URL is short-lived, so a leaked link stops working', async () => {
    const h = proofSetup();

    await fetchUrl();

    const signing = h.calls.storage.find(c => c.op === 'createSignedUrl');
    assert.equal(signing.expiresIn, 300);
    assert.equal(signing.bucket, 'salut-proofs');
  });

  test('an applicant who uploaded nothing is a 404, not a broken image', async () => {
    proofSetup({ user: { salut_payment_proof_url: null, salut_status: 'pending' } });

    const res = await fetchUrl();

    assert.equal(res.status, 404);
    assert.match(res.body.error, /proof/i);
  });

  test('an unknown user is a 404', async () => {
    proofSetup({ user: null });

    const res = await fetchUrl();

    assert.equal(res.status, 404);
  });

  test('a storage failure is reported without leaking the storage error', async () => {
    proofSetup({
      storage: {
        createSignedUrl: async () => ({ data: null, error: { message: 'bucket salut-proofs not found' } }),
      },
    });

    const res = await fetchUrl();

    assert.equal(res.status, 500);
    assert.doesNotMatch(res.body.error, /bucket/);
  });

  test('a student cannot read another student\'s bank slip', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { users: { findFirst: async () => ({ salut_payment_proof_url: 'u/proof.jpg' }) } },
      select: selectChain([]),
    });

    const res = await fetchUrl();

    assert.equal(res.status, 403);
  });

  test('signing out entirely is a 401', async () => {
    harness = stubBackend({ user: null, select: selectChain([]) });

    const res = await request(app)
      .get(`/api/users/admin/salut/proof-url/${USER_ID}`)
      .set('X-Forwarded-For', freshIp());

    assert.equal(res.status, 401);
  });
});
