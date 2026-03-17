const { supabase, supabaseAdmin } = require('../config/supabase');

async function register(req, res) {
  const { email, password, name, nim, phone } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, dan name wajib diisi' });
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  // Supabase returns null user when email already exists (enumeration prevention)
  if (!data.user) {
    // Try signing in to verify identity and recover orphaned account
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      return res.status(409).json({ error: 'Email sudah terdaftar.' });
    }
    // Check if public profile already exists
    const { data: existing } = await supabaseAdmin.from('users').select('id').eq('id', signInData.user.id).maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'Email sudah terdaftar, silakan login.' });
    }
    // Orphaned auth user — insert the missing public profile
    await supabaseAdmin.from('users').insert({ id: signInData.user.id, email, name, nim: nim || null, phone: phone || null });
    await supabase.auth.signOut();
    return res.status(201).json({ message: 'Akun berhasil dipulihkan. Silakan login.' });
  }

  // Create user profile row
  const { error: profileError } = await supabaseAdmin.from('users').insert({
    id: data.user.id,
    email,
    name,
    nim: nim || null,
    phone: phone || null,
  });

  if (profileError) {
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
  if (error) return res.status(401).json({ error: 'Email atau password salah' });

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
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*, programs(name, code)')
    .eq('id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Profil tidak ditemukan', code: 'PROFILE_MISSING' });
  res.json(data);
}

async function updateMe(req, res) {
  const allowedFields = ['name', 'nim', 'phone', 'program_id', 'current_semester',
    'shipping_address', 'city', 'province', 'postal_code', 'country'];
  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

module.exports = { register, login, logout, getMe, updateMe };
