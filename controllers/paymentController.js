const { supabaseAdmin } = require('../config/supabase');
const orderEmailService = require('../services/orderEmailService');


async function confirmPayment(req, res) {
  const { orderId } = req.params;
  const { error } = await supabaseAdmin.rpc('confirm_payment', { p_order_id: orderId });
  if (error) return res.status(400).json({ error: error.message });

  await orderEmailService.sendStatusEmail(orderId, 'paid');

  res.json({ message: 'Pembayaran dikonfirmasi' });
}

async function getPaymentStatus(req, res) {
  const { orderId } = req.params;

  // Ownership check: verify this order belongs to the requesting user
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('user_id', req.user.id)
    .single();

  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Data pembayaran tidak ditemukan' });
  res.json(data);
}

async function uploadProof(req, res) {
  const { orderId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'File wajib dilampirkan' });

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('user_id', req.user.id)
    .eq('status', 'awaiting_payment')
    .single();

  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan atau belum dalam status menunggu pembayaran' });

  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const path = `proofs/${orderId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from('payment-docs')
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

  if (upErr) return res.status(500).json({ error: upErr.message });

  await supabaseAdmin
    .from('payments')
    .update({ proof_path: path, proof_uploaded_at: new Date().toISOString() })
    .eq('order_id', orderId);

  res.json({ ok: true });
}

async function uploadInvoice(req, res) {
  const { orderId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'File wajib dilampirkan' });

  const ext = (req.file.originalname.split('.').pop() || 'pdf').toLowerCase();
  const path = `invoices/${orderId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from('payment-docs')
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

  if (upErr) return res.status(500).json({ error: upErr.message });

  await supabaseAdmin
    .from('payments')
    .update({ invoice_path: path })
    .eq('order_id', orderId);

  res.json({ ok: true });
}

const CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', pdf: 'application/pdf',
};

async function viewProof(req, res) {
  const { orderId } = req.params;

  const { data: userRecord } = await supabaseAdmin.from('users').select('role').eq('id', req.user.id).single();
  const isAdmin = userRecord?.role === 'admin';

  let q = supabaseAdmin.from('orders').select('id').eq('id', orderId);
  if (!isAdmin) q = q.eq('user_id', req.user.id);
  const { data: order } = await q.single();
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

  const { data: payment } = await supabaseAdmin.from('payments').select('proof_path').eq('order_id', orderId).single();
  if (!payment?.proof_path) return res.status(404).json({ error: 'Bukti tidak ditemukan' });

  const { data: blob, error } = await supabaseAdmin.storage.from('payment-docs').download(payment.proof_path);
  if (error || !blob) return res.status(500).json({ error: 'Gagal memuat file' });

  const ext = payment.proof_path.split('.').pop()?.toLowerCase();
  res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.send(Buffer.from(await blob.arrayBuffer()));
}

async function viewInvoice(req, res) {
  const { orderId } = req.params;

  const { data: payment } = await supabaseAdmin.from('payments').select('invoice_path').eq('order_id', orderId).single();
  if (!payment?.invoice_path) return res.status(404).json({ error: 'Invoice tidak ditemukan' });

  const { data: blob, error } = await supabaseAdmin.storage.from('payment-docs').download(payment.invoice_path);
  if (error || !blob) return res.status(500).json({ error: 'Gagal memuat file' });

  const ext = payment.invoice_path.split('.').pop()?.toLowerCase();
  res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.send(Buffer.from(await blob.arrayBuffer()));
}

module.exports = { confirmPayment, getPaymentStatus, uploadProof, uploadInvoice, viewProof, viewInvoice };
