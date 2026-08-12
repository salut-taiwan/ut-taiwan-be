'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const requireVerified = require('../../middleware/requireVerified');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

describe('requireVerified', () => {
  test('an unverified account cannot check out or apply for SALUT', () => {
    const res = fakeRes();
    let nexted = false;
    requireVerified({ user: { id: 'u-1', email_confirmed_at: null } }, res, () => { nexted = true; });

    assert.equal(nexted, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'EMAIL_NOT_VERIFIED');
    assert.match(res.body.error, /belum diverifikasi/);
  });

  test('the machine-readable code is what the frontend branches on', () => {
    const res = fakeRes();
    requireVerified({ user: {} }, res, () => {});
    assert.equal(res.body.code, 'EMAIL_NOT_VERIFIED');
  });

  test('a request with no user at all is refused the same way', () => {
    const res = fakeRes();
    requireVerified({}, res, () => {});
    assert.equal(res.statusCode, 403);
  });

  test('a verified account passes straight through', () => {
    const res = fakeRes();
    let nextArgs = 'not called';
    requireVerified(
      { user: { id: 'u-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
      res,
      (...args) => { nextArgs = args; },
    );

    assert.deepEqual(nextArgs, []);
    assert.equal(res.statusCode, null, 'no response should be written');
  });
});
