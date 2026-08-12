'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { detectChanges } = require('../../scraper/diffDetector');

const dbMod = (over = {}) => ({
  id: 'm-1',
  tbo_code: 'MKDU4109',
  name: 'Bahasa Inggris',
  price_student: 50000,
  price_general: 60000,
  cover_image_url: 'https://cdn/1.jpg',
  tbo_url: 'http://tbo/1',
  is_available: true,
  ...over,
});

const scrapedMod = (over = {}) => ({
  tbo_code: 'MKDU4109',
  name: 'Bahasa Inggris',
  price_student: 50000,
  price_general: 60000,
  cover_image_url: 'https://cdn/1.jpg',
  tbo_url: 'http://tbo/1',
  is_available: true,
  ...over,
});

describe('detectChanges — additions', () => {
  test('a scraped code the database has never seen is queued for insert, verbatim', () => {
    const fresh = scrapedMod({ tbo_code: 'NEW1234' });
    const { toAdd, toUpdate, toRemove } = detectChanges([fresh], []);
    assert.deepEqual(toAdd, [fresh]);
    assert.equal(toUpdate.length, 0);
    assert.equal(toRemove.length, 0);
  });

  test('an empty scrape against an empty database changes nothing', () => {
    assert.deepEqual(detectChanges([], []), { toAdd: [], toUpdate: [], toRemove: [] });
  });
});

describe('detectChanges — updates', () => {
  test('an unchanged module produces no work at all', () => {
    const { toUpdate } = detectChanges([scrapedMod()], [dbMod()]);
    assert.equal(toUpdate.length, 0);
  });

  test('only the fields that actually differ are queued', () => {
    const { toUpdate } = detectChanges([scrapedMod({ price_student: 75000 })], [dbMod()]);
    assert.equal(toUpdate.length, 1);
    assert.deepEqual(toUpdate[0].changes, { price_student: 75000 });
    assert.equal(toUpdate[0].id, 'm-1');
    assert.equal(toUpdate[0].oldData.price_student, 50000);
  });

  test('each tracked field is watched', () => {
    const cases = [
      ['name', 'Bahasa Inggris Edisi 2'],
      ['price_student', 75000],
      ['price_general', 90000],
      ['cover_image_url', 'https://cdn/2.jpg'],
      ['tbo_url', 'http://tbo/2'],
    ];
    for (const [field, value] of cases) {
      const { toUpdate } = detectChanges([scrapedMod({ [field]: value })], [dbMod()]);
      assert.deepEqual(toUpdate[0].changes, { [field]: value }, `${field} should be tracked`);
    }
  });

  test('an untracked field changing is ignored — the scraper does not own it', () => {
    const { toUpdate } = detectChanges([scrapedMod({ author: 'Someone Else' })], [dbMod()]);
    assert.equal(toUpdate.length, 0);
  });

  test('a field the scrape did not report is skipped, never nulling the stored value', () => {
    const partial = { tbo_code: 'MKDU4109', name: 'Bahasa Inggris' };
    const { toUpdate } = detectChanges([partial], [dbMod()]);
    assert.equal(toUpdate.length, 0);
  });

  test('several changed fields are collected into one update', () => {
    const { toUpdate } = detectChanges(
      [scrapedMod({ name: 'Baru', price_student: 75000 })],
      [dbMod()],
    );
    assert.deepEqual(toUpdate[0].changes, { name: 'Baru', price_student: 75000 });
  });
});

describe('detectChanges — availability restore', () => {
  test('a module marked unavailable is restored whenever the scrape sees it again', () => {
    const { toUpdate } = detectChanges([scrapedMod()], [dbMod({ is_available: false })]);
    assert.equal(toUpdate.length, 1);
    assert.equal(toUpdate[0].changes.is_available, true);
  });

  test('the restore fires even when the scrape says nothing about availability', () => {
    const silent = { tbo_code: 'MKDU4109', name: 'Bahasa Inggris' };
    const { toUpdate } = detectChanges([silent], [dbMod({ is_available: false })]);
    assert.equal(toUpdate[0].changes.is_available, true);
  });

  test('an available module is not needlessly re-flagged', () => {
    const { toUpdate } = detectChanges([scrapedMod()], [dbMod({ is_available: true })]);
    assert.equal(toUpdate.length, 0);
  });
});

describe('detectChanges — removals', () => {
  test('an available module missing from the scrape is queued for soft delete', () => {
    const row = dbMod();
    const { toRemove } = detectChanges([], [row]);
    assert.deepEqual(toRemove, [{ id: row.id, oldData: row }]);
  });

  test('an already-unavailable module is not removed twice — reruns stay idempotent', () => {
    const { toRemove } = detectChanges([], [dbMod({ is_available: false })]);
    assert.equal(toRemove.length, 0);
  });

  test('a module still present in the scrape is never removed', () => {
    const { toRemove } = detectChanges([scrapedMod()], [dbMod()]);
    assert.equal(toRemove.length, 0);
  });
});

describe('detectChanges — mixed and edge inputs', () => {
  test('adds, updates and removes are reported together from one pass', () => {
    const keep = dbMod({ id: 'm-1', tbo_code: 'AAA1111' });
    const changed = dbMod({ id: 'm-2', tbo_code: 'BBB2222', price_student: 10000 });
    const gone = dbMod({ id: 'm-3', tbo_code: 'CCC3333' });
    const { toAdd, toUpdate, toRemove } = detectChanges(
      [
        scrapedMod({ tbo_code: 'AAA1111' }),
        scrapedMod({ tbo_code: 'BBB2222', price_student: 20000 }),
        scrapedMod({ tbo_code: 'DDD4444' }),
      ],
      [keep, changed, gone],
    );
    assert.deepEqual(toAdd.map(m => m.tbo_code), ['DDD4444']);
    assert.deepEqual(toUpdate.map(u => u.id), ['m-2']);
    assert.deepEqual(toRemove.map(r => r.id), ['m-3']);
  });

  test('a duplicated tbo_code in one scrape collapses to the last occurrence', () => {
    // Map construction keeps the last write. Documented so a scraper that starts
    // emitting duplicates does not silently change which row wins.
    const { toAdd } = detectChanges(
      [scrapedMod({ tbo_code: 'DUP1', name: 'First' }), scrapedMod({ tbo_code: 'DUP1', name: 'Second' })],
      [],
    );
    assert.equal(toAdd.length, 1);
    assert.equal(toAdd[0].name, 'Second');
  });

  test('an empty scrape against a stocked database removes everything available', () => {
    const { toAdd, toUpdate, toRemove } = detectChanges([], [dbMod({ id: 'a' }), dbMod({ id: 'b', tbo_code: 'X' })]);
    assert.equal(toAdd.length, 0);
    assert.equal(toUpdate.length, 0);
    assert.equal(toRemove.length, 2);
  });
});
