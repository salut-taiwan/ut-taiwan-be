const { supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { users } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { v4: uuid } = require('uuid');
const {
  SALUT_MEMBERSHIP,
  getSalutMembershipFee,
  nextSalutExpiry,
  isSalutActive,
} = require('../config/constants');
const { presentSalutStatus } = require('../presenters/salutPresenter');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const RENEWAL_POLICY_PAYLOAD = {
  resetMonth: SALUT_MEMBERSHIP.EXPIRY_MONTH,
  resetDay: SALUT_MEMBERSHIP.EXPIRY_DAY,
  resetDates: SALUT_MEMBERSHIP.EXPIRY_DATES,
  timezone: SALUT_MEMBERSHIP.EXPIRY_TIMEZONE,
  notice: SALUT_MEMBERSHIP.RENEWAL_NOTICE,
};

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
  const { proofUrl, current_semester: bodySemester } = req.body;
  if (!proofUrl || typeof proofUrl !== 'string' || !proofUrl.trim()) {
    return res.status(400).json({ error: 'URL bukti pembayaran wajib diisi' });
  }

  if (bodySemester !== undefined && bodySemester !== null) {
    if (!Number.isInteger(bodySemester) || bodySemester < 1 || bodySemester > 9) {
      return res.status(400).json({ error: 'Semester saat ini harus angka 1 sampai 9' });
    }
  }

  try {
    const user = await db.query.users.findFirst({
      columns: { is_salut: true, salut_status: true, current_semester: true, salut_approved_at: true },
      where: eq(users.id, req.user.id),
    });

    if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

    // Block only if the user is a CURRENTLY active SALUT member.
    // Raw is_salut / salut_status='approved' can be stale after a cycle rolls over (lazy expiry).
    if (isSalutActive(user.salut_approved_at)) {
      return res.status(400).json({ error: 'Anda sudah menjadi anggota SALUT' });
    }
    if (user.salut_status === 'pending') {
      return res.status(400).json({ error: 'Permohonan Anda sedang dalam proses verifikasi' });
    }
    // 'none', 'rejected', 'expired', and stale 'approved' (past cycle) are all eligible to apply.

    const resolvedSemester = bodySemester ?? user.current_semester;
    if (!Number.isInteger(resolvedSemester) || resolvedSemester < 1 || resolvedSemester > 9) {
      return res.status(400).json({ error: 'Semester saat ini wajib diisi (1-9)' });
    }

    const fee = getSalutMembershipFee(resolvedSemester);

    await db.update(users)
      .set({
        salut_status: 'pending',
        salut_applied_at: new Date(),
        salut_payment_proof_url: proofUrl.trim(),
        salut_rejection_reason: null,
        current_semester: resolvedSemester,
        salut_applied_fee_amount: String(fee.amount),
        salut_applied_semester: resolvedSemester,
      })
      .where(eq(users.id, req.user.id));

    res.json({
      message: 'Permohonan berhasil dikirim',
      fee,
      nextExpiry: nextSalutExpiry(new Date()).toISOString(),
      renewalPolicy: RENEWAL_POLICY_PAYLOAD,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengirim permohonan' });
  }
}

async function getApplicationStatus(req, res) {
  try {
    const data = await db.query.users.findFirst({
      columns: {
        is_salut: true,
        salut_status: true,
        salut_applied_at: true,
        salut_rejection_reason: true,
        salut_approved_at: true,
        salut_applied_fee_amount: true,
        salut_applied_semester: true,
        current_semester: true,
      },
      where: eq(users.id, req.user.id),
    });

    if (!data) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    const active = isSalutActive(data.salut_approved_at);
    const masked = (!active && data.salut_status === 'approved') ? 'expired' : data.salut_status;
    res.json(presentSalutStatus({
      ...data,
      is_salut_active: active,
      salut_status: masked,
      renewalPolicy: RENEWAL_POLICY_PAYLOAD,
    }));
  } catch (err) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan' });
  }
}

module.exports = { uploadProof, applyForMembership, getApplicationStatus };
