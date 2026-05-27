'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  nextSalutExpiry,
  mostRecentExpiryBefore,
  isSalutActive,
  SALUT_MEMBERSHIP,
} = require('../../config/constants');

const may1_2026 = new Date('2026-04-30T16:00:00Z'); // = 2026-05-01 00:00 Taipei
const nov1_2026 = new Date('2026-10-31T16:00:00Z'); // = 2026-11-01 00:00 Taipei
const may1_2027 = new Date('2027-04-30T16:00:00Z');

describe('SALUT_MEMBERSHIP.EXPIRY_DATES', () => {
  test('contains May 1 and November 1', () => {
    assert.deepEqual(SALUT_MEMBERSHIP.EXPIRY_DATES, [
      { month: 5, day: 1 },
      { month: 11, day: 1 },
    ]);
  });
});

describe('nextSalutExpiry', () => {
  test('between May 1 and Nov 1 → returns Nov 1 of same year', () => {
    const result = nextSalutExpiry(new Date('2026-06-15T00:00:00Z'));
    assert.equal(result.toISOString(), nov1_2026.toISOString());
  });

  test('between Nov 1 and May 1 → returns May 1 of next year', () => {
    const result = nextSalutExpiry(new Date('2026-12-01T00:00:00Z'));
    assert.equal(result.toISOString(), may1_2027.toISOString());
  });

  test('right before May 1 Taipei → returns May 1', () => {
    const result = nextSalutExpiry(new Date('2026-04-30T15:59:59Z'));
    assert.equal(result.toISOString(), may1_2026.toISOString());
  });

  test('right after Nov 1 Taipei → returns next May 1, not same-year Nov 1', () => {
    // 2026-10-31 20:00 UTC = 2026-11-01 04:00 Taipei, already past the boundary
    const result = nextSalutExpiry(new Date('2026-10-31T20:00:00Z'));
    assert.equal(result.toISOString(), may1_2027.toISOString());
  });
});

describe('mostRecentExpiryBefore', () => {
  test('between May 1 and Nov 1 → returns May 1 of same year', () => {
    const result = mostRecentExpiryBefore(new Date('2026-06-15T00:00:00Z'));
    assert.equal(result.toISOString(), may1_2026.toISOString());
  });

  test('between Nov 1 and May 1 → returns Nov 1 of same year', () => {
    const result = mostRecentExpiryBefore(new Date('2026-12-01T00:00:00Z'));
    assert.equal(result.toISOString(), nov1_2026.toISOString());
  });

  test('right before May 1 Taipei → returns previous Nov 1', () => {
    const result = mostRecentExpiryBefore(new Date('2026-04-30T15:59:59Z'));
    assert.equal(result.toISOString(), '2025-10-31T16:00:00.000Z');
  });
});

describe('isSalutActive', () => {
  const now = new Date('2026-06-15T00:00:00Z'); // between May 1 and Nov 1 2026

  test('returns false for null approvedAt', () => {
    assert.equal(isSalutActive(null, now), false);
  });

  test('approved on Apr 30 2026 (before May 1) → expired', () => {
    assert.equal(isSalutActive('2026-04-30T00:00:00Z', now), false);
  });

  test('approved on May 2 2026 (after boundary) → active', () => {
    assert.equal(isSalutActive('2026-05-02T00:00:00Z', now), true);
  });

  test('approved on Oct 31 2026 → still active on Oct 31 in Nov 1 cycle', () => {
    const now2 = new Date('2026-10-31T00:00:00Z');
    assert.equal(isSalutActive('2026-05-02T00:00:00Z', now2), true);
  });

  test('approved on Oct 31 2026 → expired after Nov 1 boundary', () => {
    const now2 = new Date('2026-11-02T00:00:00Z');
    assert.equal(isSalutActive('2026-05-02T00:00:00Z', now2), false);
  });

  test('approved on Nov 2 2026 → active across November cycle', () => {
    const now2 = new Date('2026-12-15T00:00:00Z');
    assert.equal(isSalutActive('2026-11-02T00:00:00Z', now2), true);
  });
});
