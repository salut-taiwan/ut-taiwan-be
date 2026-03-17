const { supabaseAdmin } = require('../config/supabase');

async function listFaculties(req, res) {
  const { data, error } = await supabaseAdmin
    .from('faculties')
    .select('id, code, name, description')
    .order('code');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function listProgramsByFaculty(req, res) {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('programs')
    .select('id, code, name, level, total_sks')
    .eq('faculty_id', id)
    .order('name');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function listPrograms(req, res) {
  const { facultyId } = req.query;
  let query = supabaseAdmin
    .from('programs')
    .select('id, faculty_id, code, name, level, total_sks, faculties(code, name)')
    .order('name');

  if (facultyId) query = query.eq('faculty_id', facultyId);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function getProgram(req, res) {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('programs')
    .select('*, faculties(code, name)')
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Program tidak ditemukan' });
  res.json(data);
}

async function listSubjects(req, res) {
  const { id } = req.params;
  const { semester } = req.query;

  let query = supabaseAdmin
    .from('subjects')
    .select(`
      id, code, name, sks, exam_period, semester_hint, notes, is_required,
      subject_modules(
        sort_order,
        modules(id, tbo_code, name, cover_image_url, price_student, is_available)
      )
    `)
    .eq('program_id', id)
    .order('semester_hint', { ascending: true })
    .order('code', { ascending: true });

  if (semester) query = query.eq('semester_hint', parseInt(semester));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function getSubject(req, res) {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('subjects')
    .select(`
      *, programs(id, code, name),
      subject_modules(
        sort_order,
        modules(*)
      )
    `)
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Mata kuliah tidak ditemukan' });
  res.json(data);
}

module.exports = { listFaculties, listProgramsByFaculty, listPrograms, getProgram, listSubjects, getSubject };
