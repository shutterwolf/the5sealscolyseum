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
    }
}

type({ map: PlayerState })(MyRoomState.prototype, "players");
type({ map: EnemySchema })(MyRoomState.prototype, "enemies"); // 👈
type(WorldState)(MyRoomState.prototype, "world");
type([ChatMessage])(MyRoomState.prototype, "chat");

// --- Room ---
class MyRoom extends Room {
    maxClients = 40;
    placeEntrance(levelData) {
        const rooms = levelData.rooms;
        if (!rooms || rooms.length === 0) return null;
    
        const room = rooms[Math.floor(Math.random() * rooms.length)];
    
        const x = Math.floor(Math.random() * (room.width - 2)) + room.x + 1;
        const y = Math.floor(Math.random() * (room.height - 2)) + room.y + 1;
    
        return { x, y };
    }

    placeExit(levelData, levelIndex, dungeonConfig) {
        const maxLevels = dungeonConfig.Levels;
    
        if (maxLevels <= 1) return null;
        if (levelIndex >= maxLevels - 1) return null;
    
        const rooms = levelData.rooms;
        if (!rooms || rooms.length === 0) return null;
    
        const room = rooms[Math.floor(Math.random() * rooms.length)];
    
        const x = Math.floor(Math.random() * (room.width - 2)) + room.x + 1;
        const y = Math.floor(Math.random() * (room.height - 2)) + room.y + 1;
    
        return { x, y };
    }

    generateDoors(levelData, map, config) {
        const doors = {};
        if (!config.Doors) return doors;
        let count = 0;
        const maxDoors = config.maxDoors || Math.floor(levelData.freeCells.length * 0.02);
        const saveDoor = (x, y) => {
            if (count >= maxDoors) return;
            const key = `${x},${y}`;
            // evita porte adiacenti
            if (
                doors[`${x+1},${y}`] ||
                doors[`${x-1},${y}`] ||
                doors[`${x},${y+1}`] ||
                doors[`${x},${y-1}`]
            ) {
                return;
            }
            // deve essere pavimento
            if (map[key] !== ".") return;
            // controllo muri attorno (stessa logica client)
            const up = map[`${x},${y+1}`];
            const down = map[`${x},${y-1}`];
            const left = map[`${x-1},${y}`];
            const right = map[`${x+1},${y}`];
            if (
                (up === "." || down === ".") &&
                (left === "." || right === ".")
            ) {
                return;
            }
            // stessa logica client: tra due muri opposti
            const vertical = (up === "#" && down === "#");
            const horizontal = (left === "#" && right === "#");
            if (!(vertical || horizontal)) return;
            doors[key] = {
                x,
                y,
                closed: true,
                orientation: vertical ? "vertical" : "horizontal"
            };
            count++;
        };
    
        // 🔥 QUI LA DIFFERENZA FONDAMENTALE
        const rooms = levelData.rooms;
        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            // ⚠️ importante: stesso sistema del client
            if (room.getDoors) {
                room.getDoors(saveDoor);
            } else {
                // fallback manuale se serve
                const minX = room.x + 1;
                const maxX = room.x + room.width - 2;
                const minY = room.y + 1;
                const maxY = room.y + room.height - 2;
    
                for (let x = minX; x <= maxX; x++) {
                    for (let y = minY; y <= maxY; y++) {
                        saveDoor(x, y);
                    }
                }
            }
        }
    
        return doors;
    }
    
    generateFurnitures(levelData, config, occupied = new Set()) {
    const furnitures = [];
        const count = config.furniture || 10;
    
        for (let i = 0; i < count; i++) {
    
            for (let attempt = 0; attempt < 10; attempt++) {
    
                const a = Math.floor(Math.random() * 5);
    
                let type = "table";
                if (a === 1 || a === 4) type = "column";
                if (a === 2) type = "bookcase";
    
                const key = this.getRandomCellInRoom(levelData);
                if (!key) continue;
    
                if (occupied.has(key)) continue;
                if (levelData.doors && levelData.doors[key]) continue;
    
                const [x, y] = key.split(",").map(Number);
    
                // controlli spazio
                if (
                    levelData.map[`${x},${y+1}`] !== 0 ||
                    levelData.map[`${x},${y-1}`] !== 0 ||
                    levelData.map[`${x+1},${y}`] !== 0 ||
                    levelData.map[`${x-1},${y}`] !== 0
                ) continue;
    
                let rotation = levelData.map[`${x},${y-1}`] === "." ? 180 : 0;
    
                furnitures.push({
                    x,
                    y,
                    type,
                    rotation
                });
    
                occupied.add(key);
                break;
            }
        }
    
        return furnitures;
    }

    generateLoot(levelData, config, occupied = new Set()) {
        const loots = [];
        const count = config.loot || 5;
    
        for (let i = 0; i < count; i++) {
    
            for (let attempt = 0; attempt < 10; attempt++) {
    
                const key = this.getRandomCellInRoom(levelData);
                if (!key) continue;
    
                if (occupied.has(key)) continue;
                if (levelData.doors && levelData.doors[key]) continue;
    
                const [x, y] = key.split(",").map(Number);
    
                // opzionale: evita spawn vicino ai muri
                if (
                    levelData.map[`${x},${y+1}`] !== 0 ||
                    levelData.map[`${x},${y-1}`] !== 0 ||
                    levelData.map[`${x+1},${y}`] !== 0 ||
                    levelData.map[`${x-1},${y}`] !== 0
                ) continue;
    
                loots.push({
                    x,
                    y,
                    type: "chest"
                });
    
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
    
            const room = rooms[Math.floor(Math.random() * rooms.length)];
    
            const minX = room.x + 1;
            const maxX = room.x + room.width - 2;
    
            const minY = room.y + 1;
            const maxY = room.y + room.height - 2;
    
            if (maxX < minX || maxY < minY) continue;
    
            const x = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
            const y = Math.floor(Math.random() * (maxY - minY + 1)) + minY;
    
            const key = `${x},${y}`;
    
            if (levelData.map[key] !== ".") continue;
            if (levelData.doors && levelData.doors[key]) continue;
    
            return key;
        }
    
        return null;
    }
    
    generateUniformMap(dungeonConfig, seed) {
        const width = dungeonConfig.dunWidth;
        const height = dungeonConfig.dunHeight;
        // 🔑 Seed deterministico
        ROT.RNG.setSeed(seed);
        const map = {};
        const freeCells = [];
        const roomsData = [];
        const doors = {};
        // 🗺️ Generatore
        const mapGen = new ROT.Map.Digger(width, height, {
            roomWidth: [dungeonConfig.xroom, dungeonConfig.xroom + 2],
            roomHeight: [dungeonConfig.yroom, dungeonConfig.yroom + 2],
            corridorLength: [2, 10],
            dugPercentage: dungeonConfig.dug
        });
        // 🧱 Creazione mappa
        mapGen.create((x, y, value) => {
            const key = `${x},${y}`;
            // value: 0 = floor, 1 = wall
            if (value === 0) {
                map[key] = ".";
                freeCells.push({ x, y });
            } else {
                map[key] = "#";
            }
        });
        // 🏠 Recupero stanze
        const rooms = mapGen.getRooms();
        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            roomsData.push({
                x: room.getLeft(),
                y: room.getTop(),
                width: room.getRight() - room.getLeft() + 1,
                height: room.getBottom() - room.getTop() + 1
            });
            // 🚪 Gestione porte (solo se abilitate)
            /*if (dungeonConfig.Doors === true) {
                room.getDoors((x, y) => {
                    const key = `${x},${y}`;
                    // evita porte duplicate
                    if (!doors[key]) {
                        doors[key] = { closed: true };
                        // rimuovi dalle freeCells
                        for (let i = 0; i < freeCells.length; i++) {
                            if (freeCells[i].x === x && freeCells[i].y === y) {
                                freeCells.splice(i, 1);
                                break;
                            }
                        }
                    }
                });
            }*/
        }
        // 🔥 risultato completo
        return {
            map,
            freeCells,
            rooms: roomsData,
            doors
        };
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
        enemy.questId = "";
    
        enemy.isDead = false;
        enemy.lootReady = false;
    
        this.state.enemies.set(id, enemy);
    
        const logic = new EnemyServer({
            id: id,
            enemy: type,
            posX: x,
            posY: enemy.pos.y,
            posZ: z,
            dungeon: !!config.dungeonId
        });
    
        this.enemyInstances.set(id, logic);
    
        return id;
    }

    spawnQuestEnemy(ownerId, questId, config) {
        // ownerId: singolo playerId o partyId (es. "P-00014")
        // questId: id della quest
        // config: { type, x, z, localMap, dungeonId, depth }

        const id = "E" + this.enemyIdCounter++;

        const stats = enemyStats[config.type];
        if (!stats) {
            console.error("Enemy type non trovato in enemyStats:", config.type);
            return null;
        }
        const enemy = new EnemySchema();
        enemy.id = id;
        enemy.type = config.type;
        enemy.typeId = stats.id;         // ✅ derivato dal server
        enemy.pos.x = config.x;
        enemy.pos.y = 3;                 // altezza sicura
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
    
        // zone / map
        enemy.localMap = config.localMap ?? 0;
        enemy.dungeonId = config.dungeonId ?? "";
        enemy.depth = config.depth ?? 0;
    
        // quest / owner
        enemy.ownerId = ownerId;
        enemy.questId = questId;
    
        enemy.isDead = false;
        enemy.lootReady = false;
    
        this.state.enemies.set(id, enemy);
    
        // 2️⃣ Logica server (EnemyHandler)
        const logic = new EnemyServer({
            id: id,
            enemy: config.type,
            posX: config.x,
            posY: 3,
            posZ: config.z,
            dungeon: !!config.dungeonId
        });
        this.enemyInstances.set(id, logic);
    
        // 3️⃣ Salva riferimento per cleanup / respawn
        if (!this.activeQuestSpawns.has(ownerId)) {
            this.activeQuestSpawns.set(ownerId, new Map());
        }
        this.activeQuestSpawns.get(ownerId).set(questId, id);
    
        console.log("▶ spawnQuestEnemy chiamato:", id, config.type);
    
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
                    const config = dungeonConfig.Dungeons.find(d => d.id === dungeonId);
                    if (!config || !config.Enemy) return;
                    // Count enemies currently alive in this dungeon level
                    let currentCount = 0;
                    this.state.enemies.forEach((enemy) => {
                        if (String(enemy.dungeonId) === String(dungeonId) &&
                            enemy.depth === Number(levelKey)+1 &&
                            !enemy.isDead) {
                            currentCount++;
                        }
                    });
                    // Only respawn if below the max cap for this dungeon
                    if (currentCount >= config.enemies) {
                        console.log(`Dungeon ${dungeonId} level ${levelKey} already at max enemies (${config.enemies}), skipping respawn`);
                        return;
                    }
                    // Pick a random free cell to respawn at
                    const key = this.getRandomCellInRoom(levelData);
                    if (!key) return;
                    const [x, y] = key.split(",").map(Number);
                    this.spawnEnemy(config.Enemy, x, y, {
                        localMap: 0,
                        dungeonId: String(dungeonId),
                        depth: Number(levelKey)
                    });
                    console.log(`Respawned 1 ${config.Enemy} in dungeon ${dungeonId} level ${levelKey} (${currentCount + 1}/${config.enemies})`);
                });
            });
        }, 30 * 60 * 1000);
        // ─── Loot respawn: 1 chest per active dungeon level every hour ───
        setInterval(async () => {
            for (const [dungeonId, dungeon] of this.dungeons) {
                for (const [levelKey, levelData] of Object.entries(dungeon.levels)) {
                    // Find a free cell not already occupied by loot or doors
                    let placed = false;
                    for (let attempt = 0; attempt < 20; attempt++) {
                        const key = this.getRandomCellInRoom(levelData);
                        if (!key) continue;
                        const alreadyLoot = levelData.loot.some(l => `${l.x},${l.y}` === key);
                        if (alreadyLoot) continue;
                        if (levelData.doors && levelData.doors[key]) continue;
                        const [x, y] = key.split(",").map(Number);
                        const newChest = {
                            x, y,
                            type: "chest",
                            dungeonId: String(dungeonId),
                            depth: Number(levelKey)
                        };
                        levelData.loot.push(newChest);
                        placed = true;
                        // Notify players currently in this dungeon level
                        this.state.players.forEach((player, playerId) => {
                            if (String(player.dungeonId) === String(dungeonId) && player.depth === Number(levelKey)) {
                                const client = this.clients.find(c => this.sessionToPlayerId.get(c.sessionId) === playerId);
                                if (client) client.send("lootSpawned", newChest);
                            }
                        });
                        // Save updated loot list to Firestore
                        try {
                            await db.collection("dungeons").doc(`${dungeonId}_${levelKey}`).update({
                                loot: levelData.loot
                            });
                            console.log(`New chest added to dungeon ${dungeonId} level ${levelKey}`);
                        } catch (err) {
                            console.error("Failed to save new loot:", err);
                        }
                        break;
                    }
                }
            }
        }, 60 * 60 * 1000); // 1 hour
        
        
        this.onMessage("requestSpawnEnemies", (client, data) => {
            console.log("🔔 requestSpawnEnemies ricevuto");
            console.log("Client sessionId:", client.sessionId);
            console.log("Data ricevuta:", data);
        
            const { questID, enemyType, startPos, num } = data;
            console.log("Parsed questID:", questID);
            console.log("Parsed enemyType:", enemyType);
            console.log("Parsed startPos:", startPos);
            console.log("Parsed num:", num);
        
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) {
                console.warn("Player non trovato per session:", client.sessionId);
                return;
            }
        
            for (let i = 0; i < num; i++) {
                const enemyID = this.spawnQuestEnemy(
                    playerId,
                    questID,
                    {
                        type: enemyType,
                        x: startPos.x + i, // offset per non sovrapporre
                        z: startPos.z,
                        localMap: 0,
                        dungeonId: "",
                        depth: 0
                    }
                );
        
                if (!enemyID) {
                    console.error("Spawn fallito per enemyType:", enemyType);
                } else {
                    console.log("✅ Enemy spawnato:", enemyType, enemyID);
                }
            }
        });

        this.onMessage("enterDungeon", async (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;
            //console.log("RAW DATA:", JSON.stringify(data));
            const config = dungeonConfig.Dungeons.find(d => d.Name === data.name);
            if (!config) {
                console.warn("Dungeon not found:", data.name);
                return;
            }
        
            const dungeonId = config.id;
            const level = data.level ?? 0;
            const depthFromData = data.depth;
            
            console.log("Depth FROM DATA:", depthFromData);
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
                        const depth = data.depth ?? level;
                        dungeon.levels[lvlKey] = this.createLevel(config, level, dungeonId, depth, seed);
                        console.log(`Loaded dungeon ${docId} from Firestore`);
                    } else {
                        const seed = Math.floor(Math.random() * 1e9);
                        const depth = level;
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
                    dungeon.levels[lvlKey] = this.createLevel(config, level, dungeonId, depth, seed);
                }
            }
            const levelData = dungeon.levels[lvlKey];
            const depth = levelData.depth ?? level; // 🔥 FIX
            const player = this.state.players.get(playerId);
            if (player) {
                player.dungeonId = String(dungeonId);
                player.depth = depth;
            }
            //console.log(levelData)
            client.send("loadDungeon", {
                dungeonId,
                level,
                depth,
                dungeonConfig,
                state: levelData
            });
        });;
        
        // Replace the broken client-side handlers with these server-side ones:
        this.onMessage("requestCombat", (client, message) => {
            console.log("⚔️ requestCombat received:", message);
            const { attackerId, targetId } = message;
            const combatId = `${attackerId}_${targetId}_${Date.now()}`;
            const combat = new CombatCore(this, combatId);
            this.activeCombats.set(combatId, combat);
            const playerState = this.state.players.get(attackerId);
            const enemyState  = this.state.enemies.get(targetId);
            if (enemyState) enemyState.inCombat = 1;   // ← add here, after the existing declaration
            combat.addActor(attackerId, {
                combat:   playerState?.combat   ?? 5,
                defence:  playerState?.defence  ?? 5,
                strength: playerState?.strength ?? 3,
                wDamage:  playerState?.wDamage  ?? 2
            }, "player");
        
            combat.addActor(targetId, {
                combat:   enemyState?.combat   ?? 5,
                defence:  enemyState?.defence  ?? 5,
                strength: enemyState?.strength ?? 3,
                wDamage:  enemyState?.wDamage  ?? 2
            }, "enemy");
        
            combat.setTarget(attackerId, targetId);
            combat.setTarget(targetId, attackerId);
            combat.startCombat();
        });;
        
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

        this.onMessage("enemyTarget", (client, data) => {
            const enemy = this.enemyInstances.get(data.enemyId);
            if (!enemy) return;
        
            enemy.setTarget(data.playerId, data.pos);
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
            dungeonId,          // ← explicitly linked
            depth: depth,     
            seed: seed,// ← explicitly linked
            map: generated.map,
            freeCells: generated.freeCells,
            rooms: generated.rooms,
            doors: {},
            enemies: [],
            loot: [],
            furnitures: [],
            entrance: null,
            exit: null
        };
        // Entrance
        const entrance = this.placeEntrance(newLevel);
        if (entrance) {
            entrance.dungeonId = dungeonId;   // linked
            entrance.depth = depth;
            newLevel.entrance = entrance;
            occupied.add(`${entrance.x},${entrance.y}`);
        }
        // Exit
        const exit = this.placeExit(newLevel, level, config);
        if (exit) {
            exit.dungeonId = dungeonId;       // linked
            exit.depth = depth;
            newLevel.exit = exit;
            occupied.add(`${exit.x},${exit.y}`);
        }
        // Doors
        if (config.Doors) {
            newLevel.doors = this.generateDoors(newLevel, newLevel.map, config);
        }
        // Furnitures — use config.furniture (not furnitureCount)
        newLevel.furnitures = this.generateFurnitures(newLevel, config, occupied);
        // Loot — use config.loot (not lootCount)
        newLevel.loot = this.generateLoot(newLevel, config, occupied);
        // Enemies — spawn using config.Enemy and config.enemies count
        if (config.Enemy && config.enemies > 0) {
            for (let i = 0; i < config.enemies; i++) {
                const cell = newLevel.freeCells[
                    Math.floor(ROT.RNG.getUniform() * newLevel.freeCells.length)
                ];     
                if (!cell) continue;
                const key = `${cell.x},${cell.y}`;
                if (occupied.has(key)) continue;
                occupied.add(key);
                const enemyId = this.spawnEnemy(config.Enemy, cell.x, cell.y, {
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

                if (data.equipped && Array.isArray(data.equipped)) {
                    data.equipped.forEach(raw => {
                        const item = new EquippedItem();
                
                        // ❌ Chiave dello slot: usa type se esiste
                        const slotKey = raw.type?.toUpperCase() || `SLOT_${raw.slot}`;
                        item.name= raw.name;
                        item.lootID = Number(raw.lootID) || 0;
                        item.damageValue = Number(raw.damageValue) || 0;
                        item.armourValue = Number(raw.armourValue) || 0;
                        item.resistence = Number(raw.durability) || 0;
                        item.variable=Number(raw.variable) || 0;
                        item.obj = raw.obj ?? "";
                        item.slot = slotKey; // Colyseus vuole stringa
                        item.twohand = !!raw.twohand;
                        item.type = raw.type ?? "";
                        item.value = Number(raw.value) || 0;
                        item.special = raw.special ?? "";
                
                        // 🔹 Inserisce nell’equipped MapSchema
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






































