const { supabaseAdmin } = require('../config/supabase');
const paymentService = require('../services/paymentService');
const emailService = require('../services/emailService');

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
    .select('quantity, price_snapshot, modules(id, tbo_code, name, is_available)')
    .eq('cart_id', cart.id);

  if (!cartItems || cartItems.length === 0) {
    return res.status(400).json({ error: 'Keranjang kosong' });
  }

  // Pre-check availability (fast fail — re-validated atomically inside RPC)
  const unavailable = cartItems.filter(i => !i.modules.is_available);
  if (unavailable.length > 0) {
    return res.status(400).json({
      error: 'Beberapa modul tidak tersedia',
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
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  // Build order items array for RPC
  const orderItems = cartItems.map(i => ({
    module_id: i.modules.id,
    module_code: i.modules.tbo_code,
    module_name: i.modules.name,
    quantity: i.quantity,
    unit_price: i.price_snapshot,
    subtotal: i.price_snapshot * i.quantity,
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
  res.json(data);
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
    .select('id, order_number, status, total_amount, created_at, shipping_name, shipping_phone, payments(status, amount)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

const VALID_TRANSITIONS = {
  pending:          ['awaiting_payment'],
  awaiting_payment: ['paid'],
  paid:             ['processing', 'shipped'],
  processing:       ['shipped'],
  shipped:          ['delivered'],
};

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

  const allowed = VALID_TRANSITIONS[order.status] || [];
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

  // Send email notification for status transitions
  try {
    if (status === 'paid' || status === 'processing' || status === 'shipped') {
      const { data: fullOrder } = await supabaseAdmin
        .from('orders')
        .select('order_number, total_amount, shipping_name, order_items(module_code, module_name, quantity, unit_price, subtotal), users(email, name)')
        .eq('id', orderId)
        .single();

      if (fullOrder) {
        const emailPayload = {
          email: fullOrder.users.email,
          name: fullOrder.users.name,
          orderNumber: fullOrder.order_number,
          totalAmount: fullOrder.total_amount,
          items: fullOrder.order_items,
        };
        if (status === 'paid') await emailService.sendPaymentConfirmed(emailPayload);
        else if (status === 'processing') await emailService.sendOrderProcessing(emailPayload);
        else if (status === 'shipped') await emailService.sendOrderShipped(emailPayload);
      }
    }
  } catch (emailErr) {
    console.error('[Email] Failed to send status email:', emailErr.message);
  }

  res.json({ message: 'Status pesanan berhasil diperbarui', status });
}

async function confirmKarunika(req, res) {
  const { orderId } = req.params;

  const newExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

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

  // Fetch user for email
  try {
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select('email, name')
      .eq('id', order.user_id)
      .single();

    if (userRow) {
      await emailService.sendPaymentRequest({
        email: userRow.email,
        name: userRow.name,
        orderNumber: order.order_number,
        totalAmount: order.total_amount,
        items: order.order_items,
        bank: 'BCA',
        account: '2950211345',
        expiresAt: newExpiresAt,
      });
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

module.exports = { checkout, listOrders, getOrder, cancelOrder, listAllOrders, updateOrderStatus, confirmKarunika, confirmDelivery };
