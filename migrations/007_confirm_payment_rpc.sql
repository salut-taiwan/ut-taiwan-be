-- Confirm payment manually (admin only, called via RPC from backend)
CREATE OR REPLACE FUNCTION confirm_payment(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE payments SET status='paid', paid_at=now(), updated_at=now()
    WHERE order_id=p_order_id AND status='pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pembayaran tidak ditemukan atau sudah dikonfirmasi';
  END IF;
  UPDATE orders SET status='paid', updated_at=now() WHERE id=p_order_id;
  RETURN true;
END;
$$;

-- Update gateway CHECK constraint to manual only
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_gateway_check;
ALTER TABLE payments ADD CONSTRAINT payments_gateway_check
  CHECK (gateway IN ('manual'));