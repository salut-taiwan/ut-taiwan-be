'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  composeShippingAddressLine,
  addressToLines,
} = require('../../format/address');

describe('composeShippingAddressLine — matches existing app/checkout/page.tsx:99-127 byte-for-byte', () => {
  test('road + number+號 + floor', () => {
    const out = composeShippingAddressLine({
      zh_road: '羅斯福路四段',
      zh_number: '1',
      zh_floor: '5樓',
    });
    assert.equal(out, '羅斯福路四段 1號 5樓');
  });

  test('skips floor when null/empty', () => {
    assert.equal(
      composeShippingAddressLine({ zh_road: '中山路', zh_number: '10', zh_floor: null }),
      '中山路 10號'
    );
    assert.equal(
      composeShippingAddressLine({ zh_road: '中山路', zh_number: '10', zh_floor: '' }),
      '中山路 10號'
    );
  });

  test('skips number when missing', () => {
    assert.equal(
      composeShippingAddressLine({ zh_road: '中山路' }),
      '中山路'
    );
  });

  test('returns null for null/empty input', () => {
    assert.equal(composeShippingAddressLine(null), null);
    assert.equal(composeShippingAddressLine(undefined), null);
    assert.equal(composeShippingAddressLine({}), null);
  });
});

describe('addressToLines — multi-line display for read-only address card', () => {
  test('returns line1=road/num/floor, line2=district+city postal, line3=country, line4=phone', () => {
    const lines = addressToLines({
      zh_road: '羅斯福路四段',
      zh_number: '1',
      zh_floor: '5樓',
      zh_city: '台北市',
      zh_district: '中正區',
      postal_code: '100',
      country: 'Taiwan',
      phone: '+886912345678',
    });
    assert.deepEqual(lines, [
      '羅斯福路四段 1號 5樓',
      '中正區台北市 100',
      'Taiwan',
      '+886912345678',
    ]);
  });

  test('skips empty entries', () => {
    const lines = addressToLines({
      zh_road: '中山路',
      zh_number: '10',
      zh_city: '新北市',
      zh_district: '板橋區',
    });
    assert.deepEqual(lines, ['中山路 10號', '板橋區新北市']);
    for (const l of lines) assert.notEqual(l, '');
  });

  test('handles missing postal — no trailing space', () => {
    const lines = addressToLines({
      zh_road: '中山路',
      zh_number: '10',
      zh_city: '新北市',
      zh_district: '板橋區',
      postal_code: '',
    });
    assert.deepEqual(lines, ['中山路 10號', '板橋區新北市']);
  });

  test('returns empty array when all input is empty', () => {
    assert.deepEqual(addressToLines({}), []);
    assert.deepEqual(addressToLines(null), []);
  });
});
