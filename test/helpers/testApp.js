'use strict';

// Integration harness. No test database: the app is loaded with dummy env vars
// (postgres.js connects lazily, so nothing dials out) and the shared `db` and
// Supabase client objects are patched in place. Controllers destructure those
// objects once at require time but call their methods per request, so replacing
// the methods is enough to intercept every query.
//
// HOUSE RULES, learned the hard way:
//
//   * Email must be sent as `emailService.sendX(...)`, never as a destructured
//     `const { sendX } = require(...)`. The recorder patches the module object,
//     so a destructured binding escapes it and becomes untestable here.
//   * Never reuse a user id across two tests with different roles in the same
//     file. middleware/adminOnly.js caches roles for five minutes keyed by id
//     and never invalidates. Use adminUser()/studentUser(), which mint fresh
//     uuids, and the cache can never serve a stale role.
//   * Every checkout happy path must stub `rpc`. The default returns
//     { data: null }, and the controller then reads `rpcData.order` — a
//     TypeError that becomes an unhandled rejection and hangs the whole file.
//
// What this tier cannot cover: checkout_order / cancel_order / confirm_payment
// run as Postgres functions, so only the parameters sent to supabaseAdmin.rpc()
// are assertable here. The function bodies need a real database — see
// test/system/.

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.NODE_ENV ??= 'test';

const { randomUUID } = require('node:crypto');
const app = require('../../app');
const { db } = require('../../db');
const { supabase, supabaseAdmin } = require('../../config/supabase');
const emailService = require('../../services/emailService');
const orderEmailService = require('../../services/orderEmailService');

/** A user whose role the admin guard will accept. Fresh id every call. */
const adminUser = (over = {}) => ({ id: randomUUID(), role: 'admin', ...over });
/** A plain student. Fresh id every call. */
const studentUser = (over = {}) => ({ id: randomUUID(), role: 'student', ...over });

function notStubbed(name) {
  return () => { throw new Error(`${name} called but not stubbed in this test`); };
}

/** A thenable fluent chain: every verb returns itself, awaiting yields `rows`. */
function makeChain(rows, verbs, recorder) {
  const chain = {};
  for (const verb of verbs) {
    chain[verb] = (...args) => { recorder?.(verb, args); return chain; };
  }
  chain.returning = async () => rows;
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const UPDATE_VERBS = ['set', 'where', 'from'];
const INSERT_VERBS = ['values', 'onConflictDoUpdate', 'onConflictDoNothing'];
const DELETE_VERBS = ['where'];
const SELECT_VERBS = ['from', 'where', 'limit', 'offset', 'orderBy', 'groupBy', 'innerJoin', 'leftJoin'];

/** db.update(t).set(v).where(p) — add .returning() when the caller needs rows. */
function updateChain(returning = []) {
  return () => makeChain(returning, UPDATE_VERBS);
}

/** db.insert(t).values(v)[.onConflictDoUpdate(cfg)][.returning()] */
function insertChain(returning = []) {
  return () => makeChain(returning, INSERT_VERBS);
}

/** db.delete(t).where(p) */
function deleteChain(returning = []) {
  return () => makeChain(returning, DELETE_VERBS);
}

/** db.select(...).from(...).where(...) resolving to `rows`. */
function selectChain(rows) {
  return () => makeChain(rows, SELECT_VERBS);
}

/**
 * Successive db.select() calls resolve to successive result sets. Needed
 * wherever a controller fires two different selects in one Promise.all — a
 * single selectChain would serve the same rows to both.
 */
function selectQueue(resultSets) {
  let i = 0;
  return () => {
    // Cycles once exhausted, so a test that issues the same request twice does
    // not have to restate the whole queue.
    const rows = resultSets[i % resultSets.length];
    i += 1;
    return makeChain(rows, SELECT_VERBS);
  };
}

/** Successive db.query.<table>.findFirst() calls resolve to successive rows. */
function queueFindFirst(rows) {
  let i = 0;
  return async () => (i < rows.length ? rows[i++] : rows[rows.length - 1]);
}

const EMAIL_METHODS = Object.keys(emailService).filter(k => k.startsWith('send'));
const ORDER_EMAIL_METHODS = ['fetchOrderEmailPayload', 'sendStatusEmail'];

/**
 * Records every email send and lets a test await one. Sends are fire-and-forget
 * after res.json(), so without this the assertion races the response.
 */
function makeEmailRecorder() {
  const sent = [];
  const waiters = new Map();
  const failing = new Set();

  function record(name, args) {
    const entry = { name, args, payload: args[0] };
    sent.push(entry);
    const waiter = waiters.get(name);
    if (waiter) { waiters.delete(name); waiter.resolve(entry.payload); }
    if (failing.delete(name)) return Promise.reject(new Error(`${name} failed: Resend is down`));
    return Promise.resolve({ ok: true });
  }

  return {
    sent,
    /**
     * Make the next `name` send reject. Sends are fire-and-forget after
     * res.json(), so this is how a test proves a mail outage cannot turn a
     * successful action into a failed request or an unhandled rejection.
     */
    failNext: (name) => failing.add(name),
    /** Payloads sent through `name`, in order. */
    of: (name) => sent.filter(e => e.name === name).map(e => e.payload),
    /** Resolves with the payload when `name` is sent; rejects if it never is. */
    next(name, timeoutMs = 200) {
      const already = sent.find(e => e.name === name);
      if (already) return Promise.resolve(already.payload);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => { waiters.delete(name); reject(new Error(`${name} was never sent (waited ${timeoutMs}ms)`)); },
          timeoutMs,
        );
        waiters.set(name, { resolve: (p) => { clearTimeout(timer); resolve(p); } });
      });
    },
    record,
  };
}

/**
 * Authenticate every request as `user` and route all I/O through stubs.
 *
 * @param {object} opts
 * @param {{id?:string, email?:string, role?:string, email_confirmed_at?:string|null}} [opts.user]
 * @param {object}   [opts.query]    per-table stubs, e.g. { orders: { findFirst } }
 * @param {Function} [opts.update]   db.update(...)
 * @param {Function} [opts.insert]   db.insert(...)
 * @param {Function} [opts.delete]   db.delete(...)
 * @param {Function} [opts.select]   db.select(...)
 * @param {Function} [opts.execute]  db.execute(...)
 * @param {Function} [opts.rpc]      supabaseAdmin.rpc(fn, params)
 * @param {object}   [opts.storage]  per-op overrides: {upload, download, createSignedUrl}
 * @param {object}   [opts.auth]     supabase.auth.* overrides for authController
 * @param {number}   [opts.random]   freeze Math.random (order number, unique code)
 * @returns {{calls:object, email:object, unhandled:Error[], restore:Function}}
 */
function stubBackend(opts = {}) {
  const {
    user = studentUser(),
    query = {},
    update, insert, select, execute, rpc,
    storage = {},
    auth = {},
    random,
  } = opts;

  const original = {
    query: db.query, update: db.update, insert: db.insert,
    delete: db.delete, select: db.select, execute: db.execute,
    auth: { ...supabase.auth },
    adminAuth: supabaseAdmin.auth,
    rpc: supabaseAdmin.rpc, from: supabaseAdmin.from, storage: supabaseAdmin.storage,
    random: Math.random,
    email: Object.fromEntries(EMAIL_METHODS.map(m => [m, emailService[m]])),
    orderEmail: Object.fromEntries(ORDER_EMAIL_METHODS.map(m => [m, orderEmailService[m]])),
  };

  const calls = {
    execute: [], rpc: [], update: [], set: [], insert: [], values: [],
    onConflict: [], delete: [], storage: [], auth: [],
    // authMiddleware heals users.is_verified on every authenticated request.
    // It is recorded separately so `calls.set` only ever holds writes the
    // endpoint under test actually made.
    authHeal: [],
  };
  const isAuthHeal = (values) =>
    values && Object.keys(values).length === 1 && values.is_verified === true;
  const email = makeEmailRecorder();
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);

  if (typeof random === 'number') Math.random = () => random;

  // --- auth ----------------------------------------------------------------
  // Verified by default: requireVerified gates checkout and the SALUT apply.
  supabase.auth = {
    ...supabase.auth,
    getUser: async (token) => {
      calls.auth.push({ op: 'getUser', token });
      return {
        data: {
          user: {
            id: user.id,
            email: user.email ?? 'test@example.com',
            email_confirmed_at: user.email_confirmed_at === undefined
              ? '2026-01-01T00:00:00Z'
              : user.email_confirmed_at,
          },
        },
        error: null,
      };
    },
    ...auth,
  };
  if (auth.admin) supabaseAdmin.auth = auth.admin;

  // adminOnly reads the role through supabaseAdmin, not drizzle.
  supabaseAdmin.from = (table) => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { role: user.role ?? 'student' }, error: null, table }),
      }),
    }),
  });

  supabaseAdmin.rpc = async (fn, params) => {
    calls.rpc.push({ fn, params });
    return rpc ? rpc(fn, params) : { data: null, error: null };
  };

  // --- storage -------------------------------------------------------------
  supabaseAdmin.storage = {
    from: (bucket) => ({
      upload: async (path, body, options) => {
        calls.storage.push({ op: 'upload', bucket, path, options });
        return storage.upload ? storage.upload({ bucket, path, body, options })
          : { data: { path }, error: null };
      },
      download: async (path) => {
        calls.storage.push({ op: 'download', bucket, path });
        if (storage.download) return storage.download({ bucket, path });
        const bytes = Buffer.from('test-file');
        return { data: { arrayBuffer: async () => bytes }, error: null };
      },
      createSignedUrl: async (path, expiresIn) => {
        calls.storage.push({ op: 'createSignedUrl', bucket, path, expiresIn });
        return storage.createSignedUrl ? storage.createSignedUrl({ bucket, path, expiresIn })
          : { data: { signedUrl: `https://signed.test/${bucket}/${path}` }, error: null };
      },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://public.test/${bucket}/${path}` } }),
    }),
  };

  // --- email ---------------------------------------------------------------
  for (const m of EMAIL_METHODS) emailService[m] = (...args) => email.record(m, args);
  for (const m of ORDER_EMAIL_METHODS) {
    orderEmailService[m] = (...args) => email.record(m, args);
  }

  // --- drizzle -------------------------------------------------------------
  db.query = query;

  // authMiddleware heals is_verified on every request, so an unstubbed update
  // must be a silent no-op rather than an error.
  const updateImpl = update ?? updateChain([]);
  db.update = (...args) => {
    calls.update.push(args);
    return makeChain(
      updateImpl(...args),
      UPDATE_VERBS,
      (verb, verbArgs) => {
        if (verb !== 'set') return;
        (isAuthHeal(verbArgs[0]) ? calls.authHeal : calls.set).push(verbArgs[0]);
      },
    );
  };

  const insertImpl = insert ?? insertChain([]);
  db.insert = (...args) => {
    calls.insert.push(args);
    return makeChain(
      insertImpl(...args),
      INSERT_VERBS,
      (verb, verbArgs) => {
        if (verb === 'values') calls.values.push(verbArgs[0]);
        if (verb === 'onConflictDoUpdate') calls.onConflict.push(verbArgs[0]);
      },
    );
  };

  const deleteImpl = opts.delete ?? deleteChain([]);
  db.delete = (...args) => { calls.delete.push(args); return deleteImpl(...args); };

  db.select = select ?? notStubbed('db.select');
  db.execute = execute
    ? (...args) => { calls.execute.push(args); return execute(...args); }
    // Mirrors postgres.js: the result is an Array, and `.rows` is undefined.
    : async (...args) => { calls.execute.push(args); return Object.assign([], { count: 0 }); };

  return {
    calls,
    email,
    unhandled,
    user,
    restore() {
      Object.assign(db, {
        query: original.query, update: original.update, insert: original.insert,
        delete: original.delete, select: original.select, execute: original.execute,
      });
      supabase.auth = original.auth;
      supabaseAdmin.auth = original.adminAuth;
      supabaseAdmin.rpc = original.rpc;
      supabaseAdmin.from = original.from;
      supabaseAdmin.storage = original.storage;
      Math.random = original.random;
      Object.assign(emailService, original.email);
      Object.assign(orderEmailService, original.orderEmail);
      process.off('unhandledRejection', onUnhandled);
    },
  };
}

/**
 * A fresh client IP per test. express-rate-limit keys on req.ip and the app
 * trusts one proxy hop, so without this the 200-request budget is shared.
 */
let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

module.exports = {
  app,
  stubBackend,
  adminUser,
  studentUser,
  updateChain,
  insertChain,
  deleteChain,
  selectChain,
  selectQueue,
  queueFindFirst,
  freshIp,
};
