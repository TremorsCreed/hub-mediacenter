"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const ws_1 = require("../ws");
const router = (0, express_1.Router)();
// ZapScript: http.post||http://hub-backend:8020/api/zaparoo/scan||{"token":"{{TOKEN_TEXT}}","device_id":"shield-salon"}
router.post('/scan', async (req, res) => {
    const parsed = zod_1.z.object({ token: zod_1.z.string().min(1), device_id: zod_1.z.string().optional() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const { token, device_id } = parsed.data;
    let entry = null;
    // EAN mapping first, then catalog ID, then fuzzy title
    const { rows: eanRows } = await db_1.db.execute({
        sql: `SELECT c.* FROM catalog c LEFT JOIN ean_mappings e ON e.catalog_id = c.id WHERE c.ean = ? OR e.ean = ? LIMIT 1`,
        args: [token, token]
    });
    entry = eanRows[0] ?? null;
    if (!entry) {
        const { rows } = await db_1.db.execute({ sql: 'SELECT * FROM catalog WHERE id = ?', args: [token] });
        entry = rows[0] ?? null;
    }
    if (!entry) {
        const { rows } = await db_1.db.execute({
            sql: `SELECT * FROM catalog WHERE title LIKE ? ORDER BY title LIMIT 1`,
            args: [`%${token}%`]
        });
        entry = rows[0] ?? null;
    }
    if (!entry)
        return res.status(404).json({ error: 'media not found', token });
    let target_id = device_id;
    if (!target_id) {
        for (const id of (0, ws_1.getConnectedIds)()) {
            const { rows } = await db_1.db.execute({ sql: 'SELECT capabilities FROM devices WHERE id = ?', args: [id] });
            if (!rows.length)
                continue;
            const caps = JSON.parse(rows[0].capabilities);
            if (caps.some((c) => c.can_receive.includes(entry.type))) {
                target_id = id;
                break;
            }
        }
    }
    if (!target_id || !(0, ws_1.isConnected)(target_id))
        return res.status(503).json({ error: 'no device available' });
    const { rows: devRows } = await db_1.db.execute({ sql: 'SELECT capabilities FROM devices WHERE id = ?', args: [target_id] });
    const caps = JSON.parse(devRows[0].capabilities);
    const cap = caps.find((c) => c.can_receive.includes(entry.type));
    const resolved_app = cap?.app ?? 'plex';
    const cmd = {
        type: 'play', catalog_id: entry.id, app: resolved_app, title: entry.title,
        plex_id: entry.plex_id ?? undefined, tivimate_channel: entry.tivimate_id ?? undefined, requester: 'zaparoo'
    };
    (0, ws_1.sendPlayCommand)(target_id, cmd);
    await db_1.db.execute({
        sql: `INSERT INTO playback_history (device_id, catalog_id, app, title, started_at, requester) VALUES (?, ?, ?, ?, ?, 'zaparoo')`,
        args: [target_id, entry.id, resolved_app, entry.title, Date.now()]
    });
    res.json({ ok: true, title: entry.title, device_id: target_id, app: resolved_app });
});
exports.default = router;
