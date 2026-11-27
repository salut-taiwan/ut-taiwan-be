const { supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { users } = require('../db/schema');
const { eq, and, ne } = require('drizzle-orm');
const { v4: uuid } = require('uuid');
const {
  SALUT_MEMBERSHIP,
  getSalutMembershipFee,
  isSalutActive,
} = require('../config/constants');
const { presentSalutStatus } = require('../presenters/salutPresenter');
const { normalizeWaNumber } = require('../format');
const { emitUserStatusUpdate } = require('../services/userStatusEventBus');

const { validateUpload, extFromMime } = require('../utils/validateUpload');

const RENEWAL_POLICY_PAYLOAD = {
  billing: SALUT_MEMBERSHIP.BILLING,
  required: false,
  resetMonth: SALUT_MEMBERSHIP.EXPIRY_MONTH,
  resetDay: SALUT_MEMBERSHIP.EXPIRY_DAY,
  resetDates: SALUT_MEMBERSHIP.EXPIRY_DATES,
  timezone: SALUT_MEMBERSHIP.EXPIRY_TIMEZONE,
  notice: SALUT_MEMBERSHIP.RENEWAL_NOTICE,
};

async function uploadProof(req, res) {
  const uploadError = validateUpload(req.file, 'File bukti pembayaran wajib diunggah');
  if (uploadError) return res.status(400).json({ error: uploadError });
  const file = req.file;

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
  const { proofUrl, current_semester: bodySemester, wa_number: bodyWaNumber, note } = req.body;
  if (!proofUrl || typeof proofUrl !== 'string' || !proofUrl.trim()) {
    return res.status(400).json({ error: 'URL bukti pembayaran wajib diisi' });
  }

  if (!proofUrl.trim().startsWith(req.user.id + '/')) {
    return res.status(400).json({ error: 'Bukti pembayaran harus berasal dari unggahan akun Anda sendiri' });
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > 1000)) {
    return res.status(400).json({ error: 'Keterangan maksimal 1000 karakter' });
  }

  // Required: without it an approved member can't be added to the SALUT group.
  const waNumber = normalizeWaNumber(bodyWaNumber);
  if (!waNumber) {
    return res.status(400).json({ error: 'Nomor WhatsApp aktif wajib diisi dengan benar' });
  }

  if (bodySemester !== undefined && bodySemester !== null) {
    if (!Number.isInteger(bodySemester) || bodySemester < 1 || bodySemester > 9) {
      return res.status(400).json({ error: 'Semester saat ini harus angka 1 sampai 9' });
    }
  }

  try {
    const user = await db.query.users.findFirst({
      columns: { is_salut: true, salut_status: true, current_semester: true, salut_approved_at: true, nim: true },
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
    // Migration 022 cleared approval timestamps. An expired historical record
    // must be verified by an admin; do not ask that student to pay again.
    if (user.salut_status === 'expired' || user.salut_status === 'approved') {
      return res.status(409).json({ error: 'Catatan pembayaran lama perlu diperiksa bendahara sebelum pembayaran baru', code: 'HISTORICAL_PAYMENT_REVIEW_REQUIRED' });
    }
    if (!user.nim) return res.status(400).json({ error: 'Lengkapi NIM pada profil mahasiswa' });

    const resolvedSemester = bodySemester ?? user.current_semester;
    // Semester is optional metadata; it never changes the contribution amount.
    const snapshotSemester = Number.isInteger(resolvedSemester) && resolvedSemester >= 1 && resolvedSemester <= 9 ? resolvedSemester : null;

    const fee = getSalutMembershipFee(resolvedSemester);

    const saved = await db.update(users)
      .set({
        salut_status: 'pending',
        salut_applied_at: new Date(),
        salut_payment_proof_url: proofUrl.trim(),
        salut_rejection_reason: null,
        current_semester: snapshotSemester,
        salut_applied_fee_amount: fee.amount,
        salut_applied_semester: snapshotSemester,
        salut_payment_note: (note || '').trim(),
        salut_wa_number: waNumber,
        // The number they're reachable on today is the better profile phone too.
        phone: waNumber,
      })
      .where(and(eq(users.id, req.user.id), ne(users.salut_status, 'pending'), ne(users.salut_status, 'approved'), ne(users.salut_status, 'expired')))
      .returning({ id: users.id });
    if (!saved.length) return res.status(409).json({ error: 'Status konfirmasi berubah. Muat ulang halaman sebelum mencoba kembali.' });

    emitUserStatusUpdate(req.user.id, { is_salut: false, is_salut_active: false, salut_status: 'pending' });

    res.json({
      message: 'Permohonan berhasil dikirim',
      fee,
      nextExpiry: null,
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
        salut_payment_note: true,
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
