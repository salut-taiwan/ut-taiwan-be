'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, insertChain, updateChain, freshIp,
} = require('../helpers/testApp');
const { listBanks } = require('../../config/banks');

const AUTH_ID = '66666666-6666-6666-6666-666666666666';
const [NTD_BANK] = listBanks('NTD');
const [IDR_BANK] = listBanks('IDR');

const REGISTRATION = {
  email: 'budi@example.com',
  password: 'sangat-rahasia',
  name: 'Budi Santoso',
  nim: '041234567',
  phone: '081234567890',
  birth_place: 'Jakarta',
  birth_date: '2000-01-01',
  program_id: '77777777-7777-7777-7777-777777777777',
  current_semester: 1,
  address_zh_city: '台北市',
  address_zh_district: '中正區',
  address_zh_road: '羅斯福路',
  address_zh_number: '1號',
  postal_code: '10617',
  bank_ntd_code: NTD_BANK.code,
  bank_ntd_account: '1234567890',
};

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({
  authUser = { id: AUTH_ID, email: REGISTRATION.email },
  signUpError = null,
  signInResult,
  existingProfile,
  profile,
  insert,
  session,
} = {}) {
  const deleted = [];
  harness = stubBackend({
    user: studentUser({ id: AUTH_ID }),
    query: { users: { findFirst: async () => existingProfile ?? profile } },
    insert: insert ?? insertChain([{ id: AUTH_ID }]),
    update: updateChain([{ id: AUTH_ID }]),
    auth: {
      signUp: async () => ({ data: { user: authUser }, error: signUpError }),
      signInWithPassword: async () => signInResult ?? {
        data: {
          user: { id: AUTH_ID, email: REGISTRATION.email, email_confirmed_at: '2026-01-01T00:00:00Z' },
          session: session ?? {
            access_token: 'tok', refresh_token: 'ref',
            expires_at: 1800000000, expires_in: 3600,
          },
        },
        error: null,
      },
      signOut: async () => ({ error: null }),
      refreshSession: async () => ({
        data: { session: { access_token: 'new', refresh_token: 'newref', expires_at: 1800000000 } },
        error: null,
      }),
      resend: async () => ({ error: null }),
      admin: { admin: { deleteUser: async (id) => { deleted.push(id); return { error: null }; } } },
    },
  });
  harness.deleted = deleted;
  return harness;
}

const post = (path, body) =>
  request(app).post(path).set('X-Forwarded-For', freshIp()).send(body);

describe('POST /api/auth/register — validation', () => {
  const required = [
    'email', 'password', 'name', 'nim', 'phone', 'birth_place', 'birth_date',
    'program_id', 'address_zh_city', 'address_zh_district', 'address_zh_road',
    'address_zh_number', 'postal_code',
  ];

  for (const field of required) {
    test(`${field} is required`, async () => {
      setup();
      const res = await post('/api/auth/register', { ...REGISTRATION, [field]: undefined });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /wajib diisi/);
    });
  }

  test('the semester must be a whole number between 1 and 9', async () => {
    setup();
    for (const bad of [0, 10, '1', 1.5, undefined]) {
      const res = await post('/api/auth/register', { ...REGISTRATION, current_semester: bad });
      assert.equal(res.status, 400, `${String(bad)} should be refused`);
      assert.match(res.body.error, /1-9/);
    }
  });

  test('at least one bank account is required', async () => {
    setup();
    const res = await post('/api/auth/register', {
      ...REGISTRATION, bank_ntd_code: undefined, bank_ntd_account: undefined,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /minimal satu rekening bank/);
  });

  test('a half-filled account does not count as one', async () => {
    setup();
    const res = await post('/api/auth/register', {
      ...REGISTRATION, bank_ntd_account: undefined,
    });
    assert.equal(res.status, 400);
  });

  test('an IDR account alone is enough', async () => {
    setup();
    const res = await post('/api/auth/register', {
      ...REGISTRATION,
      bank_ntd_code: undefined, bank_ntd_account: undefined,
      bank_idr_name: IDR_BANK.name, bank_idr_account: '999',
    });
    assert.equal(res.status, 201);
  });

  test('an unknown NTD bank code is refused', async () => {
    setup();
    const res = await post('/api/auth/register', { ...REGISTRATION, bank_ntd_code: '000000' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Kode bank NTD tidak dikenal');
  });

  test('an unknown IDR bank name is refused', async () => {
    setup();
    const res = await post('/api/auth/register', {
      ...REGISTRATION,
      bank_ntd_code: undefined, bank_ntd_account: undefined,
      bank_idr_name: 'Bank Antah Berantah', bank_idr_account: '1',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Nama bank IDR tidak dikenal');
  });

  test('the bank name is resolved from the code, ignoring whatever the client sent', async () => {
    const h = setup();
    await post('/api/auth/register', { ...REGISTRATION, bank_ntd_name: 'Bank Palsu' });
    assert.equal(h.calls.values[0].bank_ntd_name, NTD_BANK.name);
  });
});

describe('POST /api/auth/register — account creation', () => {
  test('a new account creates the profile under the same id', async () => {
    const h = setup();
    const res = await post('/api/auth/register', REGISTRATION);
    assert.equal(res.status, 201);
    assert.equal(res.body.userId, AUTH_ID);
    assert.equal(h.calls.values[0].id, AUTH_ID);
  });

  test('a sign-up refusal is passed on', async () => {
    setup({ signUpError: { message: 'Password should be at least 6 characters' } });
    const res = await post('/api/auth/register', REGISTRATION);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Password/);
  });

  test('an address already registered is reported as a conflict', async () => {
    setup({ authUser: null, signInResult: { data: {}, error: { message: 'Invalid login credentials' } } });
    const res = await post('/api/auth/register', REGISTRATION);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Email sudah terdaftar.');
  });

  test('registering again with the right password points the user at login', async () => {
    setup({ authUser: null, existingProfile: { id: AUTH_ID } });
    const res = await post('/api/auth/register', REGISTRATION);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /silakan login/);
  });

  test('an auth account with no profile is repaired rather than blocked', async () => {
    // A previous registration that failed halfway leaves an auth user with no
    // profile row; the user could otherwise never register or log in.
    const h = setup({ authUser: null, existingProfile: null });
    const res = await post('/api/auth/register', REGISTRATION);
    assert.equal(res.status, 201);
    assert.match(res.body.message, /dipulihkan/);
    assert.equal(h.calls.values[0].id, AUTH_ID);
  });

  test('a failed profile write deletes the auth account it just created', async () => {
    // Otherwise the address is permanently unusable: sign-up says taken, login
    // finds no profile.
    const h = setup({ insert: () => { throw new Error('unique violation'); } });
    const res = await post('/api/auth/register', REGISTRATION);
    assert.equal(res.status, 500);
    assert.match(res.body.error, /Gagal membuat profil/);
    assert.deepEqual(h.deleted, [AUTH_ID]);
  });
});

describe('POST /api/auth/login', () => {
  test('credentials are required', async () => {
    setup();
    const res = await post('/api/auth/login', { email: 'a@b.c' });
    assert.equal(res.status, 400);
  });

  test('a successful login returns a session and only the safe user fields', async () => {
    setup();
    const res = await post('/api/auth/login', { email: 'a@b.c', password: 'x' });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.ok(res.body.refreshToken);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['email', 'id']);
  });

  test('an unverified account is refused with a code the UI can act on', async () => {
    setup({ signInResult: { data: {}, error: { message: 'Email not confirmed' } } });
    const res = await post('/api/auth/login', { email: 'a@b.c', password: 'x' });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'EMAIL_NOT_CONFIRMED');
  });

  test('a wrong password never reveals whether the account exists', async () => {
    setup({ signInResult: { data: {}, error: { message: 'Invalid login credentials' } } });
    const res = await post('/api/auth/login', { email: 'a@b.c', password: 'wrong' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Email atau password salah');
    assert.equal(res.body.code, undefined);
  });
});

describe('POST /api/auth/refresh', () => {
  test('a refresh token is required', async () => {
    setup();
    const res = await post('/api/auth/refresh', {});
    assert.equal(res.status, 400);
  });

  test('a valid token yields a rotated session', async () => {
    setup();
    const res = await post('/api/auth/refresh', { refreshToken: 'ref' });
    assert.equal(res.status, 200);
    assert.equal(res.body.token, 'new');
    assert.equal(res.body.refreshToken, 'newref');
  });
});

describe('GET and PUT /api/auth/me', () => {
  const authed = (method) =>
    request(app)[method]('/api/auth/me')
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', 'Bearer t');

  test('a missing profile is reported with a code the client recognises', async () => {
    setup({ profile: null });
    const res = await authed('get');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'PROFILE_MISSING');
  });

  test('a lapsed membership reads as expired without the client doing date maths', async () => {
    setup({
      profile: {
        id: AUTH_ID, email: 'a@b.c', name: 'Budi',
        is_salut: true, salut_status: 'approved', salut_approved_at: '2020-01-01T00:00:00Z',
      },
    });
    const res = await authed('get');
    assert.equal(res.body.salut_status, 'expired');
    assert.equal(res.body.is_salut_active, false);
  });

  test('a current membership is reported as approved and active', async () => {
    setup({
      profile: {
        id: AUTH_ID, email: 'a@b.c', name: 'Budi',
        is_salut: true, salut_status: 'approved', salut_approved_at: new Date().toISOString(),
      },
    });
    const res = await authed('get');
    assert.equal(res.body.salut_status, 'approved');
    assert.equal(res.body.is_salut_active, true);
  });

  test('a pending application is never masked', async () => {
    setup({
      profile: { id: AUTH_ID, email: 'a@b.c', name: 'Budi', salut_status: 'pending', salut_approved_at: null },
    });
    const res = await authed('get');
    assert.equal(res.body.salut_status, 'pending');
  });

  test('a profile update writes only the fields a user is allowed to change', async () => {
    const h = setup({ profile: { id: AUTH_ID, email: 'a@b.c', name: 'Budi' } });
    await authed('put').send({ name: 'Budi Baru', phone: '0812' });
    const written = h.calls.set[0];
    assert.equal(written.name, 'Budi Baru');
    assert.equal(written.phone, '0812');
  });

  test('a user cannot promote themselves or grant their own membership', async () => {
    // The allow-list is the privilege-escalation guard: anything outside it is
    // dropped silently rather than written.
    const h = setup({ profile: { id: AUTH_ID, email: 'a@b.c', name: 'Budi' } });
    await authed('put').send({
      name: 'Budi', role: 'admin', is_salut: true, salut_status: 'approved',
      id: 'someone-else', email: 'attacker@example.com', is_verified: true,
    });
    const written = h.calls.set[0];
    for (const forbidden of ['role', 'is_salut', 'salut_status', 'id', 'email', 'is_verified']) {
      assert.equal(written[forbidden], undefined, `${forbidden} must not be writable`);
    }
  });

  test('an update always stamps the modification time', async () => {
    const h = setup({ profile: { id: AUTH_ID, email: 'a@b.c', name: 'Budi' } });
    await authed('put').send({ name: 'Budi' });
    assert.ok(h.calls.set[0].updated_at instanceof Date);
  });

  test('an unknown bank code is refused on update too', async () => {
    setup({ profile: { id: AUTH_ID, email: 'a@b.c', name: 'Budi' } });
    const res = await authed('put').send({ bank_ntd_code: '000000' });
    assert.equal(res.status, 400);
  });
});
