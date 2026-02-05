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
        this.armourValue=1;
        this.damageValue=0;
        this.durability=0;
        this.obj="",
        this.slot=0,
        this.special="",
        this.twohand=false,
        this.type="",
        this.value=0
    }
}

type("number")(EquippedItem.prototype, "itemId");
type("number")(EquippedItem.prototype, "armourValue");
type("number")(EquippedItem.prototype, "damageValue");
type("number")(EquippedItem.prototype, "durability");
type("string")(EquippedItem.prototype, "obj");
type("number")(EquippedItem.prototype, "slot");
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
        this.localMap=0;
        this.depth=0;
        this.dungeonId=null;
        this.equipped=new Equipped();
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
type("number")(PlayerState.prototype, "localMap"); // ID della mappa
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

function isValidNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
}

function sanitizeVec3(v) {
    return {
        x: isValidNumber(v?.x) ? v.x : 0,
        y: isValidNumber(v?.y) ? v.y : 0,
        z: isValidNumber(v?.z) ? v.z : 0,
    };
}

function sanitizeQuat(q) {
    return {
        x: isValidNumber(q?.x) ? q.x : 0,
        y: isValidNumber(q?.y) ? q.y : 0,
        z: isValidNumber(q?.z) ? q.z : 0,
        w: isValidNumber(q?.w) ? q.w : 1,
    };
}

// --- Room ---
class MyRoom extends Room {
     maxClients = 20;
    onCreate(options) {
        console.log("Room created!");
        this.sessionToPlayerId = new Map();
        this.setState(new MyRoomState());

        this.onMessage("equipItem", (client, data) => {
            const player = this.state.players.get(this.sessionToPlayerId.get(client.sessionId));
            if (!player) return;

            let item = player.equipped.slots.get(data.slot);
            if (!item) {
                item = new EquippedItem();
                player.equipped.slots.set(data.slot, item);
            }
            item.obj = data.obj ?? item.obj;
item.type = data.type ?? item.type;
item.twohand = data.twohand ?? item.twohand;
        });
        
        // Player Input
        this.onMessage("playerInput", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;

            const player = this.state.players.get(playerId);
            if (!player) return;

            // **VALIDAZIONE**
            const pos = sanitizeVec3(data.playerPos);
            const rot = sanitizeQuat(data.rotation);

            player.playerPos.x = pos.x;
            player.playerPos.y = pos.y;
            player.playerPos.z = pos.z;

            player.rotation.x = rot.x;
            player.rotation.y = rot.y;
            player.rotation.z = rot.z;
            player.rotation.w = rot.w;
            player.texTure = data.texTure;
            player.activeWeapon = data.activeWeapon || "";
            if (typeof data.localMap === "number") player.localMap = data.localMap;
            if (typeof data.depth === "number") player.depth = data.depth;
            if (typeof data.dungeonId === "string") player.dungeonId = data.dungeonId;
            if (typeof data.anim === "string") {
                player.anim = data.anim;
            }
            if (typeof data.speed === "number") {
                player.speed = data.speed;
            };
        });

        // 🔥 Animazione player (walk / run / idle)
        this.onMessage("anim", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;

            const player = this.state.players.get(playerId);
            if (!player) return;

            if (typeof data.anim === "string") {
                player.anim = data.anim;
            }

            if (typeof data.speed === "number") {
                player.speed = data.speed;
            }
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
                console.error("❌ FIRESTORE SAVE ERROR:", err);  // <--- qui vedi il motivo del fallimento
                client.send("characterSaved", { ok: false, playerId: data.playerId });
            }
        });

        this.onMessage("deleteCharacter", (client, message) => {
            const charId = message.id;

            // esempio: characters è il tuo database in memoria o collegato a DB
            if (this.state.characters[charId]) {
                delete this.state.characters[charId];
                console.log("Character deleted:", charId);

                // opzionale: conferma al client
                client.send("characterDeleted", { id: charId, success: true });
            } else {
                client.send("characterDeleted", { id: charId, success: false });
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
        
        //console.log(`🟢 Player joined: ${client.sessionId} (playerId: ${playerId})`);
        //console.log(`Join: ${client.sessionId} in ${this.roomId}`);
        this.sessionToPlayerId.set(client.sessionId, playerId);

        // create state
        const player = new PlayerState();
        player.id = playerId;
        // 🔥 inizializza equipped SEMPRE
        const DEFAULT_SLOTS = [
            "HELM",
            "ARMOUR",
            "WEAPON",
            "WEAPON2",
            "SHIELD",
            "SHIELD2",
            "ITEM"
        ];

        DEFAULT_SLOTS.forEach(slot => {
        const item = new EquippedItem();
        player.equipped.slots.set(slot, item);
        });
        
        console.log("🧩 [INIT] Equipped slots AFTER default init:");
        player.equipped.slots.forEach((item, slot) => {
        console.log(
        "  slot:", slot,
        "| itemId:", item.itemId,
        "| obj:", item.obj,
        "| type:", item.type,
        "| twohand:", item.twohand
        );
        });
        
        this.state.players.set(playerId, player);

        // Iterare su tutti gli slot
        player.equipped.slots.forEach((item, slot) => {
            console.log(slot, item.itemId, item.durability);
        });

        // Accedere a uno slot specifico
        const weapon = player.equipped.slots.get("WEAPON");
        console.log(weapon.itemId, weapon.durability);

        // load from firestore
        db.collection("characters").doc(playerId).get()
            .then(doc => {
                if (doc.exists) {
                    const data = doc.data();

                    // -----------------------
                    // FIX 0.16 (no Object.assign)
                    // -----------------------
                    player.user = data.user || player.user;
                    player.email = data.email || player.email;
                    player.name = data.name || player.name;
                    player.race = data.race || player.race;
                    player.sex = data.sex || player.sex;
                    player.anim = data.anim || player.anim;
                    player.speed = data.speed || player.speed;
                    player.texTure = data.texTure || player.texTure;
                    player.activeWeapon = data.activeWeapon || player.activeWeapon;
                    player.localMap = typeof data.localMap === "number" ? data.localMap : 0;
                    player.depth = typeof data.depth === "number" ? data.depth : 0;
                    player.dungeonId = typeof data.dungeonId === "string" ? data.dungeonId : ""
                    // schema-safe assign
                    player.playerPos.x = data.playerPos?.x ?? player.playerPos.x;
                    player.playerPos.y = data.playerPos?.y ?? player.playerPos.y;
                    player.playerPos.z = data.playerPos?.z ?? player.playerPos.z;

                    player.rotation.x = data.rotation?.x ?? player.rotation.x;
                    player.rotation.y = data.rotation?.y ?? player.rotation.y;
                    player.rotation.z = data.rotation?.z ?? player.rotation.z;
                    player.rotation.w = data.rotation?.w ?? player.rotation.w;

                    // ensure id always correct
                    player.id = playerId;
                    // log for weapons
                    console.log("📥 Firestore RAW DATA", playerId, JSON.stringify(data, null, 2));
                    console.log("📥 Firestore equipped", playerId, data.equipped);
                    console.log("🧠 BEFORE state.equipped", playerId, JSON.stringify(player.equipped, null, 2));
if (data.equipped) {
    Object.entries(data.equipped).forEach(([slot, raw]) => {
        const item = new EquippedItem();
        Object.assign(item, raw); // copia tutti i campi dal DB
        console.log(`Slot ${slot} updated:`, item);
        player.equipped.slots.set(slot, item);
    });
    console.log("🧠 AFTER state.equipped", playerId, JSON.stringify(player.equipped, null, 2));
}


player.equipped.slots.forEach((item, slot) => {
    console.log(
        "  slot:", slot,
        "| itemId:", item.itemId,
        "| obj:", item.obj,
        "| type:", item.type,
        "| twohand:", item.twohand,
        "| durability:", item.durability
    );
});

    });
}

                    console.log("🧠 AFTER state.equipped", playerId, player.equipped);
                    // creare un oggetto plain JSON dai dati Schema
const equippedData = {};
player.equipped.slots.forEach((item, slot) => {
    equippedData[slot] = {
        itemId: item.itemId,
        armourValue: item.armourValue,
        damageValue: item.damageValue,
        durability: item.durability,
        obj: item.obj,
        slot: item.slot,
        special: item.special,
        twohand: item.twohand,
        type: item.type,
        value: item.value
    };
});

client.send("fullEquip", { equipped: equippedData });

                }
            })
            .catch(err => console.error(err));
    }

    onLeave(client, consented) {
        const playerId = this.sessionToPlayerId.get(client.sessionId);

        console.log(`⚠️ Player left: ${client.sessionId} (playerId: ${playerId}) consented=${consented}`);
        if (playerId) {
            this.state.players.delete(playerId);
            this.sessionToPlayerId.delete(client.sessionId);
        }
    }
}

// --- Server ---
const app = express();
const server = http.createServer(app);

const { WebSocketTransport } = require("@colyseus/ws-transport");

const gameServer = new Server({
    transport: new WebSocketTransport({
        server: server,
        pingInterval: 20000,
        pingMaxRetries: 5
    })
});

gameServer.define("my_room", MyRoom);

app.get("/", (req, res) => res.send("Colyseus server online ✅"));

server.listen(process.env.PORT || 10000, () => {
    console.log(`Colyseus server listening on port ${process.env.PORT || 10000}`);
});




































