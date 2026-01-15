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
        this.playerPos = { x:0, y:0, z:0 };        // posizione 3D
        this.rotation = { x:0, y:0, z:0, w:1 };   // quaternion
        this.activeWeapon = "";                    // arma attiva
    }
}

type("string")(PlayerState.prototype, "name");
type("json")(PlayerState.prototype, "playerPos");
type("json")(PlayerState.prototype, "rotation");
type("string")(PlayerState.prototype, "activeWeapon");

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

        // Aggiorna info base del player
        this.onMessage("playerInfo", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            player.name = data.name;
        });

        // Input per posizione, rotazione e arma
        this.onMessage("playerInput", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            player.playerPos = data.playerPos;
            player.rotation = data.rotation;
            player.activeWeapon = data.activeWeapon;
        });

        // CRUD character già presente
        this.onMessage("deleteCharacter", async (client, data) => {
            try {
                await db.collection("characters").doc(data.playerId).delete();
                client.send("characterDeleted", { success: true, playerId: data.playerId });
            } catch (err) {
                console.error(err);
                client.send("characterDeleted", { success: false, playerId: data.playerId, error: err.message });
            }
        });

        this.onMessage("checkCharacter", async (client, data) => {
            try {
                const doc = await db.collection("characters").doc(data.playerId).get();
                client.send("characterExistence", {
                    exists: doc.exists,
                    character: doc.exists ? doc.data() : null
                });
            } catch (err) {
                console.error(err);
                client.send("characterExistence", { exists: false, character: null });
            }
        });

        this.onMessage("saveCharacter", async (client, data) => {
            try {
                await db.collection("characters").doc(data.playerId).set(data.character);
                client.send("characterSaved", { ok: true, playerId: data.playerId });
            } catch (err) {
                console.error(err);
                client.send("characterSaved", { ok: false, playerId: data.playerId });
            }
        });
    }

    onJoin(client, options) {
        console.log(`🟢 Player joined: ${client.sessionId}`);
        const player = new PlayerState();
        player.name = options?.playerId || "";
        this.state.players.set(client.sessionId, player);

        // eventualmente carica dati da Firebase
        db.collection("characters").doc(client.sessionId).get()
        .then(doc => {
            if(doc.exists){
                Object.assign(player, doc.data());
            }
        }).catch(err => console.error(err));
    }

    onLeave(client, consented) {
        console.log(`⚠️ Player left: ${client.sessionId}, consented: ${consented}`);
        const player = this.state.players.get(client.sessionId);
        if(player){
            db.collection("characters").doc(client.sessionId).set({
                name: player.name,
                playerPos: player.playerPos,
                rotation: player.rotation,
                activeWeapon: player.activeWeapon
            }).catch(err => console.error(err));
        }
        this.state.players.delete(client.sessionId);
    }
}

// --- Server ---
const app = express();
const server = http.createServer(app);
const gameServer = new Server({ server });

gameServer.define("my_room", MyRoom);

app.get("/", (req, res) => res.send("Colyseus server online ✅"));

const PORT = process.env.PORT || 2567;
server.listen(PORT, () => console.log(`Colyseus server listening on port ${PORT}`));
