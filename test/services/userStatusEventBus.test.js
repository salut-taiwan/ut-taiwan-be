'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { emitUserStatusUpdate, subscribeUserStatus } = require('../../services/userStatusEventBus');

const PAYLOAD = { is_salut: true, is_salut_active: true, salut_status: 'approved' };

describe('userStatusEventBus', () => {
  test('a subscriber receives updates for its own user', () => {
    const seen = [];
    const off = subscribeUserStatus('u-1', p => seen.push(p));
    emitUserStatusUpdate('u-1', PAYLOAD);
    off();
    assert.deepEqual(seen, [PAYLOAD]);
  });

  test('updates are scoped per user — one student never sees another\'s approval', () => {
    const mine = [];
    const off = subscribeUserStatus('u-1', p => mine.push(p));
    emitUserStatusUpdate('u-2', PAYLOAD);
    off();
    assert.deepEqual(mine, []);
  });

  test('two tabs of the same user both receive the update', () => {
    const tabA = [];
    const tabB = [];
    const offA = subscribeUserStatus('u-1', p => tabA.push(p));
    const offB = subscribeUserStatus('u-1', p => tabB.push(p));
    emitUserStatusUpdate('u-1', PAYLOAD);
    offA();
    offB();
    assert.equal(tabA.length, 1);
    assert.equal(tabB.length, 1);
  });

  test('unsubscribing stops delivery — a closed SSE stream must not leak', () => {
    const seen = [];
    const off = subscribeUserStatus('u-1', p => seen.push(p));
    off();
    emitUserStatusUpdate('u-1', PAYLOAD);
    assert.deepEqual(seen, []);
  });

  test('unsubscribing removes only the listener that unsubscribed', () => {
    const stays = [];
    const goes = [];
    const offStays = subscribeUserStatus('u-1', p => stays.push(p));
    const offGoes = subscribeUserStatus('u-1', p => goes.push(p));
    offGoes();
    emitUserStatusUpdate('u-1', PAYLOAD);
    offStays();
    assert.equal(stays.length, 1);
    assert.equal(goes.length, 0);
  });

  test('unsubscribing twice is harmless', () => {
    const off = subscribeUserStatus('u-1', () => {});
    off();
    assert.doesNotThrow(off);
  });

  test('emitting to an offline user does not throw — the common case', () => {
    assert.doesNotThrow(() => emitUserStatusUpdate('nobody-is-listening', PAYLOAD));
  });

  test('the payload is passed by reference, not cloned', () => {
    let received = null;
    const off = subscribeUserStatus('u-1', p => { received = p; });
    emitUserStatusUpdate('u-1', PAYLOAD);
    off();
    assert.equal(received, PAYLOAD);
  });

  test('500 concurrent subscribers do not trip the MaxListeners warning', () => {
    const warnings = [];
    const onWarning = w => warnings.push(w);
    process.on('warning', onWarning);

    const offs = [];
    for (let i = 0; i < 500; i++) offs.push(subscribeUserStatus('crowded', () => {}));
    for (const off of offs) off();

    process.off('warning', onWarning);
    assert.deepEqual(warnings.filter(w => w.name === 'MaxListenersExceededWarning'), []);
  });
});
