-- Migration 026: mirror paid almet content (description, sizes, photos) to the
-- free SALUT-exclusive almet. Idempotent — every run wipes the free almet's
-- images/variants/SKUs and re-copies from the paid almet, then re-appends the
-- SALUT note to the description.

DO $$
DECLARE
  paid_id UUID;
  free_id UUID;
  paid_desc TEXT;
  salut_note TEXT := 'Produk ini gratis untuk Anggota SALUT semester 1, satu kali klaim per anggota.';
BEGIN
  SELECT id INTO paid_id FROM products
   WHERE category = 'jas-almamater' AND claim_rule IS NULL
   ORDER BY created_at NULLS LAST LIMIT 1;

  SELECT id INTO free_id FROM products
   WHERE claim_rule = 'salut_sem1_once' LIMIT 1;

  IF paid_id IS NULL OR free_id IS NULL THEN
    RAISE NOTICE 'Migration 025 skipped: paid_id=% free_id=%', paid_id, free_id;
    RETURN;
  END IF;

  -- 1. Description: paid description + SALUT note.
  SELECT description INTO paid_desc FROM products WHERE id = paid_id;
  UPDATE products
     SET description = CASE
       WHEN paid_desc IS NULL OR paid_desc = '' THEN salut_note
       ELSE paid_desc || E'\n\n' || salut_note
     END,
         updated_at = NOW()
   WHERE id = free_id;

  -- 2. Photos: reuse paid's image URLs. Clear-and-reinsert keeps the migration
  --    idempotent without leaving orphans.
  DELETE FROM product_images WHERE product_id = free_id;
  INSERT INTO product_images (product_id, image_url, sort_order)
  SELECT free_id, image_url, sort_order
    FROM product_images
   WHERE product_id = paid_id
   ORDER BY sort_order;

  -- 3. Variant types + options. Clear existing first; rebuild from paid.
  DELETE FROM product_variant_options
   WHERE variant_type_id IN (SELECT id FROM product_variant_types WHERE product_id = free_id);
  DELETE FROM product_variant_types WHERE product_id = free_id;

  -- Copy types AND options in one statement using a modifying CTE.
  -- `identifier` is the semantic key the FE uses (selectedOptions[vt.identifier])
  -- and is unique within a single product, so it's a safe join key for remapping.
  WITH new_types AS (
    INSERT INTO product_variant_types (product_id, name, identifier, sort_order)
    SELECT free_id, name, identifier, sort_order
      FROM product_variant_types
     WHERE product_id = paid_id
    RETURNING id, identifier
  )
  INSERT INTO product_variant_options (variant_type_id, value, hex_color, sort_order)
  SELECT nt.id, opt.value, opt.hex_color, opt.sort_order
    FROM product_variant_options opt
    JOIN product_variant_types old_vt ON old_vt.id = opt.variant_type_id
    JOIN new_types nt ON nt.identifier = old_vt.identifier
   WHERE old_vt.product_id = paid_id;

  -- 4. SKUs: mirror each paid SKU's option_names combination at price 0.
  --    Delete only the free SKUs that aren't referenced by carts/orders.
  --    cart_items.sku_id is ON DELETE CASCADE; order_items.sku_id is not, so
  --    the NOT EXISTS guard preserves order history.
  DELETE FROM product_skus ps
   WHERE ps.product_id = free_id
     AND NOT EXISTS (SELECT 1 FROM cart_items   ci WHERE ci.sku_id = ps.id)
     AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.sku_id = ps.id);

  INSERT INTO product_skus (product_id, price, option_names)
  SELECT free_id, 0, option_names
    FROM product_skus
   WHERE product_id = paid_id;

  -- 5. Fallback: if paid had no SKUs (unlikely), ensure free still has one
  --    so the product page remains claimable.
  INSERT INTO product_skus (product_id, price, option_names)
  SELECT free_id, 0, '[]'::jsonb
   WHERE NOT EXISTS (SELECT 1 FROM product_skus WHERE product_id = free_id);

  RAISE NOTICE 'Migration 025 applied: mirrored % images, % variant types, % SKUs from paid -> free',
    (SELECT COUNT(*) FROM product_images        WHERE product_id = paid_id),
    (SELECT COUNT(*) FROM product_variant_types WHERE product_id = paid_id),
    (SELECT COUNT(*) FROM product_skus          WHERE product_id = paid_id);
END $$;
