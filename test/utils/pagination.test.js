'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { clampInt, escapeIlike } = require('../../utils/pagination');

describe('clampInt', () => {
  test('a missing or unparseable value falls back', () => {
    assert.equal(clampInt(undefined, 1, 100, 25), 25);
    assert.equal(clampInt(null, 1, 100, 25), 25);
    assert.equal(clampInt('', 1, 100, 25), 25);
    assert.equal(clampInt('abc', 1, 100, 25), 25);
  });

  test('a value inside the range passes through', () => {
    assert.equal(clampInt('30', 1, 100, 25), 30);
  });

  test('clamps to the upper bound so a client cannot ask for the whole table', () => {
    assert.equal(clampInt('500', 1, 100, 25), 100);
    assert.equal(clampInt('99999', 1, 100, 25), 100);
  });

  test('clamps to the lower bound, including negatives and zero', () => {
    assert.equal(clampInt('0', 1, 100, 25), 1);
    assert.equal(clampInt('-5', 1, 100, 25), 1);
  });

  test('an offset may legitimately clamp to 0', () => {
    assert.equal(clampInt('-5', 0, 1000, 0), 0);
  });

  test('parseInt takes the numeric prefix — "30abc" is 30, not the fallback', () => {
    assert.equal(clampInt('30abc', 1, 100, 25), 30);
  });

  test('exponent notation is NOT expanded: "1e5" parses as 1, not 100000', () => {
    // parseInt stops at the 'e'. Documented so nobody "fixes" it into Number().
    assert.equal(clampInt('1e5', 1, 100, 25), 1);
  });

  test('a float string truncates rather than rounding', () => {
    assert.equal(clampInt('7.9', 1, 100, 25), 7);
  });

  test('a real number argument works as well as a string', () => {
    assert.equal(clampInt(42, 1, 100, 25), 42);
  });
});

describe('escapeIlike', () => {
  test('a percent is escaped so a search for "50%" is not a wildcard', () => {
    assert.equal(escapeIlike('50%'), '50\\%');
  });

  test('an underscore is escaped so it cannot match a single character', () => {
    assert.equal(escapeIlike('a_b'), 'a\\_b');
  });

  test('a backslash is escaped first, so an escape cannot be forged', () => {
    // Naive ordering would turn "\%" into "\\%" — a literal backslash followed
    // by a live wildcard. Escaping the backslash first prevents that.
    assert.equal(escapeIlike('a\\b'), 'a\\\\b');
    assert.equal(escapeIlike('\\%'), '\\\\\\%');
  });

  test('ordinary text is untouched', () => {
    assert.equal(escapeIlike('Budi Santoso'), 'Budi Santoso');
    assert.equal(escapeIlike('MKDU4109'), 'MKDU4109');
  });

  test('an empty string stays empty', () => {
    assert.equal(escapeIlike(''), '');
  });

  test('every wildcard in a mixed string is escaped', () => {
    assert.equal(escapeIlike('%a_b\\c%'), '\\%a\\_b\\\\c\\%');
  });
});
