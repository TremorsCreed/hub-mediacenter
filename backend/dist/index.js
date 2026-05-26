"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const db_1 = require("./db");
const ws_1 = require("./ws");
const devices_1 = __importDefault(require("./routes/devices"));
const catalog_1 = __importDefault(require("./routes/catalog"));
const play_1 = __importDefault(require("./routes/play"));
const state_1 = __importDefault(require("./routes/state"));
const zaparoo_1 = __importDefault(require("./routes/zaparoo"));
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT ?? '8020', 10);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/devices', devices_1.default);
app.use('/api/catalog', catalog_1.default);
app.use('/api/play', play_1.default);
app.use('/api/state', state_1.default);
app.use('/api/zaparoo', zaparoo_1.default);
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
async function start() {
    await (0, db_1.initDb)();
    const server = http_1.default.createServer(app);
    (0, ws_1.setupWebSocket)(server);
    server.listen(PORT, () => {
        console.log(`Hub MediaCenter backend :${PORT}`);
        console.log(`WebSocket: ws://localhost:${PORT}/ws?device_id=<id>`);
    });
}
start().catch(console.error);
