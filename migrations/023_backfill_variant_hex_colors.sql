-- Migration 023: backfill hex_color for color variant options whose hex was
-- missing from the scraper output (e.g. "navy", "hitam").
-- Idempotent: only rows where hex_color IS NULL are touched.

UPDATE product_variant_options AS pvo
SET hex_color = m.hex
FROM (VALUES
  -- English: base
  ('navy',         '#000080'),
  ('black',        '#000000'),
  ('white',        '#FFFFFF'),
  ('off white',    '#FAF9F6'),
  ('off-white',    '#FAF9F6'),
  ('broken white', '#F5F5F0'),
  ('ivory',        '#FFFFF0'),
  ('red',          '#E11D48'),
  ('blue',         '#2563EB'),
  ('green',        '#16A34A'),
  ('yellow',       '#FACC15'),
  ('purple',       '#7C3AED'),
  ('orange',       '#F97316'),
  ('pink',         '#EC4899'),
  ('brown',        '#92400E'),
  ('gray',         '#6B7280'),
  ('grey',         '#6B7280'),
  ('beige',        '#F5F5DC'),
  ('cream',        '#FFFDD0'),
  ('maroon',       '#800000'),
  ('burgundy',     '#800020'),
  ('olive',        '#808000'),
  ('army',         '#4B5320'),
  ('army green',   '#4B5320'),
  ('teal',         '#0D9488'),
  ('turquoise',    '#40E0D0'),
  ('tosca',        '#14B8A6'),
  ('mint',         '#98FF98'),
  ('emerald',      '#10B981'),
  ('lime',         '#BFFF00'),
  ('cyan',         '#06B6D4'),
  ('magenta',      '#D946EF'),
  ('indigo',       '#4F46E5'),
  ('lavender',     '#E6E6FA'),
  ('peach',        '#FFCBA4'),
  ('salmon',       '#FA8072'),
  ('coral',        '#FF7F50'),
  ('mustard',      '#D4A017'),
  ('khaki',        '#C3B091'),
  ('mocca',        '#6F4E37'),
  ('mocha',        '#6F4E37'),
  ('taupe',        '#483C32'),
  ('charcoal',     '#36454F'),
  ('terracotta',   '#E2725B'),
  ('nude',         '#E3BC9A'),
  ('silver',       '#C0C0C0'),
  ('gold',         '#D4AF37'),
  ('rose gold',    '#B76E79'),

  -- English: light / dark modifiers
  ('light blue',   '#60A5FA'),
  ('dark blue',    '#1E3A8A'),
  ('light green',  '#86EFAC'),
  ('dark green',   '#166534'),
  ('light gray',   '#D1D5DB'),
  ('light grey',   '#D1D5DB'),
  ('dark gray',    '#374151'),
  ('dark grey',    '#374151'),
  ('light pink',   '#FBCFE8'),
  ('hot pink',     '#EC4899'),
  ('light brown',  '#B97A56'),
  ('dark brown',   '#5C3317'),
  ('light yellow', '#FEF08A'),
  ('light purple', '#C4B5FD'),
  ('dark purple',  '#4C1D95'),
  ('baby blue',    '#89CFF0'),
  ('baby pink',    '#F4C2C2'),

  -- Indonesian: base
  ('hitam',        '#000000'),
  ('putih',        '#FFFFFF'),
  ('gading',       '#FFFFF0'),
  ('merah',        '#E11D48'),
  ('biru',         '#2563EB'),
  ('hijau',        '#16A34A'),
  ('kuning',       '#FACC15'),
  ('ungu',         '#7C3AED'),
  ('oranye',       '#F97316'),
  ('jingga',       '#F97316'),
  ('coklat',       '#92400E'),
  ('cokelat',      '#92400E'),
  ('abu',          '#6B7280'),
  ('abu-abu',      '#6B7280'),
  ('abu abu',      '#6B7280'),
  ('krem',         '#FFFDD0'),
  ('dongker',      '#1E3A8A'),
  ('pirus',        '#40E0D0'),
  ('emas',         '#D4AF37'),
  ('perak',        '#C0C0C0'),

  -- Indonesian: tua (dark) / muda (light) modifiers
  ('merah tua',    '#7F1D1D'),
  ('merah muda',   '#F472B6'),
  ('biru tua',     '#1E3A8A'),
  ('biru muda',    '#60A5FA'),
  ('biru dongker', '#1E3A8A'),
  ('hijau tua',    '#166534'),
  ('hijau muda',   '#86EFAC'),
  ('hijau army',   '#4B5320'),
  ('hijau tosca',  '#14B8A6'),
  ('hijau mint',   '#98FF98'),
  ('kuning tua',   '#CA8A04'),
  ('kuning muda',  '#FEF08A'),
  ('ungu tua',     '#4C1D95'),
  ('ungu muda',    '#C4B5FD'),
  ('coklat tua',   '#5C3317'),
  ('coklat muda',  '#B97A56'),
  ('cokelat tua',  '#5C3317'),
  ('cokelat muda', '#B97A56'),
  ('abu tua',      '#374151'),
  ('abu muda',     '#D1D5DB'),
  ('abu-abu tua',  '#374151'),
  ('abu-abu muda', '#D1D5DB'),
  ('pink tua',     '#DB2777'),
  ('pink muda',    '#FBCFE8'),
  ('oranye tua',   '#C2410C'),
  ('oranye muda',  '#FDBA74')
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
