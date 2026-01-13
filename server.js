// server.js
const http = require("http");
const express = require("express");
const { Server, Room } = require("colyseus");
const { Schema, MapSchema, type } = require("@colyseus/schema");
const admin = require("firebase-admin");

// --- Firestore Setup ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- State ---
class PlayerState extends Schema {
    constructor() {
        super();
        this.name = "";
    }
}
type("string")(PlayerState.prototype, "name");

class MyRoomState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
    }
}
type({ map: PlayerState })(MyRoomState.prototype, "players");

// --- Room ---
class MyRoom extends Room {
    onCreate(options) {
        console.log("Room created!");
        this.setState(new MyRoomState());

        // Aggiorna PlayerState con dati OAuth / player
        this.onMessage("playerInfo", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            player.name = data.name;
        });

        this.onMessage("deleteCharacter", async (client, data) => {
    const playerId = data.playerId;

    try {
        // cancella il character dal Firestore
        await db.collection("characters").doc(playerId).delete();
        console.log(`✅ Character ${playerId} deleted from Firestore`);

        // invia conferma al client
        client.send("characterDeleted", { success: true, playerId });

    } catch (err) {
        console.error("❌ Error deleting character:", err);
        client.send("characterDeleted", { success: false, playerId, error: err.message });
    }
});
        
        // Controlla se il character esiste su Firestore
        this.onMessage("checkCharacter", async (client, data) => {
            try {
                const doc = await db.collection("characters").doc(data.playerId).get();
                client.send("characterExistence", {
                    exists: doc.exists,
                    character: doc.exists ? doc.data() : null
                });
                console.log(`📨 checkCharacter ${data.playerId} exists=${doc.exists}`);
            } catch (err) {
                console.error("❌ Firestore checkCharacter error:", err);
                client.send("characterExistence", { exists: false, character: null });
            }
        });

        // Salva o aggiorna il character su Firestore
        this.onMessage("saveCharacter", async (client, data) => {
            try {
                await db.collection("characters").doc(data.playerId).set(data.character);
                client.send("characterSaved", { ok: true, playerId: data.playerId });
                console.log(`💾 Character salvato su Firestore: ${data.playerId}`);
            } catch (err) {
                console.error("❌ Firestore saveCharacter error:", err);
                client.send("characterSaved", { ok: false, playerId: data.playerId });
            }
        });
    }

    onJoin(client, options) {
        console.log(`🟢 Player joined: ${client.sessionId}`);
        const player = new PlayerState();
        player.name = options?.playerId || "";
        this.state.players.set(client.sessionId, player);
    }

    onLeave(client, consented) {
        console.log(`⚠️ Player left: ${client.sessionId}, consented: ${consented}`);
        this.state.players.delete(client.sessionId);
    }
}

// --- Server ---
const app = express();
const server = http.createServer(app);
const gameServer = new Server({ server });

// Definizione Room
gameServer.define("my_room", MyRoom);

// Route test
app.get("/", (req, res) => res.send("Colyseus server online ✅"));

// Avvio server
const PORT = process.env.PORT || 2567;
server.listen(PORT, () => console.log(`Colyseus server listening on port ${PORT}`));

