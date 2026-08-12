-- Migration 028: unstrand merchandise order items wrongly flagged as requests.
--
-- Checkout used to send is_request = true for every merch line, so the RPC
-- stamped request_status = 'pending'. An admin can only clear a pending request
-- by entering a positive price, which is meaningless for a SKU that already has
-- one (and impossible for the free SALUT almet at 0). Meanwhile confirmKarunika
-- refuses to advance an order while any request is pending, so merch orders
-- could never reach awaiting_payment.
--
-- Scoped to still-pending merch lines only: approved/rejected rows keep their
-- audit trail, and item subtotals are untouched so no order total needs
-- recalculating.

UPDATE order_items
   SET is_request     = false,
       request_status = NULL
 WHERE sku_id IS NOT NULL
   AND is_request = true
   AND request_status = 'pending';
