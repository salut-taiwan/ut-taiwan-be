-- Migration 017: Fix checkout_order() RPC — restore unique_code lost in migration 016
-- Migration 016 added SALUT fee params but accidentally dropped p_unique_code from the signature
-- and removed unique_code from the payments INSERT. This migration corrects that.

CREATE OR REPLACE FUNCTION checkout_order(
  p_user_id             uuid,
  p_order_number        text,
  p_subtotal            numeric,
  p_shipping_cost       numeric,
  p_box_fee             numeric,
  p_admin_fee           numeric,
  p_is_salut_order      boolean,
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
  p_order_items         jsonb,
  p_unique_code         int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cart_id     uuid;
  v_unavailable text;
  v_order       orders;
  v_payment     payments;
BEGIN
  SELECT id INTO v_cart_id FROM carts WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Keranjang tidak ditemukan'; END IF;

  SELECT m.tbo_code INTO v_unavailable
  FROM cart_items ci
  JOIN modules m ON m.id = ci.module_id
  WHERE ci.cart_id = v_cart_id
    AND ci.is_request = false
    AND m.is_available = false
  LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Modul tidak tersedia: %', v_unavailable; END IF;

  INSERT INTO orders (
    order_number, user_id, status,
    subtotal, shipping_cost, box_fee, admin_fee, is_salut_order, total_amount,
    shipping_name, shipping_address, shipping_city, shipping_province,
    shipping_postal, shipping_country, shipping_phone, notes
  ) VALUES (
    p_order_number, p_user_id, 'pending',
    p_subtotal, p_shipping_cost, p_box_fee, p_admin_fee, p_is_salut_order, p_total_amount,
    p_shipping_name, p_shipping_address, p_shipping_city, p_shipping_province,
    p_shipping_postal, p_shipping_country, p_shipping_phone, p_notes
  ) RETURNING * INTO v_order;

  INSERT INTO order_items (
    order_id, module_id, module_code, module_name, quantity, unit_price, subtotal, is_request, request_status
  )
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

  INSERT INTO payments (
    order_id, gateway, gateway_payment_id, gateway_billing_no, method, bank,
    amount, unique_code, status, expires_at, gateway_response
  ) VALUES (
    v_order.id, p_payment_gateway, p_gateway_payment_id, p_gateway_billing_no,
    p_payment_method, p_payment_bank, p_payment_amount, p_unique_code, 'pending',
    p_payment_expires_at, p_gateway_response
  ) RETURNING * INTO v_payment;

  DELETE FROM cart_items WHERE cart_id = v_cart_id;

  RETURN jsonb_build_object('order', row_to_json(v_order), 'payment', row_to_json(v_payment));
END;
$$;
