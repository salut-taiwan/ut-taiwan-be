require('dotenv').config();
const { defineConfig } = require('drizzle-kit');

module.exports = defineConfig({
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
  schema: './db/schema.js',
  out: './drizzle',
});