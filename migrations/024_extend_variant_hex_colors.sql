-- Migration 024: extend hex_color backfill with additional Indonesian
-- color names ('biru toska', 'merah bata') that the scraper emitted with
-- hex=null and migration 023 didn't cover.
-- Idempotent: only rows where hex_color IS NULL are touched.

UPDATE product_variant_options AS pvo
SET hex_color = m.hex
FROM (VALUES
  ('biru toska', '#06B6D4'),
  ('merah bata', '#B0413E')
) AS m(name, hex)
WHERE pvo.hex_color IS NULL
  AND REGEXP_REPLACE(LOWER(TRIM(pvo.value)), '\s+', ' ', 'g') = m.name;

-- Report rows still lacking a hex_color, so the operator knows what to triage.
-- This is informational; many will legitimately be non-color variants (sizes, materials).
DO $$
DECLARE missing_count INT;
BEGIN
  SELECT COUNT(*) INTO missing_count FROM product_variant_options WHERE hex_color IS NULL;
  RAISE NOTICE 'product_variant_options rows still missing hex_color: %', missing_count;
END $$;
