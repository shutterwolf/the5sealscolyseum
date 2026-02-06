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

class EquippedItem extends Schema {
    constructor() {
        super();
        this.itemId = 0;
        this.armourValue = 1;
        this.damageValue = 0;
        this.durability = 0;
        this.obj = "";
        this.slot = "";
        this.special = "";
        this.twohand = false;
        this.type = "";
        this.value = 0;
    }
}

type("number")(EquippedItem.prototype, "itemId");
type("number")(EquippedItem.prototype, "armourValue");
type("number")(EquippedItem.prototype, "damageValue");
type("number")(EquippedItem.prototype, "durability");
type("string")(EquippedItem.prototype, "obj");
type("string")(EquippedItem.prototype, "slot");
type("string")(EquippedItem.prototype, "special");
type("boolean")(EquippedItem.prototype, "twohand");
type("string")(EquippedItem.prototype, "type");
type("number")(EquippedItem.prototype, "value");

class Equipped extends Schema {
    constructor() {
        super();
        this.slots = new MapSchema();
    }
}
type({ map: EquippedItem })(Equipped.prototype, "slots");

class PlayerState extends Schema {
    constructor() {
        super();
        this.id = "";
        this.user = "";
        this.email = "";
        this.name = "";
        this.race = "Human";
        this.sex = "M";
        this.texTure = "";
        this.playerPos = new Vec3();
        this.rotation = new Quat();
        this.activeWeapon = "";
        this.anim = "stand1";
        this.speed = 1;
        this.localMap = 0;
        this.depth = 0;
        this.dungeonId = "";
        this.equipped = new Equipped();
    }
}

type("string")(PlayerState.prototype, "id");
type("string")(PlayerState.prototype, "user");
type("string")(PlayerState.prototype, "email");
type("string")(PlayerState.prototype, "name");
type("string")(PlayerState.prototype, "race");
type("string")(PlayerState.prototype, "sex");
type("string")(PlayerState.prototype, "texTure");
type(Vec3)(PlayerState.prototype, "playerPos");
type(Quat)(PlayerState.prototype, "rotation");
type("string")(PlayerState.prototype, "activeWeapon");
type("string")(PlayerState.prototype, "anim");
type("number")(PlayerState.prototype, "speed");
type("number")(PlayerState.prototype, "localMap");
type("number")(PlayerState.prototype, "depth");
type("string")(PlayerState.prototype, "dungeonId");
type(Equipped)(PlayerState.prototype, "equipped");

class MyRoomState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
    }
}
type({ map: PlayerState })(MyRoomState.prototype, "players");

// --- Room ---
class MyRoom extends Room {
    maxClients = 20;

    onCreate() {
        console.log("Room created");
        this.sessionToPlayerId = new Map();
        this.setState(new MyRoomState());

        this.onMessage("equipItem", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const player = this.state.players.get(playerId);
            if (!player || typeof data.slot !== "string") return;

            let item = player.equipped.slots.get(data.slot);
            if (!item) {
                item = new EquippedItem();
                item.slot = data.slot;
                player.equipped.slots.set(data.slot, item);
            }

            item.obj = data.obj ?? item.obj;
            item.type = data.type ?? item.type;
            item.twohand = !!data.twohand;
        });
    }

    async onJoin(client, options) {
        const playerId = options.playerId;
        if (!playerId) {
            client.leave();
            return;
        }

        this.sessionToPlayerId.set(client.sessionId, playerId);

        const player = new PlayerState();
        player.id = playerId;

        const DEFAULT_SLOTS = ["HELM", "ARMOUR", "WEAPON", "WEAPON2", "SHIELD", "SHIELD2", "ITEM"];
        DEFAULT_SLOTS.forEach(slot => {
            const item = new EquippedItem();
            item.slot = slot;
            player.equipped.slots.set(slot, item);
        });

        this.state.players.set(playerId, player);

        try {
            const doc = await db.collection("characters").doc(playerId).get();
            if (doc.exists) {
                const data = doc.data();

                Object.assign(player, {
                    user: data.user ?? player.user,
                    email: data.email ?? player.email,
                    name: data.name ?? player.name,
                    race: data.race ?? player.race,
                    sex: data.sex ?? player.sex,
                    anim: data.anim ?? player.anim,
                    speed: data.speed ?? player.speed,
                    texTure: data.texTure ?? player.texTure,
                    activeWeapon: data.activeWeapon ?? player.activeWeapon,
                    localMap: data.localMap ?? 0,
                    depth: data.depth ?? 0,
                    dungeonId: data.dungeonId ?? ""
                });

                if (data.playerPos) Object.assign(player.playerPos, data.playerPos);
                if (data.rotation) Object.assign(player.rotation, data.rotation);

                if (data.equipped) {
                    Object.entries(data.equipped).forEach(([slot, raw]) => {
                        const item = new EquippedItem();
                        Object.assign(item, raw);
                        item.slot = slot;
                        player.equipped.slots.set(slot, item);
                    });
                }
            }
        } catch (err) {
            console.error("Firestore load error:", err);
        }

        const equippedData = {};
        player.equipped.slots.forEach((item, slot) => {
            equippedData[slot] = { ...item };
        });

        client.send("fullEquip", { equipped: equippedData });
    }

    onLeave(client) {
        const playerId = this.sessionToPlayerId.get(client.sessionId);
        if (playerId) {
            this.state.players.delete(playerId);
            this.sessionToPlayerId.delete(client.sessionId);
        }
        console.log("Player left:", playerId);
    }
}

// --- Server ---
const app = express();
const server = http.createServer(app);

const { WebSocketTransport } = require("@colyseus/ws-transport");

const gameServer = new Server({
    transport: new WebSocketTransport({ server })
});

gameServer.define("my_room", MyRoom);

app.get("/", (req, res) => res.send("Colyseus server online ✅"));

server.listen(process.env.PORT || 10000, () => {
    console.log("Server listening");
});
