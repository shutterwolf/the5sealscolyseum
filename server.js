// server.js
const http = require("http");
const express = require("express");
const { Server, Room } = require("colyseus");
const { Schema, MapSchema, type } = require("@colyseus/schema");
const admin = require("firebase-admin");

// --- Firestore Setup (solo per CRUD character se vuoi) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- Schema Colyseus ---
class Vec3 extends Schema {
    constructor(x=0, y=0, z=0) {
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
    constructor(x=0, y=0, z=0, w=1) {
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

// --- PlayerState ---
class PlayerState extends Schema {
    constructor() {
        super();
        this.name = "";
        this.playerPos = new Vec3();
        this.rotation = new Quat();
        this.activeWeapon = "";
    }
}
type("string")(PlayerState.prototype, "name");
type(Vec3)(PlayerState.prototype, "playerPos");
type(Quat)(PlayerState.prototype, "rotation");
type("string")(PlayerState.prototype, "activeWeapon");

// --- RoomState ---
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

        // Ricezione info base del player
        this.onMessage("playerInfo", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            player.name = data.name;
        });

        // Input posizione / rotazione / arma
        this.onMessage("playerInput", (client, data) => {
            const player = this.state.players.get(client.sessionId);
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

        // CRUD character (solo se vuoi salvare su Firebase)
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

    const playerId = options.playerId || client.sessionId;

    const player = new PlayerState();
    player.name = playerId;
    this.state.players.set(client.sessionId, player);

    db.collection("characters").doc(playerId).get()
        .then(doc => {
            if (doc.exists) {
                Object.assign(player, doc.data());
            }
        })
        .catch(err => console.error(err));
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

gameServer.define("my_room", MyRoom);

app.get("/", (req, res) => res.send("Colyseus server online ✅"));

const PORT = process.env.PORT || 2567;
server.listen(PORT, () => console.log(`Colyseus server listening on port ${PORT}`));


