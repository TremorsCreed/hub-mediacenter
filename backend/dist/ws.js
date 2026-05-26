"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWebSocket = setupWebSocket;
exports.sendPlayCommand = sendPlayCommand;
exports.isConnected = isConnected;
exports.getConnectedIds = getConnectedIds;
const ws_1 = require("ws");
const db_1 = require("./db");
const agents = new Map();
function setupWebSocket(server) {
    const wss = new ws_1.WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => {
        const url = new URL(req.url || '', 'http://localhost');
        const device_id = url.searchParams.get('device_id');
        if (!device_id) {
            ws.close(1008, 'device_id required');
            return;
        }
        agents.set(device_id, { ws, device_id });
        console.log(`[ws] agent connected: ${device_id}`);
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                handleAgentMessage(device_id, msg);
            }
            catch {
                console.error(`[ws] invalid message from ${device_id}`);
            }
        });
        ws.on('close', () => { agents.delete(device_id); console.log(`[ws] disconnected: ${device_id}`); });
        ws.on('error', () => agents.delete(device_id));
        ws.send(JSON.stringify({ type: 'pong' }));
    });
    return wss;
}
async function handleAgentMessage(device_id, msg) {
    switch (msg.type) {
        case 'register': {
            const capabilities = msg.capabilities ?? [];
            await db_1.db.execute({
                sql: `INSERT INTO devices (id, name, platform, ip, last_seen, capabilities)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, platform = excluded.platform,
                ip = excluded.ip, last_seen = excluded.last_seen,
                capabilities = excluded.capabilities`,
                args: [device_id, msg.name, msg.platform, msg.ip ?? null, Date.now(), JSON.stringify(capabilities)]
            });
            await db_1.db.execute({
                sql: `INSERT INTO playback_state (device_id, status) VALUES (?, 'stopped') ON CONFLICT(device_id) DO NOTHING`,
                args: [device_id]
            });
            console.log(`[ws] registered: ${device_id} (${msg.name})`);
            break;
        }
        case 'state_update': {
            await db_1.db.execute({
                sql: `UPDATE playback_state SET status = ?, catalog_id = ?, app = ?, started_at = ? WHERE device_id = ?`,
                args: [msg.status, msg.catalog_id ?? null, msg.app ?? null, msg.status === 'playing' ? Date.now() : null, device_id]
            });
            break;
        }
        case 'ping': {
            agents.get(device_id)?.ws.send(JSON.stringify({ type: 'pong' }));
            await db_1.db.execute({ sql: 'UPDATE devices SET last_seen = ? WHERE id = ?', args: [Date.now(), device_id] });
            break;
        }
    }
}
function sendPlayCommand(device_id, cmd) {
    const agent = agents.get(device_id);
    if (!agent || agent.ws.readyState !== ws_1.WebSocket.OPEN)
        return false;
    agent.ws.send(JSON.stringify(cmd));
    return true;
}
function isConnected(device_id) {
    const a = agents.get(device_id);
    return !!a && a.ws.readyState === ws_1.WebSocket.OPEN;
}
function getConnectedIds() {
    return [...agents.keys()];
}
