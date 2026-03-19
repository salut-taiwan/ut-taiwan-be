-- Migration 010: Fix confirm_payment RPC to require awaiting_payment status
-- Prevents skipping the Karunika confirmation step and handles concurrent calls safely

CREATE OR REPLACE FUNCTION confirm_payment(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_order_status text;
BEGIN
  SELECT status INTO v_order_status
  FROM orders WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;
  IF v_order_status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Pesanan tidak dalam status menunggu pembayaran';
  END IF;

  UPDATE payments SET status='paid', paid_at=now(), updated_at=now()
    WHERE order_id=p_order_id AND status='pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pembayaran tidak ditemukan atau sudah dikonfirmasi';
  END IF;

  UPDATE orders SET status='paid', updated_at=now() WHERE id=p_order_id;
  RETURN true;
END;
$$;
