-- Read-only audit: does the live database match what the code expects?
--
-- Migrations here are applied by hand in the Supabase SQL editor, so nothing
-- guarantees the database matches migrations/. Paste this into the SQL editor
-- and read the `status` column: every row should say OK.
--
-- Touches nothing. Safe to run against production at any time.

WITH checks AS (

  -- 029: the WhatsApp number captured with each SALUT application.
  SELECT
    '029  users.salut_wa_number exists' AS "check",
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'salut_wa_number'
    ) THEN 'OK' ELSE 'MISSING — run 029_salut_wa_number.sql' END AS status

  -- 028: merchandise wrongly queued as an unpriced request. Any row left here
  -- is an order the admin cannot advance: clearing a request needs a positive
  -- price, which is meaningless for a SKU that already has one.
  UNION ALL SELECT
    '028  no merch stuck awaiting a price',
    CASE WHEN (
      SELECT count(*) FROM order_items
       WHERE sku_id IS NOT NULL AND is_request = true AND request_status = 'pending'
    ) = 0 THEN 'OK' ELSE
      'STUCK ORDERS — run 028_fix_merch_request_items.sql (' ||
      (SELECT count(*)::text FROM order_items
        WHERE sku_id IS NOT NULL AND is_request = true AND request_status = 'pending') ||
      ' rows)' END

  -- 030: CREATE OR REPLACE with a changed signature adds an overload rather
  -- than replacing. More than one and a caller sending fewer named arguments
  -- gets "function is not unique" instead of a checkout.
  UNION ALL SELECT
    '030  exactly one checkout_order',
    CASE WHEN (
      SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'checkout_order'
    ) = 1 THEN 'OK' ELSE
      'OVERLOADED (' ||
      (SELECT string_agg(p.pronargs::text, ', ' ORDER BY p.pronargs)
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'checkout_order') ||
      ' args) — run 030_drop_stale_checkout_overloads.sql' END

  -- The surviving definition must still take everything the backend sends.
  UNION ALL SELECT
    '030  checkout_order accepts the full argument set',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'checkout_order'
         AND pg_get_function_identity_arguments(p.oid) LIKE '%p_unique_code%'
         AND pg_get_function_identity_arguments(p.oid) LIKE '%p_order_items%'
         AND pg_get_function_identity_arguments(p.oid) LIKE '%p_is_salut_order%'
    ) THEN 'OK' ELSE 'WRONG DEFINITION SURVIVED — re-run 020 then 030' END

  -- Every stored procedure the backend calls, defined exactly once.
  UNION ALL SELECT
    '     one definition per stored procedure',
    COALESCE((
      SELECT string_agg(proname || ' x' || n::text, ', ')
        FROM (SELECT p.proname, count(*) AS n
                FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
               WHERE ns.nspname = 'public'
                 AND p.proname IN ('cancel_order','confirm_payment',
                                   'get_or_create_cart','apply_scraper_changes')
               GROUP BY p.proname HAVING count(*) <> 1) dupes
    ), 'OK')

  -- Earlier migrations the current code depends on, in case one was skipped.
  UNION ALL SELECT
    '009  orders may reach awaiting_payment',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'orders_status_check'
         AND pg_get_constraintdef(oid) LIKE '%awaiting_payment%'
    ) THEN 'OK' ELSE 'MISSING — run 009_add_awaiting_payment_status.sql' END

  UNION ALL SELECT
    '021  order_items.module_code is nullable (merch has none)',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'order_items' AND column_name = 'module_code'
         AND is_nullable = 'YES'
    ) THEN 'OK' ELSE 'MISSING — run 021_fix_module_code_nullable.sql' END

  UNION ALL SELECT
    '022  a membership can be recorded as expired',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'users_salut_status_check'
         AND pg_get_constraintdef(oid) LIKE '%expired%'
    ) THEN 'OK' ELSE 'MISSING — run 022_salut_tier_and_reset.sql' END

  UNION ALL SELECT
    '025  the free SALUT almet product exists',
    CASE WHEN EXISTS (
      SELECT 1 FROM products WHERE claim_rule = 'salut_sem1_once'
    ) THEN 'OK' ELSE 'MISSING — run 025_almet_salut_free_product.sql' END

  UNION ALL SELECT
    '027  sks_payments table exists',
    CASE WHEN to_regclass('public.sks_payments') IS NOT NULL
      THEN 'OK' ELSE 'MISSING — run 027_sks_payments.sql' END

  -- Not a migration: the paid almet was repriced to 350000 by 025, and
  -- re-running scripts/import-products.mjs would silently overwrite it.
  UNION ALL SELECT
    '     paid almet still priced (import script can reset this)',
    COALESCE((
      SELECT CASE WHEN base_price > 0 THEN 'OK'
                  ELSE 'PRICE LOST — 025 repriced it; did import-products.mjs run?' END
        FROM products
       WHERE category = 'jas-almamater' AND claim_rule IS NULL
       LIMIT 1
    ), 'no paid almet row found')
)
SELECT "check", status FROM checks ORDER BY "check";
