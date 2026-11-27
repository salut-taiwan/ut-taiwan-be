'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { PgDialect } = require('drizzle-orm/pg-core');
const {
  app, stubBackend, studentUser, adminUser, insertChain, updateChain, selectQueue, freshIp,
} = require('../helpers/testApp');
const fields = require('../../utils/registrationProfile');

let current;
afterEach(() => { current?.restore(); current = null; });

function setup({ orphan = false, insertError = false } = {}) {
  current?.restore();
  const user = studentUser();
  const profile = { id: user.id, name: 'Rina', email: 'rina@example.test',
    phone_taiwan: '+886912345678', almamater_size: 'XL', salut_status: 'none' };
  const deleted = [];
  let signs = 0;
  current = stubBackend({
    user,
    query: { users: { findFirst: async () => orphan ? null : profile } },
    insert: insertError ? () => { throw new Error('DB unavailable'); } : insertChain([profile]),
    update: updateChain([profile]),
    auth: {
      signUp: async () => { signs++; return { data: { user: orphan ? null : user }, error: null }; },
      signInWithPassword: async () => ({ data: { user }, error: null }),
      signOut: async () => ({}),
      admin: { admin: { deleteUser: async id => { deleted.push(id); return { error: null }; } } },
    },
  });
  return { ...current, deleted, get signs() { return signs; } };
}

const body = () => ({
  email: 'rina@example.test', password: 'secure-pass', name: 'Rina', nim: '041234567', phone: '+6281234567890',
  birth_place: 'Jakarta', birth_date: '2000-01-01', program_id: '77777777-7777-7777-7777-777777777777', current_semester: 1,
  address_zh_city: 'Taipei', address_zh_district: 'Daan', address_zh_road: 'Road', address_zh_number: '1', postal_code: '110',
  bank_ntd_code: '700', bank_ntd_account: '00000000000000', profile_fields_version: 1,
  phone_taiwan: '0912 345 678', almamater_size: '  Ukuran khusus 2XL  ',
});
const register = data => request(app).post('/api/auth/register').set('X-Forwarded-For', freshIp()).send(data);
const updateProfile = data => request(app).put('/api/auth/me').set('Authorization', 'Bearer test').send(data);

test('Taiwan local, international, and formatted mobile values have one canonical result', () => {
  for (const value of ['0912345678', '0912 345 678', '+886 912-345-678', '886912345678']) {
    assert.equal(fields.normalizeTaiwanPhone(value), '+886912345678');
  }
});

test('Indonesian numbers, doubled trunk prefixes, and malformed values are refused', () => {
  for (const value of ['081234567890', '+6281234567890', '+8860912345678', '091234567', '09ABC45678', [], null]) {
    assert.equal(fields.normalizeTaiwanPhone(value), null);
  }
});

test('almamater sizes are free text, trimmed, and not a predefined dropdown', () => {
  for (const value of ['S', '2XL', 'XXXL', 'Ukuran khusus 120']) {
    assert.equal(fields.normalizeAlmamaterSize(`  ${value}  `), value);
  }
});

test('blank, oversized, multiline, and non-string sizes are refused', () => {
  for (const value of ['', '   ', 'L\nXL', 'x'.repeat(31), {}, null]) assert.equal(fields.normalizeAlmamaterSize(value), null);
});

test('new registrations cannot omit either new field', async () => {
  for (const field of ['phone_taiwan', 'almamater_size']) {
    const h = setup(), data = body();
    delete data[field];
    const res = await register(data);
    assert.equal(res.status, 400);
    assert.equal(h.signs, 0);
  }
});

test('invalid Taiwan phone is refused before creating the auth account', async () => {
  const h = setup();
  const res = await register({ ...body(), phone_taiwan: '+6281234567890' });
  assert.equal(res.status, 400);
  assert.equal(h.signs, 0);
});

test('registration persists the normalized Taiwan number and the free-text size separately from WhatsApp', async () => {
  const h = setup();
  const res = await register(body());
  assert.equal(res.status, 201);
  assert.equal(h.calls.values[0].phone_taiwan, '+886912345678');
  assert.equal(h.calls.values[0].phone, '+6281234567890');
  assert.equal(h.calls.values[0].almamater_size, 'Ukuran khusus 2XL');
});

test('orphaned auth-account recovery retains both new fields', async () => {
  const h = setup({ orphan: true });
  const res = await register(body());
  assert.equal(res.status, 201);
  assert.equal(h.calls.values[0].almamater_size, 'Ukuran khusus 2XL');
  assert.equal(h.calls.values[0].phone_taiwan, '+886912345678');
});

test('legacy registration remains compatible while frontend and backend deploy separately', async () => {
  const h = setup(), legacy = body();
  delete legacy.profile_fields_version; delete legacy.phone_taiwan; delete legacy.almamater_size;
  const res = await register(legacy);
  assert.equal(res.status, 201);
  assert.equal(h.calls.values[0].phone_taiwan, null);
  assert.equal(h.calls.values[0].almamater_size, null);
});

test('profile-insert failures still compensate by deleting only the newly created auth account', async () => {
  const h = setup({ insertError: true });
  const res = await register(body());
  assert.equal(res.status, 500);
  assert.deepEqual(h.deleted, [h.user.id]);
});

test('profile updates validate and store the new fields', async () => {
  const h = setup();
  const res = await updateProfile({ phone_taiwan: '0912345678', almamater_size: '  L  ' });
  assert.equal(res.status, 200);
  assert.equal(h.calls.set[0].phone_taiwan, '+886912345678');
  assert.equal(h.calls.set[0].almamater_size, 'L');
});

test('invalid profile update does not write the rejected fields to the database', async () => {
  const h = setup();
  const res = await updateProfile({ almamater_size: 'x'.repeat(31) });
  assert.equal(res.status, 400);
  assert.equal(h.calls.set.length, 0);
});

test('saving unrelated profile fields does not erase existing size or Taiwan contact', async () => {
  const h = setup();
  const res = await updateProfile({ name: 'Rina Baru' });
  assert.equal(res.status, 200);
  assert.equal('phone_taiwan' in h.calls.set[0], false);
  assert.equal('almamater_size' in h.calls.set[0], false);
});

test('older students can explicitly clear optional profile data', async () => {
  const h = setup();
  const res = await updateProfile({ phone_taiwan: '', almamater_size: null });
  assert.equal(res.status, 200);
  assert.equal(h.calls.set[0].phone_taiwan, null);
  assert.equal(h.calls.set[0].almamater_size, null);
});

test('getMe returns both saved fields for the profile form', async () => {
  setup();
  const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer test');
  assert.equal(res.status, 200);
  assert.equal(res.body.phone_taiwan, '+886912345678');
  assert.equal(res.body.almamater_size, 'XL');
});

test('the public registration configuration advertises the fields the backend persists', async () => {
  const res = await request(app).get('/api/config/registration');
  assert.equal(res.status, 200);
  assert.equal(res.body.profile_fields_version, 1);
  assert.equal(res.body.required_fields.includes('phone_taiwan'), true);
  assert.equal(res.body.required_fields.includes('almamater_size'), true);
  assert.equal(res.body.almamater_size_max_length, fields.SIZE_MAX_LENGTH);
});

test('the admin list selects the new fields and searches the Taiwan phone', async () => {
  const row = { id: studentUser().id, name: 'Rina', phone_taiwan: '+886912345678', almamater_size: 'Ukuran khusus 2XL' };
  const selected = [], predicates = [];
  const select = selectQueue([[row], [{ count: 1 }]]);
  current = stubBackend({
    user: adminUser(),
    select: columns => {
      selected.push(columns);
      const chain = select();
      const where = chain.where;
      chain.where = predicate => { predicates.push(predicate); return where(predicate); };
      return chain;
    },
  });
  const res = await request(app).get('/api/users/admin/all?search=0912').set('Authorization', 'Bearer test');
  assert.equal(res.status, 200);
  assert.equal(res.body.rows[0].phone_taiwan, row.phone_taiwan);
  assert.equal(res.body.rows[0].almamater_size, row.almamater_size);
  assert.equal(selected[0].phone_taiwan.name, 'phone_taiwan');
  assert.equal(selected[0].almamater_size.name, 'almamater_size');
  const query = new PgDialect().sqlToQuery(predicates[0]);
  assert.match(query.sql, /"phone_taiwan" ilike/);
  assert.ok(query.params.includes('%0912%'));
});
