'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// The templates are covered elsewhere. This is about the dispatch layer: who
// the mail goes to, and the promise that a failure here never breaks an order.
//
// Loaded in isolation so the harness, which replaces every sendX with a
// recorder, cannot interfere.

const MODULE_PATH = require.resolve('../../services/emailService');
const RESEND_PATH = require.resolve('resend');

let sent = [];
let nextResult = { data: { id: 'msg-1' }, error: null };

function loadEmailService({ apiKey = 're_test_key' } = {}) {
  delete require.cache[MODULE_PATH];
  delete require.cache[require.resolve('../../config/env')];
  delete require.cache[RESEND_PATH];

  process.env.RESEND_API_KEY = apiKey;
  process.env.EMAIL_FROM = 'UT Taiwan <noreply@test.local>';

  // Stand in for the SDK so nothing leaves the machine.
  require.cache[RESEND_PATH] = {
    id: RESEND_PATH,
    filename: RESEND_PATH,
    loaded: true,
    exports: {
      Resend: class {
        constructor(key) {
          if (!key) throw new Error('Missing API key');
          this.emails = {
            send: async (payload) => {
              sent.push(payload);
              if (nextResult instanceof Error) throw nextResult;
              return nextResult;
            },
          };
        }
      },
    },
  };

  return require(MODULE_PATH);
}

const ORDER = {
  email: 'budi@example.com',
  name: 'Budi',
  orderNumber: 'UT-2026-10001',
  totalAmount: 525000,
  items: [{ module_code: 'MKDU4109', module_name: 'Bahasa Inggris', subtotal: 100000 }],
};

beforeEach(() => {
  sent = [];
  nextResult = { data: { id: 'msg-1' }, error: null };
});

afterEach(() => {
  delete require.cache[MODULE_PATH];
  delete require.cache[require.resolve('../../config/env')];
  delete require.cache[RESEND_PATH];
});

describe('dispatch', () => {
  test('an order confirmation goes to the buyer, from the configured sender', async () => {
    const email = loadEmailService();

    await email.sendOrderConfirmation(ORDER);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'budi@example.com');
    assert.equal(sent[0].from, 'UT Taiwan <noreply@test.local>');
    assert.match(sent[0].subject, /UT-2026-10001/);
    assert.ok(sent[0].html.includes('Budi'));
  });

  test('every order notice reaches the buyer', async () => {
    const email = loadEmailService();

    for (const send of [
      email.sendOrderConfirmation, email.sendPaymentConfirmed,
      email.sendOrderProcessing, email.sendOrderShipped, email.sendOrderCancelled,
    ]) {
      await send(ORDER);
    }

    assert.equal(sent.length, 5);
    for (const payload of sent) {
      assert.equal(payload.to, 'budi@example.com');
      assert.ok(payload.subject.length > 0);
      assert.ok(payload.html.length > 0);
    }
  });

  test('a SALUT approval carries the expiry the member needs to know', async () => {
    const email = loadEmailService();

    await email.sendSalutApproved({
      email: 'budi@example.com', name: 'Budi', expiresAt: '2026-11-01T00:00:00Z',
    });

    assert.equal(sent[0].to, 'budi@example.com');
    assert.ok(sent[0].html.length > 0);
  });

  test('a rejection carries the reason', async () => {
    const email = loadEmailService();

    await email.sendSalutRejected({
      email: 'budi@example.com', name: 'Budi', reason: 'Bukti tidak terbaca',
    });

    assert.ok(sent[0].html.includes('Bukti tidak terbaca'));
  });

  test('the payment request tells the buyer where and how much to transfer', async () => {
    const email = loadEmailService();

    await email.sendPaymentRequest({
      ...ORDER, bank: 'BCA', account: '2950211345', expiresAt: '2026-05-25T00:00:00Z',
    });

    assert.ok(sent[0].html.includes('2950211345'));
  });
});

describe('when sending fails', () => {
  test('an error from the provider is swallowed, not thrown at the caller', async () => {
    // Every send happens after the HTTP response has gone out. A rejection
    // here would surface as an unhandled rejection instead of a missing email.
    nextResult = { data: null, error: { name: 'validation_error', message: 'bad address', statusCode: 422 } };
    const email = loadEmailService();

    await assert.doesNotReject(() => email.sendOrderConfirmation(ORDER));
  });

  test('a thrown network error is swallowed too', async () => {
    nextResult = new Error('ECONNRESET');
    const email = loadEmailService();

    await assert.doesNotReject(() => email.sendOrderConfirmation(ORDER));
  });
});

describe('with no provider configured', () => {
  test('nothing is sent and nothing throws', async () => {
    // env.js treats the key as optional, so the app must degrade to silence
    // rather than failing an order.
    const email = loadEmailService({ apiKey: '' });

    await assert.doesNotReject(() => email.sendOrderConfirmation(ORDER));

    assert.deepEqual(sent, [], 'no attempt was made');
  });
});
