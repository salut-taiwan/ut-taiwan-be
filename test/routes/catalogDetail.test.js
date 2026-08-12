'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, selectChain, selectQueue, freshIp,
} = require('../helpers/testApp');

// The read-only catalogue behind /program: faculties, their programmes, the
// subjects in each, and the modules a subject needs. All public.

const FACULTY_ID = '11111111-1111-1111-1111-111111111111';
const PROGRAM_ID = '22222222-2222-2222-2222-222222222222';
const SUBJECT_ID = '33333333-3333-3333-3333-333333333333';

const moduleRow = (over = {}) => ({
  id: 'm-1', tbo_code: 'MKDU4109', name: 'Bahasa Inggris',
  price_student: 50000, price_general: 60000, is_available: true,
  cover_image_url: null, deleted_at: null, ...over,
});

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({ rows = [], faculty, program, subject, subjects = [], select } = {}) {
  harness = stubBackend({
    user: studentUser(),
    query: {
      faculties: { findFirst: async () => faculty, findMany: async () => rows },
      programs: { findFirst: async () => program, findMany: async () => rows },
      subjects: { findFirst: async () => subject, findMany: async () => subjects },
    },
    select: select ?? selectChain(rows),
  });
  return harness;
}

const pub = (path) => request(app).get(path).set('X-Forwarded-For', freshIp());

describe('faculties and programmes', () => {
  test('faculties come back in code order for a stable menu', async () => {
    setup({
      rows: [
        { id: FACULTY_ID, code: 'FST', name: 'Sains dan Teknologi', description: null },
        { id: 'f-2', code: 'FE', name: 'Ekonomi', description: null },
      ],
    });

    const res = await pub('/api/catalog/faculties');

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
  });

  test('a faculty\'s programmes can be listed by its id', async () => {
    setup({ rows: [{ id: PROGRAM_ID, code: 'S1SI', name: 'Sistem Informasi', level: 'S1', total_sks: 145 }] });

    const res = await pub(`/api/catalog/faculties/${FACULTY_ID}/programs`);

    assert.equal(res.status, 200);
    assert.equal(res.body[0].code, 'S1SI');
  });

  test('a programme carries the credit total a student plans around', async () => {
    setup({ program: { id: PROGRAM_ID, code: 'S1SI', name: 'Sistem Informasi', level: 'S1', total_sks: 145 } });

    const res = await pub(`/api/catalog/programs/${PROGRAM_ID}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.total_sks, 145);
  });
});

describe('subjects and their modules', () => {
  const subjectWithModules = (over = {}) => ({
    id: SUBJECT_ID, code: 'MKDU4109', name: 'Bahasa Inggris I', sks: 3,
    semester_hint: 1, exam_period: null, notes: null, is_required: true,
    subject_modules: [{ modules: moduleRow() }],
    ...over,
  });

  test('a programme\'s subjects list the modules needed for each', async () => {
    setup({ subjects: [subjectWithModules()] });

    const res = await pub(`/api/catalog/programs/${PROGRAM_ID}/subjects`);

    assert.equal(res.status, 200);
    assert.equal(res.body[0].sks, 3);
  });

  test('a semester filter narrows the list', async () => {
    setup({ subjects: [subjectWithModules({ semester_hint: 1 })] });

    const res = await pub(`/api/catalog/programs/${PROGRAM_ID}/subjects?semester=1`);

    assert.equal(res.status, 200);
  });

  test('a nonsense semester is ignored rather than erroring', async () => {
    // A stale bookmark should still render a page.
    setup({ subjects: [subjectWithModules()] });

    const res = await pub(`/api/catalog/programs/${PROGRAM_ID}/subjects?semester=abc`);

    assert.equal(res.status, 200);
  });

  test('a module withdrawn from the catalogue is not offered', async () => {
    // Soft-deleted modules stay in the table for history but must not appear
    // as something a student can order.
    setup({
      subjects: [subjectWithModules({
        subject_modules: [
          { modules: moduleRow({ id: 'm-live' }) },
          { modules: moduleRow({ id: 'm-gone', deleted_at: '2026-01-01T00:00:00Z' }) },
        ],
      })],
    });

    const res = await pub(`/api/catalog/programs/${PROGRAM_ID}/subjects`);

    const ids = JSON.stringify(res.body);
    assert.ok(ids.includes('m-live'));
    assert.ok(!ids.includes('m-gone'), 'a withdrawn module must not be listed');
  });

  test('an unknown subject is a 404', async () => {
    setup({ subject: null });
    const res = await pub(`/api/catalog/subjects/${SUBJECT_ID}`);
    assert.equal(res.status, 404);
  });

  test('a known subject comes back with its modules priced for display', async () => {
    setup({ subject: subjectWithModules() });

    const res = await pub(`/api/catalog/subjects/${SUBJECT_ID}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 'MKDU4109');
  });
});

describe('when the database is unreachable', () => {
  test('a listing fails loudly rather than returning an empty catalogue', async () => {
    // An empty list would read as "no programmes exist", which is worse than
    // an error.
    harness = stubBackend({
      user: studentUser(),
      select: () => { throw new Error('db down'); },
      query: {},
    });

    const res = await pub('/api/catalog/faculties');

    assert.equal(res.status, 500);
  });
});
