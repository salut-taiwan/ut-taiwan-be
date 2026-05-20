'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { presentUser } = require('../../presenters/userPresenter');

function makeRow(over = {}) {
  return {
    id: 'u1',
    email: 'a@b.com',
    name: 'Andi',
    nim: '12345',
    phone: '+886912345678',
    address_zh_city: '台北市',
    address_zh_district: '中正區',
    address_zh_road: '羅斯福路',
    address_zh_number: '1',
    address_zh_floor: '5樓',
    postal_code: '100',
    country: 'Taiwan',
    is_salut: false,
    is_salut_active: false,
    salut_status: 'none',
    salut_approved_at: null,
    current_semester: 3,
    ...over,
  };
}

describe('presentUser', () => {
  test('adds shipping_address_lines from address_zh_* + country + phone', () => {
    const out = presentUser(makeRow());
    assert.deepEqual(out.shipping_address_lines, [
      '羅斯福路 1號 5樓',
      '中正區台北市 100',
      'Taiwan',
      '+886912345678',
    ]);
  });

  test('adds shipping_address_display (joined lines for single-string display)', () => {
    const out = presentUser(makeRow());
    assert.equal(
      out.shipping_address_display,
      '羅斯福路 1號 5樓\n中正區台北市 100\nTaiwan\n+886912345678'
    );
  });

  test('adds is_member/is_pending mirror flags', () => {
    const member = presentUser(makeRow({
      salut_status: 'approved',
      is_salut_active: true,
    }));
    assert.equal(member.is_member, true);
    assert.equal(member.is_pending, false);

    const pending = presentUser(makeRow({ salut_status: 'pending' }));
    assert.equal(pending.is_member, false);
    assert.equal(pending.is_pending, true);

    const none = presentUser(makeRow({ salut_status: 'none' }));
    assert.equal(none.is_member, false);
    assert.equal(none.is_pending, false);
  });

  test('shipping_address_lines is empty array when address fields missing', () => {
    const out = presentUser(makeRow({
      address_zh_city: null,
      address_zh_district: null,
      address_zh_road: null,
      address_zh_number: null,
      address_zh_floor: null,
      postal_code: null,
      country: null,
      phone: null,
    }));
    assert.deepEqual(out.shipping_address_lines, []);
    assert.equal(out.shipping_address_display, null);
  });

  test('formats salut_applied_fee_amount as NTD display', () => {
    const out = presentUser(makeRow({ salut_applied_fee_amount: 1700 }));
    assert.equal(out.salut_applied_fee_amount_display, 'NT$ 1,700');
  });

  test('handles string-typed numeric salut_applied_fee_amount', () => {
    const out = presentUser(makeRow({ salut_applied_fee_amount: '1200' }));
    assert.equal(out.salut_applied_fee_amount_display, 'NT$ 1,200');
  });

  test('null salut_applied_fee_amount → null display', () => {
    const out = presentUser(makeRow({ salut_applied_fee_amount: null }));
    assert.equal(out.salut_applied_fee_amount_display, null);
  });

  test('preserves raw fields (additive)', () => {
    const out = presentUser(makeRow());
    assert.equal(out.address_zh_city, '台北市');
    assert.equal(out.address_zh_road, '羅斯福路');
    assert.equal(out.postal_code, '100');
  });
});
