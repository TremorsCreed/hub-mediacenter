"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const ws_1 = require("../ws");
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    const { rows } = await db_1.db.execute('SELECT * FROM devices ORDER BY last_seen DESC');
    const devices = rows.map((r) => ({
        ...r,
        capabilities: JSON.parse(r.capabilities),
        ws_connected: (0, ws_1.isConnected)(r.id)
    }));
    res.json(devices);
});
router.get('/:id', async (req, res) => {
    const { rows } = await db_1.db.execute({ sql: 'SELECT * FROM devices WHERE id = ?', args: [req.params.id] });
    if (!rows.length)
        return res.status(404).json({ error: 'device not found' });
    const r = rows[0];
    res.json({ ...r, capabilities: JSON.parse(r.capabilities), ws_connected: (0, ws_1.isConnected)(r.id) });
});
const RegisterSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    platform: zod_1.z.enum(['android_tv', 'fire_tv', 'shield', 'apple_tv', 'roku', 'kodi', 'other']),
    ip: zod_1.z.string().optional(),
    capabilities: zod_1.z.array(zod_1.z.object({
        app: zod_1.z.string(),
        package: zod_1.z.string().optional(),
        can_receive: zod_1.z.array(zod_1.z.string()),
        launch_method: zod_1.z.string()
    })).default([])
});
router.post('/register', async (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const { id, name, platform, ip, capabilities } = parsed.data;
    await db_1.db.execute({
        sql: `INSERT INTO devices (id, name, platform, ip, last_seen, capabilities)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, platform = excluded.platform,
            ip = excluded.ip, last_seen = excluded.last_seen,
            capabilities = excluded.capabilities`,
        args: [id, name, platform, ip ?? null, Date.now(), JSON.stringify(capabilities)]
    });
    await db_1.db.execute({
        sql: `INSERT INTO playback_state (device_id, status) VALUES (?, 'stopped') ON CONFLICT(device_id) DO NOTHING`,
        args: [id]
    });
    res.status(201).json({ ok: true, id });
});
router.delete('/:id', async (req, res) => {
    const result = await db_1.db.execute({ sql: 'DELETE FROM devices WHERE id = ?', args: [req.params.id] });
    if (!result.rowsAffected)
        return res.status(404).json({ error: 'device not found' });
    res.json({ ok: true });
});
exports.default = router;
