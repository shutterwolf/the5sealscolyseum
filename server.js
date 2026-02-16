// server.js
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server, Room } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { Schema, MapSchema, ArraySchema, type } = require("@colyseus/schema");
const admin = require("firebase-admin");
const CombatCore = require("./combatCore");
// =============================
// EXPRESS + HTTP
// =============================
const app = express();

app.use(cors({
    origin: true, // accetta automaticamente qualsiasi origin (PlayCanvas safe)
    credentials: true
}));

const httpServer = http.createServer(app);

// =============================
// COLYSEUS SERVER
// =============================
const gameServer = new Server({
    transport: new WebSocketTransport({
        server: httpServer
    })
});

// =============================
// FIRESTORE SETUP
// =============================
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

class WorldState extends Schema {
    constructor() {
        super();
        this.timeOfDay = 8;        // 08:00
        this.isDay = true;
        this.weather = "sunny";    // sunny | rain | snow
    }
}

type("number")(WorldState.prototype, "timeOfDay");
type("boolean")(WorldState.prototype, "isDay");
type("string")(WorldState.prototype, "weather");

class EquippedItem extends Schema {
    constructor() {
        super();
        this.lootID = 0;
        this.armourValue = 1;
        this.damageValue = 0;
        this.durability = 0;
        this.obj = "";
        this.slot = ""; // sempre string
        this.special = "";
        this.twohand = false;
        this.type = "";
        this.value = 0;
    }
}

type("number")(EquippedItem.prototype, "lootID");
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

// --- Server: aggiorna la posizione dei nemici ---
class EnemyState {
    constructor(id, type, startPos) {
        this.id = id;
        this.type = type;
        this.pos = startPos.clone();
        this.rot = new Vec3(0, 0, 0);
        this.health = enemyStats[type].maxHealth;
        this.aiState = "idle";         
        this.targetPlayerId = null;
        this.destination = null;
        this.enemySpeed = enemyStats[type].enemyspeed || 1;
        this.inCombat = 0;             
        this.currentAnim = "idle";
    }

    update(deltaTime, players) {
        if (this.aiState === "dead" || this.aiState === "frozen") return;

        let nearestPlayer = null;
        let nearestDist = Infinity;
        for (const p of players) {
            if (p.state === "dead" || p.status === "hidden") continue;
            const dist = this.pos.distance(p.pos);
            if (dist < nearestDist) { nearestDist = dist; nearestPlayer = p; }
        }

        if (nearestPlayer && nearestDist < enemyStats[this.type].radius) {
            this.aiState = "combat";
            this.targetPlayerId = nearestPlayer.id;
            this.destination = null;
            if (this.inCombat === 0) this.inCombat = generateCombatId();
            this.setAnimation("attack");

            const wRange = enemyStats[this.type].wRange || 0;
            if (nearestDist > wRange) this.moveTowards(nearestPlayer.pos, deltaTime);
        } else {
            this.aiState = "roaming";
            this.targetPlayerId = null;
            this.inCombat = 0;

            if (!this.destination || this.pos.distance(this.destination) < 0.5) {
                this.destination = this.randomDestination();
            }
            this.moveTowards(this.destination, deltaTime);

            this.setAnimation(this.pos.distance(this.destination) < 0.5 ? "idle" : "walk");
        }
    }

    moveTowards(target, deltaTime) {
        const dir = target.clone().sub(this.pos);
        const dist = dir.length();
        if (dist < 0.01) {
            this.velocity = new Vec3(0, 0, 0);
            return;
        }
        dir.normalize();
        this.velocity = dir.clone().scale(this.enemySpeed);
        this.pos.add(this.velocity.clone().scale(deltaTime));
        this.rot.y = Math.atan2(dir.x, dir.z);
    }

    randomDestination() {
        const r = enemyStats[this.type].range || 5;
        return new Vec3(
            this.pos.x + (Math.random() * r * 2 - r),
            this.pos.y,
            this.pos.z + (Math.random() * r * 2 - r)
        );
    }

    setAnimation(anim) {
        if (this.currentAnim !== anim) this.currentAnim = anim;
    }
}

// --- Client: interpolazione ---
class EnemyClient {
    constructor(serverEnemy) {
        this.id = serverEnemy.id;
        this.pos = serverEnemy.pos.clone();
        this.rot = serverEnemy.rot.clone();
        this.targetPos = serverEnemy.pos.clone();
        this.targetRot = serverEnemy.rot.clone();
        this.currentAnim = serverEnemy.currentAnim;
    }

    receiveUpdate(serverEnemy) {
        this.targetPos = serverEnemy.pos.clone();
        this.targetRot = serverEnemy.rot.clone();
        this.currentAnim = serverEnemy.currentAnim;
    }

    interpolate(deltaTime) {
        const lerpFactor = 0.1; // più piccolo = più fluido ma più lag
        this.pos.lerp(this.targetPos, lerpFactor);
        this.rot.y += (this.targetRot.y - this.rot.y) * lerpFactor;
    }
}

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
        this.hp=0;
        this.inCombat = 0;
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
type("number")(PlayerState.prototype, "hp");
type("number")(PlayerState.prototype, "inCombat");
type(Equipped)(PlayerState.prototype, "equipped");

class ChatMessage extends Schema {
    constructor(id = "", name = "Anon", text = "", timestamp = Date.now()) {
        super();
        this.id = id;
        this.name = name;
        this.text = text;
        this.timestamp = timestamp;
    }
}
type("string")(ChatMessage.prototype, "id");
type("string")(ChatMessage.prototype, "name");
type("string")(ChatMessage.prototype, "text");
type("number")(ChatMessage.prototype, "timestamp");

class MyRoomState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
        this.world = new WorldState();
        this.chat = new ArraySchema();
    }
}
type({ map: PlayerState })(MyRoomState.prototype, "players");
type(WorldState)(MyRoomState.prototype, "world");
type([ChatMessage])(MyRoomState.prototype, "chat");

// --- Room ---
class MyRoom extends Room {
    maxClients = 40;
    
    onCreate() {
        console.log("Room created");
        this.sessionToPlayerId = new Map();
        this.setState(new MyRoomState());
        this.dayDuration = 30 * 60 * 1000;    // 30 min
        this.nightDuration = 15 * 60 * 1000;  // 15 min
        this.weatherInterval = 10 * 60 * 1000;
        this.lastWeatherChange = Date.now();
        this.combat = new CombatCore(this);
        this.activeCombats = new Map(); // combatId -> CombatCore instance
        this.nextCombatId = 1;    
        // --- equipItem ---
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
        
        this.clock.setInterval(() => {
            const world = this.state.world;
        
            const speed = world.isDay
                ? 16 / this.dayDuration
                : 8 / this.nightDuration;
        
            world.timeOfDay += speed * 1000;
        
            if (world.timeOfDay >= 24) world.timeOfDay -= 24;
        
            const nowDay = world.timeOfDay >= 6 && world.timeOfDay < 22;
        
            if (nowDay !== world.isDay) {
                world.isDay = nowDay;
            }
        
            // WEATHER (ogni 10 min)
            if (Date.now() - this.lastWeatherChange > this.weatherInterval) {
                this.lastWeatherChange = Date.now();
        
                const roll = Math.random();
                if (roll < 0.5) {
                    world.weather = "sunny";
                } else if (roll < 0.8) {
                    world.weather = "rain";
                } else {
                    world.weather = "snow";
                }
            }
        }, 1000);

        // client segnala fine animazione
        this.onMessage("turnFinished", (client, data) => {
            const actorId = data.actorId;
            const player = this.state.players.get(actorId);
        
            if (!player || player.inCombat === 0) return;
        
            const combat = this.activeCombats.get(player.inCombat);
            if (!combat) return;
        
            combat.onActorAnimationFinished(actorId);
        });
        
        this.onMessage("startCombat", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const targetId = data.targetId;
        
            if (!playerId || !targetId) return;
        
            const player = this.state.players.get(playerId);
            const target = this.state.players.get(targetId);
        
            if (!player || !target) return;
        
            // già in combat?
            if (player.inCombat > 0 || target.inCombat > 0) return;
        
            const combatId = this.nextCombatId++;
        
            const combat = new CombatCore(this, combatId);
        
            this.activeCombats.set(combatId, combat);
        
            player.inCombat = combatId;
            target.inCombat = combatId;
        
            combat.addActor(playerId, { hp: 20, combat: 6, defence: 5, strength: 4, wDamage: 2 });
            combat.addActor(targetId, { hp: 20, combat: 6, defence: 5, strength: 4, wDamage: 2 });
        
            combat.setTarget(playerId, targetId);
            combat.setTarget(targetId, playerId);
        
            combat.startCombat();
        });
        
        // --- playerInput ---
        this.onMessage("playerInput", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const player = this.state.players.get(playerId);
            if (!player) return;

            const pos = {
                x: Number(data.playerPos?.x) || 0,
                y: Number(data.playerPos?.y) || 0,
                z: Number(data.playerPos?.z) || 0
            };

            const rot = {
                x: Number(data.rotation?.x) || 0,
                y: Number(data.rotation?.y) || 0,
                z: Number(data.rotation?.z) || 0,
                w: Number(data.rotation?.w) || 1
            };

            Object.assign(player.playerPos, pos);
            Object.assign(player.rotation, rot);

            player.texTure = data.texTure ?? player.texTure;
            player.activeWeapon = data.activeWeapon ?? player.activeWeapon;
            if (typeof data.localMap === "number") player.localMap = data.localMap;
            if (typeof data.depth === "number") player.depth = data.depth;
            if (typeof data.dungeonId === "string") player.dungeonId = data.dungeonId;
            if (typeof data.anim === "string") player.anim = data.anim;
            if (typeof data.speed === "number") player.speed = data.speed;
        });

        // --- anim ---
        this.onMessage("anim", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const player = this.state.players.get(playerId);
            if (!player) return;

            if (typeof data.anim === "string") player.anim = data.anim;
            if (typeof data.speed === "number") player.speed = data.speed;
        });

        // --- checkCharacter ---
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

        // --- saveCharacter ---
        this.onMessage("saveCharacter", async (client, data) => {
            try {
                await db.collection("characters").doc(data.playerId).set(data.character);
                client.send("characterSaved", { ok: true, playerId: data.playerId });
            } catch (err) {
                console.error("FIRESTORE SAVE ERROR:", err);
                client.send("characterSaved", { ok: false, playerId: data.playerId });
            }
        });

        // --- deleteCharacter ---
        this.onMessage("deleteCharacter", async (client, message) => {
            const charId = message.id;
            let success = false;
        
            try {
                // Cancella dal DB Firestore
                await db.collection("characters").doc(charId).delete();
                success = true;
        
                // Cancella anche dallo stato della stanza
                if (this.state.players.has(charId)) {
                    this.state.players.delete(charId);
                }
        
                console.log(`❌ Character ${charId} deleted successfully`);
            } catch (err) {
                console.error(`❌ Error deleting character ${charId}:`, err);
            }
        
            // Conferma al client
            client.send("characterDeleted", { id: charId, success });
        });
        
        // --- playerInfo ---
        this.onMessage("playerInfo", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const player = this.state.players.get(playerId);
            if (!player) return;

            player.name = data.name ?? player.name;
            player.user = data.user ?? player.user;
            player.email = data.email ?? player.email;
            player.id = data.id ?? player.id;
        });

        // --- CHAT ---
        this.onMessage("sendMessage", (client, message) => {
            if (typeof message !== "string" || message.trim() === "") return;
        
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;
        
            const player = this.state.players.get(playerId);
            const name = player?.name || "Anon";
        
            const msg = new ChatMessage(playerId, name, message.trim(), Date.now());
        
            // memorizza max 50
            this.state.chat.push(msg);
            if (this.state.chat.length > 50) this.state.chat.shift();
        
            // broadcast a tutti
            this.broadcast("chatMessage", msg);
        });
    }

    async onJoin(client, options) {
        const playerId = options.playerId;
        if (!playerId) return client.leave();

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

                        // Copia solo i campi validi
                        item.lootID = raw.lootID ?? 0;
                        item.armourValue = raw.armourValue ?? 1;
                        item.damageValue = raw.damageValue ?? 0;
                        item.durability = raw.durability ?? 0;
                        item.obj = raw.obj ?? "";
                        item.special = raw.special ?? "";
                        item.twohand = !!raw.twohand;
                        item.type = raw.type ?? "";
                        item.value = raw.value ?? 0;

                        // Il nome dello slot DEVE essere stringa per Colyseus
                        // Se Firebase ti invia un numero (anche se nel DB è “giusto”), il server lo converte
                        item.slot = String(slot);

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

        // invia messaggi chat già presenti
        client.send("chatInit", this.state.chat.map(msg => ({
            id: msg.id,
            name: msg.name,
            text: msg.text,
            timestamp: msg.timestamp
        })));
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
// definisci la tua room
gameServer.define("my_room", MyRoom);
//gameServer.define("chat_room", ChatRoom);
// route di test
app.get("/", (req, res) => res.send("Server Colyseus online ✅"));

// avvia il server
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});





















