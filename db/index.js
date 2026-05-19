const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
const env = require('../config/env');

// prepare: false required for transaction pooler (port 6543)
const schema = require('./schema');

const client = postgres(env.DATABASE_URL, { prepare: false });
const db = drizzle({ client, schema });

module.exports = { db };
