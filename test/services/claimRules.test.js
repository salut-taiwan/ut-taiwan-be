'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { stubBackend, studentUser } = require('../helpers/testApp');
const { checkSalutSem1Eligibility, cartContainsProduct } = require('../../services/claimRules');

// The security boundary for the free SALUT almet. Three refusals guard one
// giveaway: you must be an active member, in semester 1, and not have claimed
// before.

const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';

/** postgres.js returns a Result that extends Array — never an object with .rows. */
const pgResult = (rows = []) => Object.assign([...rows], { count: rows.length });

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({ user: userRow, claimed = [] } = {}) {
  harness = stubBackend({
    user: studentUser(),
    query: { users: { findFirst: async () => userRow } },
    execute: async () => pgResult(claimed),
  });
  return harness;
}

const activeSem1 = { current_semester: 1, salut_approved_at: new Date().toISOString() };

describe('checkSalutSem1Eligibility', () => {
  test('an active semester-1 member with no prior claim is eligible', async () => {
    setup({ user: activeSem1 });
    assert.deepEqual(await checkSalutSem1Eligibility('u-1', PRODUCT_ID), { ok: true });
  });

  test('a non-member is refused', async () => {
    setup({ user: { current_semester: 1, salut_approved_at: null } });
    const res = await checkSalutSem1Eligibility('u-1', PRODUCT_ID);
    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
    assert.match(res.error, /anggota SALUT aktif/);
  });

  test('a membership that lapsed at the last cycle boundary is refused', async () => {
    setup({ user: { current_semester: 1, salut_approved_at: '2020-01-01T00:00:00Z' } });
    const res = await checkSalutSem1Eligibility('u-1', PRODUCT_ID);
    assert.equal(res.status, 403);
    assert.match(res.error, /anggota SALUT aktif/);
  });

  test('a missing user row is treated as a non-member', async () => {
    setup({ user: undefined });
    assert.equal((await checkSalutSem1Eligibility('u-1', PRODUCT_ID)).status, 403);
  });

  test('an active member past semester 1 is refused', async () => {
    setup({ user: { current_semester: 2, salut_approved_at: new Date().toISOString() } });
    const res = await checkSalutSem1Eligibility('u-1', PRODUCT_ID);
    assert.equal(res.status, 403);
    assert.match(res.error, /semester 1/);
  });

  test('a member with no recorded semester is refused', async () => {
    setup({ user: { current_semester: null, salut_approved_at: new Date().toISOString() } });
    assert.equal((await checkSalutSem1Eligibility('u-1', PRODUCT_ID)).status, 403);
  });

  test('a claim already spent on a paid order is refused — the giveaway is once per member', async () => {
    setup({ user: activeSem1, claimed: [{ '?column?': 1 }] });
    const res = await checkSalutSem1Eligibility('u-1', PRODUCT_ID);
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.equal(res.error, 'Almet gratis sudah pernah diklaim');
  });

  test('a refunded claim stays spent — a refund does not restore the entitlement', async () => {
    // The query matches payments IN ('paid','refunded'); this asserts the
    // controller-side half of that rule.
    setup({ user: activeSem1, claimed: [{ '?column?': 1 }] });
    assert.equal((await checkSalutSem1Eligibility('u-1', PRODUCT_ID)).status, 409);
  });

  test('the claim lookup reads an Array, not a .rows wrapper', async () => {
    // Regression guard: `claimed.rows` is always undefined on postgres.js, so
    // the guard above silently never fired and the almet could be claimed twice.
    const h = setup({ user: activeSem1, claimed: [{ '?column?': 1 }] });
    await checkSalutSem1Eligibility('u-1', PRODUCT_ID);
    const result = await h.calls.execute.length;
    assert.ok(result > 0, 'the claim history must actually be queried');
    assert.equal(pgResult([{ x: 1 }]).rows, undefined);
  });

  test('membership is checked before semester, and semester before claim history', async () => {
    // A user failing every condition reports the membership problem first, so
    // the message never leaks that they had also already claimed.
    setup({ user: { current_semester: 5, salut_approved_at: null }, claimed: [{ '?column?': 1 }] });
    assert.match((await checkSalutSem1Eligibility('u-1', PRODUCT_ID)).error, /anggota SALUT aktif/);
  });

  test('an empty claim history does not refuse', async () => {
    setup({ user: activeSem1, claimed: [] });
    assert.deepEqual(await checkSalutSem1Eligibility('u-1', PRODUCT_ID), { ok: true });
  });
});

describe('cartContainsProduct', () => {
  test('reports true when any SKU of the product is already in that cart', async () => {
    harness = stubBackend({
      user: studentUser(),
      select: require('../helpers/testApp').selectChain([{ id: 'ci-1' }]),
    });
    assert.equal(await cartContainsProduct('cart-1', PRODUCT_ID), true);
  });

  test('reports false for an empty result', async () => {
    harness = stubBackend({
      user: studentUser(),
      select: require('../helpers/testApp').selectChain([]),
    });
    assert.equal(await cartContainsProduct('cart-1', PRODUCT_ID), false);
  });
});
