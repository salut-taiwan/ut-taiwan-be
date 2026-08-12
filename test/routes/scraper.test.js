'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, adminUser, studentUser, insertChain, selectChain, freshIp,
} = require('../helpers/testApp');
const scraperService = require('../../services/scraperService');

// The scraper rewrites the whole module catalogue, so starting a second one
// while the first is mid-flight would have two writers on the same rows.

const RUN_ID = '11111111-1111-1111-1111-111111111111';

const runRow = (over = {}) => ({
  id: RUN_ID,
  status: 'success',
  triggered_by: 'manual',
  started_at: '2026-05-20T00:00:00Z',
  finished_at: '2026-05-20T00:05:00Z',
  modules_added: 3,
  modules_updated: 1,
  modules_removed: 0,
  error_message: null,
  ...over,
});

let harness = null;
const originalService = {
  runScraper: scraperService.runScraper,
  runPrefixScraperService: scraperService.runPrefixScraperService,
};

afterEach(() => {
  harness?.restore();
  harness = null;
  Object.assign(scraperService, originalService);
});

/** Replace the long-running work with a recorder. */
function recordService() {
  const started = [];
  scraperService.runScraper = async (runId) => { started.push({ fn: 'runScraper', runId }); };
  scraperService.runPrefixScraperService = async (runId) => {
    started.push({ fn: 'runPrefixScraperService', runId });
  };
  return started;
}

function setup({ user = adminUser(), running = false, runs = [runRow()], insert, selectRows } = {}) {
  harness = stubBackend({
    user,
    // Two different selects share this stub: isScraperRunning (empty means
    // nothing in flight) and listRuns (the history itself).
    select: selectChain(selectRows ?? (running ? [{ id: 'in-flight' }] : [])),
    insert: insert ?? insertChain([{ id: RUN_ID }]),
    query: {
      scraper_runs: { findFirst: async () => runs[0], findMany: async () => runs },
      module_history: { findMany: async () => [] },
    },
  });
  return harness;
}

const authed = (method, path) =>
  request(app)[method](path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');

describe('starting a scraper run', () => {
  test('a student cannot start one', async () => {
    setup({ user: studentUser() });
    const res = await authed('post', '/api/scraper/run');
    assert.equal(res.status, 403);
  });

  test('an admin starts one and is given the run to follow', async () => {
    const started = recordService();
    setup();

    const res = await authed('post', '/api/scraper/run');

    assert.equal(res.status, 202);
    assert.equal(res.body.runId, RUN_ID);
    assert.equal(started[0].fn, 'runScraper');
    assert.equal(started[0].runId, RUN_ID);
  });

  test('a second run is refused while one is already going', async () => {
    // Two scrapers rewriting the catalogue at once would fight over the rows.
    const started = recordService();
    setup({ running: true });

    const res = await authed('post', '/api/scraper/run');

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Scraper sudah berjalan');
    assert.deepEqual(started, [], 'nothing was started');
  });

  test('the answer comes back before the work does — it takes minutes', async () => {
    // 202 Accepted, not 200: the response is a promise to start, not a result.
    recordService();
    setup();
    const res = await authed('post', '/api/scraper/run');
    assert.equal(res.status, 202);
  });

  test('the prefix run is recorded as its own kind of trigger', async () => {
    const started = recordService();
    const h = setup();

    const res = await authed('post', '/api/scraper/run-prefixes');

    assert.equal(res.status, 202);
    assert.equal(started[0].fn, 'runPrefixScraperService');
    assert.equal(h.calls.values[0].triggered_by, 'prefix-manual');
  });

  test('a manual run is labelled as manual', async () => {
    recordService();
    const h = setup();
    await authed('post', '/api/scraper/run');
    assert.equal(h.calls.values[0].triggered_by, 'manual');
  });

  test('a new run starts out marked as running', async () => {
    recordService();
    const h = setup();
    await authed('post', '/api/scraper/run');
    assert.equal(h.calls.values[0].status, 'running');
  });

  test('failing to record the run stops it from starting', async () => {
    const started = recordService();
    setup({ insert: insertChain([]) });

    const res = await authed('post', '/api/scraper/run');

    assert.equal(res.status, 500);
    assert.deepEqual(started, [], 'no untracked scraper is left running');
  });
});

describe('looking at past runs', () => {
  test('a student cannot', async () => {
    setup({ user: studentUser() });
    const res = await authed('get', '/api/scraper/runs');
    assert.equal(res.status, 403);
  });

  test('an admin sees the history with readable dates', async () => {
    setup({ selectRows: [runRow()] });
    const res = await authed('get', '/api/scraper/runs');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].modules_added, 3);
    assert.ok(res.body[0].started_at_display, 'dates are formatted for reading');
  });

  test('a run that does not exist is a 404', async () => {
    setup({ runs: [undefined] });
    const res = await authed('get', `/api/scraper/runs/${RUN_ID}`);
    assert.equal(res.status, 404);
  });

  test('a failed run keeps its error message for diagnosis', async () => {
    setup({ runs: [runRow({ status: 'failed', error_message: 'TBO timed out' })] });
    const res = await authed('get', `/api/scraper/runs/${RUN_ID}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.run.error_message, 'TBO timed out');
    assert.deepEqual(res.body.changes, [], 'a failed run changed nothing');
  });
});
