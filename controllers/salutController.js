const { supabaseAdmin } = require('../config/supabase');
const { v4: uuid } = require('uuid');
const path = require('path');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function extFromMime(mime) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  return map[mime] || 'bin';
}

async function uploadProof(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'File bukti pembayaran wajib diunggah' });
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return res.status(400).json({ error: 'Format file tidak didukung (JPG, PNG, WebP, atau PDF)' });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return res.status(400).json({ error: 'Ukuran file maksimal 5 MB' });
  }

  const ext = extFromMime(file.mimetype);
  const storagePath = `${req.user.id}/${Date.now()}_${uuid()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from('salut-proofs')
    .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) {
    console.error('[salut uploadProof] Supabase storage error:', error);
    return res.status(500).json({ error: `Gagal mengunggah file: ${error.message}` });
  }
  res.json({ url: storagePath });
}

async function applyForMembership(req, res) {
  const { proofUrl } = req.body;
  if (!proofUrl || typeof proofUrl !== 'string' || !proofUrl.trim()) {
    return res.status(400).json({ error: 'URL bukti pembayaran wajib diisi' });
  }

  // Load current user status
  const { data: user, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('is_salut, salut_status')
    .eq('id', req.user.id)
    .single();

  if (fetchError || !user) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

  if (user.is_salut || user.salut_status === 'approved') {
    return res.status(400).json({ error: 'Anda sudah menjadi anggota SALUT' });
  }
  if (user.salut_status === 'pending') {
    return res.status(400).json({ error: 'Permohonan Anda sedang dalam proses verifikasi' });
  }

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({
      salut_status: 'pending',
      salut_applied_at: new Date().toISOString(),
      salut_payment_proof_url: proofUrl.trim(),
      salut_rejection_reason: null,
    })
    .eq('id', req.user.id);

  if (updateError) return res.status(500).json({ error: 'Gagal mengirim permohonan' });
  res.json({ message: 'Permohonan berhasil dikirim' });
}

async function getApplicationStatus(req, res) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('is_salut, salut_status, salut_applied_at, salut_rejection_reason, salut_approved_at')
    .eq('id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
  res.json(data);
}

module.exports = { uploadProof, applyForMembership, getApplicationStatus };
