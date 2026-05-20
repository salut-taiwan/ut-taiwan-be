-- Migration 023: backfill hex_color for color variant options whose hex was
-- missing from the scraper output (e.g. "navy", "hitam").
-- Idempotent: only rows where hex_color IS NULL are touched.

UPDATE product_variant_options AS pvo
SET hex_color = m.hex
FROM (VALUES
  -- English
  ('navy',     '#000080'),
  ('black',    '#000000'),
  ('white',    '#FFFFFF'),
  ('red',      '#E11D48'),
  ('blue',     '#2563EB'),
  ('green',    '#16A34A'),
  ('yellow',   '#FACC15'),
  ('purple',   '#7C3AED'),
  ('orange',   '#F97316'),
  ('pink',     '#EC4899'),
  ('brown',    '#92400E'),
  ('gray',     '#6B7280'),
  ('grey',     '#6B7280'),
  ('beige',    '#F5F5DC'),
  ('cream',    '#FFFDD0'),
  ('maroon',   '#800000'),
  ('olive',    '#808000'),
  ('teal',     '#0D9488'),
  ('silver',   '#C0C0C0'),
  ('gold',     '#D4AF37'),
  -- Indonesian
  ('hitam',    '#000000'),
  ('putih',    '#FFFFFF'),
  ('merah',    '#E11D48'),
  ('biru',     '#2563EB'),
  ('hijau',    '#16A34A'),
  ('kuning',   '#FACC15'),
  ('ungu',     '#7C3AED'),
  ('oranye',   '#F97316'),
  ('coklat',   '#92400E'),
  ('cokelat',  '#92400E'),
  ('abu',      '#6B7280'),
  ('abu-abu',  '#6B7280'),
  ('krem',     '#FFFDD0'),
  ('dongker',  '#1E3A8A')
) AS m(name, hex)
WHERE pvo.hex_color IS NULL
  AND LOWER(TRIM(pvo.value)) = m.name;

-- Report rows still lacking a hex_color, so the operator knows what to triage.
-- This is informational; many will legitimately be non-color variants (sizes, materials).
DO $$
DECLARE missing_count INT;
BEGIN
  SELECT COUNT(*) INTO missing_count FROM product_variant_options WHERE hex_color IS NULL;
  RAISE NOTICE 'product_variant_options rows still missing hex_color: %', missing_count;
END $$;
