"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const uuid_1 = require("uuid");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.get('/search', async (req, res) => {
    const q = (req.query.q ?? '').trim();
    const { rows } = q
        ? await db_1.db.execute({ sql: `SELECT * FROM catalog WHERE title LIKE ? ORDER BY title LIMIT 50`, args: [`%${q}%`] })
        : await db_1.db.execute('SELECT * FROM catalog ORDER BY title LIMIT 100');
    res.json(rows);
});
router.get('/ean/:ean', async (req, res) => {
    const { rows } = await db_1.db.execute({
        sql: `SELECT c.* FROM catalog c
          LEFT JOIN ean_mappings e ON e.catalog_id = c.id
          WHERE c.ean = ? OR e.ean = ? LIMIT 1`,
        args: [req.params.ean, req.params.ean]
    });
    if (!rows.length)
        return res.status(404).json({ error: 'EAN not found' });
    res.json(rows[0]);
});
const CatalogSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    type: zod_1.z.enum(['movie', 'episode', 'music', 'live_channel', 'vod']),
    ean: zod_1.z.string().optional(),
    year: zod_1.z.number().int().optional(),
    plex_id: zod_1.z.string().optional(),
    tivimate_id: zod_1.z.string().optional(),
    thumbnail: zod_1.z.string().url().optional(),
    metadata: zod_1.z.record(zod_1.z.unknown()).default({})
});
router.post('/', async (req, res) => {
    const parsed = CatalogSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const id = (0, uuid_1.v4)();
    const { title, type, ean, year, plex_id, tivimate_id, thumbnail, metadata } = parsed.data;
    await db_1.db.execute({
        sql: `INSERT INTO catalog (id, title, type, ean, year, plex_id, tivimate_id, thumbnail, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, title, type, ean ?? null, year ?? null, plex_id ?? null, tivimate_id ?? null, thumbnail ?? null, JSON.stringify(metadata)]
    });
    if (ean) {
        await db_1.db.execute({
            sql: `INSERT INTO ean_mappings (ean, catalog_id) VALUES (?, ?)
            ON CONFLICT(ean) DO UPDATE SET catalog_id = excluded.catalog_id`,
            args: [ean, id]
        });
    }
    res.status(201).json({ ok: true, id });
});
router.put('/:id', async (req, res) => {
    const { rows } = await db_1.db.execute({ sql: 'SELECT id FROM catalog WHERE id = ?', args: [req.params.id] });
    if (!rows.length)
        return res.status(404).json({ error: 'not found' });
    const parsed = CatalogSchema.partial().safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const fields = parsed.data;
    const sets = [];
    const values = [];
    for (const [key, val] of Object.entries(fields)) {
        sets.push(`${key} = ?`);
        values.push(key === 'metadata' ? JSON.stringify(val) : (val ?? null));
    }
    if (!sets.length)
        return res.status(400).json({ error: 'nothing to update' });
    values.push(req.params.id);
    await db_1.db.execute({ sql: `UPDATE catalog SET ${sets.join(', ')} WHERE id = ?`, args: values });
    if (fields.ean) {
        await db_1.db.execute({
            sql: `INSERT INTO ean_mappings (ean, catalog_id) VALUES (?, ?)
            ON CONFLICT(ean) DO UPDATE SET catalog_id = excluded.catalog_id`,
            args: [fields.ean, req.params.id]
        });
    }
    res.json({ ok: true });
});
router.delete('/:id', async (req, res) => {
    const result = await db_1.db.execute({ sql: 'DELETE FROM catalog WHERE id = ?', args: [req.params.id] });
    if (!result.rowsAffected)
        return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
});
router.post('/ean', async (req, res) => {
    const schema = zod_1.z.object({ ean: zod_1.z.string().min(1), catalog_id: zod_1.z.string().uuid() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const { ean, catalog_id } = parsed.data;
    const { rows } = await db_1.db.execute({ sql: 'SELECT id FROM catalog WHERE id = ?', args: [catalog_id] });
    if (!rows.length)
        return res.status(404).json({ error: 'catalog entry not found' });
    await db_1.db.execute({
        sql: `INSERT INTO ean_mappings (ean, catalog_id) VALUES (?, ?)
          ON CONFLICT(ean) DO UPDATE SET catalog_id = excluded.catalog_id`,
        args: [ean, catalog_id]
    });
    res.status(201).json({ ok: true });
});
exports.default = router;
