const { createClient } = require('@supabase/supabase-js');
const env = require('./env');

// Public client (uses anon key) — respects RLS
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

// Admin client (uses service role key) — bypasses RLS, use only in trusted server code
const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = { supabase, supabaseAdmin };
