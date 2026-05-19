const { supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { orders, payments, users } = require('../db/schema');
const { eq, and, desc } = require('drizzle-orm');
const orderEmailService = require('../services/orderEmailService');


async function confirmPayment(req, res) {
  const { orderId } = req.params;
  // RPC stays on Supabase client (stored procedure)
  const { error } = await supabaseAdmin.rpc('confirm_payment', { p_order_id: orderId });
  if (error) return res.status(400).json({ error: error.message });

  await orderEmailService.sendStatusEmail(orderId, 'paid');

  res.json({ message: 'Pembayaran dikonfirmasi' });
}

async function getPaymentStatus(req, res) {
  const { orderId } = req.params;
  try {
    // Ownership check
    const order = await db.query.orders.findFirst({
      columns: { id: true },
      where: and(eq(orders.id, orderId), eq(orders.user_id, req.user.id)),
    });

    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

    const [data] = await db
      .select()
      .from(payments)
      .where(eq(payments.order_id, orderId))
      .orderBy(desc(payments.created_at))
      .limit(1);

    if (!data) return res.status(404).json({ error: 'Data pembayaran tidak ditemukan' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function uploadProof(req, res) {
  const { orderId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'File wajib dilampirkan' });

  try {
    const order = await db.query.orders.findFirst({
      columns: { id: true },
      where: and(
        eq(orders.id, orderId),
        eq(orders.user_id, req.user.id),
        eq(orders.status, 'awaiting_payment'),
      ),
    });

    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan atau belum dalam status menunggu pembayaran' });

    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const filePath = `proofs/${orderId}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from('payment-docs')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

    if (upErr) return res.status(500).json({ error: upErr.message });

    await db.update(payments)
      .set({ proof_path: filePath, proof_uploaded_at: new Date() })
      .where(eq(payments.order_id, orderId));

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function uploadInvoice(req, res) {
  const { orderId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'File wajib dilampirkan' });

  try {
    const ext = (req.file.originalname.split('.').pop() || 'pdf').toLowerCase();
    const filePath = `invoices/${orderId}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from('payment-docs')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

    if (upErr) return res.status(500).json({ error: upErr.message });

    await db.update(payments)
      .set({ invoice_path: filePath })
      .where(eq(payments.order_id, orderId));

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', pdf: 'application/pdf',
};

async function viewProof(req, res) {
  const { orderId } = req.params;

  try {
    const userRecord = await db.query.users.findFirst({
      columns: { role: true },
      where: eq(users.id, req.user.id),
    });
    const isAdmin = userRecord?.role === 'admin';

    const orderConditions = [eq(orders.id, orderId)];
    if (!isAdmin) orderConditions.push(eq(orders.user_id, req.user.id));

    const order = await db.query.orders.findFirst({
      columns: { id: true },
      where: and(...orderConditions),
    });
    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

    const payment = await db.query.payments.findFirst({
      columns: { proof_path: true },
      where: eq(payments.order_id, orderId),
    });
    if (!payment?.proof_path) return res.status(404).json({ error: 'Bukti tidak ditemukan' });

    const { data: blob, error } = await supabaseAdmin.storage.from('payment-docs').download(payment.proof_path);
    if (error || !blob) return res.status(500).json({ error: 'Gagal memuat file' });

    const ext = payment.proof_path.split('.').pop()?.toLowerCase();
    res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.send(Buffer.from(await blob.arrayBuffer()));
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat file' });
  }
}

async function viewInvoice(req, res) {
  const { orderId } = req.params;

  try {
    const payment = await db.query.payments.findFirst({
      columns: { invoice_path: true },
      where: eq(payments.order_id, orderId),
    });
    if (!payment?.invoice_path) return res.status(404).json({ error: 'Invoice tidak ditemukan' });

    const { data: blob, error } = await supabaseAdmin.storage.from('payment-docs').download(payment.invoice_path);
    if (error || !blob) return res.status(500).json({ error: 'Gagal memuat file' });

    const ext = payment.invoice_path.split('.').pop()?.toLowerCase();
    res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.send(Buffer.from(await blob.arrayBuffer()));
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat file' });
  }
}

module.exports = { confirmPayment, getPaymentStatus, uploadProof, uploadInvoice, viewProof, viewInvoice };