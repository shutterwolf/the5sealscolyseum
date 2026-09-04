// MyRoom.js
const { Room } = require("colyseus");
const fs = require("fs");
const ROT = require("rot-js");
const CombatCore = require("./combatCore");
const enemyStats = require("./enemyStats");
const EnemyServer = require("./EnemyHandler");
const { db } = require("./db");
const {
    Vec3, Quat, DoorState,
    EquippedItem, Equipped,
    PlayerState, ChatMessage,
    EnemySchema, PreySchema, MyRoomState
} = require("./schemas");
const { SPECIAL } = require("./specials");
const PUZZLE_TEMPLATES = require("./puzzleTemplates");
const { PuzzleRoomInjector } = require("./puzzleInjector");
const loreTexts = require("./loreTexts.json");
const dungeonConfig = JSON.parse(fs.readFileSync("Dungeons.json"));

const COMBAT_TRACE = true;
function combatTrace(stage, data = {}) {
    if (!COMBAT_TRACE) return;
    console.log(`[COMBAT][${new Date().toISOString()}][${stage}]`, data);
}

const PREY_CONFIG = {
    deer: {
        speed: 2.5,
        radius: 6,
        wanderRange: 5,
        maxHealth: 15,
        idleAnim: "deer-idle.json",
        walkAnim: "deer-run.json",
        deathAnim: "doe.json"
    },

    chicken: {
        speed: 3.5,
        radius: 4,
        wanderRange: 7,
        maxHealth: 8,
        idleAnim: "chicken-idle.json",
        walkAnim: "chicken-run.json",
        deathAnim: "chicken-death.json"
    }
};

function getPreyConfig(type) {
    return PREY_CONFIG[String(type || "deer").toLowerCase()] ||
           PREY_CONFIG.deer;
}
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

    getRoomContaining(x, y, rooms) {
        for (var i = 0; i < rooms.length; i++) {
            var room = rooms[i];
            if (x >= room.getLeft() && x <= room.getRight() &&
                y >= room.getTop()  && y <= room.getBottom()) {
                return room;
            }
        }
        return null;
    }

    checkPuzzleSolution(level) {
      const p = level.puzzle;
      if (!p || p.solved) return;
      const sol = p.solution;
      if (!sol) return;
    
      if (sol.type === "lever_sequence") {
        const allCorrect = sol.required.every(pid => {
          const e = Object.values(p.entities).find(x => x.puzzleId === pid);
          return e?.active === true;
        });
    
        if (allCorrect) {
          p.solved = true;
          // Apri tutte le porte puzzle
          for (const key in level.doors) {
            const d = level.doors[key];
            if (d.lockType === "puzzle") {
              d.closed = false;
              d.state = "open";
            }
          }
          this.broadcastToLevel(level.dungeonId, String(level.depth), "puzzleSolved", {
            templateId: p.templateId
          });
        }
      }
    }
    
    getEligibleEnemyTypes(depth) {
        var maxTier;
        if (depth <= 2) {
            maxTier = 1;
        } else if (depth <= 4) {
            maxTier = 2;
        } else {
            maxTier = 3;
        }
        return Object.keys(enemyStats).filter(function(type) {
            return enemyStats[type].DunLevel <= maxTier && enemyStats[type].id !== 3;
        });
    }

    findCombatByActor(actorId) {
        for (const combat of this.activeCombats.values()) {
            if (combat.actors.has(actorId)) {
                return combat;
            }
        }
        return null;
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

    spawnPrey(type = "deer", x = 0, z = 0, config = {}) {
        const preyType = String(type || "deer").toLowerCase();
        const cfg = getPreyConfig(preyType);
        const townId = Number(config.townId ?? config.localMap ?? 0);
        const id = `prey_town_${townId}`;
    
        const existingId = this.activePreyByTown.get(townId);
        if (existingId && this.state.preys.has(existingId)) {
            return existingId;
        }
    
        const prey = new PreySchema();
        prey.id = id;
        prey.townId = townId;
        prey.type = preyType;
        prey.x = Number(x) || 0;
        prey.z = Number(z) || 0;
        prey.originX = prey.x;
        prey.originZ = prey.z;
        prey.localMap = config.localMap ?? townId;
        prey.dungeonId = config.dungeonId ?? "";
        prey.depth = config.depth ?? 0;
        prey.speed = config.speed ?? cfg.speed;
        prey.radius = config.radius ?? cfg.radius;
        prey.wanderRange = config.wanderRange ?? cfg.wanderRange;
        prey.maxHealth = config.maxHealth ?? cfg.maxHealth;
        prey.health = prey.maxHealth;
        prey.aiState = "idle";
        prey.currentAnim = cfg.idleAnim;
        prey.isDead = false;
        prey.lootReady = false;
        this.state.preys.set(id, prey);
        this.activePreyByTown.set(townId, id);
    
        this.preyInstances.set(id, {
            destX: prey.x,
            destZ: prey.z,
            idleTimer: 0,
            nextAttackAt: 0,
            originX: prey.x,
            originZ: prey.z
        });
    
        return id;
    }

    generateDoors(levelData, config) {
        const doors = {};
        if (!config.Doors) return doors;
        const rooms = levelData.rooms;
        if (!rooms || rooms.length === 0) return doors;
        const maxDoors = config.maxDoors || 999;
        let count = 0;
        let doorIndex = 0;
        const saveDoor = (x, y) => {
            if (count >= maxDoors) return;
            const key = `${x},${y}`;
            if (
                doors[`${x+1},${y}`] ||
                doors[`${x-1},${y}`] ||
                doors[`${x},${y+1}`] ||
                doors[`${x},${y-1}`]
            ) return;
    
            if (levelData.map[key] !== ".") return;
    
            const up    = levelData.map[`${x},${y+1}`];
            const down  = levelData.map[`${x},${y-1}`];
            const left  = levelData.map[`${x-1},${y}`];
            const right = levelData.map[`${x+1},${y}`];
            const vertical   = (up === "#" && down === "#");
            const horizontal = (left === "#" && right === "#");
            if (!(vertical || horizontal)) return;
            doorIndex++;
            const isLocked = (doorIndex % 10 === 0);
            doors[key] = {
                x,
                y,
                closed: true,
                lockType: isLocked ? "key" : "none",
                keyNumber: isLocked ? 1 : 0,
                triggerId: 0,
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
                furnitures[key] = { x, y, type, rotation };
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
                loots[key] = { x, y, type: "chest" };
                occupied.add(key);
                break;
            }
        }
        return loots;
    }

    getRandomCorridorCell(levelData) {
        const cells = levelData.freeCells.filter(key => {
            const [x, y] = key.split(",").map(Number);
            const room = this.getRoomContaining(x, y, levelData.rooms);
            return !room;
        });
        if (cells.length === 0) return null;
        return cells[Math.floor(ROT.RNG.getUniform() * cells.length)];
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
            corridorLength: [1, 3],
            dugPercentage: dungeonConfig.dug
        });
    
        mapGen.create((x, y, value) => {
            const key = `${x},${y}`;
            if (value === 0) {
                map[key] = ".";
                freeCells.push(key);
            } else {
                map[key] = "#";
            }
        });
        const rooms = mapGen.getRooms();
        for (const room of rooms) {
            roomsData.push(room);
        }
        return { map, freeCells, rooms: roomsData };
    }
    
    spawnEnemy(type, x, z, config = {}) {
        const id = "E" + this.enemyIdCounter++;
        const enemy = new EnemySchema();
        const stats = enemyStats[type];
        const combatStats = {
            combat: stats.attac ?? stats.combat ?? 0,
            defence: stats.defence ?? 0,
            strength: stats.strength ?? 5,
            wDamage: stats.wDamage ?? 2,
            armour: stats.armor ?? stats.armour ?? 0
        };
        enemy.id = id;
        enemy.typeId = stats.id;
        enemy.type = type;
        enemy.pos.x = x;
        enemy.pos.y = 5;
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
        enemy.combat = stats.attac;
        enemy.armour = stats.armor;
        enemy.maxHealth = stats.maxHealth;
        enemy.ownerId = "";
        enemy.questId = config.questId ?? -1;
        enemy.isDead = false;
        enemy.lootReady = false;
        this.state.enemies.set(id, enemy);
        const logic = new EnemyServer({
            id: id,
            enemy: type,
            posX: x,
            posY: 3,
            posZ: z,
            dungeon: !!config.dungeonId,
            localMap: config.localMap ?? 0,
            depth: config.depth ?? 0,
            aggroRange: enemyStats[type]?.radius ?? 5,
            speed: enemyStats[type]?.enemyspeed ?? 1,
            radius: enemyStats[type]?.radius ?? 5
        });
        this.enemyInstances.set(id, logic);
        return id;
    }

    spawnQuestEnemy(ownerId, questId, config) {
        const id = "E" + this.enemyIdCounter++;
        const stats = enemyStats[config.type];
        const combatStats = {
            combat: stats.attac ?? stats.combat ?? 0,
            defence: stats.defence ?? 0,
            strength: stats.strength ?? 5,
            wDamage: stats.wDamage ?? 2,
            armour: stats.armor ?? stats.armour ?? 0
        };
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
        enemy.combat = stats.attac;
        enemy.armour = stats.armor;
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
    
    onCreate(options) {
        console.log("Room created");
        this.sessionToPlayerId = new Map();
        this.setState(new MyRoomState());
        console.log("[SERVER SCHEMA CHECK]", {
            hasPlayers: !!this.state.players,
            hasEnemies: !!this.state.enemies,
            hasPreys: !!this.state.preys,
            enemiesType: this.state.enemies?.constructor?.name,
            preysType: this.state.preys?.constructor?.name
        });
        this.dayDuration = 30 * 60 * 1000;
        this.nightDuration = 15 * 60 * 1000;
        this.weatherInterval = 10 * 60 * 1000;
        this.lastWeatherChange = Date.now();
        this.start = true;
        this.activeCombats = new Map();
        this.nextCombatId = 1;    
        this.enemyLogic = new Map();
        this.enemyInstances = new Map();
        this.enemyIdCounter = 1;
        this.activeQuestSpawns = new Map();
        this.dungeons = new Map();
        this.commonRoomCache = new Map();
        this.activePreyByTown = new Map();
        this.preyInstances = new Map();
        // ─── WORLD EVENT MANAGER ───
        this.worldEventManager = options.worldEventManager || global.worldEventManager;
        if (this.worldEventManager) {
            this.worldEventManager.addRoom(this);
            console.log("[MyRoom] WorldEventManager collegato");
        }

        // ── Il client comunica un colpo alla preda ──
        this.onMessage("preyHit", (client, data = {}) => {
            const preyId = String(data.preyId || "");
            const prey = this.state.preys.get(preyId);
            if (!prey || prey.isDead) return;
        
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const player = this.state.players.get(playerId);
            if (!player) return;
        
            // 1. VALIDAZIONE DISTANZA (Anti-Cheat)
            const dx = Number(player.playerPos.x) - prey.x;
            const dz = Number(player.playerPos.z) - prey.z;
            const distSq = dx * dx + dz * dz;
            if (distSq > 16.0) { // Distanza massima 4 unità al quadrato
                console.warn(`[ANTI-CHEAT] Player ${playerId} tried to hit prey ${preyId} from too far away.`);
                return;
            }
        
            // 2. VALIDAZIONE COOLDOWN (Anti-Spam)
            const now = Date.now();
            if (!player.lastPreyHitTime) player.lastPreyHitTime = 0;
            if (now - player.lastPreyHitTime < 500) { // Minimo 500ms tra i colpi
                return; 
            }
            player.lastPreyHitTime = now;
        
            // 3. CALCOLO DANNO LATO SERVER (Opzionale ma consigliato)
            // Per ora usiamo il danno del client ma con un hard cap severo, 
            // in futuro qui leggerai il danno dall'arma equipaggiata in player.equipped
            const rawDamage = Number(data.damage) || 1;
            const MAX_PREY_HIT_DAMAGE = 20;
            const damage = Math.min(Math.floor(rawDamage), MAX_PREY_HIT_DAMAGE);
            if (damage <= 0) return;
        
            // 4. APPLICA DANNO
            prey.health = Math.max(0, prey.health - damage);
        
            if (prey.health <= 0) {
                prey.health = 0;
                prey.isDead = true;
                prey.lootReady = false;
                prey.aiState = "dead";
                // L'animazione di morte verrà gestita dal client ascoltando il cambio di stato
                
                setTimeout(() => {
                    const current = this.state.preys.get(prey.id);
                    if (!current || !current.isDead) return;
                    current.lootReady = true;
                    current.aiState = "corpse";
                }, 3000);
            }
        });
        
        // ── Il client chiede il loot della preda ──
        this.onMessage("lootPrey", (client, data = {}) => {
            const prey = this.state.preys.get(String(data.preyId || ""));
            if (!prey || !prey.isDead || !prey.lootReady) return;
        
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const player = this.state.players.get(playerId);
            if (!player) return;
        
            if (String(player.dungeonId) !== String(prey.dungeonId)) return;
            if (Number(player.depth) !== Number(prey.depth)) return;
            if (Number(player.localMap) !== Number(prey.localMap)) return;
        
            const dx = Number(player.playerPos.x) - prey.x;
            const dz = Number(player.playerPos.z) - prey.z;
            if (Math.sqrt(dx * dx + dz * dz) > 4) return;
        
            // La preda resta nello schema per il respawn.
            prey.lootReady = false;
        
            client.send("preyLootSuccess", {
                preyId: prey.id,
                townId: prey.townId,
                type: prey.type
            });
        });

        // ─── Prey respawn check (ogni 30s) ───
        setInterval(() => {
            const NOW = Date.now();
            const RESPAWN_DELAY = 5 * 60 * 1000; // 5 minuti
        
            this.state.preys.forEach((prey, id) => {
                if (!prey.isDead) return;
                if (NOW - prey.deathTime < RESPAWN_DELAY) return;
        
                // Respawn nella posizione originale
                prey.x = prey.originX;
                prey.z = prey.originZ;
                prey.health = prey.maxHealth;
                prey.isDead = false;
                prey.lootReady = false;
                prey.aiState = "idle";
                prey.currentAnim = getPreyConfig(prey.type).idleAnim;
                prey.deathTime = 0;
        
                // Reset dello stato AI interno
                const inst = this.preyInstances.get(id);
        
                if (inst) {
                    inst.destX = prey.originX;
                    inst.destZ = prey.originZ;
                    inst.idleTimer = 0;
                    inst.nextAttackAt = 0;
                }
        
                // Notifica i client nella stessa mappa
                this.state.players.forEach((p, pid) => {
                    if (p.localMap !== prey.localMap) return;
        
                    const c = this.clients.find(cl =>
                        this.sessionToPlayerId.get(cl.sessionId) === pid
                    );
        
                    if (!c) return;
        
                    c.send("preyRespawn", {
                        id: prey.id,
                        townId: prey.townId,
                        type: prey.type,
                        x: prey.x,
                        z: prey.z,
                        health: prey.health,
                        maxHealth: prey.maxHealth,
                        currentAnim: prey.currentAnim
                    });
                });
            });
        }, 30 * 1000);
        
        // --- IDLE LOGIC ---
        setInterval(() => {
            this.dungeons.forEach((dungeon, dungeonId) => {
                Object.entries(dungeon.levels).forEach(([levelKey, levelData]) => {
                    const config = dungeonConfig.Dungeons.find(d => String(d.id) === String(dungeonId));
                    if (!config) return;
                    const eligibleTypes = this.getEligibleEnemyTypes(Number(levelKey));
                    const enemyType = config.Enemy || eligibleTypes[Math.floor(Math.random() * eligibleTypes.length)];
                    let currentCount = 0;
                    this.state.enemies.forEach((enemy) => {
                        if (String(enemy.dungeonId) === String(dungeonId) &&
                            enemy.depth === Number(levelKey) &&
                            !enemy.isDead) {
                            currentCount++;
                        }
                    });
                    if (currentCount >= config.enemies) return;
                    const key = this.getRandomCellInRoom(levelData);
                    if (!key) return;
                    if (key in levelData.loot) return;
                    if (key in levelData.furnitures) return;
                    const [x, y] = key.split(",").map(Number);
                    this.spawnEnemy(enemyType, x, y, {
                        localMap: 0,
                        dungeonId: String(dungeonId),
                        depth: Number(levelKey)
                    });
                });
            });
        }, 30 * 60 * 1000);

        // ─── Loot respawn ───
        setInterval(async () => {
            for (const [dungeonId, dungeon] of this.dungeons) {
                for (const [levelKey, levelData] of Object.entries(dungeon.levels)) {
                    let placed = false;
                    for (let attempt = 0; attempt < 20; attempt++) {
                        const key = this.getRandomCellInRoom(levelData);
                        if (!key) continue;
                        const alreadyLoot = key in levelData.loot;
                        if (alreadyLoot) continue;
                        if (levelData.doors && levelData.doors[key]) continue;
                        const [x, y] = key.split(",").map(Number);
                        const newChest = {
                            x, y,
                            type: "chest",
                            dungeonId: String(dungeonId),
                            depth: Number(levelKey)
                        };
                        levelData.loot[key] = newChest;
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
            delete level.loot[data.key];           
            console.log(`[CHEST] Success! Broadcasting chestOpened for key: ${data.key}`);
            this.broadcastToLevel(player.dungeonId, String(player.depth), "chestOpened", {
                key: data.key
            });
        });

        const COMMON_ROOM_NPCS = JSON.parse(
            fs.readFileSync(__dirname + '/commonRoomNpcs.json', 'utf8')
        ).commonRoomNpcs;

        this.onMessage("interactSpecial", (client, data) => {
          const playerId = this.sessionToPlayerId.get(client.sessionId);
          if (!playerId) return;
          const player = this.state.players.get(playerId);
          if (!player) return;
        
          const dungeon = this.dungeons.get(player.dungeonId) ?? this.dungeons.get(Number(player.dungeonId));
          if (!dungeon) return;
          const level = dungeon.levels[String(player.depth)];
          if (!level?.puzzle) return;
        
          const ent = level.puzzle.entities[data.key];
          if (!ent) return;
        
         // ─── LEGGIO ───
        if (ent.type === SPECIAL.LECTERN) {
            const lang = player.lang || "en";
            const entry = loreTexts[ent.textId]?.[lang];
            
            if (entry) {
                client.send("showText", {
                    title: entry.title,
                    text: entry.text,
                    lang: lang
                });
            } else {
                // Fallback se manca la traduzione
                client.send("showText", {
                    title: ent.title || "Note",
                    text: ent.textId,
                    lang: "en"
                });
            }
            return;
        }
        
          // ─── PIEDISTALLO ───
          if (ent.type === SPECIAL.PEDESTAL) {
            if (ent.active) {
              client.send("pedestalReject", { message: "C'è già un oggetto qui." });
              return;
            }
            const item = data.item; // oggetto selezionato dal client
            if (item === ent.requiredItem) {
              ent.active = true;
              ent.placedItem = item;
              ent.state = "active";
              this.broadcastToLevel(player.dungeonId, String(player.depth), "specialUpdate", {
                key: data.key,
                state: "active",
                placedItem: item
              });
              this.checkPuzzleSolution(level);
            } else {
              client.send("pedestalReject", { required: ent.requiredItem });
            }
            return;
          }
        
          // ─── LEVA ───
          if (ent.type === SPECIAL.LEVER) {
            ent.state = (ent.state === "down") ? "up" : "down";
            ent.active = (ent.state === "up");
            this.broadcastToLevel(player.dungeonId, String(player.depth), "specialUpdate", {
              key: data.key,
              state: ent.state,
              active: ent.active
            });
            this.checkPuzzleSolution(level);
            return;
          }
        });
        
        this.onMessage("getCommonRoomNpcs", (client, data) => {
            const townId = Number(data.townId);
            const now = Date.now();
            const CACHE_TTL = 5 * 60 * 1000;
            const MIN_NPCS = 2;
            const MAX_NPCS = 4;
            let cacheEntry = this.commonRoomCache.get(townId);
            if (!cacheEntry || (now - cacheEntry.timestamp) > CACHE_TTL) {
                let pool = COMMON_ROOM_NPCS.filter(function(n) {
                    return n.townId === townId;
                });
                if (pool.length === 0) {
                    client.send("commonRoomNpcs", { npcs: [] });
                    return;
                }
                for (var i = pool.length - 1; i > 0; i--) {
                    var j = Math.floor(Math.random() * (i + 1));
                    var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
                }
                const count = Math.floor(Math.random() * (MAX_NPCS - MIN_NPCS + 1)) + MIN_NPCS;
                const selected = pool.slice(0, Math.min(count, pool.length));
                cacheEntry = { npcs: selected, timestamp: now };
                this.commonRoomCache.set(townId, cacheEntry);
            }
            client.send("commonRoomNpcs", { npcs: cacheEntry.npcs });
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
            const config = dungeonConfig.Dungeons.find(d => d.Name === data.name);
            if (!config) {
                console.warn("Dungeon not found:", data, client);
                return;
            }
            console.log("ENTER DUNGEON DATA:", data);
            const dungeonId = config.id;
            let level = data.level ?? 1;
            let depth = data.depth ?? level;
            const docId = `${dungeonId}_${level}`;
            if (!this.dungeons.has(dungeonId)) {
                this.dungeons.set(dungeonId, { id: dungeonId, levels: {} });
            }
            const dungeon = this.dungeons.get(dungeonId);
            const lvlKey = String(level);
            if (!dungeon.levels[lvlKey]) {
                try {
                    const doc = await db.collection("dungeons").doc(docId).get();
                    if (doc.exists) {
                        const docData = doc.data();
                        const seed = docData.seed;
                        let depth = docData.depth ?? level;
                        dungeon.levels[lvlKey] = this.createLevel(config, level, dungeonId, depth, seed);
                    } else {
                        const seed = Math.floor(Math.random() * 1e9);
                        const dungeonLevel = level;
                        depth = dungeonLevel;
                        dungeon.levels[lvlKey] = this.createLevel(config, level, dungeonId, depth, seed);
                        const toSave = { seed, dungeonId, level, depth };
                        await db.collection("dungeons").doc(docId).set(toSave, { merge: true });
                        console.log(`Saved dungeon ${docId} to Firestore`);
                    }
                } catch (err) {
                    console.error("Firestore dungeon error:", err);
                    const seed = Math.floor(Math.random() * 1e9);
                    let depth = level;
                    dungeon.levels[lvlKey] = this.createLevel(config, level, dungeonId, depth, seed);
                }
            }
        
            const levelData = dungeon.levels[lvlKey];
            let currentCount = 0;
            this.state.enemies.forEach((enemy) => {
                if (String(enemy.dungeonId) === String(dungeonId) &&
                    enemy.depth === Number(lvlKey) &&
                    !enemy.isDead) {
                    currentCount++;
                }
            });
            if (currentCount < config.enemies) {
                const eligibleTypes = this.getEligibleEnemyTypes(Number(lvlKey));
                const enemyType = config.Enemy || eligibleTypes[Math.floor(Math.random() * eligibleTypes.length)];
                const toSpawn = config.enemies - currentCount;
                for (let i = 0; i < toSpawn; i++) {
                    const key = this.getRandomCellInRoom(levelData);
                    if (!key) continue;
                    if (key in levelData.loot) continue;
                    if (key in levelData.furnitures) continue;
                    const [ex, ey] = key.split(",").map(Number);
                    this.spawnEnemy(enemyType, ex, ey, {
                        localMap: 0,
                        dungeonId: String(dungeonId),
                        depth: Number(lvlKey)
                    });
                }
            }
        
            const player = this.state.players.get(playerId);
            console.log("Dati player", dungeonId, depth);
            if (player) {
                player.dungeonId = String(dungeonId);
                player.depth = depth;
            }
            const enemySnapshot = [];
            this.state.enemies.forEach((e, eid) => {
                if (String(e.dungeonId) === String(dungeonId) &&
                    e.depth === Number(lvlKey) &&
                    !e.isDead) {
                    enemySnapshot.push({
                        id: e.id,
                        type: e.type,
                        typeId: e.typeId,
                        pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
                        health: e.health,
                        maxHealth: e.maxHealth,
                        aiState: e.aiState,
                        currentAnim: e.currentAnim,
                        dungeonId: e.dungeonId,
                        depth: e.depth,
                        isDead: e.isDead,
                        speed: e.speed,
                        radius: e.radius,
                        wRange: e.wRange,
                        combat: e.combat,
                        armour: e.armour,
                        questId: e.questId,
                        ownerId: e.ownerId
                    });
                }
            });
            console.log(`[loadDungeon] sending ${enemySnapshot.length} enemies to client for dungeon ${dungeonId} depth ${depth}`);
            client.send("loadDungeon", {
                dungeonConfig: config,
                dungeonId,
                level,
                depth,
                map: levelData.map,
                doors: levelData.doors,
                furnitures: levelData.furnitures,
                loot: levelData.loot,
                entrance: levelData.entrance,
                exit: levelData.exit,
                enemies: enemySnapshot,
                puzzle: levelData.puzzle
            });
        });

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
        
        this.onMessage("requestCombat", (client, message) => {
            const { attackerId, targetId } = message;
            combatTrace("REQUEST", { attackerId, targetId, message });
            const playerState = this.state.players.get(attackerId);
            const enemyState = this.state.enemies.get(targetId);
            combatTrace("STATE_LOOKUP", {
                attackerId,
                targetId,
                hasPlayer: !!playerState,
                hasEnemy: !!enemyState,
                enemyType: enemyState?.type
            });
            if (!playerState || !enemyState) return;
            const es = enemyStats[enemyState.type] || {};

            const attackerCombat = this.findCombatByActor(attackerId);
            const targetCombat = this.findCombatByActor(targetId);

            if (attackerCombat && targetCombat && attackerCombat !== targetCombat) {
                console.log(`[COMBAT MERGE] Merging ${targetCombat.combatId} into ${attackerCombat.combatId}`);
                for (const [id, actorData] of targetCombat.actors) {
                    if (!attackerCombat.actors.has(id)) {
                        const stats = {
                            hp: actorData.hp,
                            maxHp: actorData.maxHealth,
                            combat: actorData.combat,
                            defence: actorData.defence,
                            strength: actorData.strength,
                            wDamage: actorData.wDamage,
                            weaponType: actorData.weaponType,
                            shieldArmor: actorData.shield,
                            armour: actorData.armour
                        };
                        attackerCombat.addActor(id, stats, actorData.type);
                    }
                }
                for (const [id, actorData] of targetCombat.actors) {
                    if (actorData.targetId && attackerCombat.actors.has(actorData.targetId)) {
                        attackerCombat.setTarget(id, actorData.targetId);
                    }
                }
                targetCombat.quietDispose();
            }

            const existingCombat = attackerCombat || targetCombat;

            if (existingCombat) {
                if (!existingCombat.actors.has(attackerId)) {
                    existingCombat.addActor(attackerId, {
                        hp: message.hp,
                        maxHp: message.maxHp,
                        combat: message.combat,
                        defence: message.defence,
                        strength: message.strength,
                        wDamage: message.wDamage,
                        weaponType: message.weaponType,
                        shieldArmor: message.shieldArmor,
                        armour: message.armour
                    }, "player");
                    playerState.inCombat = 1;
                }
                if (!existingCombat.actors.has(targetId)) {
                    existingCombat.addActor(targetId, {
                        hp: message.enemyHp ?? enemyState.health,
                        combat: es.attac ?? es.combat ?? 5,
                        defence: es.defence ?? 5,
                        strength: es.strength ?? 3,
                        wDamage: es.wDamage ?? 1,
                        armour: es.armor ?? 0
                    }, "enemy");
                    enemyState.inCombat = 1;
                }
                existingCombat.setTarget(attackerId, targetId);
                const targetActor = existingCombat.actors.get(targetId);
                if (targetActor && !targetActor.targetId) {
                    existingCombat.setTarget(targetId, attackerId);
                }
                combatTrace("JOIN_EXISTING", {
                    combatId: existingCombat.combatId,
                    attackerId,
                    targetId,
                    totalActors: existingCombat.actors.size
                });
                return;
            }

            const combatId = `${attackerId}_${targetId}_${Date.now()}`;
            const combat = new CombatCore(this, combatId);
            this.activeCombats.set(combatId, combat);
            enemyState.inCombat = 1;
            playerState.inCombat = 1;
            combat.addActor(attackerId, {
                hp: message.hp,
                maxHp: message.maxHp,
                combat: message.combat,
                defence: message.defence,
                strength: message.strength,
                wDamage: message.wDamage,
                weaponType: message.weaponType,
                shieldArmor: message.shieldArmor,
                armour: message.armour
            });
            combat.addActor(targetId, {
                hp: message.enemyHp ?? enemyState.health,
                combat: es.attac ?? es.combat ?? 5,
                defence: es.defence ?? 5,
                strength: es.strength ?? 3,
                wDamage: es.wDamage ?? 1,
                armour: es.armor ?? 0
            }, "enemy");
            combat.setTarget(attackerId, targetId);
            combat.setTarget(targetId, attackerId);
            combatTrace("START", { combatId, attackerId, targetId });
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
            logic.updatePositionFromClient(data.pos);
            schemaEnemy.pos.x = data.pos.x;
            schemaEnemy.pos.z = data.pos.z;
            logic.destination = null;
            logic.targetPlayer = null; 
            logic.leaderId = null;
            schemaEnemy.destX = data.pos.x;
            schemaEnemy.destZ = data.pos.z;
            schemaEnemy.aiState = "idle";
            schemaEnemy.currentAnim = "idle";
        });
        
        this.onMessage("lootEnemy", (client, data) => {
            console.log("[lootEnemy RAW STATE]", {
                enemy: this.state.enemies.get(data.enemyId),
                allEnemies: [...this.state.enemies.keys()]
            });
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            console.log("[lootEnemy] resolved playerId:", playerId);
            const player = this.state.players.get(playerId);
            if (!player) {
                console.warn("[lootEnemy] player not found", playerId);
            } else {
                console.log("[lootEnemy] player found", { id: playerId, partyId: player.partyId });
            }
            const enemy = this.state.enemies.get(data.enemyId);
            console.log("[lootEnemy FLAGS]", { isDead: enemy?.isDead, lootReady: enemy?.lootReady });
            if (!enemy) {
                console.warn("[lootEnemy] enemy not found", data.enemyId);
                return;
            }
            console.log("[lootEnemy] enemy state", {
                id: enemy.id,
                isDead: enemy.isDead,
                lootReady: enemy.lootReady,
                ownerId: enemy.ownerId,
                questId: enemy.questId
            });
            if (!enemy.isDead) {
                console.warn("[lootEnemy] enemy is not dead");
                return;
            }
            if (!enemy.lootReady) {
                console.warn("[lootEnemy] loot not ready");
                return;
            }
            const allowed =
                !enemy.ownerId ||
                enemy.ownerId === playerId ||
                enemy.ownerId === player?.partyId;
            console.log("[lootEnemy] permission check", {
                enemyOwner: enemy.ownerId,
                playerId: playerId,
                playerPartyId: player?.partyId,
                allowed
            });
            if (!allowed) {
                console.warn("[lootEnemy] loot denied");
                return;
            }

            // ─── WORLD EVENT: report siege kill (usa cache in memoria, no Firestore) ───
            if (this.worldEventManager && enemy.questId === -1) {
                const playerCity = (player.dungeonId === "" || player.dungeonId == null)
                    ? String(player.localMap ?? "")
                    : null;
                if (playerCity) {
                    const events = [...this.worldEventManager.activeEvents.values()];
                    for (const evt of events) {
                        if (evt.type === "siege" && String(evt.targetCity) === playerCity) {
                            this.worldEventManager.reportEnemyKill(playerId, evt.eventId, 1)
                                .catch(e => console.error("[MyRoom] reportEnemyKill failed:", e));
                        }
                    }
                }
            }

            console.log("[lootEnemy] deleting enemy from state", enemy.id);
            this.state.enemies.delete(enemy.id);
            this.enemyInstances.delete(enemy.id);
            const loaderClient = [...this.clients].find(
                c => this.sessionToPlayerId.get(c.sessionId) === playerId
            );
            if (loaderClient) {
                loaderClient.send("lootSuccess", { enemyId: enemy.id, questId: enemy.questId ?? null });
            }
            console.log("[lootEnemy] completed successfully");
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

        // ─── WORLD EVENT MESSAGES ───
        this.onMessage("world:event:joinFaction", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId || !this.worldEventManager) return;
            this.worldEventManager.joinFaction(playerId, data.eventId, data.faction)
                .then(r => client.send("world:event:joined", r))
                .catch(e => client.send("world:event:error", { error: e.message }));
        });

        this.onMessage("world:event:questDone", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId || !this.worldEventManager) return;
            this.worldEventManager.reportQuestComplete(playerId, data.eventId, data.faction)
                .then(r => client.send("world:event:questConfirmed", r))
                .catch(e => client.send("world:event:error", { error: e.message }));
        });

        this.onMessage("world:event:enemyKill", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId || !this.worldEventManager) return;
            this.worldEventManager.reportEnemyKill(playerId, data.eventId, data.count || 1)
                .then(r => client.send("world:event:killConfirmed", r))
                .catch(e => client.send("world:event:error", { error: e.message }));
        });

        this.setSimulationInterval((deltaTime) => {
            // ─── DEBUG: Verifica che il tick parta
            if (this.state.preys.size > 0) {
                console.log(`[SERVER DEBUG] Tick prede attivo. Totale prede: ${this.state.preys.size}`);
            }

            // ─── Prey AI tick ───
            this.state.preys.forEach((prey, id) => {
                if (prey.isDead) return;
            
                const inst = this.preyInstances.get(id);
                if (!inst) return;
            
                // Cerca il player più vicino nella stessa mappa
                let nearest = null;
                let nearestDist = Infinity;
                
                this.state.players.forEach((p) => {
                    // DEBUG: Verifica se le mappe corrispondono
                    if (p.localMap !== prey.localMap) {
                        // console.log(`[SERVER DEBUG] Player ${p.id} (map ${p.localMap}) non corrisponde a Prey ${id} (map ${prey.localMap})`);
                        return;
                    }
                    
                    const dx = p.playerPos.x - prey.x;
                    const dz = p.playerPos.z - prey.z;
                    const d  = Math.sqrt(dx*dx + dz*dz);
                    if (d < nearestDist) { 
                        nearestDist = d; 
                        nearest = p; 
                    }
                });
            
                const FLEE_RADIUS   = prey.radius;   // 6
                const WANDER_RANGE  = prey.wanderRange; // 5
                const SPEED         = prey.speed;    // 2.5
                const dt            = 1 / 20;        // il tuo tick è 20Hz
            
                if (nearest && nearestDist < FLEE_RADIUS) {
                    // ── FUGA ──
                    console.log(`[SERVER DEBUG] PREY ${id} IN FUGA! Distanza dal player: ${nearestDist.toFixed(2)}`);
                    const dx = prey.x - nearest.playerPos.x;
                    const dz = prey.z - nearest.playerPos.z;
                    const len = Math.sqrt(dx*dx + dz*dz) || 1;
                    inst.destX = prey.x + (dx/len) * FLEE_RADIUS;
                    inst.destZ = prey.z + (dz/len) * FLEE_RADIUS;
                    prey.aiState = "walking";
                    prey.currentAnim = "deer-run.json";
                } else {
                    // ── WANDER ──
                    inst.idleTimer -= dt;
                    if (inst.idleTimer <= 0) {
                        inst.idleTimer = 3 + Math.random() * 4; // 3-7s
                        if (Math.random() < 0.4) {
                            console.log(`[SERVER DEBUG] PREY ${id} INIZIA WANDER casuale`);
                            inst.destX = prey.originX + (Math.random() * WANDER_RANGE*2 - WANDER_RANGE);
                            inst.destZ = prey.originZ + (Math.random() * WANDER_RANGE*2 - WANDER_RANGE);
                            prey.aiState = "walking";
                            prey.currentAnim = "deer-run.json";
                        } else {
                            prey.aiState = "idle";
                            prey.currentAnim = "deer-idle.json";
                        }
                    }
                }
            
                // ── Movimento verso destinazione ──
                if (prey.aiState === "walking") {
                    const dx = inst.destX - prey.x;
                    const dz = inst.destZ - prey.z;
                    const dist = Math.sqrt(dx*dx + dz*dz);
                    if (dist < 0.3) {
                        prey.aiState = "idle";
                        prey.currentAnim = "deer-idle.json";
                    } else {
                        prey.x += (dx/dist) * SPEED * dt;
                        prey.z += (dz/dist) * SPEED * dt;
                    }
                }
            
                prey.destX = inst.destX;
                prey.destZ = inst.destZ;
            });
            
            // ... (il resto del tuo codice per i nemici rimane invariato) ...
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
                if (logic.destination) {
                    schemaEnemy.destX = logic.destination.x;
                    schemaEnemy.destZ = logic.destination.z;
                }
                schemaEnemy.aiState = result.state || schemaEnemy.aiState;
                schemaEnemy.currentAnim = result.anim || schemaEnemy.currentAnim;
            });
        
            this.combatDistanceCheckCounter = (this.combatDistanceCheckCounter || 0) + 1;
            if (this.combatDistanceCheckCounter >= 10) {
                this.combatDistanceCheckCounter = 0;
                for (const combat of this.activeCombats.values()) {
                    combat.checkDistances();
                }
            }
        }, 1000 / 20);
        
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
            if (Date.now() - this.lastWeatherChange > this.weatherInterval || this.start === true) {
                this.start = false;
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

        this.onMessage("playerInput", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            console.log("📥 SERVER RECV playerInput from", playerId, "pos=", data.playerPos, "rot=", data.rotation);
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
            if (Math.abs(player.playerPos.x - newX) > 0.1) player.playerPos.x = newX;
            if (Math.abs(player.playerPos.z - newZ) > 0.1) player.playerPos.z = newZ;
            if (Math.abs(player.playerPos.y - pos.y) > 0.1) player.playerPos.y = pos.y;
            player.playerPos.y = player.playerPos.y ?? 0;
            console.log("💾 SERVER SAVE playerInput: playerId=" + playerId, "savedPos=" + player.playerPos.x + "," + player.playerPos.y + "," + player.playerPos.z);
            const newRotY = quantize(rot.y);
            if (Math.abs(player.rotation.y - newRotY) > 0.1) {
                player.rotation.x = rot.x;
                player.rotation.y = newRotY;
                player.rotation.z = rot.z;
                player.rotation.w = rot.w;
            }
            player.texTure = data.texTure ?? player.texTure;
            player.activeWeapon = data.activeWeapon ?? player.activeWeapon;
            if (typeof data.anim === "string") player.anim = data.anim;
            if (typeof data.speed === "number") player.speed = data.speed;
            if (typeof data.localMap === "number" && data.localMap !== player.localMap) player.localMap = data.localMap;
            if (typeof data.depth === "number" && data.depth !== player.depth) player.depth = data.depth;
            if (typeof data.dungeonId === "string" && data.dungeonId !== player.dungeonId) player.dungeonId = data.dungeonId;
        });

        this.onMessage("anim", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const player = this.state.players.get(playerId);
            if (!player) return;
            if (typeof data.anim === "string") player.anim = data.anim;
            if (typeof data.speed === "number") player.speed = data.speed;
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
                console.error("FIRESTORE SAVE ERROR:", err);
                client.send("characterSaved", { ok: false, playerId: data.playerId });
            }
        });

        this.onMessage("deleteCharacter", async (client, message) => {
            const charId = message.id;
            let success = false;
            try {
                await db.collection("characters").doc(charId).delete();
                success = true;
                if (this.state.players.has(charId)) {
                    this.state.players.delete(charId);
                }
            } catch (err) {
                console.error(`❌ Error deleting character ${charId}:`, err);
            }
            client.send("characterDeleted", { id: charId, success });
        });

        this.onMessage("playerInfo", (client, data) => {
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            const player = this.state.players.get(playerId);
            if (!player) return;
            player.name = data.name ?? player.name;
            player.user = data.user ?? player.user;
            player.email = data.email ?? player.email;
            player.id = data.id ?? player.id;
        });

        this.onMessage("sendMessage", (client, message) => {
            if (typeof message !== "string" || message.trim() === "") return;
            const playerId = this.sessionToPlayerId.get(client.sessionId);
            if (!playerId) return;
            const player = this.state.players.get(playerId);
            const name = player?.name || "Anon";
            const msg = new ChatMessage(playerId, name, message.trim(), Date.now());
            this.state.chat.push(msg);
            if (this.state.chat.length > 50) this.state.chat.shift();
            this.broadcast("chatMessage", msg);
        });
    }

    createDungeon(dungeonId) {
        const config = dungeonConfig.Dungeons.find(d => d.id === dungeonId);
        if (!config) return null;
        const dungeon = {
            id: config.id,
            name: config.Name,
            levels: {},
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
            exit: null,
            puzzle: null   // ← NUOVO
          };
        
          // ========== INIEZIONE STANZA ENIGMA ==========
          const injector = new PuzzleRoomInjector(ROT.RNG);
          const puzzleResult = injector.inject(newLevel, PUZZLE_TEMPLATES);
          if (puzzleResult) {
            newLevel.puzzle = puzzleResult.puzzleState;
            // Marchia la stanza come occupata per evitare entrance/exit qui dentro
            for (let rx = puzzleResult.room.getLeft(); rx <= puzzleResult.room.getRight(); rx++) {
              for (let ry = puzzleResult.room.getTop(); ry <= puzzleResult.room.getBottom(); ry++) {
                occupied.add(`${rx},${ry}`);
              }
            }
          }
          // =============================================
        
          const entrance = this.placeEntrance(newLevel);
        if (entrance) {
            entrance.dungeonId = dungeonId;
            entrance.depth = depth;
            newLevel.entrance = entrance;
            occupied.add(`${entrance.x},${entrance.y}`);
        }
        const exit = this.placeExit(newLevel, level, config, entrance); 
        if (exit) {
            exit.dungeonId = dungeonId;
            exit.depth = depth;
            newLevel.exit = exit;
            occupied.add(`${exit.x},${exit.y}`);
        }
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
                doorState.lockType = d.lockType;
                doorState.keyNumber = d.keyNumber;
                newLevel.doors[key] = doorState;
                occupied.add(key);
            }
        }
        newLevel.furnitures = this.generateFurnitures(newLevel, config, occupied);
        newLevel.loot = this.generateLoot(newLevel, config, occupied);

        if (entrance && newLevel.rooms) {
            var entranceRoom = this.getRoomContaining(entrance.x, entrance.y, newLevel.rooms);
            if (entranceRoom) {
                for (var rx = entranceRoom.getLeft(); rx <= entranceRoom.getRight(); rx++) {
                    for (var ry = entranceRoom.getTop(); ry <= entranceRoom.getBottom(); ry++) {
                        occupied.add(rx + "," + ry);
                    }
                }
            }
        }
        if (config.enemies > 0) {
            const eligibleTypes = this.getEligibleEnemyTypes(depth);
            for (let i = 0; i < config.enemies; i++) {
                const enemyType = config.Enemy || eligibleTypes[Math.floor(ROT.RNG.getUniform() * eligibleTypes.length)];
                let placed = false;
                for (let attempt = 0; attempt < 15; attempt++) {
                    const useRoom = ROT.RNG.getUniform() < 0.5;
                    const cell = useRoom
                        ? this.getRandomCellInRoom(newLevel)
                        : this.getRandomCorridorCell(newLevel);
                    if (!cell) continue;
                    if (occupied.has(cell)) continue;
                    const [x, y] = cell.split(",").map(Number);
                    occupied.add(cell);
                    const enemyId = this.spawnEnemy(enemyType, x, y, {
                        localMap: 0,
                        dungeonId: String(dungeonId),
                        depth: depth
                    });
                    newLevel.enemies.push(enemyId);
                    placed = true;
                    break;
                }
                if (!placed) {
                    console.warn(`[createLevel] Could not place enemy ${i} after 15 attempts`);
                }
            }
        }
        return newLevel;
    }

    async onJoin(client, options) {
        const playerId = options.playerId;
        if (!playerId) return client.leave();

        this.sessionToPlayerId.set(client.sessionId, playerId);
        console.log("PLAYER JOIN:", client.sessionId, options);
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
                player.lang = data.lang ?? player.lang;
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
                    console.log("📂 SERVER LOAD from Firestore: playerId=" + playerId, "loadedPos=" + (data.playerPos ? data.playerPos.x+","+data.playerPos.y+","+data.playerPos.z : "NO_POS"));
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
        const currentMap = player.localMap ?? 0;
        if (currentMap === 0 || currentMap === 11) {
            console.log(`[SERVER DEBUG] Tentativo spawn preda per mappa ${currentMap} (Player: ${playerId})`);
            this.spawnPrey("deer", 10, 10, { 
                localMap: currentMap,
                townId: currentMap 
            });
        }
        const equippedData = {};
        player.equipped.slots.forEach((item, slot) => {
            equippedData[slot] = { ...item };
        });
        client.send("fullEquip", { equipped: equippedData });
        client.send("chatInit", this.state.chat.map(msg => ({
            id: msg.id,
            name: msg.name,
            text: msg.text,
            timestamp: msg.timestamp
        })));

        // ─── WORLD EVENT: invia eventi attivi al player che si connette ───
        if (this.worldEventManager) {
            this.worldEventManager.getActiveEvents()
                .then(events => {
                    if (events.length > 0) {
                        client.send("world:activeEvents", events);
                    }
                })
                .catch(err => console.error("[MyRoom] getActiveEvents failed:", err));
        }

        console.log("PLAYER JOIN:", client.sessionId, options);
    }

    onLeave(client) {
        const playerId = this.sessionToPlayerId.get(client.sessionId);
        if (playerId) {
            for (const [combatId, combat] of this.activeCombats) {
                if (combat.actors.has(playerId)) {
                    combat.removeActor(playerId);
                    if (combat.actors.size < 2) {
                        combat.endCombat();
                    }
                    break;
                }
            }
            this.state.players.delete(playerId);
            this.sessionToPlayerId.delete(client.sessionId);
        }
        console.log("Player left:", playerId);
    }

    // ─── WORLD EVENT: rimuovi la room quando viene distrutta, non al leave ───
    onDispose() {
        if (this.worldEventManager) {
            this.worldEventManager.removeRoom(this);
            console.log("[MyRoom] Room rimossa dal WorldEventManager");
        }
    }
}

module.exports = MyRoom;
