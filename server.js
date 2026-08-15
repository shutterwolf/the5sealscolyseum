const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const MyRoom = require("./MyRoom");
const { WorldEventManager } = require("./WorldEventManager");
const { db } = require("./db");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const httpServer = http.createServer(app);

const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer })
});

// ─── WORLD EVENT MANAGER ───
const wem = new WorldEventManager({ db });
global.worldEventManager = wem;

gameServer.define("my_room", MyRoom, { worldEventManager: wem });

// ─── ADMIN ENDPOINTS ───

app.post("/admin/events/politic", async (req, res) => {
    try {
        const { eventId, title, targetCity, faction1, faction2, flags, hours = 72 } = req.body;
        const evt = await wem.scheduleEvent({
            eventId: String(eventId),
            title,
            type: "politic",
            targetCity,
            faction1,
            faction2,
            faction1Count: 0,
            faction2Count: 0,
            flags: flags || [`Winner of ${title}`, `Loser of ${title}`],
            status: "scheduled",
            endsAt: new Date(Date.now() + hours * 3600000)
        });
        res.json({ ok: true, event: evt });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/admin/events/siege", async (req, res) => {
    try {
        const { eventId, title, targetCity, enemiesTotal, enemiesRaceName, flags, hours = 48 } = req.body;
        const evt = await wem.scheduleEvent({
            eventId: String(eventId),
            title,
            type: "siege",
            targetCity,
            enemiesTotal: Number(enemiesTotal) || 100,
            enemiesRace: 0,
            enemiesRaceName,
            flags: flags || ["Friend", "Defender", "Hero"],
            status: "scheduled",
            endsAt: new Date(Date.now() + hours * 3600000)
        });
        res.json({ ok: true, event: evt });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/admin/events/start", async (req, res) => {
    try { await wem.startEvent(req.body.eventId); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/events/resolve", async (req, res) => {
    try { await wem.resolveEvent(req.body.eventId); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/", (req, res) => res.send("Server Colyseus online ✅"));

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    // Restore active events after restart
    try {
        await wem.restoreActiveEvents();
    } catch (err) {
        console.error("[WEM] Failed to restore active events:", err);
    }
});
