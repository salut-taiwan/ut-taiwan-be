-- Migration 025: free SALUT-exclusive almet product + reprice the regular almet.
-- Idempotent: re-running is safe (uses IF NOT EXISTS / WHERE NOT EXISTS guards).

-- 1. Add claim_rule column to products. Nullable; NULL means a regular product.
ALTER TABLE products ADD COLUMN IF NOT EXISTS claim_rule VARCHAR(50);

-- 2. Reprice the existing paid almet(s) to Rp 350.000.
--    Match by category. Any existing product with claim_rule IS NULL in 'jas-almamater'
--    is treated as the paid almet.
UPDATE products
   SET base_price = 350000, updated_at = NOW()
 WHERE category = 'jas-almamater' AND claim_rule IS NULL;

UPDATE product_skus
   SET price = 350000, updated_at = NOW()
 WHERE product_id IN (
   SELECT id FROM products WHERE category = 'jas-almamater' AND claim_rule IS NULL
 );

-- 3. Insert the free SALUT-exclusive almet product. Guarded so re-runs don't duplicate.
INSERT INTO products (category, name, description, base_price, weight_grams, claim_rule)
SELECT 'jas-almamater',
       'Almet UT Anggota SALUT (Gratis)',
       'Jas almamater Universitas Terbuka khusus untuk Anggota SALUT semester 1. Gratis, satu kali klaim per anggota.',
       0,
       800,
       'salut_sem1_once'
 WHERE NOT EXISTS (
   SELECT 1 FROM products WHERE claim_rule = 'salut_sem1_once'
 );

-- 4. One default SKU at price 0 for the free almet.
INSERT INTO product_skus (product_id, price, option_names)
SELECT p.id, 0, '[]'::jsonb
  FROM products p
 WHERE p.claim_rule = 'salut_sem1_once'
   AND NOT EXISTS (
     SELECT 1 FROM product_skus ps WHERE ps.product_id = p.id
   );

DO $$
DECLARE created_id UUID;
BEGIN
  SELECT id INTO created_id FROM products WHERE claim_rule = 'salut_sem1_once' LIMIT 1;
  RAISE NOTICE 'Free SALUT almet product id: %', created_id;
END $$;
