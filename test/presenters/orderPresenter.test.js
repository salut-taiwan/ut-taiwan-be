'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  presentOrderDetail,
  presentOrderListItem,
  presentAdminOrder,
  buildOrderSteps,
  buildFeeLines,
} = require('../../presenters/orderPresenter');
const { SALUT_FEES } = require('../../config/constants');

const NBSP = ' ';

function baseOrder(over = {}) {
  return {
    id: 'o-1',
    user_id: 'u-1',
    order_number: 'UT-2026-0001',
    status: 'awaiting_payment',
    is_salut_order: false,
    subtotal: 100000,
    shipping_cost: SALUT_FEES.ONGKIR,
    box_fee: SALUT_FEES.BOX,
    admin_fee: SALUT_FEES.ADMIN,
    total_amount: 100000 + SALUT_FEES.ONGKIR + SALUT_FEES.BOX + SALUT_FEES.ADMIN,
    created_at: '2026-05-20T06:30:00Z',
    shipped_at: null,
    shipping_name: 'Andi',
    shipping_address: '羅斯福路 1號 5樓',
    shipping_city: '中正區台北市',
    shipping_phone: '+886912345678',
    order_items: [
      { id: 'i-1', module_code: 'MKDU4109', module_name: 'Bahasa Inggris',
        quantity: 2, unit_price: 50000, subtotal: 100000,
        is_request: false, request_status: null, display_status: 'normal' },
    ],
    payments: [
      // amount = total_amount + unique_code = 525000 + 425 = 525425
      { id: 'p-1', status: 'pending', amount: 525425, unique_code: 425,
        expires_at: '2026-05-25T17:00:00Z', paid_at: null, proof_uploaded_at: null,
        show_payment_instructions: true, show_payment_deadline: true,
        bank_name: 'BCA', bank_account: '2950211345', bank_holder: 'Nathasya Vira Nerisa' },
    ],
    ...over,
  };
}

describe('buildOrderSteps', () => {
  test('awaiting_payment: step 1 is current, step 0 completed, rest pending', () => {
    const { steps, progress_percent } = buildOrderSteps('awaiting_payment');
    assert.equal(steps.length, 6);
    assert.equal(steps[0].state, 'completed');
    assert.equal(steps[1].state, 'current');
    for (let i = 2; i < 6; i++) assert.equal(steps[i].state, 'pending');
    assert.equal(progress_percent, Math.round((1 / 5) * 100));
  });

  test('delivered: all completed; progress 100', () => {
    const { steps, progress_percent } = buildOrderSteps('delivered');
    for (const s of steps) assert.equal(s.state, 'completed');
    assert.equal(progress_percent, 100);
  });

  test('pending: only first is current', () => {
    const { steps, progress_percent } = buildOrderSteps('pending');
    assert.equal(steps[0].state, 'current');
    assert.equal(progress_percent, 0);
  });

  test('cancelled / unknown: no current step, no progress', () => {
    const { steps, progress_percent } = buildOrderSteps('cancelled');
    for (const s of steps) assert.equal(s.state, 'pending');
    assert.equal(progress_percent, 0);
  });

  test('each step has key and label', () => {
    const { steps } = buildOrderSteps('paid');
    for (const s of steps) {
      assert.ok(s.key);
      assert.ok(s.label);
    }
  });
});

describe('buildFeeLines', () => {
  test('non-SALUT: lines reflect actual fee amounts, is_waived=false', () => {
    const lines = buildFeeLines({
      shippingCost: SALUT_FEES.ONGKIR,
      boxFee: SALUT_FEES.BOX,
      adminFee: SALUT_FEES.ADMIN,
      isSalutOrder: false,
    });
    assert.equal(lines.length, 3);
    assert.equal(lines[0].key, 'shipping');
    assert.equal(lines[0].amount, SALUT_FEES.ONGKIR);
    assert.equal(lines[0].is_waived, false);
    assert.equal(lines[0].original_amount, undefined);
  });

  test('SALUT order: lines all waived with original_amount from SALUT_FEES constants', () => {
    const lines = buildFeeLines({
      shippingCost: 0,
      boxFee: 0,
      adminFee: 0,
      isSalutOrder: true,
    });
    for (const l of lines) {
      assert.equal(l.is_waived, true);
      assert.equal(l.amount, 0);
      assert.ok(l.amount_display.startsWith('Rp'));
      assert.ok(l.original_amount > 0,
        'original_amount must come from SALUT_FEES, not order columns');
      assert.ok(l.original_amount_display);
    }
    assert.equal(lines[0].original_amount, SALUT_FEES.ONGKIR);
    assert.equal(lines[1].original_amount, SALUT_FEES.BOX);
    assert.equal(lines[2].original_amount, SALUT_FEES.ADMIN);
  });
});

describe('presentOrderDetail — top-level _display fields', () => {
  test('adds subtotal_display, total_amount_display, created_at_display', () => {
    const out = presentOrderDetail(baseOrder());
    assert.equal(out.subtotal_display, `Rp${NBSP}100.000`);
    // subtotal 100k + ongkir 300k + box 100k + admin 25k = 525k
    assert.equal(out.total_amount_display, `Rp${NBSP}525.000`);
    assert.equal(out.created_at_display, '20 Mei 2026 pukul 14.30');
  });

  test('adds status_label', () => {
    const out = presentOrderDetail(baseOrder({ status: 'paid' }));
    assert.equal(out.status_label, 'Dibayar');
  });

  test('adds steps and progress_percent (replaces step_index gradient math)', () => {
    const out = presentOrderDetail(baseOrder({ status: 'shipped' }));
    assert.equal(out.steps.length, 6);
    assert.equal(out.steps[4].state, 'current');
    assert.equal(out.progress_percent, 80);
  });

  test('adds fee_lines and total_breakdown', () => {
    const out = presentOrderDetail(baseOrder());
    assert.equal(out.fee_lines.length, 3);
    assert.ok(out.total_breakdown);
  });

  test('total_breakdown.total_display includes unique_code when payment has one', () => {
    // baseOrder has payment.unique_code=425, payment.amount=525425
    const out = presentOrderDetail(baseOrder());
    assert.equal(out.total_breakdown.total_display, out.payments[0].amount_display);
    assert.equal(out.total_breakdown.unique_code_display, `Rp${NBSP}425`);
    // Sanity: payment amount differs from order.total_amount by the unique_code
    assert.notEqual(out.total_breakdown.total_display, out.total_amount_display);
  });

  test('total_breakdown.total_display falls back to order.total_amount when no payment unique_code', () => {
    const out = presentOrderDetail(baseOrder({
      payments: [{ id: 'p-x', status: 'paid', amount: 525000, unique_code: 0,
        expires_at: null, paid_at: '2026-05-22T08:00:00Z', proof_uploaded_at: null }],
    }));
    assert.equal(out.total_breakdown.total_display, out.total_amount_display);
    assert.equal(out.total_breakdown.unique_code_display, null);
  });

  test('total_breakdown.total_display falls back when payments array empty', () => {
    const out = presentOrderDetail(baseOrder({ payments: [] }));
    assert.equal(out.total_breakdown.total_display, out.total_amount_display);
    assert.equal(out.total_breakdown.unique_code_display, null);
  });

  test('SALUT order: fee_lines waived with original strikethrough amounts from constants (LOOPHOLE)', () => {
    const out = presentOrderDetail(baseOrder({
      is_salut_order: true,
      shipping_cost: 0,
      box_fee: 0,
      admin_fee: 0,
      total_amount: 100000,
    }));
    for (const l of out.fee_lines) {
      assert.equal(l.is_waived, true);
      assert.ok(l.original_amount > 0);
    }
    assert.equal(out.fee_lines[0].original_amount, SALUT_FEES.ONGKIR);
  });

  test('shipping_address_lines composed from existing flat fields', () => {
    const out = presentOrderDetail(baseOrder());
    assert.ok(Array.isArray(out.shipping_address_lines));
    assert.ok(out.shipping_address_lines.length >= 2);
    assert.ok(out.shipping_address_lines.includes('Andi'));
  });

  test('confirm_deadline_display present when shipped_at set', () => {
    const shippedAt = new Date('2026-05-15T00:00:00Z').toISOString();
    const out = presentOrderDetail(baseOrder({ status: 'shipped', shipped_at: shippedAt }));
    assert.ok(out.shipped_at_display);
    assert.ok(out.confirm_deadline_display);
  });
});

describe('presentOrderDetail — per-item displays', () => {
  test('normal item: price_visible=true, displays present', () => {
    const out = presentOrderDetail(baseOrder());
    const item = out.order_items[0];
    assert.equal(item.unit_price_display, `Rp${NBSP}50.000`);
    assert.equal(item.subtotal_display, `Rp${NBSP}100.000`);
    assert.equal(item.price_visible, true);
    assert.equal(item.request_status_label, null);
  });

  test('rejected item: price_visible=false, request_status_label=Ditolak', () => {
    const out = presentOrderDetail(baseOrder({
      order_items: [{
        ...baseOrder().order_items[0],
        is_request: true, request_status: 'rejected', display_status: 'rejected',
      }],
    }));
    const item = out.order_items[0];
    assert.equal(item.price_visible, false);
    assert.equal(item.request_status_label, 'Ditolak');
  });

  test('pending_request item: price_visible=false, request_status_label set', () => {
    const out = presentOrderDetail(baseOrder({
      order_items: [{
        ...baseOrder().order_items[0],
        unit_price: 0, subtotal: 0,
        is_request: true, request_status: 'pending', display_status: 'pending_request',
      }],
    }));
    const item = out.order_items[0];
    assert.ok(item.request_status_label);
  });

  test('zero_price item: price_visible=false', () => {
    const out = presentOrderDetail(baseOrder({
      order_items: [{
        ...baseOrder().order_items[0],
        unit_price: 0, subtotal: 0,
        is_request: true, request_status: 'approved', display_status: 'zero_price',
      }],
    }));
    assert.equal(out.order_items[0].price_visible, false);
  });
});

describe('presentOrderDetail — payment displays', () => {
  test('payment gets _display fields and _label', () => {
    const out = presentOrderDetail(baseOrder());
    const p = out.payments[0];
    assert.ok(p.amount_display);
    assert.equal(p.payment_status_label, 'Menunggu Pembayaran');
    assert.ok(p.expires_at_display);
    assert.equal(p.paid_at_display, null);
  });

  test('paid_at_display populated when paid', () => {
    const out = presentOrderDetail(baseOrder({
      payments: [{ ...baseOrder().payments[0], status: 'paid', paid_at: '2026-05-22T08:00:00Z' }],
    }));
    const p = out.payments[0];
    assert.equal(p.payment_status_label, 'Lunas');
    assert.ok(p.paid_at_display);
  });
});

describe('presentOrderListItem', () => {
  test('adds status_label, created_at_display, total_amount_display', () => {
    const out = presentOrderListItem({
      id: 'o-2',
      order_number: 'UT-2026-0002',
      status: 'paid',
      total_amount: 425000,
      created_at: '2026-05-20T06:30:00Z',
      order_items: [],
      payments: [],
    });
    assert.equal(out.status_label, 'Dibayar');
    assert.equal(out.created_at_display, '20 Mei 2026 pukul 14.30');
    assert.equal(out.total_amount_display, `Rp${NBSP}425.000`);
  });
});

describe('presentAdminOrder', () => {
  test('adds order + payment + per-item displays', () => {
    const out = presentAdminOrder({
      id: 'o-3',
      order_number: 'UT-X',
      status: 'awaiting_payment',
      subtotal: 100000,
      shipping_cost: 0, box_fee: 0, admin_fee: 0,
      is_salut_order: true,
      total_amount: 100000,
      created_at: '2026-05-20T06:30:00Z',
      payments: [{ status: 'pending', amount: 100425, proof_path: null, invoice_path: null, proof_uploaded_at: null }],
      order_items: [{ id: 'i', module_code: 'X', module_name: 'Y', quantity: 1,
        unit_price: 100000, subtotal: 100000, is_request: false, request_status: null }],
    });
    assert.equal(out.status_label, 'Menunggu Pembayaran');
    assert.equal(out.payments[0].payment_status_label, 'Menunggu Pembayaran');
    assert.ok(out.payments[0].amount_display);
    assert.ok(out.order_items[0].unit_price_display);
  });
});
