-- module_code is only meaningful for module order items (TBO codes like ADBI4130-2).
-- Merchandise items are identified by sku_id; module_code is NULL for them.
ALTER TABLE order_items ALTER COLUMN module_code DROP NOT NULL;
