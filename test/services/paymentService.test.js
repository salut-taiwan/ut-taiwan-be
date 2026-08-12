'use strict';

const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');

const { chargeGateway } = require('../../services/paymentService');
const { PAYMENT_EXPIRY_MS } = require('../../config/constants');

describe('chargeGateway', () => {
  test('reports the manual gateway — there is no payment processor yet', async () => {
    const res = await chargeGateway({ orderNumber: 'UT-2026-12345', amount: 525425 });
    assert.equal(res.gateway, 'manual');
    assert.equal(res.gatewayPaymentId, null);
    assert.equal(res.gatewayBillingNo, null);
  });

  test('the stored gateway response carries the transfer target and the amount owed', async () => {
    const res = await chargeGateway({ orderNumber: 'UT-2026-12345', amount: 525425 });
    assert.equal(res.gatewayResponse.bank, 'BCA');
    assert.equal(res.gatewayResponse.number, '2950211345');
    assert.equal(res.gatewayResponse.name, 'Nathasya Vira Nerisa');
    assert.equal(res.gatewayResponse.order_number, 'UT-2026-12345');
    assert.equal(res.gatewayResponse.amount, 525425);
  });

  test('the payment window is exactly the configured expiry from now', async (t) => {
    const now = new Date('2026-05-20T06:30:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });

    const res = await chargeGateway({ orderNumber: 'UT-2026-12345', amount: 1 });

    assert.equal(res.expiresAt, new Date(now.getTime() + PAYMENT_EXPIRY_MS).toISOString());
    t.mock.timers.reset();
  });

  test('the expiry is an ISO string, ready for the timestamptz column', async () => {
    const res = await chargeGateway({ orderNumber: 'UT-2026-1', amount: 1 });
    assert.match(res.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('the window is five days', () => {
    assert.equal(PAYMENT_EXPIRY_MS, 5 * 24 * 60 * 60 * 1000);
  });

  test('it never throws, so checkout\'s gateway-failure fallback is currently unreachable', async () => {
    // orderController wraps this in try/catch and falls back to a manual
    // payment. That branch is dead while this implementation is synchronous
    // and total — worth knowing before anyone deletes the fallback.
    await assert.doesNotReject(() => chargeGateway({}));
  });
});
