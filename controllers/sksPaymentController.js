'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { sks_payments, users } = require('../db/schema');
const { eq, and, desc, sql } = require('drizzle-orm');
const { v4: uuid } = require('uuid');
const { quoteNtdFromIdr } = require('../config/constants');
const { formatIDR, formatNTD } = require('../format');
const { presentSksPayment, presentAdminSksPayment } = require('../presenters/sksPaymentPresenter');
const emailService = require('../services/emailService');

const { validateUpload, extFromMime } = require('../utils/validateUpload');

const BUCKET = 'sks-payment-files';
const MAX_IDR_AMOUNT = 100_000_000;
const MAX_SEMESTER_PERIOD_LEN = 30;
const MAX_NIM_LEN = 20;
const MAX_NAME_LEN = 120;
const MAX_REASON_LEN = 500;

function firstNameOf(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().split(/\s+/)[0] || '';
}

async function uploadFile(req, res, kind /* 'slip' | 'proof' */) {
  const uploadError = validateUpload(req.file);
  if (uploadError) return res.status(400).json({ error: uploadError });
  const file = req.file;

  const ext = extFromMime(file.mimetype);
  const storagePath = `${req.user.id}/${kind}_${Date.now()}_${uuid()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) {
    console.error(`[sksPayment upload-${kind}] Supabase storage error:`, error);
    return res.status(500).json({ error: `Gagal mengunggah file: ${error.message}` });
  }
  res.json({ url: storagePath });
}

async function uploadUtSlip(req, res) {
  return uploadFile(req, res, 'slip');
}

async function uploadTransferProof(req, res) {
  return uploadFile(req, res, 'proof');
}

async function quoteSksPayment(req, res) {
  const { idr_amount } = req.body || {};
  const idrNum = Number(idr_amount);
  if (!Number.isFinite(idrNum) || idrNum <= 0) {
    return res.status(400).json({ error: 'Nominal IDR harus angka positif' });
  }
  if (idrNum > MAX_IDR_AMOUNT) {
    return res.status(400).json({ error: 'Nominal melebihi batas (maksimal Rp 100.000.000)' });
  }
  const quote = quoteNtdFromIdr(idrNum);
  if (!quote) {
    return res.status(400).json({ error: 'Nominal tidak valid' });
  }
  res.json({
    idr_amount: quote.idr_amount,
    ntd_amount: quote.ntd_amount,
    idr_amount_display: formatIDR(quote.idr_amount),
    ntd_amount_display: formatNTD(quote.ntd_amount),
    rate_label: `Rp ${new Intl.NumberFormat('id-ID').format(quote.rate_idr_per_ntd)} / NT$ 1`,
    memo_hint: `SKS ${firstNameOf(req.user?.name) || 'Mahasiswa'}`,
  });
}

async function submitSksPayment(req, res) {
  const { nim, name, semester_period, idr_amount, ut_slip_url, transfer_proof_url } = req.body || {};

  if (!nim || typeof nim !== 'string' || !nim.trim() || nim.trim().length > MAX_NIM_LEN) {
    return res.status(400).json({ error: 'NIM wajib diisi (maks 20 karakter)' });
  }
  if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LEN) {
    return res.status(400).json({ error: 'Nama wajib diisi (maks 120 karakter)' });
  }
  if (!semester_period || typeof semester_period !== 'string'
      || !semester_period.trim() || semester_period.trim().length > MAX_SEMESTER_PERIOD_LEN) {
    return res.status(400).json({ error: 'Semester/Periode wajib diisi (maks 30 karakter)' });
  }
  const idrNum = Number(idr_amount);
  if (!Number.isFinite(idrNum) || idrNum <= 0) {
    return res.status(400).json({ error: 'Nominal IDR harus angka positif' });
  }
  if (idrNum > MAX_IDR_AMOUNT) {
    return res.status(400).json({ error: 'Nominal melebihi batas (maksimal Rp 100.000.000)' });
  }
  if (!ut_slip_url || typeof ut_slip_url !== 'string' || !ut_slip_url.trim()) {
    return res.status(400).json({ error: 'Slip pembayaran UT wajib diunggah' });
  }
  if (!transfer_proof_url || typeof transfer_proof_url !== 'string' || !transfer_proof_url.trim()) {
    return res.status(400).json({ error: 'Bukti transfer wajib diunggah' });
  }

  const quote = quoteNtdFromIdr(idrNum);
  if (!quote) return res.status(400).json({ error: 'Nominal tidak valid' });

  try {
    const [row] = await db.insert(sks_payments).values({
      user_id: req.user.id,
      nim: nim.trim(),
      name: name.trim(),
      semester_period: semester_period.trim(),
      idr_amount: String(quote.idr_amount),
      ntd_amount: String(quote.ntd_amount),
      rate_idr_per_ntd: String(quote.rate_idr_per_ntd),
      ut_slip_url: ut_slip_url.trim(),
      transfer_proof_url: transfer_proof_url.trim(),
      status: 'pending',
    }).returning();

    res.json(presentSksPayment(row));
  } catch (err) {
    console.error('[sksPayment submit] insert error:', err);
    res.status(500).json({ error: 'Gagal menyimpan permohonan' });
  }
}

async function listMineSksPayments(req, res) {
  try {
    const rows = await db.query.sks_payments.findMany({
      where: eq(sks_payments.user_id, req.user.id),
      orderBy: [desc(sks_payments.created_at)],
    });
    res.json(rows.map(presentSksPayment));
  } catch (err) {
    console.error('[sksPayment listMine] error:', err);
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
}

async function listAdminSksPayments(req, res) {
  const statusFilter = req.query.status === 'all' ? null : 'pending';
  try {
    const rows = await db
      .select({
        id: sks_payments.id,
        user_id: sks_payments.user_id,
        nim: sks_payments.nim,
        name: sks_payments.name,
        semester_period: sks_payments.semester_period,
        idr_amount: sks_payments.idr_amount,
        ntd_amount: sks_payments.ntd_amount,
        rate_idr_per_ntd: sks_payments.rate_idr_per_ntd,
        ut_slip_url: sks_payments.ut_slip_url,
        transfer_proof_url: sks_payments.transfer_proof_url,
        status: sks_payments.status,
        rejection_reason: sks_payments.rejection_reason,
        completed_at: sks_payments.completed_at,
        created_at: sks_payments.created_at,
        email: users.email,
      })
      .from(sks_payments)
      .leftJoin(users, eq(sks_payments.user_id, users.id))
      .where(statusFilter ? eq(sks_payments.status, statusFilter) : undefined)
      .orderBy(desc(sks_payments.created_at));

    res.json(rows.map(presentAdminSksPayment));
  } catch (err) {
    console.error('[sksPayment admin list] error:', err);
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
}

async function getSignedFileUrl(req, res, column) {
  const { id } = req.params;
  try {
    const row = await db.query.sks_payments.findFirst({
      columns: { [column]: true },
      where: eq(sks_payments.id, id),
    });
    if (!row) return res.status(404).json({ error: 'Data tidak ditemukan' });
    const path = row[column];
    if (!path) return res.status(404).json({ error: 'File tidak ada' });

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 300);
    if (error) return res.status(500).json({ error: 'Gagal membuat URL' });
    res.json({ signedUrl: data.signedUrl });
  } catch (err) {
    console.error('[sksPayment signed-url] error:', err);
    res.status(500).json({ error: 'Gagal membuat URL' });
  }
}

async function getAdminSlipSignedUrl(req, res) {
  return getSignedFileUrl(req, res, 'ut_slip_url');
}

async function getAdminProofSignedUrl(req, res) {
  return getSignedFileUrl(req, res, 'transfer_proof_url');
}

async function completeSksPayment(req, res) {
  const { id } = req.params;
  try {
    const updated = await db.update(sks_payments)
      .set({ status: 'completed', completed_at: new Date(), updated_at: new Date() })
      .where(and(eq(sks_payments.id, id), eq(sks_payments.status, 'pending')))
      .returning();

    if (updated.length === 0) {
      return res.status(409).json({ error: 'Sudah diproses' });
    }
    const row = updated[0];

    // Fetch email for the notification (we don't store it on the row).
    const user = await db.query.users.findFirst({
      columns: { email: true },
      where: eq(users.id, row.user_id),
    });

    res.json(presentSksPayment(row));

    if (user?.email) {
      emailService.sendSksPaymentCompleted({
        email: user.email,
        name: row.name,
        semester_period: row.semester_period,
        idr_amount_display: formatIDR(Number(row.idr_amount)),
        ntd_amount_display: formatNTD(Number(row.ntd_amount)),
      }).catch((err) => console.error('[email] send failed:', err.message));
    }
  } catch (err) {
    console.error('[sksPayment complete] error:', err);
    res.status(500).json({ error: 'Gagal memproses' });
  }
}

async function rejectSksPayment(req, res) {
  const { id } = req.params;
  const { reason } = req.body || {};

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'Alasan penolakan wajib diisi' });
  }
  const trimmed = reason.trim();
  if (trimmed.length > MAX_REASON_LEN) {
    return res.status(400).json({ error: 'Alasan maksimal 500 karakter' });
  }

  try {
    const updated = await db.update(sks_payments)
      .set({ status: 'rejected', rejection_reason: trimmed, updated_at: new Date() })
      .where(and(eq(sks_payments.id, id), eq(sks_payments.status, 'pending')))
      .returning();

    if (updated.length === 0) {
      return res.status(409).json({ error: 'Sudah diproses' });
    }
    const row = updated[0];

    const user = await db.query.users.findFirst({
      columns: { email: true },
      where: eq(users.id, row.user_id),
    });

    res.json(presentSksPayment(row));

    if (user?.email) {
      emailService.sendSksPaymentRejected({
        email: user.email,
        name: row.name,
        semester_period: row.semester_period,
        idr_amount_display: formatIDR(Number(row.idr_amount)),
        reason: trimmed,
      }).catch((err) => console.error('[email] send failed:', err.message));
    }
  } catch (err) {
    console.error('[sksPayment reject] error:', err);
    res.status(500).json({ error: 'Gagal menolak' });
  }
}

module.exports = {
  uploadUtSlip,
  uploadTransferProof,
  quoteSksPayment,
  submitSksPayment,
  listMineSksPayments,
  listAdminSksPayments,
  getAdminSlipSignedUrl,
  getAdminProofSignedUrl,
  completeSksPayment,
  rejectSksPayment,
};
