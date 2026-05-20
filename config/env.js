require('dotenv').config();

const env = {
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Database (Drizzle ORM direct connection)
  DATABASE_URL: process.env.DATABASE_URL,

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  // TBO
  TBO_BASE_URL: process.env.TBO_BASE_URL || 'http://tbo.karunika.co.id',

  // Frontend
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Public URL of this API (used to build storage proxy URLs in DTOs).
  // Defaults to localhost in dev so URLs work locally; set in prod.
  API_PUBLIC_URL: process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`,

  // Email (Resend)
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM || 'UT Taiwan <noreply@ut-taiwan.com>',
};

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const recommended = ['RESEND_API_KEY'];
for (const key of required) {
  if (!env[key]) {
    console.warn(`Warning: Missing environment variable ${key}`);
  }
}
for (const key of recommended) {
  if (!env[key]) {
    console.warn(`Warning: Missing env var ${key} — emails will be skipped`);
  }
}

module.exports = env;
