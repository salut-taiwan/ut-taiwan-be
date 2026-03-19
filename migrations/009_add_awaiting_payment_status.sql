-- Drop the old check constraint (name from 001_initial_schema.sql)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
-- Re-add with awaiting_payment included
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending','awaiting_payment','paid','processing','shipped','delivered','cancelled'));
