const { db } = require('../db');
const { faculties, programs, subjects } = require('../db/schema');
const { eq, asc, and, isNull } = require('drizzle-orm');

async function listFaculties(req, res) {
  try {
    const data = await db
      .select({ id: faculties.id, code: faculties.code, name: faculties.name, description: faculties.description })
      .from(faculties)
      .orderBy(asc(faculties.code));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listProgramsByFaculty(req, res) {
  const { id } = req.params;
  try {
    const data = await db
      .select({ id: programs.id, code: programs.code, name: programs.name, level: programs.level, total_sks: programs.total_sks })
      .from(programs)
      .where(eq(programs.faculty_id, id))
      .orderBy(asc(programs.name));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listPrograms(req, res) {
  const { facultyId } = req.query;
  try {
    const data = await db.query.programs.findMany({
      columns: { id: true, faculty_id: true, code: true, name: true, level: true, total_sks: true },
      with: { faculties: { columns: { code: true, name: true } } },
      where: facultyId ? eq(programs.faculty_id, facultyId) : undefined,
      orderBy: asc(programs.name),
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getProgram(req, res) {
  const { id } = req.params;
  try {
    const data = await db.query.programs.findFirst({
      where: eq(programs.id, id),
      with: { faculties: { columns: { code: true, name: true } } },
    });
    if (!data) return res.status(404).json({ error: 'Program tidak ditemukan' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listSubjects(req, res) {
  const { id } = req.params;
  const { semester } = req.query;
  try {
    const whereClause = semester
      ? and(eq(subjects.program_id, id), eq(subjects.semester_hint, parseInt(semester)))
      : eq(subjects.program_id, id);

    const data = await db.query.subjects.findMany({
      columns: { id: true, code: true, name: true, sks: true, exam_period: true, semester_hint: true, notes: true, is_required: true },
      where: whereClause,
      orderBy: [asc(subjects.semester_hint), asc(subjects.code)],
      with: {
        subject_modules: {
          columns: { sort_order: true },
          with: {
            modules: {
              columns: { id: true, tbo_code: true, name: true, cover_image_url: true, price_student: true, is_available: true, deleted_at: true },
            },
          },
        },
      },
    });

    // Strip soft-deleted modules
    data.forEach(subject => {
      subject.subject_modules = (subject.subject_modules || [])
        .filter(sm => sm.modules && !sm.modules.deleted_at)
        .map(sm => {
          const { deleted_at, ...moduleRest } = sm.modules;
          return { ...sm, modules: moduleRest };
        });
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSubject(req, res) {
  const { id } = req.params;
  try {
    const data = await db.query.subjects.findFirst({
      where: eq(subjects.id, id),
      with: {
        programs: true,
        subject_modules: {
          columns: { sort_order: true },
          with: { modules: true },
        },
      },
    });
    if (!data) return res.status(404).json({ error: 'Mata kuliah tidak ditemukan' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listFaculties, listProgramsByFaculty, listPrograms, getProgram, listSubjects, getSubject };