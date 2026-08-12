'use strict';

// Integration harness. No test database: the app is loaded with dummy env vars
// (postgres.js connects lazily, so nothing dials out) and the shared `db` and
// Supabase client objects are patched in place. Controllers destructure those
// objects once at require time but call their methods per request, so replacing
// the methods is enough to intercept every query.
//
// What this cannot cover: checkout_order / cancel_order / confirm_payment run as
// Postgres functions, so only the parameters sent to supabaseAdmin.rpc() are
// assertable here. The function bodies need a real database.

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.NODE_ENV ??= 'test';

const app = require('../../app');
const { db } = require('../../db');
const { supabase, supabaseAdmin } = require('../../config/supabase');

function notStubbed(name) {
  return () => { throw new Error(`${name} called but not stubbed in this test`); };
}

/**
 * Authenticate every request as `user` and route all DB access through stubs.
 *
 * @param {object} opts
 * @param {{ id: string, email?: string, role?: string }} opts.user
 * @param {object} [opts.query]   per-table stubs, e.g. { order_items: { findFirst: fn } }
 * @param {Function} [opts.update] db.update(...) — return the chain the caller expects
 * @param {Function} [opts.select] db.select(...)
 * @param {Function} [opts.execute] db.execute(...)
 * @param {Function} [opts.rpc]    supabaseAdmin.rpc(...)
 * @returns {{ restore: Function, calls: object }}
 */
function stubBackend({ user, query = {}, update, select, execute, rpc } = {}) {
  const original = {
    query: db.query,
    update: db.update,
    select: db.select,
    execute: db.execute,
    getUser: supabase.auth.getUser,
    rpc: supabaseAdmin.rpc,
    from: supabaseAdmin.from,
  };
  const calls = { execute: [], rpc: [], update: [], set: [] };

  // Verified by default — requireVerified gates the SALUT routes on this claim.
  supabase.auth.getUser = async () => ({
    data: {
      user: {
        id: user.id,
        email: user.email ?? 'test@example.com',
        email_confirmed_at: user.email_confirmed_at === undefined ? '2026-01-01T00:00:00Z' : user.email_confirmed_at,
      },
    },
    error: null,
  });

  // adminOnly reads the role through supabaseAdmin, not drizzle.
  supabaseAdmin.from = () => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: { role: user.role ?? 'student' }, error: null }) }) }),
  });

  supabaseAdmin.rpc = async (fn, params) => {
    calls.rpc.push({ fn, params });
    return rpc ? rpc(fn, params) : { data: null, error: null };
  };

  db.query = query;
  // authMiddleware heals is_verified on every request, so an unstubbed update
  // has to be a silent no-op rather than an error.
  const updateImpl = update ?? updateChain([]);
  db.update = (...args) => {
    calls.update.push(args);
    const chain = updateImpl(...args);
    // Record the column/value payload so tests can assert what was written.
    return { ...chain, set(values) { calls.set.push(values); return chain.set(values); } };
  };
  db.select = select ?? notStubbed('db.select');
  db.execute = execute
    ? (...args) => { calls.execute.push(args); return execute(...args); }
    : async (...args) => { calls.execute.push(args); return { rows: [] }; };

  return {
    calls,
    restore() { Object.assign(db, { query: original.query, update: original.update, select: original.select, execute: original.execute }); supabase.auth.getUser = original.getUser; supabaseAdmin.rpc = original.rpc; supabaseAdmin.from = original.from; },
  };
}

/** db.update(...).set(...).where(...) — and .returning(...) when the caller needs rows back. */
function updateChain(returning = []) {
  const chain = {
    set: () => chain,
    where: () => chain,
    returning: async () => returning,
    then: (resolve) => Promise.resolve(returning).then(resolve),
  };
  return () => chain;
}

/** db.select(...).from(...).where(...) resolving to `rows` (used for count() queries). */
function selectChain(rows) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    innerJoin: () => chain,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
  return () => chain;
}

module.exports = { app, stubBackend, updateChain, selectChain };
