-- Migration 030: collapse checkout_order to a single definition.
--
-- CREATE OR REPLACE FUNCTION with a CHANGED signature creates an OVERLOAD, it
-- does not replace. Migrations 014 (23 args), 016 (25 args) and 017 (26 args)
-- each did that on top of 005/011 (22 args), so a clean apply of the migration
-- set leaves FOUR checkout_order functions side by side.
--
-- Production works only because PostgREST resolves the right one from the 26
-- named arguments the backend sends. Any caller passing fewer named arguments
-- gets "function checkout_order is not unique" instead of a checkout.
--
-- Dropped by introspection rather than by a hand-written signature list: the
-- older argument lists are long and easy to mistype, and a typo here would
-- drop the wrong function. Idempotent — safe to re-run.

DO $$
DECLARE
  r record;
  keep_args text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid) INTO keep_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'checkout_order'
     AND p.pronargs = 26;

  IF keep_args IS NULL THEN
    RAISE EXCEPTION 'No 26-argument checkout_order found — apply 020_update_checkout_rpc.sql first';
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'checkout_order'
       AND p.pronargs <> 26
  LOOP
    RAISE NOTICE 'dropping stale checkout_order overload: %', r.sig;
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;
