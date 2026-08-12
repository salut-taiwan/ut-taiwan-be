'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

/** Load a module in a clean process with a controlled environment. */
function requireIn(moduleId, env) {
  return execFileSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(moduleId)}); console.log('loaded');`],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_ANON_KEY: 'test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        // dotenv would otherwise load the developer's own .env and hide the gap.
        DOTENV_CONFIG_PATH: '/dev/null',
        ...env,
      },
    },
  );
}

describe('the server starts without an email provider', () => {
  test('emailService loads with no RESEND_API_KEY', () => {
    // The Resend constructor throws on a missing key. Building the client at
    // require time meant a deployment without the key could not boot at all,
    // even though config/env.js treats it as optional and _send skips sending
    // when it is absent.
    const out = requireIn('./services/emailService', {});
    assert.match(out, /loaded/);
  });

  test('the whole app loads with no RESEND_API_KEY', () => {
    const out = requireIn('./app', {});
    assert.match(out, /loaded/);
  });

  test('and still loads when the key is present', () => {
    const out = requireIn('./services/emailService', { RESEND_API_KEY: 're_test_key' });
    assert.match(out, /loaded/);
  });
});
