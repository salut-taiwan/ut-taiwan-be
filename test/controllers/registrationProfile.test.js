'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const fields = require('../../utils/registrationProfile');

function loadController(relativePath, mocks) {
  const filename = path.resolve(__dirname, relativePath);
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, exports: {}, Date, console,
    require: name => Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

function response() {
  return { statusCode: 200, body: null, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
}

function harness({ orphan = false, insertError = false } = {}) {
  const calls = { signs: 0, inserts: [], updates: [], deleted: [] };
  const profile = { id: 'student-1', name: 'Rina', email: 'rina@example.test',
    phone_taiwan: '+886912345678', almamater_size: 'XL', salut_status: 'none' };
  const db = {
    query: { users: { findFirst: async () => orphan ? null : profile } },
    insert: () => ({ values: async value => { calls.inserts.push(value); if (insertError) throw new Error('DB unavailable'); } }),
    update: () => ({ set(value) { calls.updates.push(value); return this; }, where() { return this; }, returning: async () => [profile] }),
  };
  const auth = {
    signUp: async () => { calls.signs++; return { data: { user: orphan ? null : { id: 'student-1' } }, error: null }; },
    signInWithPassword: async () => ({ data: { user: { id: 'student-1' } }, error: null }),
    signOut: async () => ({}),
  };
  const ctrl = loadController('../../controllers/authController.js', {
    '../config/supabase': { supabase: { auth }, supabaseAdmin: { auth: { admin: { deleteUser: async id => calls.deleted.push(id) } } } },
    '../db': { db }, '../db/schema': { users: { id: 'id' } },
    'drizzle-orm': { eq: (...args) => args },
    '../config/env': { FRONTEND_URL: 'https://example.test' },
    './../config/constants': { isSalutActive: () => false },
    '../presenters/userPresenter': { presentUser: row => row },
    '../config/banks': { getBankName: () => 'Test Bank' },
  });
  return { ctrl, calls };
}

const body = () => ({ email: 'rina@example.test', password: 'secure-pass', name: 'Rina', nim: '041234567', phone: '+6281234567890',
  birth_place: 'Jakarta', birth_date: '2000-01-01', program_id: 'program-1', current_semester: 1,
  address_zh_city: '台北市', address_zh_district: '信義區', address_zh_road: '信義路', address_zh_number: '1號', postal_code: '110',
  bank_ntd_code: '700', bank_ntd_account: '00000000000000', profile_fields_version: 1,
  phone_taiwan: '0912 345 678', almamater_size: '  Ukuran khusus 2XL  ' });

test('Taiwan local, international, and formatted mobile values have one canonical result', () => {
  for (const value of ['0912345678', '0912 345 678', '+886 912-345-678', '886912345678']) assert.equal(fields.normalizeTaiwanPhone(value), '+886912345678');
});
test('Indonesian numbers, doubled trunk prefixes, and malformed values are refused', () => {
  for (const value of ['081234567890', '+6281234567890', '+8860912345678', '091234567', '09ABC45678', [], null]) assert.equal(fields.normalizeTaiwanPhone(value), null);
});
test('almamater sizes are free text, trimmed, and not a predefined dropdown', () => {
  for (const value of ['S', '2XL', 'XXXL', 'Ukuran khusus 120']) assert.equal(fields.normalizeAlmamaterSize(`  ${value}  `), value);
});
test('blank, oversized, multiline, and non-string sizes are refused', () => {
  for (const value of ['', '   ', 'L\nXL', 'x'.repeat(31), {}, null]) assert.equal(fields.normalizeAlmamaterSize(value), null);
});
test('new registrations cannot omit either new field', async () => {
  for (const field of ['phone_taiwan', 'almamater_size']) {
    const h = harness(), reqBody = body(); delete reqBody[field]; const res = response();
    await h.ctrl.register({ body: reqBody }, res);
    assert.equal(res.statusCode, 400); assert.equal(h.calls.signs, 0);
  }
});
test('invalid Taiwan phone is refused before creating the auth account', async () => {
  const h = harness(), res = response(); await h.ctrl.register({ body: { ...body(), phone_taiwan: '+6281234567890' } }, res);
  assert.equal(res.statusCode, 400); assert.equal(h.calls.signs, 0);
});
test('registration persists the normalized Taiwan number and the free-text size separately from WhatsApp', async () => {
  const h = harness(), res = response(); await h.ctrl.register({ body: body() }, res);
  assert.equal(res.statusCode, 201); assert.equal(h.calls.inserts[0].phone_taiwan, '+886912345678');
  assert.equal(h.calls.inserts[0].phone, '+6281234567890'); assert.equal(h.calls.inserts[0].almamater_size, 'Ukuran khusus 2XL');
});
test('orphaned auth-account recovery retains both new fields', async () => {
  const h = harness({ orphan: true }), res = response(); await h.ctrl.register({ body: body() }, res);
  assert.equal(res.statusCode, 201); assert.equal(h.calls.inserts[0].almamater_size, 'Ukuran khusus 2XL');
  assert.equal(h.calls.inserts[0].phone_taiwan, '+886912345678');
});
test('legacy registration remains compatible while frontend and backend deploy separately', async () => {
  const h = harness(), res = response(), legacy = body();
  delete legacy.profile_fields_version; delete legacy.phone_taiwan; delete legacy.almamater_size;
  await h.ctrl.register({ body: legacy }, res); assert.equal(res.statusCode, 201);
  assert.equal(h.calls.inserts[0].phone_taiwan, null); assert.equal(h.calls.inserts[0].almamater_size, null);
});
test('profile-insert failures still compensate by deleting only the newly created auth account', async () => {
  const h = harness({ insertError: true }), res = response(); await h.ctrl.register({ body: body() }, res);
  assert.equal(res.statusCode, 500); assert.deepEqual(h.calls.deleted, ['student-1']);
});
test('profile updates validate and store the new fields', async () => {
  const h = harness(), res = response(); await h.ctrl.updateMe({ user: { id: 'student-1' }, body: { phone_taiwan: '0912345678', almamater_size: '  L  ' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(h.calls.updates[0].phone_taiwan, '+886912345678'); assert.equal(h.calls.updates[0].almamater_size, 'L');
});
test('invalid profile update does not write to the database', async () => {
  const h = harness(), res = response(); await h.ctrl.updateMe({ user: { id: 'student-1' }, body: { almamater_size: 'x'.repeat(31) } }, res);
  assert.equal(res.statusCode, 400); assert.equal(h.calls.updates.length, 0);
});
test('saving unrelated profile fields does not erase existing size or Taiwan contact', async () => {
  const h = harness(), res = response(); await h.ctrl.updateMe({ user: { id: 'student-1' }, body: { name: 'Rina Baru' } }, res);
  assert.equal(res.statusCode, 200); assert.equal('phone_taiwan' in h.calls.updates[0], false); assert.equal('almamater_size' in h.calls.updates[0], false);
});
test('older students can explicitly clear optional profile data', async () => {
  const h = harness(), res = response(); await h.ctrl.updateMe({ user: { id: 'student-1' }, body: { phone_taiwan: '', almamater_size: null } }, res);
  assert.equal(res.statusCode, 200); assert.equal(h.calls.updates[0].phone_taiwan, null); assert.equal(h.calls.updates[0].almamater_size, null);
});
test('getMe returns both saved fields for the profile form', async () => {
  const h = harness(), res = response(); await h.ctrl.getMe({ user: { id: 'student-1' } }, res);
  assert.equal(res.body.phone_taiwan, '+886912345678'); assert.equal(res.body.almamater_size, 'XL');
});

test('the public registration configuration advertises the fields the backend persists', () => {
  const ctrl = loadController('../../controllers/configController.js', {
    '../config/constants': {}, '../presenters/feesPresenter': {}, '../config/banks': {},
  });
  const res = response(); ctrl.getRegistration({}, res);
  assert.equal(res.body.profile_fields_version, 1);
  assert.equal(res.body.required_fields.includes('phone_taiwan'), true);
  assert.equal(res.body.required_fields.includes('almamater_size'), true);
  assert.equal(res.body.almamater_size_max_length, fields.SIZE_MAX_LENGTH);
});

test('the admin list returns the contact and size and can search the Taiwan phone', async () => {
  const searches = [];
  const users = new Proxy({}, { get: (_, key) => String(key) });
  const programs = { id: 'program-id', name: 'program-name', code: 'program-code' };
  const row = { id: 'student-1', name: 'Rina', phone_taiwan: '+886912345678', almamater_size: 'Ukuran khusus 2XL' };
  let query = 0;
  const db = { select() {
    const result = query++ === 0 ? [row] : [{ count: 1 }];
    const chain = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
    for (const name of ['from', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) chain[name] = () => chain;
    return chain;
  } };
  const noop = (...values) => values;
  const ctrl = loadController('../../controllers/userController.js', {
    '../config/supabase': {}, '../db': { db }, '../db/schema': { users, programs },
    'drizzle-orm': { eq: noop, and: noop, ne: noop, or: noop, ilike: (column, term) => { searches.push([column, term]); }, inArray: noop, asc: noop, desc: noop, sql: noop },
    '../services/emailService': {}, '../config/constants': {}, '../services/userStatusEventBus': {},
    '../format': { formatDate: () => null },
    '../utils/pagination': { clampInt: (value, min, max, fallback) => value === undefined ? fallback : Number(value), escapeIlike: value => value },
  });
  const res = response(); await ctrl.listUsers({ query: { search: '0912' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.rows[0].phone_taiwan, row.phone_taiwan);
  assert.equal(res.body.rows[0].almamater_size, row.almamater_size);
  assert.equal(searches.some(([column]) => column === 'phone_taiwan'), true);
});
