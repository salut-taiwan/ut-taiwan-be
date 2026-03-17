-- Migration 005: ACID-compliant stored functions via SECURITY DEFINER RPCs
-- Run in Supabase SQL Editor

-- ============================================================
-- 1. checkout_order — Atomicity + Consistency + Isolation
-- ============================================================
CREATE OR REPLACE FUNCTION checkout_order(
  p_user_id             uuid,
  p_order_number        text,
  p_subtotal            numeric,
  p_shipping_cost       numeric,
  p_total_amount        numeric,
  p_shipping_name       text,
  p_shipping_address    text,
  p_shipping_city       text,
  p_shipping_province   text,
  p_shipping_postal     text,
  p_shipping_country    text,
  p_shipping_phone      text,
  p_notes               text,
  p_payment_gateway     text,
  p_payment_method      text,
  p_payment_bank        text,
  p_payment_amount      numeric,
  p_payment_expires_at  timestamptz,
  p_gateway_payment_id  text,
  p_gateway_billing_no  text,
  p_gateway_response    jsonb,
  p_order_items         jsonb  -- [{module_id, module_code, module_name, quantity, unit_price, subtotal}]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cart_id        uuid;
  v_unavailable    text;
  v_order          orders;
  v_payment        payments;
BEGIN
  -- ISOLATION: lock cart row to block concurrent checkouts for same user
  SELECT id INTO v_cart_id FROM carts WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Keranjang tidak ditemukan'; END IF;

  -- CONSISTENCY: re-validate module availability inside the transaction (closes TOCTOU window)
  SELECT m.tbo_code INTO v_unavailable
  FROM cart_items ci
  JOIN modules m ON m.id = ci.module_id
  WHERE ci.cart_id = v_cart_id AND m.is_available = false
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Modul tidak tersedia: %', v_unavailable;
  END IF;

  -- ATOMICITY: all writes in one transaction --

  -- 1. Create order
  INSERT INTO orders (order_number, user_id, status, subtotal, shipping_cost, total_amount,
    shipping_name, shipping_address, shipping_city, shipping_province, shipping_postal,
    shipping_country, shipping_phone, notes)
  VALUES (p_order_number, p_user_id, 'pending', p_subtotal, p_shipping_cost, p_total_amount,
    p_shipping_name, p_shipping_address, p_shipping_city, p_shipping_province, p_shipping_postal,
    p_shipping_country, p_shipping_phone, p_notes)
  RETURNING * INTO v_order;

  -- 2. Create order items from jsonb array
  INSERT INTO order_items (order_id, module_id, module_code, module_name, quantity, unit_price, subtotal)
  SELECT v_order.id,
    (item->>'module_id')::uuid,
    item->>'module_code',
    item->>'module_name',
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric,
    (item->>'subtotal')::numeric
  FROM jsonb_array_elements(p_order_items) AS item;

  -- 3. Create payment record
  INSERT INTO payments (order_id, gateway, gateway_payment_id, gateway_billing_no, method, bank,
    amount, status, expires_at, gateway_response)
  VALUES (v_order.id, p_payment_gateway, p_gateway_payment_id, p_gateway_billing_no,
    p_payment_method, p_payment_bank, p_payment_amount, 'pending',
    p_payment_expires_at, p_gateway_response)
  RETURNING * INTO v_payment;

  -- 4. Clear cart atomically
  DELETE FROM cart_items WHERE cart_id = v_cart_id;

  RETURN jsonb_build_object('order', row_to_json(v_order), 'payment', row_to_json(v_payment));
END;
$$;


-- ============================================================
-- 2. cancel_order — Atomicity + Isolation
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_order(p_order_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_status text;
BEGIN
  -- ISOLATION: lock order row before checking status
  SELECT status INTO v_status
  FROM orders WHERE id = p_order_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Hanya pesanan pending yang dapat dibatalkan';
  END IF;

  -- ATOMICITY: both updates in one transaction
  UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = p_order_id;
  UPDATE payments SET status = 'failed', updated_at = now()
    WHERE order_id = p_order_id AND status = 'pending';

  RETURN true;
END;
$$;


-- ============================================================
-- 3. handle_payment_webhook — Atomicity + Idempotency + Isolation
-- ============================================================
CREATE OR REPLACE FUNCTION handle_payment_webhook(
  p_gateway_order_id    text,
  p_new_payment_status  text,
  p_paid_at             timestamptz,
  p_gateway_response    jsonb,
  p_new_order_status    text   -- null = don't update order
) RETURNS uuid  -- returns order_id, or null if not found
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_payment payments;
BEGIN
  -- ISOLATION: lock payment row to block concurrent webhook replays
  SELECT * INTO v_payment
  FROM payments WHERE gateway_payment_id = p_gateway_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN null; END IF;

  -- IDEMPOTENCY: if already in terminal state, skip (webhook replay safety)
  IF v_payment.status IN ('paid', 'expired', 'failed', 'refunded') THEN
    RETURN v_payment.order_id;
  END IF;

  -- ATOMICITY: both updates in one transaction
  UPDATE payments
  SET status = p_new_payment_status, paid_at = p_paid_at,
      gateway_response = p_gateway_response, updated_at = now()
  WHERE id = v_payment.id;

  IF p_new_order_status IS NOT NULL THEN
    UPDATE orders SET status = p_new_order_status, updated_at = now()
    WHERE id = v_payment.order_id;
  END IF;

  RETURN v_payment.order_id;
END;
$$;
