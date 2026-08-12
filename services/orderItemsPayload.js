'use strict';

/**
 * Map cart rows onto the `p_order_items` payload the checkout_order RPC expects.
 *
 * `is_request` means "price or availability unknown, admin must resolve it".
 * Modules carry the flag decided at cart-add time (services/cartPricing.js);
 * merchandise never does, because a SKU price is always known — a free almet at
 * 0 is a legitimately free item, not a pending request. Sending is_request for
 * merch used to strand orders: the RPC stamped request_status = 'pending', and
 * confirmKarunika refuses to advance while any request is pending.
 */
function buildOrderItemsPayload(cartItems) {
  return (cartItems || []).map((i) => {
    const unitPrice = Number(i.price_snapshot) || 0;
    const base = {
      quantity: i.quantity,
      unit_price: unitPrice,
      subtotal: unitPrice * i.quantity,
    };

    if (i.modules) {
      return {
        ...base,
        module_id: i.modules.id,
        module_code: i.modules.tbo_code,
        module_name: i.modules.name,
        is_request: Boolean(i.is_request),
      };
    }

    return {
      ...base,
      module_id: null,
      module_code: null,
      module_name: i.product_name_snapshot,
      is_request: Boolean(i.is_request),
      sku_id: i.sku_id,
      variant_label: i.variant_label,
    };
  });
}

/**
 * Free-text items a student types in at checkout ("modul tidak ada di katalog").
 * Always a request: neither price nor availability is known until an admin looks.
 */
function buildCustomOrderItems(customItems) {
  return (customItems || []).map((ci) => {
    const code = ci.moduleCode.trim().slice(0, 30);
    return {
      module_id: null,
      module_code: code,
      module_name: ci.moduleName?.trim() || code,
      quantity: Math.max(1, parseInt(ci.quantity) || 1),
      unit_price: 0,
      subtotal: 0,
      is_request: true,
    };
  });
}

module.exports = { buildOrderItemsPayload, buildCustomOrderItems };
