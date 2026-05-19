const { supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { orders, order_items, payments, users, carts, cart_items } = require('../db/schema');
const { eq, and, desc, count } = require('drizzle-orm');
const paymentService = require('../services/paymentService');
const emailService = require('../services/emailService');
const orderEmailService = require('../services/orderEmailService');
const { PAYMENT_EXPIRY_MS, ORDER_STATUS_TRANSITIONS, CONFIRM_DEADLINE_MS, ORDER_STEPS, PAYMENT_BANK, SALUT_FEES } = require('../config/constants');

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
    paymentMethod, paymentBank, customItems,
  } = req.body;

  // Validate required fields
  const required = { shippingName, shippingAddress, shippingCity, shippingProvince, shippingPostal, shippingPhone, paymentMethod };
  for (const [key, val] of Object.entries(required)) {
    if (!val) return res.status(400).json({ error: `${key} wajib diisi` });
  }

  // Pre-check: read cart items for amount calculation
  const cart = await db.query.carts.findFirst({
    columns: { id: true },
    where: eq(carts.user_id, req.user.id),
  });

  if (!cart) return res.status(400).json({ error: 'Keranjang kosong' });

  const cartItems = await db.query.cart_items.findMany({
    columns: { quantity: true, price_snapshot: true, is_request: true, sku_id: true, variant_label: true, product_name_snapshot: true },
    where: eq(cart_items.cart_id, cart.id),
    with: {
      modules: { columns: { id: true, tbo_code: true, name: true, is_available: true } },
      product_skus: {
        columns: { id: true, price: true },
        with: { products: { columns: { name: true } } },
      },
    },
  });

  if (!cartItems || cartItems.length === 0) {
    return res.status(400).json({ error: 'Keranjang kosong' });
  }

  const unavailable = cartItems.filter(i => !i.is_request && i.modules && !i.modules.is_available);
  if (unavailable.length > 0) {
    return res.status(400).json({
      error: 'Beberapa modul tidak tersedia. Silakan ubah ke permintaan atau hapus dari keranjang.',
      modules: unavailable.map(i => i.modules.tbo_code),
    });
  }

  const userRecord = await db.query.users.findFirst({
    columns: { is_salut: true },
    where: eq(users.id, req.user.id),
  });
  const isSalut  = userRecord?.is_salut ?? false;
  const ongkir   = isSalut ? 0 : SALUT_FEES.ONGKIR;
  const boxFee   = isSalut ? 0 : SALUT_FEES.BOX;
  const adminFee = isSalut ? 0 : SALUT_FEES.ADMIN;

  const subtotal = cartItems.reduce((sum, i) => sum + Number(i.price_snapshot) * i.quantity, 0);
  const totalAmount = subtotal + ongkir + boxFee + adminFee;
  const uniqueCode = Math.floor(Math.random() * 500) + 100;
  const orderNumber = generateOrderNumber();

  // Call gateway
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

  const orderItemsPayload = cartItems.map(i => {
    if (i.modules) {
      return {
        module_id: i.modules.id,
        module_code: i.modules.tbo_code,
        module_name: i.modules.name,
        quantity: i.quantity,
        unit_price: i.price_snapshot,
        subtotal: Number(i.price_snapshot) * i.quantity,
        is_request: i.is_request,
      };
    }
    return {
      module_id: null,
      module_code: null,
      module_name: i.product_name_snapshot,
      quantity: i.quantity,
      unit_price: i.price_snapshot,
      subtotal: Number(i.price_snapshot) * i.quantity,
      is_request: true,
      sku_id: i.sku_id,
      variant_label: i.variant_label,
    };
  });

  const extras = Array.isArray(customItems) ? customItems : [];
  for (const ci of extras) {
    if (!ci.moduleCode || typeof ci.moduleCode !== 'string' || !ci.moduleCode.trim()) {
      return res.status(400).json({ error: 'Kode modul wajib diisi untuk setiap item tambahan' });
    }
  }
  const customOrderItems = extras.map(ci => ({
    module_id: null,
    module_code: ci.moduleCode.trim().slice(0, 30),
    module_name: ci.moduleName?.trim() || ci.moduleCode.trim().slice(0, 30),
    quantity: Math.max(1, parseInt(ci.quantity) || 1),
    unit_price: 0,
    subtotal: 0,
    is_request: true,
  }));
  const allOrderItems = [...orderItemsPayload, ...customOrderItems];

  // RPC stays on Supabase client (atomic transaction with multiple table writes)
  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('checkout_order', {
    p_user_id:            req.user.id,
    p_order_number:       orderNumber,
    p_subtotal:           subtotal,
    p_shipping_cost:      ongkir,
    p_box_fee:            boxFee,
    p_admin_fee:          adminFee,
    p_is_salut_order:     isSalut,
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
    p_payment_amount:     totalAmount + uniqueCode,
    p_unique_code:        uniqueCode,
    p_payment_expires_at: gatewayResult.expiresAt,
    p_gateway_payment_id: gatewayResult.gatewayPaymentId,
    p_gateway_billing_no: gatewayResult.gatewayBillingNo,
    p_gateway_response:   gatewayResult.gatewayResponse,
    p_order_items:        allOrderItems,
  });

  if (rpcError) {
    const status = rpcError.message.includes('tidak tersedia') ? 400 : 500;
    return res.status(status).json({ error: rpcError.message });
  }

  res.status(201).json({ order: rpcData.order, payment: rpcData.payment });

  orderEmailService.fetchOrderEmailPayload(rpcData.order.id)
    .then(p => p && emailService.sendOrderConfirmation(p))
    .catch(() => {});
}

async function listOrders(req, res) {
  try {
    const data = await db.query.orders.findMany({
      columns: { id: true, order_number: true, status: true, total_amount: true, created_at: true },
      where: eq(orders.user_id, req.user.id),
      orderBy: desc(orders.created_at),
      with: {
        order_items: { columns: { id: true } },
        payments: { columns: { status: true, amount: true } },
      },
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOrder(req, res) {
  const { id } = req.params;
  try {
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.user_id, req.user.id)),
      with: { order_items: true, payments: true },
    });

    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

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
          item.request_status === 'rejected'                          ? 'rejected'        :
          item.is_request && item.request_status === 'pending'        ? 'pending_request' :
          item.is_request && Number(item.unit_price) === 0            ? 'zero_price'      :
          'normal',
      }));
    }

    res.json(order);
  } catch (err) {
    res.status(404).json({ error: 'Pesanan tidak ditemukan' });
  }
}

async function cancelOrder(req, res) {
  const { id } = req.params;

  // RPC stays on Supabase client (atomic with side effects)
  const { error } = await supabaseAdmin.rpc('cancel_order', {
    p_order_id: id,
    p_user_id: req.user.id,
  });

  if (error) {
    const status = error.message.includes('tidak ditemukan') ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }

  res.json({ message: 'Pesanan berhasil dibatalkan' });

  orderEmailService.fetchOrderEmailPayload(id)
    .then(p => p && emailService.sendOrderCancelled(p))
    .catch(() => {});
}

async function listAllOrders(req, res) {
  try {
    const data = await db.query.orders.findMany({
      columns: {
        id: true, order_number: true, status: true, subtotal: true,
        shipping_cost: true, box_fee: true, admin_fee: true, is_salut_order: true,
        total_amount: true, created_at: true, shipping_name: true, shipping_phone: true,
      },
      orderBy: desc(orders.created_at),
      with: {
        payments: { columns: { status: true, amount: true, proof_path: true, invoice_path: true, proof_uploaded_at: true } },
        order_items: { columns: { id: true, module_code: true, module_name: true, quantity: true, unit_price: true, subtotal: true, is_request: true, request_status: true } },
      },
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}


async function updateOrderStatus(req, res) {
  const { orderId } = req.params;
  const { status } = req.body;

  if (!status) return res.status(400).json({ error: 'status wajib diisi' });

  try {
    const order = await db.query.orders.findFirst({
      columns: { id: true, status: true },
      where: eq(orders.id, orderId),
    });

    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

    const allowed = ORDER_STATUS_TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Tidak dapat mengubah status dari "${order.status}" ke "${status}"` });
    }

    const extra = status === 'shipped' ? { shipped_at: new Date() } : {};

    const [updated] = await db.update(orders)
      .set({ status, updated_at: new Date(), ...extra })
      .where(and(eq(orders.id, orderId), eq(orders.status, order.status)))
      .returning({ id: orders.id });

    if (!updated) return res.status(409).json({ error: 'Status pesanan telah berubah, silakan refresh' });

    if (status === 'paid' || status === 'processing' || status === 'shipped') {
      await orderEmailService.sendStatusEmail(orderId, status);
    }

    res.json({ message: 'Status pesanan berhasil diperbarui', status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function confirmKarunika(req, res) {
  const { orderId } = req.params;

  try {
    // Block if any request items are still pending
    const [{ pending }] = await db
      .select({ pending: count() })
      .from(order_items)
      .where(and(
        eq(order_items.order_id, orderId),
        eq(order_items.is_request, true),
        eq(order_items.request_status, 'pending'),
      ));

    if (Number(pending) > 0) {
      return res.status(400).json({
        error: 'Selesaikan semua permintaan terlebih dahulu (setujui atau tolak) sebelum konfirmasi',
      });
    }

    const newExpiresAt = new Date(Date.now() + PAYMENT_EXPIRY_MS);

    const [updated] = await db.update(orders)
      .set({ status: 'awaiting_payment', updated_at: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
      .returning({ id: orders.id });

    if (!updated) {
      return res.status(400).json({ error: 'Pesanan tidak ditemukan atau bukan dalam status pending' });
    }

    // Reset payment expiry
    try {
      await db.update(payments)
        .set({ expires_at: newExpiresAt })
        .where(and(eq(payments.order_id, orderId), eq(payments.status, 'pending')));
    } catch (e) {
      console.error('[confirmKarunika] Failed to reset payment expiry:', e.message);
    }

    try {
      const payload = await orderEmailService.fetchOrderEmailPayload(orderId);
      if (payload) {
        await emailService.sendPaymentRequest({ ...payload, bank: 'BCA', account: '2950211345', expiresAt: newExpiresAt.toISOString() });
      }
    } catch (emailErr) {
      console.error('[Email] Failed to send payment request email:', emailErr.message);
    }

    res.json({ message: 'Stok Karunika dikonfirmasi, email pembayaran dikirim ke pelanggan', status: 'awaiting_payment' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function confirmDelivery(req, res) {
  const { id } = req.params;

  try {
    const [updated] = await db.update(orders)
      .set({ status: 'delivered', updated_at: new Date() })
      .where(and(
        eq(orders.id, id),
        eq(orders.user_id, req.user.id),
        eq(orders.status, 'shipped'),
      ))
      .returning({ id: orders.id });

    if (!updated) {
      return res.status(400).json({ error: 'Pesanan tidak ditemukan atau belum dalam status dikirim' });
    }

    res.json({ message: 'Penerimaan dikonfirmasi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

  try {
    const existingItem = await db.query.order_items.findFirst({
      columns: { id: true, quantity: true, unit_price: true, is_request: true },
      where: and(eq(order_items.id, itemId), eq(order_items.order_id, orderId)),
    });

    if (!existingItem) return res.status(404).json({ error: 'Item tidak ditemukan' });

    if (status === 'approved' && !existingItem.is_request) {
      return res.status(400).json({ error: 'Hanya item permintaan yang bisa disetujui' });
    }

    if (status === 'approved' && existingItem.is_request && Number(existingItem.unit_price) === 0 && unit_price === undefined) {
      return res.status(400).json({ error: 'Masukkan harga untuk item ini sebelum menyetujui' });
    }

    const updatePayload = { request_status: status };
    if (status === 'approved' && unit_price !== undefined) {
      updatePayload.unit_price = unit_price;
      updatePayload.subtotal   = unit_price * existingItem.quantity;
    }

    const [item] = await db.update(order_items)
      .set(updatePayload)
      .where(and(eq(order_items.id, itemId), eq(order_items.order_id, orderId)))
      .returning({ id: order_items.id, subtotal: order_items.subtotal });

    if (!item) return res.status(404).json({ error: 'Item tidak ditemukan' });

    const needsRecalc = status === 'rejected' || (status === 'approved' && unit_price !== undefined);
    if (needsRecalc) {
      const allItems = await db
        .select({ subtotal: order_items.subtotal, request_status: order_items.request_status })
        .from(order_items)
        .where(eq(order_items.order_id, orderId));

      const newSubtotal = allItems
        .filter(i => i.request_status !== 'rejected')
        .reduce((sum, i) => sum + Number(i.subtotal), 0);

      if (status === 'rejected' && newSubtotal <= 0) {
        return res.status(400).json({
          error: 'Tidak dapat menolak semua item — batalkan pesanan jika tidak ada yang bisa dipenuhi',
        });
      }

      const orderFees = await db.query.orders.findFirst({
        columns: { shipping_cost: true, box_fee: true, admin_fee: true },
        where: eq(orders.id, orderId),
      });
      const fees = Number(orderFees?.shipping_cost ?? 0) + Number(orderFees?.box_fee ?? 0) + Number(orderFees?.admin_fee ?? 0);
      const newTotalAmount = newSubtotal + fees;

      await db.update(orders)
        .set({ subtotal: newSubtotal, total_amount: newTotalAmount, updated_at: new Date() })
        .where(eq(orders.id, orderId));

      const existingPayment = await db.query.payments.findFirst({
        columns: { unique_code: true },
        where: and(eq(payments.order_id, orderId), eq(payments.status, 'pending')),
      });
      const paymentUniqueCode = existingPayment?.unique_code ?? 0;

      await db.update(payments)
        .set({ amount: newTotalAmount + paymentUniqueCode })
        .where(and(eq(payments.order_id, orderId), eq(payments.status, 'pending')));
    }

    res.json({ message: 'Status permintaan berhasil diperbarui', status });

    // Send resolution email if no pending requests remain
    (async () => {
      try {
        const [{ remaining }] = await db
          .select({ remaining: count() })
          .from(order_items)
          .where(and(
            eq(order_items.order_id, orderId),
            eq(order_items.is_request, true),
            eq(order_items.request_status, 'pending'),
          ));

        if (Number(remaining) !== 0) return;

        const [allReqItems, orderRow] = await Promise.all([
          db.select({ module_name: order_items.module_name, request_status: order_items.request_status })
            .from(order_items)
            .where(and(eq(order_items.order_id, orderId), eq(order_items.is_request, true))),
          db.query.orders.findFirst({
            columns: { order_number: true, user_id: true },
            where: eq(orders.id, orderId),
          }),
        ]);

        if (!orderRow) return;

        const userRow = await db.query.users.findFirst({
          columns: { email: true, name: true },
          where: eq(users.id, orderRow.user_id),
        });
        if (!userRow) return;

        emailService.sendRequestItemsResolved({
          email: userRow.email,
          name: userRow.name,
          orderNumber: orderRow.order_number,
          approved: allReqItems.filter(i => i.request_status === 'approved').map(i => i.module_name),
          rejected: allReqItems.filter(i => i.request_status === 'rejected').map(i => i.module_name),
        });
      } catch (_) { /* noop */ }
    })();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { checkout, listOrders, getOrder, cancelOrder, listAllOrders, updateOrderStatus, confirmKarunika, confirmDelivery, updateRequestItemStatus };
