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

// --- Schema ---
class Vec3 extends Schema {
    constructor(x = 0, y = 0, z = 0) {
        super();
        this.x = x;
        this.y = y;
        this.z = z;
    }
}
type("number")(Vec3.prototype, "x");
type("number")(Vec3.prototype, "y");
type("number")(Vec3.prototype, "z");

class Quat extends Schema {
    constructor(x = 0, y = 0, z = 0, w = 1) {
        super();
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
}
type("number")(Quat.prototype, "x");
type("number")(Quat.prototype, "y");
type("number")(Quat.prototype, "z");
type("number")(Quat.prototype, "w");

class PlayerState extends Schema {
    constructor() {
        super();
        this.id = "";
        this.user = "";
        this.email = "";
        this.name = "";
        this.race = "Human";
        this.sex = "M";
        this.playerPos = new Vec3();
        this.rotation = new Quat();
        this.activeWeapon = "";
    }
}

type("string")(PlayerState.prototype, "id");
type("string")(PlayerState.prototype, "user");
type("string")(PlayerState.prototype, "email");
type("string")(PlayerState.prototype, "name");
type(Vec3)(PlayerState.prototype, "playerPos");
type(Quat)(PlayerState.prototype, "rotation");
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
        this.sessionToPlayerId = new Map();
        this.setState(new MyRoomState());

        // Player Input
        this.onMessage("playerInput", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;

            const player = this.state.players.get(playerId);
            if (!player) return;

            player.playerPos.x = data.playerPos.x;
            player.playerPos.y = data.playerPos.y;
            player.playerPos.z = data.playerPos.z;

            player.rotation.x = data.rotation.x;
            player.rotation.y = data.rotation.y;
            player.rotation.z = data.rotation.z;
            player.rotation.w = data.rotation.w;

            player.activeWeapon = data.activeWeapon;
        });

        // CRUD character
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

        // playerInfo (solo per aggiornare dati in room)
        this.onMessage("playerInfo", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;

            const player = this.state.players.get(playerId);
            if (!player) return;

            player.name = data.name || player.name;
            player.user = data.user || player.user;
            player.email = data.email || player.email;
            player.id = data.id || player.id;
        });
    }

    onJoin(client, options) {
        const playerId = options.playerId;

        if (!playerId) {
            console.error("No playerId provided!");
            client.leave();
            return;
        }

        console.log(`🟢 Player joined: ${client.sessionId} (playerId: ${playerId})`);

        this.sessionToPlayerId.set(client.sessionId, playerId);

        // create state
        const player = new PlayerState();
        player.id = playerId;

        this.state.players.set(playerId, player);

        // load from firestore
        db.collection("characters").doc(playerId).get()
    .then(doc => {
        if (doc.exists) {
            const data = doc.data();

            // rimuovi id dal documento prima di assegnarlo allo state
            delete data.id;

            Object.assign(player, data);

            // assicurati che l'id del player sia sempre quello del client
            player.id = playerId;
        }
    })
    .catch(err => console.error(err));

    }

    onLeave(client, consented) {
        const playerId = this.sessionToPlayerId.get(client.sessionId);

        console.log(`⚠️ Player left: ${client.sessionId} (playerId: ${playerId})`);

        if (playerId) {
            this.state.players.delete(playerId);
            this.sessionToPlayerId.delete(client.sessionId);
        }
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


