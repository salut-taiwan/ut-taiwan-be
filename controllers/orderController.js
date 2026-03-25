const { supabaseAdmin } = require('../config/supabase');
const paymentService = require('../services/paymentService');
const emailService = require('../services/emailService');
const orderEmailService = require('../services/orderEmailService');
const { PAYMENT_EXPIRY_MS, ORDER_STATUS_TRANSITIONS, CONFIRM_DEADLINE_MS, ORDER_STEPS, PAYMENT_BANK } = require('../config/constants');

function generateOrderNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const random = Math.floor(Math.random() * 90000) + 10000;
  return `UT-${year}-${random}`;
}

async function checkout(req, res) {
  const {
    shippingName, shippingAddress, shippingCity, shippingProvince,
    shippingPostal, shippingCountry, shippingPhone, notes,
    paymentMethod, paymentBank,
  } = req.body;

  // Validate required fields
  const required = { shippingName, shippingAddress, shippingCity, shippingProvince, shippingPostal, shippingPhone, paymentMethod };
  for (const [key, val] of Object.entries(required)) {
    if (!val) return res.status(400).json({ error: `${key} wajib diisi` });
  }

  // Pre-check: read cart items for amount calculation (fast fail before external call)
  const { data: cart } = await supabaseAdmin
    .from('carts')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (!cart) return res.status(400).json({ error: 'Keranjang kosong' });

  const { data: cartItems } = await supabaseAdmin
    .from('cart_items')
    .select('quantity, price_snapshot, is_request, modules(id, tbo_code, name, is_available)')
    .eq('cart_id', cart.id);

  if (!cartItems || cartItems.length === 0) {
    return res.status(400).json({ error: 'Keranjang kosong' });
  }

  // Pre-check: only block non-request items that became unavailable after being added
  // Request items (is_request=true) are allowed through regardless of availability
  const unavailable = cartItems.filter(i => !i.is_request && !i.modules.is_available);
  if (unavailable.length > 0) {
    return res.status(400).json({
      error: 'Beberapa modul tidak tersedia. Silakan ubah ke permintaan atau hapus dari keranjang.',
      modules: unavailable.map(i => i.modules.tbo_code),
    });
  }

  const subtotal = cartItems.reduce((sum, i) => sum + i.price_snapshot * i.quantity, 0);
  const shippingCost = 0;
  const totalAmount = subtotal + shippingCost;
  const orderNumber = generateOrderNumber();

  // Call gateway (external HTTP) — before DB write; fallback to manual on error
  let gatewayResult;
  try {
    gatewayResult = await paymentService.chargeGateway({
      orderNumber,
      amount: totalAmount,
      method: paymentMethod,
      bank: paymentBank,
      customerName: shippingName,
      customerPhone: shippingPhone,
    });
  } catch (err) {
    console.error('Payment gateway error:', err.message);
    gatewayResult = {
      gateway: 'manual',
      gatewayPaymentId: null,
      gatewayBillingNo: null,
      gatewayResponse: null,
      expiresAt: new Date(Date.now() + PAYMENT_EXPIRY_MS).toISOString(),
    };
  }

   // Build order items array for RPC (include is_request flag)
  const orderItems = cartItems.map(i => ({
    module_id: i.modules.id,
    module_code: i.modules.tbo_code,
    module_name: i.modules.name,
    quantity: i.quantity,
    unit_price: i.price_snapshot,
    subtotal: i.price_snapshot * i.quantity,
    is_request: i.is_request,
  }));

  // Single atomic write: order + order_items + payment + clear cart
  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('checkout_order', {
    p_user_id:            req.user.id,
    p_order_number:       orderNumber,
    p_subtotal:           subtotal,
    p_shipping_cost:      shippingCost,
    p_total_amount:       totalAmount,
    p_shipping_name:      shippingName,
    p_shipping_address:   shippingAddress,
    p_shipping_city:      shippingCity,
    p_shipping_province:  shippingProvince,
    p_shipping_postal:    shippingPostal,
    p_shipping_country:   shippingCountry || 'Taiwan',
    p_shipping_phone:     shippingPhone,
    p_notes:              notes || null,
    p_payment_gateway:    gatewayResult.gateway,
    p_payment_method:     paymentMethod,
    p_payment_bank:       paymentBank || null,
    p_payment_amount:     totalAmount,
    p_payment_expires_at: gatewayResult.expiresAt,
    p_gateway_payment_id: gatewayResult.gatewayPaymentId,
    p_gateway_billing_no: gatewayResult.gatewayBillingNo,
    p_gateway_response:   gatewayResult.gatewayResponse,
    p_order_items:        orderItems,
  });

  if (rpcError) {
    const status = rpcError.message.includes('tidak tersedia') ? 400 : 500;
    return res.status(status).json({ error: rpcError.message });
  }

  res.status(201).json({ order: rpcData.order, payment: rpcData.payment });
}

async function listOrders(req, res) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, status, total_amount, created_at, order_items(id), payments(status, amount)')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function getOrder(req, res) {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items(*),
      payments(*)
    `)
    .eq('id', id)
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

  const order = data;

  // Computed fields
  order.step_index = ORDER_STEPS.indexOf(order.status);
  order.can_cancel = order.status === 'pending';

  if (order.status === 'shipped' && order.shipped_at) {
    const deadlineMs = new Date(order.shipped_at).getTime() + CONFIRM_DEADLINE_MS;
    order.confirm_deadline = new Date(deadlineMs).toISOString();
    order.confirm_deadline_is_urgent = (deadlineMs - Date.now()) / (1000 * 60 * 60 * 24) < 2;
  }

  if (order.payments?.length) {
    const p = order.payments[0];
    p.show_payment_instructions = p.status === 'pending' && order.status === 'awaiting_payment';
    p.show_payment_deadline     = !!(p.expires_at && p.status === 'pending' && order.status !== 'pending');
    if (p.show_payment_instructions) {
      p.bank_name    = PAYMENT_BANK.bank;
      p.bank_account = PAYMENT_BANK.account;
      p.bank_holder  = PAYMENT_BANK.holder;
    }
  }

  if (order.order_items?.length) {
    order.order_items = order.order_items.map(item => ({
      ...item,
      display_status:
        item.request_status === 'rejected'                   ? 'rejected'        :
        item.is_request && item.request_status === 'pending' ? 'pending_request' :
        item.is_request && item.unit_price === 0             ? 'zero_price'      :
        'normal',
    }));
  }

  res.json(order);
}

async function cancelOrder(req, res) {
  const { id } = req.params;

  const { error } = await supabaseAdmin.rpc('cancel_order', {
    p_order_id: id,
    p_user_id: req.user.id,
  });

  if (error) {
    const status = error.message.includes('tidak ditemukan') ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }

  res.json({ message: 'Pesanan berhasil dibatalkan' });
}

async function listAllOrders(req, res) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, status, total_amount, created_at, shipping_name, shipping_phone, payments(status, amount, proof_url, invoice_url, proof_uploaded_at), order_items(id, module_code, module_name, quantity, unit_price, subtotal, is_request, request_status)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}


async function updateOrderStatus(req, res) {
  const { orderId } = req.params;
  const { status } = req.body;

  if (!status) return res.status(400).json({ error: 'status wajib diisi' });

  const { data: order, error: fetchError } = await supabaseAdmin
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .single();

  if (fetchError || !order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

  const allowed = ORDER_STATUS_TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Tidak dapat mengubah status dari "${order.status}" ke "${status}"` });
  }

  const extra = status === 'shipped' ? { shipped_at: new Date().toISOString() } : {};

  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq('id', orderId)
    .eq('status', order.status)    // atomic guard: fails if status changed since fetch
    .select('id')
    .single();

  if (error || !updated) return res.status(409).json({ error: 'Status pesanan telah berubah, silakan refresh' });

  if (status === 'paid' || status === 'processing' || status === 'shipped') {
    await orderEmailService.sendStatusEmail(orderId, status);
  }

  res.json({ message: 'Status pesanan berhasil diperbarui', status });
}

async function confirmKarunika(req, res) {
  const { orderId } = req.params;

  // Block if any request items are still pending — admin must resolve them first
  const { data: pendingRequests } = await supabaseAdmin
    .from('order_items')
    .select('id')
    .eq('order_id', orderId)
    .eq('is_request', true)
    .eq('request_status', 'pending')
    .limit(1);

  if (pendingRequests && pendingRequests.length > 0) {
    return res.status(400).json({
      error: 'Selesaikan semua permintaan terlebih dahulu (setujui atau tolak) sebelum konfirmasi',
    });
  }

  const newExpiresAt = new Date(Date.now() + PAYMENT_EXPIRY_MS).toISOString();

  // Atomic UPDATE: only succeeds if order is still pending (eliminates TOCTOU)
  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update({ status: 'awaiting_payment', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('status', 'pending')
    .select('id, order_number, total_amount, user_id, order_items(module_code, module_name, quantity, unit_price, subtotal)')
    .single();

  if (error || !updated) {
    return res.status(400).json({ error: 'Pesanan tidak ditemukan atau bukan dalam status pending' });
  }

  const order = updated;

  // Reset payment expiry
  const { error: paymentError } = await supabaseAdmin
    .from('payments')
    .update({ expires_at: newExpiresAt })
    .eq('order_id', orderId)
    .eq('status', 'pending');

  if (paymentError) console.error('[confirmKarunika] Failed to reset payment expiry:', paymentError.message);

  try {
    const payload = await orderEmailService.fetchOrderEmailPayload(orderId);
    if (payload) {
      await emailService.sendPaymentRequest({ ...payload, bank: 'BCA', account: '2950211345', expiresAt: newExpiresAt });
    }
  } catch (emailErr) {
    console.error('[Email] Failed to send payment request email:', emailErr.message);
  }

  res.json({ message: 'Stok Karunika dikonfirmasi, email pembayaran dikirim ke pelanggan', status: 'awaiting_payment' });
}

async function confirmDelivery(req, res) {
  const { id } = req.params;

  // Atomic UPDATE: ownership + status guard in one query (eliminates TOCTOU)
  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update({ status: 'delivered', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', req.user.id)
    .eq('status', 'shipped')
    .select('id')
    .single();

  if (error || !updated) {
    return res.status(400).json({ error: 'Pesanan tidak ditemukan atau belum dalam status dikirim' });
  }

  res.json({ message: 'Penerimaan dikonfirmasi' });
}

async function updateRequestItemStatus(req, res) {
  const { orderId, itemId } = req.params;
  const { status, unit_price } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status harus approved atau rejected' });
  }

  if (status === 'approved' && unit_price !== undefined) {
    if (typeof unit_price !== 'number' || unit_price <= 0) {
      return res.status(400).json({ error: 'Harga harus berupa angka positif' });
    }
  }

  // Fetch item to get quantity + current price for guards
  const { data: existingItem } = await supabaseAdmin
    .from('order_items')
    .select('id, quantity, unit_price')
    .eq('id', itemId)
    .eq('order_id', orderId)
    .single();

  if (!existingItem) return res.status(404).json({ error: 'Item permintaan tidak ditemukan' });

  // Guard: zero-price item requires a price before it can be approved
  if (status === 'approved' && existingItem.unit_price === 0 && unit_price === undefined) {
    return res.status(400).json({ error: 'Masukkan harga untuk item ini sebelum menyetujui' });
  }

  const updatePayload = { request_status: status };
  if (status === 'approved' && unit_price !== undefined) {
    updatePayload.unit_price = unit_price;
    updatePayload.subtotal   = unit_price * existingItem.quantity;
  }

  const { data: item, error } = await supabaseAdmin
    .from('order_items')
    .update(updatePayload)
    .eq('id', itemId)
    .eq('order_id', orderId)
    .eq('is_request', true)
    .select('id, subtotal')
    .single();

  if (error || !item) {
    return res.status(404).json({ error: 'Item permintaan tidak ditemukan' });
  }

  const needsRecalc = status === 'rejected' || (status === 'approved' && unit_price !== undefined);
  if (needsRecalc) {
    const { data: allItems } = await supabaseAdmin
      .from('order_items')
      .select('subtotal, request_status')
      .eq('order_id', orderId);

    const newSubtotal = (allItems || [])
      .filter(i => i.request_status !== 'rejected')
      .reduce((sum, i) => sum + Number(i.subtotal), 0);

    if (status === 'rejected' && newSubtotal <= 0) {
      return res.status(400).json({
        error: 'Tidak dapat menolak semua item — batalkan pesanan jika tidak ada yang bisa dipenuhi',
      });
    }

    await supabaseAdmin
      .from('orders')
      .update({ subtotal: newSubtotal, total_amount: newSubtotal, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    await supabaseAdmin
      .from('payments')
      .update({ amount: newSubtotal })
      .eq('order_id', orderId)
      .eq('status', 'pending');
  }

  res.json({ message: 'Status permintaan berhasil diperbarui', status });
}

module.exports = { checkout, listOrders, getOrder, cancelOrder, listAllOrders, updateOrderStatus, confirmKarunika, confirmDelivery, updateRequestItemStatus };
