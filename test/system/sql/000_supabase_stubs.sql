-- Stand-ins for the Supabase-managed schemas that migrations/ assumes exist.
-- Only what 001 and 018 actually touch. Test tier only — never applied to a
-- real Supabase project, which provides all of this itself.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

-- 001_initial_schema.sql: users.id REFERENCES auth.users(id) ON DELETE CASCADE
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text UNIQUE,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at         timestamptz DEFAULT now()
);

-- 001's RLS policies call auth.uid(). Nothing sets the JWT claim in this tier,
-- so it returns NULL and every policy evaluates false — which is harmless
-- because the connection role owns the tables and bypasses RLS, exactly as the
-- service-role pooler does in production.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'service_role')
$$;

-- 018_salut_applications.sql inserts into storage.buckets.
CREATE TABLE IF NOT EXISTS storage.buckets (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  public     boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  text REFERENCES storage.buckets(id),
  name       text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (bucket_id, name)
);
