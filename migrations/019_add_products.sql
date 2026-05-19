-- Migration 019: Add products, variants, SKUs for merchandise shop (/toko)

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tokopedia_id VARCHAR(50) UNIQUE,
  category VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  base_price NUMERIC(12,2) NOT NULL,
  weight_grams INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE product_variant_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  identifier VARCHAR(50) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE product_variant_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_type_id UUID NOT NULL REFERENCES product_variant_types(id) ON DELETE CASCADE,
  value VARCHAR(100) NOT NULL,
  hex_color VARCHAR(7),
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE product_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tokopedia_sku_id VARCHAR(50),
  price NUMERIC(12,2) NOT NULL,
  option_names JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Extend cart_items: make module_id nullable, add sku columns
ALTER TABLE cart_items
  ALTER COLUMN module_id DROP NOT NULL,
  ADD COLUMN sku_id UUID REFERENCES product_skus(id) ON DELETE CASCADE,
  ADD COLUMN variant_label TEXT,
  ADD COLUMN product_name_snapshot TEXT,
  ADD CONSTRAINT cart_items_type_check CHECK (
    (module_id IS NOT NULL) != (sku_id IS NOT NULL)
  ),
  ADD CONSTRAINT cart_items_cart_id_sku_id_key UNIQUE (cart_id, sku_id);
-- The existing UNIQUE (cart_id, module_id) stays intact.
-- Both constraints allow NULLs in PostgreSQL, so:
--   module items → conflict on (cart_id, module_id) when both non-null
--   merch items  → conflict on (cart_id, sku_id) when both non-null

-- Extend order_items
ALTER TABLE order_items
  ADD COLUMN sku_id UUID REFERENCES product_skus(id),
  ADD COLUMN variant_label TEXT;
