const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const httpServer = http.createServer(app);

const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer })
});

// ─── SAFE MODULE LOADING ───
let db = null;
let FieldValue = null;
let MyRoom = null;
let wem = null;

try {
    MyRoom = require("./MyRoom");
    console.log("[BOOT] ✓ MyRoom");
} catch (e) {
    console.error("[BOOT] ✗ MyRoom:", e.message);
    process.exit(1);
}

try {
    const dbModule = require("./db");
    db = dbModule.db || dbModule;
    if (dbModule.FieldValue) FieldValue = dbModule.FieldValue;
    else if (dbModule.admin) FieldValue = dbModule.admin.firestore.FieldValue;
    else {
        try { FieldValue = require("firebase-admin").firestore.FieldValue; }
        catch (e2) { FieldValue = require("@google-cloud/firestore").FieldValue; }
    }
    console.log("[BOOT] ✓ DB");
} catch (e) {
    console.error("[BOOT] ✗ DB:", e.message);
}

try {
    if (db && FieldValue) {
        const { WorldEventManager } = require("./WorldEventManager");
        wem = new WorldEventManager({ db, FieldValue });
        global.worldEventManager = wem;
        console.log("[BOOT] ✓ WEM");
    } else {
        console.warn("[BOOT] ⚠ WEM skipped");
    }
} catch (e) {
    console.error("[BOOT] ✗ WEM:", e.message);
}

try {
    gameServer.define("my_room", MyRoom, { worldEventManager: wem });
    console.log("[BOOT] ✓ Room");
} catch (e) {
    console.error("[BOOT] ✗ Room:", e.message);
    process.exit(1);
}

// ─── ROUTES ───
app.get("/", (req, res) => res.send("Server Colyseus online ✅"));
app.get("/health", (req, res) => res.json({ ok: true, wem: !!wem }));

// ─── ADMIN ENDPOINTS ───
if (wem) {
    // Create political event
    app.post("/admin/events/politic", async (req, res) => {
        try {
            const { eventId, title, targetCity, faction1, faction2, flags, startsAt, hours = 72 } = req.body;
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
                startsAt: startsAt ? new Date(startsAt) : new Date(),
                hours: Number(hours) || 72
            });
            res.json({ ok: true, event: evt });
        } catch (err) {
            console.error("[ADMIN] politic:", err);
            res.status(500).json({ error: err.message });
        }
    });

    // Create siege event
    app.post("/admin/events/siege", async (req, res) => {
        try {
            const { eventId, title, targetCity, enemiesTotal, enemiesRaceName, flags, startsAt, hours = 48 } = req.body;
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
                startsAt: startsAt ? new Date(startsAt) : new Date(),
                hours: Number(hours) || 48
            });
            res.json({ ok: true, event: evt });
        } catch (err) {
            console.error("[ADMIN] siege:", err);
            res.status(500).json({ error: err.message });
        }
    });

    // Force start now
    app.post("/admin/events/start", async (req, res) => {
        try { await wem.startEvent(req.body.eventId); res.json({ ok: true }); }
        catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Force resolve now
    app.post("/admin/events/resolve", async (req, res) => {
        try { await wem.resolveEvent(req.body.eventId); res.json({ ok: true }); }
        catch (err) { res.status(500).json({ error: err.message }); }
    });
}

// ─── START ───
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[BOOT] Listening on ${PORT}`);
    if (wem) {
        setTimeout(() => {
            wem.init().catch(err => console.error("[WEM] Init failed:", err.message));
        }, 2000);
    }
});
