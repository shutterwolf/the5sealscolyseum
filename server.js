// server.js
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server, Room } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { Schema, MapSchema, ArraySchema, type } = require("@colyseus/schema");
const admin = require("firebase-admin");
const CombatCore = require("./combatCore");
const enemyStats = require("./enemyStats");
const EnemyServer = require("./EnemyHandler");
const fs = require("fs");
const ROT = require("rot-js");
const dungeonConfig = JSON.parse(fs.readFileSync("Dungeons.json"));
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

class DoorState extends Schema {
    constructor() {
        super();
        this.x = 0;
        this.y = 0;
        this.closed = true;
        this.state = "closed"; // closed | opening | open | broken
        // 🔐 type of door logic
        this.lockType = "key"; // key | puzzle | trigger
        // 🔑 key system
        this.keyNumber = 0;
        // 🧩 puzzle / lockpick system
        this.openProgress = 0; // 0-100
        // ⚡ trigger system
        this.triggerId = 0;
        // 💥 optional break system
        this.resistance = 100;
        // 🧭 visuals
        this.orientation = "vertical";
        this.material = "wood";
    }
}

type("number")(DoorState.prototype, "x");
type("number")(DoorState.prototype, "y");
type("boolean")(DoorState.prototype, "closed");
type("string")(DoorState.prototype, "state");
type("string")(DoorState.prototype, "lockType");
type("number")(DoorState.prototype, "triggerId");
type("number")(DoorState.prototype, "keyNumber");
type("number")(DoorState.prototype, "openProgress");
type("number")(DoorState.prototype, "resistance");
type("string")(DoorState.prototype, "orientation");
type("string")(DoorState.prototype, "material");

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
        this.name = "";
        this.armourValue = 1;
        this.damageValue = 0;
        this.resistence = 0;
        this.variable = 0;
        this.obj = "";
        this.slot = ""; // sempre string
        this.special = "";
        this.twohand = false;
        this.type = "";
        this.value = 0;
    }
}

type("number")(EquippedItem.prototype, "lootID");
type("string")(EquippedItem.prototype, "name");
type("number")(EquippedItem.prototype, "armourValue");
type("number")(EquippedItem.prototype, "damageValue");
type("number")(EquippedItem.prototype, "variable");
type("number")(EquippedItem.prototype, "resistence");
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

class EnemyLogic {
    constructor(schemaEnemy, type) {
        this.schema = schemaEnemy;
        this.type = type;
        this.speed = enemyStats[type].enemyspeed || 1;
    }
}

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
        this.speed = 0;
        this.radius = 0;
        this.wRange = 0;
        this.maxHealth = 0;
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
        this.partyId = "";
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
type("string")(PlayerState.prototype, "partyId");
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

class EnemySchema extends Schema {
    constructor() {
        super();
        this.id = "";
        this.typeId = 0;
        this.type = "";
        this.pos = new Vec3();
        this.rot = new Vec3();
        this.health = 0;
        this.aiState = "idle";
        this.currentAnim = "idle";
        this.inCombat = 0;

        this.localMap = 0;      
        this.dungeonId = "";    
        this.depth = 0;
        this.destX = 0;
        this.destZ = 0;
        this.idleUntil = 0;
        this.targetPlayerId = "";
        this.speed = 0;
        this.radius = 0;
        this.wRange = 0;
        this.maxHealth = 0;
        this.ownerId="";
        this.questId=0;
        this.isDead=false;
        this.lootReady=false;
    }
}

type("string")(EnemySchema.prototype, "id");
type("number")(EnemySchema.prototype, "typeId");
type("string")(EnemySchema.prototype, "type");
type(Vec3)(EnemySchema.prototype, "pos");
type(Vec3)(EnemySchema.prototype, "rot");
type("number")(EnemySchema.prototype, "health");
type("string")(EnemySchema.prototype, "aiState");
type("string")(EnemySchema.prototype, "currentAnim");
type("number")(EnemySchema.prototype, "inCombat");
type("number")(EnemySchema.prototype, "localMap");
type("string")(EnemySchema.prototype, "dungeonId");
type("number")(EnemySchema.prototype, "depth");
type("number")(EnemySchema.prototype, "destX");
type("number")(EnemySchema.prototype, "destZ");
type("number")(EnemySchema.prototype, "idleUntil");
type("string")(EnemySchema.prototype, "targetPlayerId");
type("number")(EnemySchema.prototype, "speed");
type("number")(EnemySchema.prototype, "radius");
type("number")(EnemySchema.prototype, "wRange");
type("number")(EnemySchema.prototype, "maxHealth");
type("string")(EnemySchema.prototype, "ownerId");
type("number")(EnemySchema.prototype, "questId");
type("boolean")(EnemySchema.prototype, "isDead");
type("boolean")(EnemySchema.prototype, "lootReady");

class MyRoomState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
        this.enemies = new MapSchema(); // 👈
        this.world = new WorldState();
        this.chat = new ArraySchema();
        this.doors = new MapSchema();
    }
}

type({ map: PlayerState })(MyRoomState.prototype, "players");
type({ map: EnemySchema })(MyRoomState.prototype, "enemies"); // 👈
type(WorldState)(MyRoomState.prototype, "world");
type([ChatMessage])(MyRoomState.prototype, "chat");
type({ map: DoorState })(MyRoomState.prototype, "doors");

// --- Room ---
class MyRoom extends Room {
    maxClients = 40;
    placeEntrance(levelData) {
        const rooms = levelData.rooms;
        if (!rooms || rooms.length === 0) return null;
    
        const room = rooms[Math.floor(ROT.RNG.getUniform() * rooms.length)];
    
        const x = Math.floor(ROT.RNG.getUniform() * (room.getRight() - room.getLeft() - 1)) + room.getLeft() + 1;
        const y = Math.floor(ROT.RNG.getUniform() * (room.getBottom() - room.getTop() - 1)) + room.getTop() + 1;
    
        return { x, y };
    }
    
    placeExit(levelData, levelIndex, dungeonConfig, entrance) {
        const maxLevels = dungeonConfig.Levels;
        if (maxLevels <= 1) return null;
        if (levelIndex >= maxLevels - 1) return null;
        const rooms = levelData.rooms;
        if (!rooms || rooms.length === 0) return null;
        const MIN_DIST = 15;
        if (entrance && rooms.length > 1) {
            let bestRoom = null;
            let bestDist = -1;
            for (const room of rooms) {
                const cx = (room.getLeft() + room.getRight()) / 2;
                const cy = (room.getTop() + room.getBottom()) / 2;
                const dist = Math.sqrt(Math.pow(cx - entrance.x, 2) + Math.pow(cy - entrance.y, 2));
                if (dist > bestDist) {
                    bestDist = dist;
                    bestRoom = room;
                }
            }
    
            if (bestRoom) {
                const x = Math.floor(ROT.RNG.getUniform() * (bestRoom.getRight() - bestRoom.getLeft() - 1)) + bestRoom.getLeft() + 1;
                const y = Math.floor(ROT.RNG.getUniform() * (bestRoom.getBottom() - bestRoom.getTop() - 1)) + bestRoom.getTop() + 1;
                return { x, y };
            }
        }
    
        // fallback: try random rooms until one is far enough
        for (let attempt = 0; attempt < 20; attempt++) {
            const room = rooms[Math.floor(ROT.RNG.getUniform() * rooms.length)];
            const x = Math.floor(ROT.RNG.getUniform() * (room.getRight() - room.getLeft() - 1)) + room.getLeft() + 1;
            const y = Math.floor(ROT.RNG.getUniform() * (room.getBottom() - room.getTop() - 1)) + room.getTop() + 1;
            if (!entrance) return { x, y };
            const dist = Math.sqrt(Math.pow(x - entrance.x, 2) + Math.pow(y - entrance.y, 2));
            if (dist >= MIN_DIST) return { x, y };
        }
        // last resort
        const room = rooms[Math.floor(ROT.RNG.getUniform() * rooms.length)];
        const x = Math.floor(ROT.RNG.getUniform() * (room.getRight() - room.getLeft() - 1)) + room.getLeft() + 1;
        const y = Math.floor(ROT.RNG.getUniform() * (room.getBottom() - room.getTop() - 1)) + room.getTop() + 1;
        return { x, y };
    }

    generateDoors(levelData, config) {
        const doors = {};
        if (!config.Doors) return doors;
        const rooms = levelData.rooms;
        if (!rooms || rooms.length === 0) return doors;
        const maxDoors = config.maxDoors || 999;
        let count = 0;
        let doorIndex = 0; // 👈 per ratio locked
        const saveDoor = (x, y) => {
            if (count >= maxDoors) return;
            const key = `${x},${y}`;
            // skip adjacent doors
            if (
                doors[`${x+1},${y}`] ||
                doors[`${x-1},${y}`] ||
                doors[`${x},${y+1}`] ||
                doors[`${x},${y-1}`]
            ) return;
    
            // must be floor
            if (levelData.map[key] !== ".") return;
    
            const up    = levelData.map[`${x},${y+1}`];
            const down  = levelData.map[`${x},${y-1}`];
            const left  = levelData.map[`${x-1},${y}`];
            const right = levelData.map[`${x+1},${y}`];
            const vertical   = (up === "#" && down === "#");
            const horizontal = (left === "#" && right === "#");
            if (!(vertical || horizontal)) return;
            doorIndex++;
            // 🔥 1 ogni 10 è locked
            const isLocked = (doorIndex % 10 === 0);
            doors[key] = {
                x,
                y,
                closed: true,
                // 🔐 ONLY key system for now
                lockType: isLocked ? "key" : "none",
                keyNumber: isLocked ? 1 : 0,
                triggerId: 0,
                // unused for now but safe
                resistance: 100,
                orientation: vertical ? "vertical" : "horizontal",
                material: "wood"
            };
            count++;
        };
        for (const room of rooms) {
            room.getDoors(saveDoor);
        }
        return doors;
    }

    broadcastToLevel(dungeonId, levelKey, type, data) {
        this.state.players.forEach((player, playerId) => {
            if (String(player.dungeonId) === String(dungeonId) &&
                String(player.depth) === String(levelKey)) {
                const client = this.clients.find(c =>
                    this.sessionToPlayerId.get(c.sessionId) === playerId
                );
                if (client) client.send(type, data);
            }
        });
    }
    
    generateFurnitures(levelData, config, occupied = new Set()) {
        const furnitures = {};
        const count = config.furniture || 10;
        for (let i = 0; i < count; i++) {
            for (let attempt = 0; attempt < 10; attempt++) {
                const a = Math.floor(ROT.RNG.getUniform() * 5);
                let type = "table";
                if (a === 1 || a === 4) type = "column";
                if (a === 2) type = "bookcase";
                const key = this.getRandomCellInRoom(levelData);
                if (!key) continue;
                if (occupied.has(key)) continue;
                if (levelData.doors && levelData.doors[key]) continue;
                const [x, y] = key.split(",").map(Number);
                if (
                    levelData.map[`${x},${y+1}`] !== "." ||
                    levelData.map[`${x},${y-1}`] !== "." ||
                    levelData.map[`${x+1},${y}`] !== "." ||
                    levelData.map[`${x-1},${y}`] !== "."
                ) continue;
                let rotation = levelData.map[`${x},${y-1}`] === "." ? 180 : 0;
                furnitures[key] = {
                    x,
                    y,
                    type,
                    rotation
                };
                occupied.add(key);
                break;
            }
        }
        return furnitures;
    }
    
    generateLoot(levelData, config, occupied = new Set()) {
        const loots = {};
        const count = config.loot || 5;
        for (let i = 0; i < count; i++) {
            for (let attempt = 0; attempt < 10; attempt++) {
                const key = this.getRandomCellInRoom(levelData);
                if (!key) continue;
                if (occupied.has(key)) continue;
                if (levelData.doors && levelData.doors[key]) continue;
                const [x, y] = key.split(",").map(Number);
                if (
                    levelData.map[`${x},${y+1}`] !== "." ||
                    levelData.map[`${x},${y-1}`] !== "." ||
                    levelData.map[`${x+1},${y}`] !== "." ||
                    levelData.map[`${x-1},${y}`] !== "."
                ) continue;
                loots[key] = {
                    x,
                    y,
                    type: "chest"
                };
                occupied.add(key);
                break;
            }
        }
        return loots;
    }
    
    getRandomCellInRoom(levelData) {
        const rooms = levelData.rooms;
        if (!rooms || rooms.length === 0) return null;
        for (let attempt = 0; attempt < 10; attempt++) {
            const room = rooms[Math.floor(ROT.RNG.getUniform() * rooms.length)];
            const minX = room.getLeft() + 1;
            const maxX = room.getRight() - 1;
            const minY = room.getTop() + 1;
            const maxY = room.getBottom() - 1;
            if (maxX < minX || maxY < minY) continue;
            const x = Math.floor(ROT.RNG.getUniform() * (maxX - minX + 1)) + minX;
            const y = Math.floor(ROT.RNG.getUniform() * (maxY - minY + 1)) + minY;
            const key = `${x},${y}`;
            if (levelData.map[key] !== ".") continue;
            if (levelData.doors && levelData.doors[key]) continue;
            return key;
        }
        return null;
    }
    
    generateUniformMap(dungeonConfig, seed) {
        const width  = dungeonConfig.dunWidth;
        const height = dungeonConfig.dunHeight;
        ROT.RNG.setSeed(seed);
        const map       = {};
        const freeCells = [];
        const roomsData = [];
        const mapGen = new ROT.Map.Digger(width, height, {
            roomWidth:     [dungeonConfig.xroom, dungeonConfig.xroom + 2],
            roomHeight:    [dungeonConfig.yroom, dungeonConfig.yroom + 2],
            corridorLength: [2, 10],
            dugPercentage: dungeonConfig.dug
        });
    
        mapGen.create((x, y, value) => {
            const key = `${x},${y}`;
            if (value === 0) {
                map[key] = ".";
                freeCells.push(key);   // ← string key, not {x, y} object
            } else {
                map[key] = "#";
            }
        });
        // Store actual room objects so getDoors() is available
        const rooms = mapGen.getRooms();
        for (const room of rooms) {
            roomsData.push(room);
        }
        return {
            map,
            freeCells,
            rooms: roomsData   // ROT.js Room objects with getDoors()
        };
        // Doors are generated separately via generateDoors() after this
    }
    

    spawnEnemy(type, x, z, config = {}) {
        const id = "E" + this.enemyIdCounter++;
        const enemy = new EnemySchema();
        const stats = enemyStats[type];
        enemy.id = id;
        enemy.typeId = stats.id;
        enemy.type = type;
        enemy.pos.x = x;
        enemy.pos.y = 5; // altezza sicura
        enemy.pos.z = z;
        enemy.rot = new Vec3(0,0,0);
        enemy.health = enemyStats[type]?.maxHealth || 20;
        enemy.aiState = "idle";
        enemy.currentAnim = "idle";
        enemy.inCombat = 0;
        enemy.localMap = config.localMap ?? 0;
        enemy.dungeonId = config.dungeonId ?? "";
        enemy.depth = config.depth ?? 0;
        enemy.speed = stats.enemyspeed;
        enemy.radius = stats.radius;
        enemy.wRange = stats.wRange;
        enemy.maxHealth = stats.maxHealth;
        // NON ha ownerId → loot libero o null
        enemy.ownerId = "";
        enemy.questId = config.questId ?? -1;
        enemy.isDead = false;
        enemy.lootReady = false;
        this.state.enemies.set(id, enemy);
        const logic = new EnemyServer({
            id: id,
            enemy: config.type,
            posX: config.x,
            posY: 3,
            posZ: config.z,
            dungeon: !!config.dungeonId,
            localMap: config.localMap ?? 0,
            depth: config.depth ?? 0,
            aggroRange: enemyStats[config.type]?.radius ?? 5,
            speed: enemyStats[config.type]?.enemyspeed ?? 1,
            radius: enemyStats[config.type]?.radius ?? 5
        });
        this.enemyInstances.set(id, logic);
        // 3️⃣ Salva riferimento
        if (!this.activeQuestSpawns.has(ownerId)) {
            this.activeQuestSpawns.set(ownerId, new Map());
        }
        this.activeQuestSpawns.get(ownerId).set(questId, id);
        // 4️⃣ Notifica client owner  ← VA QUI, dopo tutto il resto
        const ownerSessionId = [...this.sessionToPlayerId.entries()]
            .find(([, pid]) => pid === ownerId)?.[0];
        const ownerClient = this.clients.find(c => c.sessionId === ownerSessionId);
        if (ownerClient) {
            ownerClient.send("enemySpawn", {
                id: enemy.id,
                type: enemy.type,
                typeId: enemy.typeId,
                pos: { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z }
            });
            console.log(`[spawnQuestEnemy] enemySpawn inviato a ${ownerId} per ${enemy.id}`);
        } else {
            console.warn(`[spawnQuestEnemy] client owner ${ownerId} non trovato`);
        }
        return id;
    }

    spawnQuestEnemy(ownerId, questId, config) {
    const id = "E" + this.enemyIdCounter++;
    const stats = enemyStats[config.type];
    if (!stats) {
        console.error("Enemy type non trovato in enemyStats:", config.type);
        return null;
    }
    const enemy = new EnemySchema();
    enemy.id = id;
    enemy.typeId = stats.id;
    enemy.type = config.type;
    enemy.pos.x = config.x;
    enemy.pos.y = 3;
    enemy.pos.z = config.z;
    enemy.rot = new Vec3(0, 0, 0);
    enemy.health = stats.maxHealth;
    enemy.maxHealth = stats.maxHealth;
    enemy.speed = stats.enemyspeed;
    enemy.radius = stats.radius;
    enemy.wRange = stats.wRange;
    enemy.aiState = "idle";
    enemy.currentAnim = "idle";
    enemy.inCombat = 0;
    enemy.localMap = config.localMap ?? 0;
    enemy.dungeonId = config.dungeonId ?? "";
    enemy.depth = config.depth ?? 0;
    enemy.ownerId = ownerId;
    enemy.questId = questId;
    enemy.isDead = false;
    enemy.lootReady = false;
    this.state.enemies.set(id, enemy);
    const logic = new EnemyServer({
        id: id,
        enemy: config.type,
        posX: config.x,
        posY: 3,
        posZ: config.z,
        dungeon: !!config.dungeonId,
        localMap: config.localMap ?? 0,
        depth: config.depth ?? 0,
        aggroRange: stats.radius ?? 5,
        speed: stats.enemyspeed ?? 1,
        radius: stats.radius ?? 5
    });
    this.enemyInstances.set(id, logic);
    if (!this.activeQuestSpawns.has(ownerId)) {
        this.activeQuestSpawns.set(ownerId, new Map());
    }
    this.activeQuestSpawns.get(ownerId).set(questId, id);
    const ownerSessionId = [...this.sessionToPlayerId.entries()]
        .find(([, pid]) => pid === ownerId)?.[0];
    const ownerClient = this.clients.find(c => c.sessionId === ownerSessionId);
    if (ownerClient) {
        ownerClient.send("enemySpawn", {
            id: enemy.id,
            type: enemy.type,
            typeId: enemy.typeId,
            pos: { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z }
        });
        console.log(`[spawnQuestEnemy] OK id=${id} type=${config.type} owner=${ownerId}`);
    } else {
        console.warn(`[spawnQuestEnemy] client owner ${ownerId} non trovato`);
    }
    return id;
}

    
    onCreate() {
        console.log("Room created");
        this.sessionToPlayerId = new Map();
        this.setState(new MyRoomState());
        this.dayDuration = 30 * 60 * 1000;    // 30 min
        this.nightDuration = 15 * 60 * 1000;  // 15 min
        this.weatherInterval = 10 * 60 * 1000;
        this.lastWeatherChange = Date.now();
        this.start=true;
        this.activeCombats = new Map(); // combatId -> CombatCore instance
        this.nextCombatId = 1;    
        this.enemyLogic = new Map();
        this.enemyInstances = new Map();
        this.enemyIdCounter = 1;
        this.activeQuestSpawns = new Map();
        this.dungeons = new Map();
        // --- IDLE LOGIC ---
        setInterval(() => {
            this.dungeons.forEach((dungeon, dungeonId) => {
                Object.entries(dungeon.levels).forEach(([levelKey, levelData]) => {
                    const config = dungeonConfig.Dungeons.find(d => String(d.id) === String(dungeonId));
                    if (!config) return;
                    const enemyTypes = Object.keys(enemyStats);
                    const enemyType = config.Enemy || enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
                    // Count enemies currently alive in this dungeon level
                    let currentCount = 0;
                    this.state.enemies.forEach((enemy) => {
                        if (String(enemy.dungeonId) === String(dungeonId) &&
                            enemy.depth === Number(levelKey) &&
                            !enemy.isDead) {
                            currentCount++;
                        }
                    });
                    // Only respawn if below the max cap for this dungeon
                    if (currentCount >= config.enemies) {
                        //console.log(`Dungeon ${dungeonId} level ${levelKey} already at max enemies (${config.enemies}), skipping respawn`);
                        return;
                    }
                    // Pick a random free cell to respawn at
                    const key = this.getRandomCellInRoom(levelData);
                    if (!key) return;
                    if (key in levelData.loot) return;       // skip chest cells
                    if (key in levelData.furnitures) return;
                    const [x, y] = key.split(",").map(Number);
                    this.spawnEnemy(enemyType, x, y, {
                        localMap: 0,
                        dungeonId: String(dungeonId),
                        depth: Number(levelKey)
                    });
                    //console.log(`Respawned 1 ${config.Enemy} in dungeon ${dungeonId} level ${levelKey} (${currentCount + 1}/${config.enemies})`);
                });
            });
        }, 30 * 60 * 1000);
        // ─── Loot respawn: 1 chest per active dungeon level every hour ───
        setInterval(async () => {
            for (const [dungeonId, dungeon] of this.dungeons) {
                for (const [levelKey, levelData] of Object.entries(dungeon.levels)) {
                    let placed = false;
                    for (let attempt = 0; attempt < 20; attempt++) {
                        const key = this.getRandomCellInRoom(levelData);
                        if (!key) continue;
        
                        const alreadyLoot = key in levelData.loot;   // ← CHANGED
                        if (alreadyLoot) continue;
                        if (levelData.doors && levelData.doors[key]) continue;
        
                        const [x, y] = key.split(",").map(Number);
                        const newChest = {
                            x, y,
                            type: "chest",
                            dungeonId: String(dungeonId),
                            depth: Number(levelKey)
                        };
                        levelData.loot[key] = newChest;              // ← CHANGED
                        placed = true;
                        this.broadcastToLevel(dungeonId, levelKey, "lootSpawned", newChest);
                        break;
                    }
                }
            }
        }, 60 * 60 * 1000);
        
        this.onMessage("openChest", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;
            const player = this.state.players.get(playerId);
            if (!player) return;
            const dungeon = this.dungeons.get(player.dungeonId) ?? this.dungeons.get(Number(player.dungeonId));
            if (!dungeon) return;
            const level = dungeon.levels[String(player.depth)];
            if (!level?.loot) return;
            console.log(`[CHEST] Player trying to open chest at key: ${data.key}`);
            if (!(data.key in level.loot)) {
                console.log(`[CHEST ERROR] Key ${data.key} not found! Available keys:`, Object.keys(level.loot));
                return; 
            }
            // Delete it from server state
            delete level.loot[data.key];           
            console.log(`[CHEST] Success! Broadcasting chestOpened for key: ${data.key}`);
            this.broadcastToLevel(player.dungeonId, String(player.depth), "chestOpened", {
                key: data.key
            });
        });

        
       this.onMessage("requestSpawnEnemies", (client, data) => {
           console.log(">>> requestSpawnEnemies raw data:", JSON.stringify(data));
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;
            const player = this.state.players.get(playerId);
            if (!player) return;
            const questId = data.questID ?? data.questId ?? 0;
            const enemyType = data.enemyType;
            const startPos = data.startPos || {};
            const num = Number.isFinite(data.num) && data.num > 0 ? Math.floor(data.num) : 1;
            if (!enemyType || !Number.isFinite(startPos.x) || !Number.isFinite(startPos.z)) {
                console.warn("[requestSpawnEnemies] Invalid payload:", data);
                return;
            }
            for (let i = 0; i < num; i++) {
                const enemyID = this.spawnQuestEnemy(playerId, questId, {
                    type: enemyType,
                    x: startPos.x + i,
                    z: startPos.z,
                    localMap: player.localMap ?? 0,
                    dungeonId: player.dungeonId ?? "",
                    depth: player.depth ?? 0
                });
                if (!enemyID) {
                    console.error("Spawn failed for enemyType:", enemyType);
                }
            }
        });


        this.onMessage("enterDungeon", async (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;
            //console.log("RAW DATA:", JSON.stringify(data));
            const config = dungeonConfig.Dungeons.find(d => d.Name === data.name);
            if (!config) {
                console.warn("Dungeon not found:", data, client);
                return;
            }
            console.log("ENTER DUNGEON DATA:", data);
            const dungeonId = config.id;
            let level = data.level ?? 1; // 👈 let
            let depth = data.depth ?? level;
            const depthFromData = data.depth;
            //console.log("Depth FROM DATA:", depthFromData);
            const docId = `${dungeonId}_${level}`;
            // Get or create dungeon in memory
            if (!this.dungeons.has(dungeonId)) {
                this.dungeons.set(dungeonId, { id: dungeonId, levels: {} });
            }
            const dungeon = this.dungeons.get(dungeonId);
            // If level not in memory, try Firestore first
            const lvlKey = String(level);
            if (!dungeon.levels[lvlKey]) {
                try {
                    const doc = await db.collection("dungeons").doc(docId).get();
                    if (doc.exists) {
                        const data = doc.data();
                        const seed = data.seed;
                        let depth = data.depth ?? level;
                        dungeon.levels[lvlKey] = this.createLevel(config, level, dungeonId, depth, seed);
                    } else {
                        const seed = Math.floor(Math.random() * 1e9);
                        const dungeonLevel = level;
                        depth=dungeonLevel;
                        dungeon.levels[lvlKey] = this.createLevel(config, level, dungeonId, depth, seed);
                        const toSave = {
                            seed,
                            dungeonId,
                            level,
                            depth
                        };
                        await db.collection("dungeons").doc(docId).set(toSave, { merge: true });
                        console.log(`Saved dungeon ${docId} to Firestore`);
                    }
                } catch (err) {
                    console.error("Firestore dungeon error:", err);
                    // Fallback: generate in memory without saving
                    const seed = Math.floor(Math.random() * 1e9);
                    let depth = level;
                    console.log("levelKey",lvlKey);
                    console.log("Depth:",depth);
                    dungeon.levels[lvlKey] = this.createLevel(config, level, dungeonId, depth, seed);
                }
            }
            const levelData = dungeon.levels[lvlKey];
            //const depth = levelData.depth ?? level; // 🔥 FIX
            const player = this.state.players.get(playerId);
            console.log("Dati player",dungeonId,depth);
            if (player) {
                player.dungeonId = String(dungeonId);
                player.depth = depth;
            }
            //console.log("LEVEL DATA BEFORE SEND:", levelData);
            //console.log("Sending loadDungeon:", { level, depth, hasEntrance: !!levelData.entrance });
            //console.log(levelData)
            client.send("loadDungeon", {
                dungeonConfig: config,
                dungeonId,
                level,
                depth,
                map: levelData.map,
                //rooms: levelData.rooms,
                doors: levelData.doors,
                furnitures: levelData.furnitures,
                loot: levelData.loot,
                entrance: levelData.entrance,
                exit: levelData.exit
            });
        });;

        this.onMessage("openDoor", (client, data) => {
            console.log("openDoor received key:", data.key);
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            console.log("PLAYER:", playerId);
            if (!playerId) return;
            const player = this.state.players.get(playerId);
            console.log("dungeonId:", player.dungeonId);
            console.log("DUNGEONS KEYS:", [...this.dungeons.keys()]);
            if (!player) return;
            const dungeon = this.dungeons.get(player.dungeonId) ?? this.dungeons.get(Number(player.dungeonId));
            console.log("depth:", player.depth);
            console.log("dungeon exists:", !!dungeon);
            if (!dungeon) return;
            const level = dungeon.levels[String(player.depth)] 
                   ?? dungeon.levels[Object.keys(dungeon.levels).find(k => dungeon.levels[k].depth === player.depth)];
            if (!level?.doors) return;
            console.log("levels:", Object.keys(dungeon.levels));
            const doorState = level.doors[data.key];
            console.log("matched doorState:", doorState);
            if (!doorState) return;
            
            if (doorState.lockType === "key" && doorState.keyNumber > 0) {
                if (!data.hasKey) {
                    client.send("doorLocked", {
                        key: data.key,
                        keyNumber: doorState.keyNumber
                    });
                    return;
                }
            }
            
            if (doorState.state === "closed") {
                doorState.state = "open";
                doorState.closed = false;
            }
            client.send("doorUpdate", {
                key: data.key,
                dungeonId: player.dungeonId,
                depth: player.depth,
                state: doorState.state,
                closed: doorState.closed,
                x: doorState.x,
                y: doorState.y
            });
        });

        
        // Replace the broken client-side handlers with these server-side ones:
        this.onMessage("requestCombat", (client, message) => {
            console.log("⚔️ requestCombat received:", message);
            const { attackerId, targetId } = message;
            const combatId = `${attackerId}_${targetId}_${Date.now()}`;
            const combat = new CombatCore(this, combatId);
            this.activeCombats.set(combatId, combat);
            const playerState = this.state.players.get(attackerId);
            const enemyState  = this.state.enemies.get(targetId);
            if (enemyState) enemyState.inCombat = 1;
            combat.addActor(attackerId, {
                combat:    message.playerSnapshot.combat,
                defence:  message.playerSnapshot.defence,
                strength: message.playerSnapshot.strength,
                wDamage:  message.playerSnapshot.wDamage,
                weaponType: message.playerSnapshot.weaponType,
                shieldValue:   message.playerSnapshot.shieldArmor,
                armour:   message.playerSnapshot.armour
            }, "player");
        
           combat.addActor(targetId, {
                combat:    enemyState?.attac ?? 5,
                defence:  enemyState?.defence ?? 5,
                strength: enemyState?.strength ?? 3,
                wDamage:  enemyState?.wDamage ?? 2,
                armour:   enemyState.armour
            }, "enemy");
        
            combat.setTarget(attackerId, targetId);
            combat.setTarget(targetId, attackerId);
            combat.startCombat();
        });
        
        this.onMessage("combatActionFinished", (client, msg) => {
            const actorId = msg.actorId;
            for (const combat of this.activeCombats.values()) {
                if (combat.actors.has(actorId)) {
                    combat.onActorAnimationFinished(actorId);
                    break;
                }
            }
        });
        
        this.onMessage("enemyReachedTarget", (client, data) => {
            console.log(">>> enemyReachedTarget RICEVUTO per enemy:", data.enemyId);
            const logic = this.enemyInstances.get(data.enemyId);
            const schemaEnemy = this.state.enemies.get(data.enemyId);
            if (!logic || !schemaEnemy) return;
            if (schemaEnemy.inCombat === 1) return;
            // 1️⃣ aggiorna logica AI
            logic.updatePositionFromClient(data.pos);
        
            // 2️⃣ aggiorna posizione reale nello state
            schemaEnemy.pos.x = data.pos.x;
            schemaEnemy.pos.z = data.pos.z;
            // 2️⃣ ferma la destinazione AI
            logic.destination = null;
            // 3️⃣ pulisci destinazione
            schemaEnemy.destX = data.pos.x;
            schemaEnemy.destZ = data.pos.z;
        });
        
        this.onMessage("lootEnemy", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const player = this.state.players.get(playerId); // ← ADD THIS
            const enemy = this.state.enemies.get(data.enemyId);
            if (!enemy || !enemy.isDead || !enemy.lootReady) return;
            if (enemy.ownerId !== playerId && enemy.ownerId !== player?.partyId) return;
            this.giveQuestLoot(playerId, enemy);
            // rimuovi body
            this.state.enemies.delete(enemy.id);
            // cleanup spawn tracking
            const ownerMap = this.activeQuestSpawns.get(enemy.ownerId);
            if (ownerMap) ownerMap.delete(enemy.questId);
        });

        this.onMessage("startQuest", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const questId = data.questId;
            const questConfig = {
                type: data.enemyType,
                x: data.spawnX,
                z: data.spawnZ,
                localMap: data.localMap,
                dungeonId: data.dungeonId,
                depth: data.depth
            };
            this.spawnQuestEnemy(playerId, questId, questConfig);
        });
        
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

        this.setSimulationInterval((deltaTime) => {
            const playersMap = {};
            this.state.players.forEach((player, id) => { playersMap[id] = player; });
            this.enemyInstances.forEach((logic, id) => {
                const schemaEnemy = this.state.enemies.get(id);
                if (!schemaEnemy) return;
                if (schemaEnemy.inCombat === 1) return; 
                let hasNearbyPlayer = false;
                this.state.players.forEach((p) => {
                    if (String(p.dungeonId) === String(schemaEnemy.dungeonId) &&
                        p.depth === schemaEnemy.depth) {
                        hasNearbyPlayer = true;
                    }
                });
                if (!hasNearbyPlayer) return;
                const result = logic.update(playersMap, deltaTime / 1000, this);
                if (!result) return;
            
                // aggiorna destinazione
                if (logic.destination) {
                    schemaEnemy.destX = logic.destination.x;
                    schemaEnemy.destZ = logic.destination.z;
                }
            
                schemaEnemy.aiState = result.state || schemaEnemy.aiState;
                schemaEnemy.currentAnim = result.anim || schemaEnemy.currentAnim;
            });
        }, 1000 / 20); // 20 tick al secondo
        
        setInterval(() => {
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
            if (Date.now() - this.lastWeatherChange > this.weatherInterval || this.start===true) {
                this.start=false;
                this.lastWeatherChange = Date.now();
                const roll = Math.floor(Math.random() * 10) + 1;
                if (roll <= 5) {
                    world.weather = "sunny";
                } else if (roll <= 8) {
                    world.weather = "rain";
                } else {
                    world.weather = "snow";
                }
                console.log(world.weather);
                this.broadcast("network:world:update", this.state.world);
                this.broadcast("weatherUpdate", {
                    weather: world.weather,
                    timeOfDay: world.timeOfDay,
                    isDay: world.isDay
                });
            }
        }, 10000);

        this.onMessage("enemyTarget", (client, data) => {
            const enemy = this.enemyInstances.get(data.enemyId);
            if (!enemy) return;
        
            enemy.setTarget(data.playerId, data.pos);
        });

        this.onMessage("enemyAggro", (client, data) => {
            const schemaEnemy = this.state.enemies.get(data.enemyId);
            const logic = this.enemyInstances.get(data.enemyId);
            if (!schemaEnemy || !logic) return;
        
            schemaEnemy.destX = data.destX;
            schemaEnemy.destZ = data.destZ;
            schemaEnemy.aiState = "aggro";
        
            logic.leaderId = this.sessionToPlayerId.get(client.sessionId);
            logic.destination = { x: data.destX, z: data.destZ };
        });

        this.onMessage("spawnEnemy", (client, data) => {
            this.spawnEnemy(
                data.type,
                data.x,
                data.z,
                {
                    localMap: data.localMap ?? 0,
                    dungeonId: data.dungeonId ?? "",
                    depth: data.depth ?? 0
                }
            );
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

            const quantize = (v) => Math.round(v * 10) / 10;
            const newX = quantize(pos.x);
            const newZ = quantize(pos.z);
            // aggiorna solo se cambia davvero (soglia 0.1)
            if (Math.abs(player.playerPos.x - newX) > 0.1) {
                player.playerPos.x = newX;
            }
            if (Math.abs(player.playerPos.z - newZ) > 0.1) {
                player.playerPos.z = newZ;
            }
            // opzionale: fissa Y se non ti serve
            player.playerPos.y = player.playerPos.y ?? 0;
            const newRotY = quantize(rot.y);
            // aggiorna solo se cambia davvero
            if (Math.abs(player.rotation.y - newRotY) > 0.1) {
                player.rotation.x = rot.x; // opzionale, spesso non serve
                player.rotation.y = newRotY;
                player.rotation.z = rot.z; // opzionale
                player.rotation.w = rot.w; // opzionale
            }
            player.texTure = data.texTure ?? player.texTure;
            player.activeWeapon = data.activeWeapon ?? player.activeWeapon;
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
        
                //console.log(`❌ Character ${charId} deleted successfully`);
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

    createDungeon(dungeonId) {
        const config = dungeonConfig.Dungeons.find(d => d.id === dungeonId);
        if (!config) return null;
    
        const dungeon = {
            id: config.id,
            name: config.Name,
            levels: {},           // ogni livello verrà creato quando serve
            config: config
        };
    
        this.state.dungeons.set(dungeonId, dungeon);
        return dungeon;
    }
    
    createLevel(config, level, dungeonId, depth, seed) {
        ROT.RNG.setSeed(seed);
        const generated = this.generateUniformMap(config, seed);
        const occupied = new Set();
        const newLevel = {
            dungeonId,
            depth: depth,
            seed: seed,
            map: generated.map,
            freeCells: generated.freeCells,
            rooms: generated.rooms,
            doors: {},
            enemies: [],
            loot: {},
            furnitures: {},
            entrance: null,
            exit: null
        };
        // Entrance
        const entrance = this.placeEntrance(newLevel);
        if (entrance) {
            entrance.dungeonId = dungeonId;
            entrance.depth = depth;
            newLevel.entrance = entrance;
            occupied.add(`${entrance.x},${entrance.y}`);
        }
        // Exit
        const exit = this.placeExit(newLevel, level, config, entrance); 
        if (exit) {
            exit.dungeonId = dungeonId;       // linked
            exit.depth = depth;
            newLevel.exit = exit;
            occupied.add(`${exit.x},${exit.y}`);
        }
        // Doors
        if (config.Doors) {
            const generatedDoors = this.generateDoors(newLevel, config);
            newLevel.doors = {};
            for (const key in generatedDoors) {
                const d = generatedDoors[key];
                const doorState = new DoorState();
                doorState.x = d.x;
                doorState.y = d.y;
                doorState.closed = d.closed;
                doorState.orientation = d.orientation;
                doorState.lockType = d.lockType;    // ← add this
                doorState.keyNumber = d.keyNumber;  // ← add this
                newLevel.doors[key] = doorState;
                occupied.add(key);
            }
        }
        // Furnitures — use config.furniture (not furnitureCount)
        newLevel.furnitures = this.generateFurnitures(newLevel, config, occupied);
        // Loot — use config.loot (not lootCount)
        newLevel.loot = this.generateLoot(newLevel, config, occupied);
        // Enemies — spawn using config.Enemy and config.enemies count
        if (config.enemies > 0) {
            const enemyTypes = Object.keys(enemyStats);
            for (let i = 0; i < config.enemies; i++) {
                const enemyType = config.Enemy || enemyTypes[Math.floor(ROT.RNG.getUniform() * enemyTypes.length)];
                const cell = this.getRandomCellInRoom(newLevel);
                if (!cell) continue;
                const [x, y] = cell.split(",").map(Number);
                const key = `${x},${y}`;
                if (occupied.has(key)) continue;
                occupied.add(key);
                const enemyId = this.spawnEnemy(enemyType, x, y, {
                    localMap: 0,
                    dungeonId: String(dungeonId),
                    depth: depth
                });
                newLevel.enemies.push(enemyId);
            }
        }
        return newLevel;
    }

    async onJoin(client, options) {
        const playerId = options.playerId;
        if (!playerId) return client.leave();

        this.sessionToPlayerId.set(client.sessionId, playerId);

        const player = new PlayerState();
        player.id = playerId;

        const DEFAULT_SLOTS = ["HELM", "ARMOUR", "WEAPON", "WEAPON2", "SHIELD", "SHIELD2", "GLOVES", "BOOTS", "CLOAK", "NECK", "RING", "ITEM", "FAST1", "FAST2", "FAST3", "FAST4"];
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
                player.user = data.user ?? player.user;
                player.email = data.email ?? player.email;
                player.name = data.name ?? player.name;
                player.race = data.race ?? player.race;
                player.sex = data.sex ?? player.sex;
                player.anim = data.anim ?? player.anim;
                player.speed = data.speed ?? player.speed;
                player.texTure = data.texTure ?? player.texTure;
                player.activeWeapon = data.activeWeapon ?? player.activeWeapon;
                player.localMap = data.localMap ?? 0;
                player.depth = data.depth ?? 0;
                player.dungeonId = data.dungeonId ?? "";

                if (data.playerPos) {
                    const quantize = (v) => Math.round(v * 10) / 10;
                
                    const x = quantize(data.playerPos.x);
                    const z = quantize(data.playerPos.z);
                
                    if (Math.abs(player.playerPos.x - x) > 0.1) player.playerPos.x = x;
                    if (Math.abs(player.playerPos.z - z) > 0.1) player.playerPos.z = z;
                    player.playerPos.y = player.playerPos.y ?? 0;
                }
                
                if (data.rotation) {
                    const quantize = (v) => Math.round(v * 10) / 10;
                    const y = quantize(data.rotation.y);
                
                    if (Math.abs(player.rotation.y - y) > 0.1) {
                        player.rotation.y = y;
                    }
                }

                if (data.equipped && typeof data.equipped === "object" && !Array.isArray(data.equipped)) {
                    Object.entries(data.equipped).forEach(([slot, raw]) => {
                        if (!raw || raw === 0) return;
                        const item = new EquippedItem();
                        item.name        = raw.name        ?? "";
                        item.lootID      = Number(raw.lootID)      || 0;
                        item.damageValue = Number(raw.damageValue)  || 0;
                        item.armourValue = Number(raw.armourValue)  || 0;
                        item.resistence  = Number(raw.resistence)   || 0;
                        item.variable    = Number(raw.variable)     || 0;
                        item.obj         = raw.obj         ?? "";
                        item.slot        = slot;
                        item.twohand     = !!raw.twohand;
                        item.type        = raw.type        ?? "";
                        item.value       = Number(raw.value)        || 0;
                        item.special     = raw.special     ?? "";
                        player.equipped.slots.set(slot, item);
                    });
                } else if (data.equipped && Array.isArray(data.equipped)) {
                    data.equipped.forEach(raw => {
                        const item = new EquippedItem();
                        const slotKey = raw.slot?.toUpperCase() || raw.type?.toUpperCase() || "ITEM";
                        item.name        = raw.name        ?? "";
                        item.lootID      = Number(raw.lootID)      || 0;
                        item.damageValue = Number(raw.damageValue)  || 0;
                        item.armourValue = Number(raw.armourValue)  || 0;
                        item.resistence  = Number(raw.resistence || raw.durability) || 0;
                        item.variable    = Number(raw.variable)     || 0;
                        item.obj         = raw.obj         ?? "";
                        item.slot        = slotKey;
                        item.twohand     = !!raw.twohand;
                        item.type        = raw.type        ?? "";
                        item.value       = Number(raw.value)        || 0;
                        item.special     = raw.special     ?? "";
                        player.equipped.slots.set(slotKey, item);
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






































