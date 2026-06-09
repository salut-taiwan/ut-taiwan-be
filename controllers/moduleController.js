const { db } = require('../db');
const { modules } = require('../db/schema');
const { eq, and, asc, isNull, or, ilike, count } = require('drizzle-orm');
const { presentModule, presentModuleList } = require('../presenters/modulePresenter');

async function listModules(req, res) {
  const { page = 1, limit = 20, available } = req.query;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  try {
    const whereClause = available === 'true'
      ? and(isNull(modules.deleted_at), eq(modules.is_available, true))
      : isNull(modules.deleted_at);

    const [data, [{ total }]] = await Promise.all([
      db.select({
        id: modules.id,
        tbo_code: modules.tbo_code,
        name: modules.name,
        edition: modules.edition,
        cover_image_url: modules.cover_image_url,
        price_student: modules.price_student,
        price_general: modules.price_general,
        is_available: modules.is_available,
        has_multimedia: modules.has_multimedia,
      })
        .from(modules)
        .where(whereClause)
        .orderBy(asc(modules.tbo_code))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(modules).where(whereClause),
    ]);

    res.json({ data: presentModuleList(data), total, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function searchModules(req, res) {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Query minimal 2 karakter' });
  }

  const term = `%${q}%`;
  try {
    const data = await db.select({
      id: modules.id,
      tbo_code: modules.tbo_code,
      name: modules.name,
      edition: modules.edition,
      cover_image_url: modules.cover_image_url,
      price_student: modules.price_student,
      is_available: modules.is_available,
    })
      .from(modules)
      .where(and(
        isNull(modules.deleted_at),
        or(ilike(modules.tbo_code, term), ilike(modules.name, term)),
      ))
      .orderBy(asc(modules.tbo_code))
      .limit(50);

    res.json(presentModuleList(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getModule(req, res) {
  const { id } = req.params;
  try {
    const data = await db.query.modules.findFirst({
      where: eq(modules.id, id),
      with: {
        subject_modules: {
          with: {
            subjects: {
              columns: { id: true, code: true, name: true },
              with: { programs: { columns: { id: true, code: true, name: true } } },
            },
          },
        },
      },
    });
    if (!data) return res.status(404).json({ error: 'Modul tidak ditemukan' });
    res.json(presentModule(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

  try {
    const [data] = await db.insert(modules).values({
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
    }).returning();

    res.status(201).json(presentModule(data));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Kode TBO sudah terdaftar' });
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listModules, searchModules, getModule, createModule };