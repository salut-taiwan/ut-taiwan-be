const { supabaseAdmin } = require('../config/supabase');

async function listModules(req, res) {
  const { page = 1, limit = 20, available } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabaseAdmin
    .from('modules')
    .select('id, tbo_code, name, edition, cover_image_url, price_student, price_general, is_available, has_multimedia', { count: 'exact' })
    .is('deleted_at', null)
    .order('tbo_code')
    .range(offset, offset + parseInt(limit) - 1);

  if (available === 'true') query = query.eq('is_available', true);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ data, total: count, page: parseInt(page), limit: parseInt(limit) });
}

async function searchModules(req, res) {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Query minimal 2 karakter' });
  }

  const { data, error } = await supabaseAdmin
    .from('modules')
    .select('id, tbo_code, name, edition, cover_image_url, price_student, is_available')
    .is('deleted_at', null)
    .or(`tbo_code.ilike.%${q}%,name.ilike.%${q}%`)
    .order('tbo_code')
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function getModule(req, res) {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('modules')
    .select(`
      *,
      subject_modules(
        subjects(id, code, name, programs(id, code, name))
      )
    `)
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Modul tidak ditemukan' });
  res.json(data);
}

async function createModule(req, res) {
  const {
    tbo_code, name, price_student, price_general,
    edition, author, publisher, weight_grams,
    cover_image_url, is_available, has_multimedia, tbo_url,
  } = req.body;

  if (!tbo_code || !name || price_student == null || price_general == null) {
    return res.status(400).json({ error: 'tbo_code, name, price_student, dan price_general wajib diisi' });
  }

  const { data, error } = await supabaseAdmin
    .from('modules')
    .insert({
      tbo_code: String(tbo_code).toUpperCase().trim(),
      name,
      price_student,
      price_general,
      edition: edition || null,
      author: author || null,
      publisher: publisher || 'Universitas Terbuka',
      weight_grams: weight_grams || null,
      cover_image_url: cover_image_url || null,
      is_available: is_available !== undefined ? is_available : true,
      has_multimedia: has_multimedia !== undefined ? has_multimedia : false,
      tbo_url: tbo_url || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Kode TBO sudah terdaftar' });
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
}

module.exports = { listModules, searchModules, getModule, createModule };
