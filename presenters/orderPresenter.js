'use strict';

const {
  formatIDR,
  formatPriceOrFree,
  formatDate,
  getOrderStatusLabel,
  getStepLabel,
  getRequestStatusLabel,
  addressToLines,
} = require('../format');
const { ORDER_STEPS, CONFIRM_DEADLINE_MS } = require('../config/constants');
const { presentPayment } = require('./paymentPresenter');

// --- Steps & progress ------------------------------------------------------

function buildOrderSteps(currentStatus) {
  const currentIndex = ORDER_STEPS.indexOf(currentStatus);
  const isDelivered = currentStatus === 'delivered';
  const steps = ORDER_STEPS.map((key, i) => {
    let state;
    if (currentIndex < 0) state = 'pending';
    else if (i < currentIndex) state = 'completed';
    else if (i === currentIndex) state = isDelivered ? 'completed' : 'current';
    else state = 'pending';
    return { key, label: getStepLabel(key), state };
  });
  const progress_percent = currentIndex < 0
    ? 0
    : Math.round((currentIndex / (ORDER_STEPS.length - 1)) * 100);
  return { steps, progress_percent };
}

// --- Fee lines --------------------------------------------------------------
//
// For SALUT orders, the original (pre-discount) amounts come from SALUT_FEES
// constants (not DB columns, which are zero), preserving the strikethrough
// display even after the user is de-SALUTed. See presenters/feeLines.js.

const { buildFeeLines: _buildFeeLines } = require('./feeLines');

function buildFeeLines({ shippingCost = 0, boxFee = 0, adminFee = 0, isSalutOrder = false }) {
  return _buildFeeLines({
    amounts: [Number(shippingCost), Number(boxFee), Number(adminFee)],
    isSalut: isSalutOrder,
  });
}

// --- Per-element decorators ------------------------------------------------

// Merchandise lines reuse the module_* columns (module_code stays NULL), so
// sku_id is the only discriminator on an order item.
function deriveItemType(item) {
  return item.sku_id ? 'merch' : 'module';
}

function presentOrderItem(item) {
  const display = item.display_status;
  // A request still waiting on an admin price has unit_price 0, which would
  // otherwise render as "Gratis". A zero-price *non-request* item (the free
  // SALUT almet) is genuinely free and keeps its price visible.
  const awaitingPrice = display === 'pending_request' && Number(item.unit_price) === 0;
  const priceVisible = display !== 'rejected' && display !== 'zero_price' && !awaitingPrice;
  return {
    ...item,
    item_type: deriveItemType(item),
    unit_price_display: formatPriceOrFree(Number(item.unit_price)),
    subtotal_display: formatPriceOrFree(Number(item.subtotal)),
    request_status_label: getRequestStatusLabel(item.request_status),
    price_visible: priceVisible,
  };
}

// One checkout maps the whole cart into one order, so an order can hold both
// kinds. 'mixed' orders surface under either filter in the admin table.
function deriveOrderKind(items) {
  const types = new Set((items || []).map(deriveItemType));
  if (types.size > 1) return 'mixed';
  return types.has('merch') ? 'merch' : 'module';
}

// --- Order presenters -------------------------------------------------------

function buildShippingAddressLines(order) {
  const lines = [];
  if (order.shipping_name) lines.push(order.shipping_name);
  if (order.shipping_address) lines.push(order.shipping_address);
  if (order.shipping_city) {
    lines.push(order.shipping_postal
      ? `${order.shipping_city} ${order.shipping_postal}`
      : order.shipping_city);
  }
  if (order.shipping_country) lines.push(order.shipping_country);
  if (order.shipping_phone) lines.push(order.shipping_phone);
  return lines;
}

function presentOrderCommon(order) {
  const fee_lines = buildFeeLines({
    shippingCost: order.shipping_cost,
    boxFee: order.box_fee,
    adminFee: order.admin_fee,
    isSalutOrder: Boolean(order.is_salut_order),
  });
  return {
    // Order-level subtotal always renders as an amount: "Gratis" is a property of
    // an individual free item, and reads as a bug on an order whose items are
    // still awaiting prices.
    subtotal_display: formatIDR(Number(order.subtotal)),
    shipping_cost_display: formatIDR(Number(order.shipping_cost ?? 0)),
    box_fee_display: formatIDR(Number(order.box_fee ?? 0)),
    admin_fee_display: formatIDR(Number(order.admin_fee ?? 0)),
    total_amount_display: formatIDR(Number(order.total_amount)),
    created_at_display: formatDate(order.created_at),
    shipped_at_display: formatDate(order.shipped_at),
    status_label: getOrderStatusLabel(order.status),
    fee_lines,
  };
}

function computeConfirmDeadline(order, now = Date.now()) {
  if (order.confirm_deadline) return {
    confirm_deadline: order.confirm_deadline,
    confirm_deadline_is_urgent: order.confirm_deadline_is_urgent ?? null,
  };
  if (order.status === 'shipped' && order.shipped_at) {
    const deadlineMs = new Date(order.shipped_at).getTime() + CONFIRM_DEADLINE_MS;
    const isoDeadline = new Date(deadlineMs).toISOString();
    return {
      confirm_deadline: isoDeadline,
      confirm_deadline_is_urgent: (deadlineMs - now) / (1000 * 60 * 60 * 24) < 2,
    };
  }
  return { confirm_deadline: null, confirm_deadline_is_urgent: null };
}

function presentOrderDetail(order, opts = {}) {
  const { steps, progress_percent } = buildOrderSteps(order.status);
  const common = presentOrderCommon(order);
  const payment0 = order.payments?.[0];
  // When a payment exists with a unique_code > 0, the "Total" the user must
  // transfer is payment.amount (= order.total_amount + unique_code). The order's
  // total_amount alone is the pre-unique-code subtotal+fees. Show the full pay
  // amount so the bottom-row Total matches the bank-instruction amount.
  const hasUniqueCode = payment0?.unique_code != null && Number(payment0.unique_code) > 0;
  const totalDisplay = hasUniqueCode && payment0.amount != null
    ? formatIDR(Number(payment0.amount))
    : common.total_amount_display;
  const total_breakdown = {
    subtotal_display: common.subtotal_display,
    fee_lines: common.fee_lines,
    unique_code_display: hasUniqueCode ? formatIDR(Number(payment0.unique_code)) : null,
    total_display: totalDisplay,
  };
  const deadlineInfo = computeConfirmDeadline(order, opts.now);

  return {
    ...order,
    ...common,
    ...deadlineInfo,
    confirm_deadline_display: formatDate(deadlineInfo.confirm_deadline),
    steps,
    progress_percent,
    shipping_address_lines: buildShippingAddressLines(order),
    total_breakdown,
    can_cancel: order.status === 'pending',
    step_index: ORDER_STEPS.indexOf(order.status),
    order_items: (order.order_items || []).map(presentOrderItem),
    payments: (order.payments || []).map(presentPayment),
  };
}

function presentOrderListItem(row) {
  return {
    ...row,
    status_label: getOrderStatusLabel(row.status),
    created_at_display: formatDate(row.created_at),
    total_amount_display: formatIDR(Number(row.total_amount)),
    payments: (row.payments || []).map(presentPayment),
  };
}

function presentAdminOrder(row) {
  return {
    ...row,
    status_label: getOrderStatusLabel(row.status),
    created_at_display: formatDate(row.created_at),
    subtotal_display: formatIDR(Number(row.subtotal)),
    total_amount_display: formatIDR(Number(row.total_amount)),
    order_kind: deriveOrderKind(row.order_items),
    payments: (row.payments || []).map(presentPayment),
    order_items: (row.order_items || []).map(presentOrderItem),
  };
}

module.exports = {
  presentOrderDetail,
  presentOrderListItem,
  presentAdminOrder,
  buildOrderSteps,
  buildFeeLines,
};
