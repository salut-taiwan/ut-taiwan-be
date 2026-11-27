'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
process.env.FRONTEND_URL = 'https://www.salut.example';
process.env.FRONTEND_PREVIEW_URL = 'https://preview.salut.example';
const { app, freshIp } = require('../helpers/testApp');

const visit = origin => request(app).get('/api/config/registration')
  .set('X-Forwarded-For', freshIp()).set('Origin', origin);

test('the explicitly configured HTTPS preview origin can read registration configuration', async () => {
  const res = await visit('https://preview.salut.example');
  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], 'https://preview.salut.example');
  assert.equal(res.body.profile_fields_version, 1);
});

test('both existing production hostname variants remain allowed', async () => {
  for (const origin of ['https://www.salut.example', 'https://salut.example']) {
    const res = await visit(origin);
    assert.equal(res.headers['access-control-allow-origin'], origin);
  }
});

test('similar-looking domains and other Vercel previews are not implicitly allowed', async () => {
  for (const origin of ['https://preview.salut.example.attacker.test', 'https://other.vercel.app', 'https://www.preview.salut.example', 'null']) {
    const res = await visit(origin);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
});
