const { supabase, supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { users } = require('../db/schema');
const { eq } = require('drizzle-orm');
const env = require('../config/env');

function buildProfileInsert(userId, body) {
  const {
    email, name, nim, phone, birth_place, birth_date, program_id,
    address_zh_city, address_zh_district, address_zh_road, address_zh_number, address_zh_floor,
    postal_code,
    bank_ntd_code, bank_ntd_name, bank_ntd_account, bank_idr_name, bank_idr_account,
  } = body;
  return {
    id: userId, email, name, nim, phone,
    birth_place: birth_place || null,
    birth_date: birth_date || null,
    program_id,
    address_zh_city, address_zh_district, address_zh_road, address_zh_number,
    address_zh_floor: address_zh_floor || null,
    postal_code: postal_code || null,
    bank_ntd_code: bank_ntd_code || null,
    bank_ntd_name: bank_ntd_name || null,
    bank_ntd_account: bank_ntd_account || null,
    bank_idr_name: bank_idr_name || null,
    bank_idr_account: bank_idr_account || null,
  };
}

async function register(req, res) {
  const { email, password, name, nim, phone, birth_place, birth_date,
          program_id,
          address_zh_city, address_zh_district, address_zh_road, address_zh_number, address_zh_floor,
          postal_code,
          bank_ntd_code, bank_ntd_name, bank_ntd_account,
          bank_idr_name, bank_idr_account } = req.body;

  if (!email || !password || !name || !nim || !phone || !birth_place || !birth_date
      || !program_id
      || !address_zh_city || !address_zh_district || !address_zh_road || !address_zh_number
      || !postal_code) {
    return res.status(400).json({ error: 'email, password, nama, NIM, nomor HP, tempat/tanggal lahir, program studi, alamat Mandarin, dan kode pos wajib diisi' });
  }

  const ntdComplete = bank_ntd_code && bank_ntd_account;
  const idrComplete = bank_idr_name && bank_idr_account;
  if (!ntdComplete && !idrComplete) {
    return res.status(400).json({ error: 'Wajib mengisi minimal satu rekening bank (NTD atau IDR)' });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${env.FRONTEND_URL}/login?verified=true` },
  });
  if (error) return res.status(400).json({ error: error.message });

  // Supabase returns null user when email already exists (enumeration prevention)
  if (!data.user) {
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      return res.status(409).json({ error: 'Email sudah terdaftar.' });
    }
    const existing = await db.query.users.findFirst({
      columns: { id: true },
      where: eq(users.id, signInData.user.id),
    });
    if (existing) {
      return res.status(409).json({ error: 'Email sudah terdaftar, silakan login.' });
    }
    // Orphaned auth user — insert the missing public profile
    await db.insert(users).values(buildProfileInsert(signInData.user.id, req.body));
    await supabase.auth.signOut();
    return res.status(201).json({ message: 'Akun berhasil dipulihkan. Silakan login.' });
  }

  try {
    await db.insert(users).values(buildProfileInsert(data.user.id, req.body));
  } catch (profileError) {
    // Compensate: delete the auth user to avoid orphaned auth account
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
    return res.status(500).json({ error: 'Gagal membuat profil. Silakan coba lagi.' });
  }

  res.status(201).json({ message: 'Registrasi berhasil. Cek email untuk verifikasi.', userId: data.user.id });
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email dan password wajib diisi' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message === 'Email not confirmed') {
      return res.status(401).json({ error: 'Email belum diverifikasi. Cek inbox atau folder spam Anda.', code: 'EMAIL_NOT_CONFIRMED' });
    }
    return res.status(401).json({ error: 'Email atau password salah' });
  }

  res.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: {
      id: data.user.id,
      email: data.user.email,
    },
  });
}

async function logout(req, res) {
  await supabase.auth.signOut();
  res.json({ message: 'Logout berhasil' });
}

async function getMe(req, res) {
  try {
    const data = await db.query.users.findFirst({
      where: eq(users.id, req.user.id),
      with: { programs: { columns: { name: true, code: true } } },
    });

    if (!data) return res.status(404).json({ error: 'Profil tidak ditemukan', code: 'PROFILE_MISSING' });
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: 'Profil tidak ditemukan', code: 'PROFILE_MISSING' });
  }
}

async function updateMe(req, res) {
  const allowedFields = ['name', 'nim', 'phone', 'program_id', 'current_semester',
    'shipping_address', 'city', 'province', 'postal_code', 'country',
    'bank_ntd_code', 'bank_ntd_name', 'bank_ntd_account',
    'bank_idr_name', 'bank_idr_account',
    'birth_place', 'birth_date',
    'address_zh_city', 'address_zh_district', 'address_zh_road',
    'address_zh_number', 'address_zh_floor'];
  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  updates.updated_at = new Date();

  try {
    const [data] = await db.update(users)
      .set(updates)
      .where(eq(users.id, req.user.id))
      .returning();

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return res.status(401).json({ error: 'Sesi berakhir. Silakan login kembali.' });

  res.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  });
}

async function resendVerification(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email wajib diisi' });
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${env.FRONTEND_URL}/login?verified=true` },
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Email verifikasi telah dikirim ulang' });
}

module.exports = { register, login, logout, getMe, updateMe, refresh, resendVerification };