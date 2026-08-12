'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

const { stubBackend, studentUser } = require('../helpers/testApp');
const { userStatusStream } = require('../../controllers/sseController');
const { emitUserStatusUpdate } = require('../../services/userStatusEventBus');

// Driven directly rather than over HTTP: the response never ends, so supertest
// would simply hang. This is the channel that tells a student their SALUT
// application was approved without them refreshing.

/** A response that records what was written instead of sending it. */
function fakeRes() {
  const res = {
    headers: {},
    chunks: [],
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    flushHeaders() { this.flushed = true; },
    write(chunk) { this.chunks.push(chunk); return true; },
    end() { this.ended = true; },
  };
  return res;
}

const fakeReq = (userId) => Object.assign(new EventEmitter(), { user: { id: userId } });

/** The JSON payloads written as SSE data frames. */
const frames = (res) => res.chunks
  .filter(c => c.startsWith('data: '))
  .map(c => JSON.parse(c.slice(6).trim()));

let harness = null;
const openStreams = [];

afterEach(() => {
  for (const req of openStreams.splice(0)) req.emit('close');
  harness?.restore();
  harness = null;
});

function setup(dbUser) {
  harness = stubBackend({
    user: studentUser(),
    query: { users: { findFirst: async () => dbUser } },
  });
  return harness;
}

async function openStream(userId, dbUser) {
  setup(dbUser);
  const req = fakeReq(userId);
  const res = fakeRes();
  openStreams.push(req);
  await userStatusStream(req, res);
  return { req, res };
}

describe('opening the stream', () => {
  test('the headers say this is a long-lived event stream', async () => {
    const { res } = await openStream(randomUUID(), { is_salut: false, salut_status: 'none' });

    assert.equal(res.headers['content-type'], 'text/event-stream');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal(res.headers['connection'], 'keep-alive');
    assert.equal(res.flushed, true, 'headers must go out before the first frame');
  });

  test('the first frame carries the status as it stands right now', async () => {
    const { res } = await openStream(randomUUID(), {
      is_salut: true, salut_status: 'approved', salut_approved_at: new Date().toISOString(),
    });

    assert.deepEqual(frames(res)[0], {
      is_salut: true, is_salut_active: true, salut_status: 'approved',
    });
  });

  test('a lapsed membership opens as inactive even though the flag is set', async () => {
    const { res } = await openStream(randomUUID(), {
      is_salut: true, salut_status: 'approved', salut_approved_at: '2020-01-01T00:00:00Z',
    });

    assert.equal(frames(res)[0].is_salut_active, false);
  });

  test('a user with no profile row still gets a usable frame', async () => {
    const { res } = await openStream(randomUUID(), undefined);

    assert.deepEqual(frames(res)[0], {
      is_salut: false, is_salut_active: false, salut_status: 'none',
    });
  });

  test('a database failure sends a safe default rather than closing the stream', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { users: { findFirst: async () => { throw new Error('db down'); } } },
    });
    const req = fakeReq(randomUUID());
    const res = fakeRes();
    openStreams.push(req);

    await userStatusStream(req, res);

    assert.deepEqual(frames(res)[0], {
      is_salut: false, is_salut_active: false, salut_status: 'none',
    });
    assert.equal(res.ended, false, 'the stream stays open');
  });
});

describe('pushing updates', () => {
  test('an approval reaches the student who was approved', async () => {
    const userId = randomUUID();
    const { res } = await openStream(userId, { is_salut: false, salut_status: 'pending' });

    emitUserStatusUpdate(userId, { is_salut: true, is_salut_active: true, salut_status: 'approved' });

    assert.equal(frames(res).length, 2);
    assert.equal(frames(res)[1].salut_status, 'approved');
  });

  test('it reaches nobody else', async () => {
    const mine = await openStream(randomUUID(), { is_salut: false, salut_status: 'none' });

    emitUserStatusUpdate(randomUUID(), { is_salut: true, is_salut_active: true, salut_status: 'approved' });

    assert.equal(frames(mine.res).length, 1, 'only the opening frame');
  });

  test('every frame is terminated so the browser dispatches it', async () => {
    const userId = randomUUID();
    const { res } = await openStream(userId, { is_salut: false, salut_status: 'none' });
    emitUserStatusUpdate(userId, { is_salut: true, is_salut_active: true, salut_status: 'approved' });

    for (const chunk of res.chunks) {
      assert.ok(chunk.endsWith('\n\n'), `frame not terminated: ${JSON.stringify(chunk)}`);
    }
  });
});

describe('keeping the connection alive', () => {
  test('a comment is sent periodically so a proxy does not drop the stream', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const userId = randomUUID();
    const { res } = await openStream(userId, { is_salut: false, salut_status: 'none' });

    t.mock.timers.tick(25_000);

    assert.ok(res.chunks.includes(': ping\n\n'));
    t.mock.timers.reset();
  });
});

describe('when the student navigates away', () => {
  test('the stream is closed and stops receiving updates', async () => {
    const userId = randomUUID();
    const { req, res } = await openStream(userId, { is_salut: false, salut_status: 'none' });
    const before = frames(res).length;

    req.emit('close');
    emitUserStatusUpdate(userId, { is_salut: true, is_salut_active: true, salut_status: 'approved' });

    assert.equal(res.ended, true);
    assert.equal(frames(res).length, before, 'no frame written after close');
  });

  test('closing twice is harmless', async () => {
    const userId = randomUUID();
    const { req } = await openStream(userId, { is_salut: false, salut_status: 'none' });

    req.emit('close');
    assert.doesNotThrow(() => req.emit('close'));
  });
});
