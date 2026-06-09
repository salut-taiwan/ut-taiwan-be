require('dotenv').config();

// Strip a matched pair of wrapping quotes from a value — guards against the
// deployment-UI footgun where `EMAIL_FROM="..."` is pasted into a key/value
// form and the quotes become literal characters of the value.
function unquote(s) {
  if (typeof s !== 'string' || s.length < 2) return s;
  const first = s[0], last = s[s.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return s.slice(1, -1);
  }
  return s;
}

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

  // Email (Resend)
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: unquote(process.env.EMAIL_FROM) || 'UT Taiwan <noreply@ut-taiwan.com>',
};

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL'];
const recommended = ['RESEND_API_KEY'];
for (const key of required) {
  if (!env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
for (const key of recommended) {
  if (!env[key]) {
    console.warn(`Warning: Missing env var ${key} — emails will be skipped`);
  }
}

module.exports = env;
