'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { stubBackend, studentUser } = require('../helpers/testApp');
const orderEmailService = require('../../services/orderEmailService');
const emailService = require('../../services/emailService');

// stubBackend replaces these two on the module object so controllers can be
// tested without sending anything. This file is testing the functions
// themselves, so hold the real ones from before any stubbing happens.
const { fetchOrderEmailPayload, sendStatusEmail } = orderEmailService;

// This module decides who gets told what when an order moves. It sits between
// the controllers and the templates, and it must never throw: every caller
// invokes it after the response has already been sent.

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

const orderRow = (over = {}) => ({
  order_number: 'UT-2026-10001',
  total_amount: 525000,
  user_id: 'u-1',
  order_items: [
    { module_code: 'MKDU4109', module_name: 'Bahasa Inggris', quantity: 2, unit_price: 50000, subtotal: 100000 },
  ],
  ...over,
});

let harness = null;
let restoreEmail = null;

afterEach(() => {
  harness?.restore();
  harness = null;
  if (restoreEmail) { restoreEmail(); restoreEmail = null; }
});

/** Record the send wrappers directly: the harness patches them by name. */
function recordSends() {
  const calls = [];
  const names = ['sendPaymentConfirmed', 'sendOrderProcessing', 'sendOrderShipped'];
  const original = Object.fromEntries(names.map(n => [n, emailService[n]]));
  for (const name of names) {
    emailService[name] = async (payload) => { calls.push({ name, payload }); };
  }
  restoreEmail = () => Object.assign(emailService, original);
  return calls;
}

function setup({ order, user: userRow = { email: 'budi@example.com', name: 'Budi' } } = {}) {
  harness = stubBackend({
    user: studentUser(),
    query: {
      orders: { findFirst: async () => order },
      users: { findFirst: async () => userRow },
    },
  });
  return harness;
}

describe('fetchOrderEmailPayload', () => {
  test('an order and its buyer become one payload the templates can use', async () => {
    setup({ order: orderRow() });

    const payload = await fetchOrderEmailPayload(ORDER_ID);

    assert.equal(payload.email, 'budi@example.com');
    assert.equal(payload.name, 'Budi');
    assert.equal(payload.orderNumber, 'UT-2026-10001');
    assert.equal(payload.totalAmount, 525000);
    assert.equal(payload.items.length, 1);
  });

  test('an order that no longer exists yields nothing to send', async () => {
    setup({ order: null });
    assert.equal(await fetchOrderEmailPayload(ORDER_ID), null);
  });

  test('an order whose buyer was deleted yields nothing rather than a broken address', async () => {
    setup({ order: orderRow(), user: null });
    assert.equal(await fetchOrderEmailPayload(ORDER_ID), null);
  });

  test('the items carry what the receipt needs, including request flags', async () => {
    setup({
      order: orderRow({
        order_items: [{
          module_code: null, module_name: 'Jas Almamater', quantity: 1,
          unit_price: 350000, subtotal: 350000, is_request: false, request_status: null,
        }],
      }),
    });

    const payload = await fetchOrderEmailPayload(ORDER_ID);

    assert.equal(payload.items[0].module_name, 'Jas Almamater');
    assert.equal(payload.items[0].subtotal, 350000);
  });
});

describe('sendStatusEmail', () => {
  test('a paid order sends the payment confirmation', async () => {
    setup({ order: orderRow() });
    const sends = recordSends();

    await sendStatusEmail(ORDER_ID, 'paid');

    assert.deepEqual(sends.map(s => s.name), ['sendPaymentConfirmed']);
    assert.equal(sends[0].payload.orderNumber, 'UT-2026-10001');
  });

  test('a processing order tells the buyer it is being prepared', async () => {
    setup({ order: orderRow() });
    const sends = recordSends();

    await sendStatusEmail(ORDER_ID, 'processing');

    assert.deepEqual(sends.map(s => s.name), ['sendOrderProcessing']);
  });

  test('a shipped order tells the buyer it is on its way', async () => {
    setup({ order: orderRow() });
    const sends = recordSends();

    await sendStatusEmail(ORDER_ID, 'shipped');

    assert.deepEqual(sends.map(s => s.name), ['sendOrderShipped']);
  });

  test('a status with no template sends nothing rather than guessing', async () => {
    setup({ order: orderRow() });
    const sends = recordSends();

    for (const status of ['pending', 'awaiting_payment', 'delivered', 'cancelled']) {
      await sendStatusEmail(ORDER_ID, status);
    }

    assert.deepEqual(sends, []);
  });

  test('a missing order sends nothing and does not throw', async () => {
    setup({ order: null });
    const sends = recordSends();

    await assert.doesNotReject(() => sendStatusEmail(ORDER_ID, 'paid'));

    assert.deepEqual(sends, []);
  });

  test('a failing send is swallowed, so an email outage cannot fail the request', async () => {
    // updateOrderStatus awaits this after responding; a rejection here would
    // surface as an unhandled rejection rather than a degraded notification.
    setup({ order: orderRow() });
    const original = emailService.sendPaymentConfirmed;
    emailService.sendPaymentConfirmed = async () => { throw new Error('Resend is down'); };
    restoreEmail = () => { emailService.sendPaymentConfirmed = original; };

    await assert.doesNotReject(() => sendStatusEmail(ORDER_ID, 'paid'));
  });

  test('a failing lookup is swallowed too', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { orders: { findFirst: async () => { throw new Error('db down'); } } },
    });

    await assert.doesNotReject(() => sendStatusEmail(ORDER_ID, 'paid'));
  });
});
