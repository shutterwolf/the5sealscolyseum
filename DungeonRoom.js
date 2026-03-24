import { Room } from "colyseus";

export class DungeonRoom extends Room {

    onCreate(options) {
        this.setState({
            dungeons: {}
        });

        console.log("DungeonRoom created");

        // Tick per respawn dinamico
        this.setSimulationInterval(() => this.update(), 1000);
    }

    // =========================
    // PLAYER ENTER DUNGEON
    // =========================
    onJoin(client, options) {
        console.log(client.sessionId, "joined");
    }

    onMessage("enterDungeon", async (client, data) => {
        const { dungeonId, level } = data;

        let dungeon = this.state.dungeons[dungeonId];

        // 🧠 CREATE ON REQUEST
        if (!dungeon) {
            dungeon = this.createDungeon(dungeonId);
            this.state.dungeons[dungeonId] = dungeon;
        }

        // 🧱 Se il livello non esiste → crealo
        if (!dungeon.levels[level]) {
            dungeon.levels[level] = this.createLevel(dungeon.seed, level);
        }

        // 📤 invia dati al client
        client.send("loadDungeon", {
            dungeonId,
            seed: dungeon.seed,
            level,
            state: dungeon.levels[level]
        });
    });

    // =========================
    // CREAZIONE DUNGEON
    // =========================
    createDungeon(dungeonId) {
        const dungeonData = dungeonConfig.Dungeons.find(d => d.id === dungeonId);
        if (!dungeonData) throw new Error("Dungeon ID non trovato");
    
        return {
            id: dungeonId,
            name: dungeonData.Name,
            levels: {},
            config: dungeonData,
            createdAt: Date.now()
        };
    }

    // =========================
    // CREAZIONE LEVEL
    // =========================
    createLevel(dungeonConfig, levelNum) {
        return {
            enemies: this.generateEnemies(levelNum, dungeonConfig.enemies, dungeonConfig.Enemy),
            loot: this.generateLoot(levelNum, dungeonConfig.loot),
            doors: this.generateDoors(levelNum, dungeonConfig.Doors),
            furnitures: this.generateFurnitures(levelNum, dungeonConfig.furniture),
            width: dungeonConfig.dunWidth,
            height: dungeonConfig.dunHeight,
            roomWidth: dungeonConfig.xroom,
            roomHeight: dungeonConfig.yroom,
            dugPercentage: dungeonConfig.dug,
            entrance: { x: 3, y: 3 },  // puoi renderlo random o statico
            exit: { x: dungeonConfig.dunWidth - 3, y: dungeonConfig.dunHeight - 3 },
            lastRespawn: Date.now()
        };
    }

    // =========================
    // GENERAZIONE DINAMICA
    // =========================
    generateEnemies(level, count, type) {
        const enemies = {};
        for (let i = 0; i < count; i++) {
            const x = Math.floor(Math.random() * 50); // oppure usare width del dungeon
            const y = Math.floor(Math.random() * 50); // oppure usare height del dungeon
            const key = `${x},${y}`;
    
            // evita sovrapposizioni
            if (enemies[key]) {
                i--;
                continue;
            }
    
            enemies[key] = {
                type: type || "default",
                alive: true,
                lastAttacked: null,
                entityId: null // riferimento lato client
            };
        }
        return enemies;
    }
    
    generateLoot(level, count) {
        const loot = {};
        for (let i = 0; i < count; i++) {
            const x = Math.floor(Math.random() * 50);
            const y = Math.floor(Math.random() * 50);
            const key = `${x},${y}`;
    
            if (loot[key]) {
                i--;
                continue;
            }
    
            loot[key] = {
                opened: false,
                contents: [], // puoi aggiungere oggetti qui
                entityId: null
            };
        }
        return loot;
    }
    
    generateDoors(level, hasDoors) {
        const doors = {};
        if (!hasDoors) return doors;
    
        const doorCount = Math.floor(Math.random() * 5) + 3; // 3-7 porte
        for (let i = 0; i < doorCount; i++) {
            const x = Math.floor(Math.random() * 50);
            const y = Math.floor(Math.random() * 50);
            const key = `${x},${y}`;
    
            if (doors[key]) {
                i--;
                continue;
            }
    
            doors[key] = {
                locked: false,
                entityId: null
            };
        }
        return doors;
    }
    
    generateFurnitures(level, count) {
        const furnitures = {};
        const types = ["table", "column", "bookcase"];
    
        for (let i = 0; i < count; i++) {
            const x = Math.floor(Math.random() * 50);
            const y = Math.floor(Math.random() * 50);
            const key = `${x},${y}`;
    
            if (furnitures[key]) {
                i--;
                continue;
            }
    
            const type = types[Math.floor(Math.random() * types.length)];
    
            furnitures[key] = {
                type: type,
                active: true, // se il player lo distrugge o sposta diventa false
                entityId: null
            };
        }
        return furnitures;
    }
    
    generateEntranceExit(levelData, dungeonConfig) {
        // semplice esempio: angoli opposti
        levelData.entrance = {
            x: 1 + Math.floor(Math.random() * 3), 
            y: 1 + Math.floor(Math.random() * 3)
        };
    
        levelData.exit = {
            x: dungeonConfig.dunWidth - 2 - Math.floor(Math.random() * 3),
            y: dungeonConfig.dunHeight - 2 - Math.floor(Math.random() * 3)
        };
    }
    // =========================
    // AZIONI CLIENT
    // =========================
    onMessage("enemyKilled", (client, data) => {
        const { dungeonId, level, key } = data;
        const dungeon = this.state.dungeons[dungeonId];
        if (!dungeon) return;

        const enemy = dungeon.levels[level].enemies[key];
        if (enemy) enemy.alive = false;
    });

    onMessage("lootOpened", (client, data) => {
        const { dungeonId, level, key } = data;
        const dungeon = this.state.dungeons[dungeonId];
        if (!dungeon) return;

        const loot = dungeon.levels[level].loot[key];
        if (loot) loot.opened = true;
    });

    onMessage("doorChanged", (client, data) => {
        const { dungeonId, level, key, locked } = data;
        const dungeon = this.state.dungeons[dungeonId];
        if (!dungeon) return;

        const door = dungeon.levels[level].doors[key];
        if (door) door.locked = locked;
    });

    onMessage("furnitureChanged", (client, data) => {
        const { dungeonId, level, key, active } = data;
        const dungeon = this.state.dungeons[dungeonId];
        if (!dungeon) return;

        const furn = dungeon.levels[level].furnitures[key];
        if (furn) furn.active = active;
    });

    // =========================
    // RESPAWN IBIDO
    // =========================
    update() {
        const now = Date.now();

        for (let dungeonId in this.state.dungeons) {
            const dungeon = this.state.dungeons[dungeonId];

            for (let levelId in dungeon.levels) {
                const level = dungeon.levels[levelId];

                // ogni 10 minuti respawna 1-2 nemici morti
                if (now - level.lastRespawn > 600000) {
                    this.respawnEnemies(level);
                    level.lastRespawn = now;
                }
            }
        }
    }

    respawnEnemies(level) {
        let respawnCount = 2;
        for (let key in level.enemies) {
            if (!level.enemies[key].alive && respawnCount > 0) {
                level.enemies[key].alive = true;
                respawnCount--;
            }
        }
    }

    // =========================
    // PULIZIA
    // =========================
    onLeave(client) {
        console.log(client.sessionId, "left");
    }

    onDispose() {
        console.log("DungeonRoom disposed");
    }
}
}
