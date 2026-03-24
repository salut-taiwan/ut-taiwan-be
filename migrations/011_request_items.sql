-- Migration 011: Request items — allow adding out-of-stock modules as requests
-- Run in Supabase SQL Editor

-- 1. Add is_request flag to cart_items
--    Set at add-time based on module availability; persists until item is converted or removed
ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS is_request BOOLEAN NOT NULL DEFAULT false;

-- 2. Add is_request + request_status to order_items
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS is_request BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS request_status TEXT
    CHECK (request_status IS NULL OR request_status IN ('pending', 'approved', 'rejected'))
    DEFAULT NULL;

-- 3. Update checkout_order() RPC to:
--    a) Skip availability re-validation for is_request items
--    b) Persist is_request and request_status on order_items
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
  p_order_items         jsonb  -- [{module_id, module_code, module_name, quantity, unit_price, subtotal, is_request}]
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

  -- CONSISTENCY: re-validate availability only for non-request items (closes TOCTOU window)
  -- Request items (is_request = true) are intentionally allowed when unavailable
  SELECT m.tbo_code INTO v_unavailable
  FROM cart_items ci
  JOIN modules m ON m.id = ci.module_id
  WHERE ci.cart_id = v_cart_id
    AND ci.is_request = false
    AND m.is_available = false
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

  -- 2. Create order items from jsonb array (includes is_request + request_status)
  INSERT INTO order_items (order_id, module_id, module_code, module_name, quantity, unit_price, subtotal, is_request, request_status)
  SELECT
    v_order.id,
    (item->>'module_id')::uuid,
    item->>'module_code',
    item->>'module_name',
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric,
    (item->>'subtotal')::numeric,
    COALESCE((item->>'is_request')::boolean, false),
    CASE WHEN COALESCE((item->>'is_request')::boolean, false) THEN 'pending' ELSE NULL END
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