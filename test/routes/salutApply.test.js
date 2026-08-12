'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, stubBackend, updateChain } = require('../helpers/testApp');

const USER = { id: '33333333-3333-3333-3333-333333333333', role: 'student' };

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup(userRow = { is_salut: false, salut_status: 'none', current_semester: 1, salut_approved_at: null }) {
  harness = stubBackend({
    user: USER,
    query: { users: { findFirst: async () => userRow } },
    update: updateChain([{ id: USER.id }]),
  });
  return harness;
}

function apply(body) {
  return request(app)
    .post('/api/salut/apply')
    .set('Authorization', 'Bearer test-token')
    .send(body);
}

describe('POST /api/salut/apply — WhatsApp number', () => {
  test('stores the number normalized to wa.me digits, and mirrors it to the profile', async () => {
    const h = setup();

    const res = await apply({ proofUrl: 'u/1/proof.jpg', current_semester: 1, wa_number: '081234567890' });

    assert.equal(res.status, 200);
    assert.equal(res.body.fee.amount, 1700);
    assert.equal(res.body.fee.amount_idr, 952000);

    const written = h.calls.set.find(v => v.salut_status === 'pending');
    assert.equal(written.salut_wa_number, '6281234567890');
    assert.equal(written.phone, '6281234567890');
    assert.equal(written.salut_applied_fee_amount, 1700);
  });

  test('a missing number is rejected — admins need it to add the member to the group', async () => {
    setup();

    const res = await apply({ proofUrl: 'u/1/proof.jpg', current_semester: 1 });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Nomor WhatsApp aktif wajib diisi dengan benar');
  });

  test('an unusable number is rejected', async () => {
    setup();

    const res = await apply({ proofUrl: 'u/1/proof.jpg', current_semester: 1, wa_number: '0812' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Nomor WhatsApp aktif wajib diisi dengan benar');
  });

  test('proof URL is still required, and checked before the number', async () => {
    setup();

    const res = await apply({ current_semester: 1, wa_number: '081234567890' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'URL bukti pembayaran wajib diisi');
  });

  test('an application already in review is not replaced', async () => {
    setup({ is_salut: false, salut_status: 'pending', current_semester: 1, salut_approved_at: null });

    const res = await apply({ proofUrl: 'u/1/proof.jpg', current_semester: 1, wa_number: '081234567890' });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /sedang dalam proses verifikasi/);
  });

  test('semester 2+ applies the returning-member fee', async () => {
    setup({ is_salut: false, salut_status: 'none', current_semester: 3, salut_approved_at: null });

    const res = await apply({ proofUrl: 'u/1/proof.jpg', current_semester: 3, wa_number: '+886912345678' });

    assert.equal(res.status, 200);
    assert.equal(res.body.fee.amount, 1200);
    assert.equal(res.body.fee.amount_idr, 672000);
  });
});
