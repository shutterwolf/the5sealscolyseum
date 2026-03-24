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
        const seed = Math.floor(Math.random() * 1000000);
        return {
            id: dungeonId,
            seed: seed,
            createdAt: Date.now(),
            levels: {}
        };
    }

    // =========================
    // CREAZIONE LEVEL
    // =========================
    createLevel(seed, level) {
        return {
            enemies: this.generateEnemies(level),
            loot: this.generateLoot(level),
            doors: this.generateDoors(level),
            furnitures: this.generateFurnitures(level),
            entrance: this.generateEntrance(level),
            exit: this.generateExit(level),
            lastRespawn: Date.now()
        };
    }

    // =========================
    // GENERAZIONE DINAMICA
    // =========================
    generateEnemies(level) {
        const enemies = {};
        const count = 20 + level * 2;
        for (let i = 0; i < count; i++) {
            const x = Math.floor(Math.random() * 50);
            const y = Math.floor(Math.random() * 50);
            const key = `${x},${y}`;
            enemies[key] = { type: "goblin", alive: true };
        }
        return enemies;
    }

    generateLoot(level) {
        const loot = {};
        const count = 10;
        for (let i = 0; i < count; i++) {
            const x = Math.floor(Math.random() * 50);
            const y = Math.floor(Math.random() * 50);
            const key = `${x},${y}`;
            loot[key] = { opened: false };
        }
        return loot;
    }

    generateDoors(level) {
        const doors = {};
        const count = 5;
        for (let i = 0; i < count; i++) {
            const x = Math.floor(Math.random() * 50);
            const y = Math.floor(Math.random() * 50);
            const key = `${x},${y}`;
            doors[key] = { locked: Math.random() < 0.2 }; // 20% porte bloccate
        }
        return doors;
    }

    generateFurnitures(level) {
        const furnitures = {};
        const types = ["table", "column", "bookcase"];
        const count = 8;
        for (let i = 0; i < count; i++) {
            const x = Math.floor(Math.random() * 50);
            const y = Math.floor(Math.random() * 50);
            const key = `${x},${y}`;
            const type = types[Math.floor(Math.random() * types.length)];
            furnitures[key] = { type, active: true };
        }
        return furnitures;
    }

    generateEntrance(level) {
        return { x: 3, y: 3 }; // posizione fissa o random
    }

    generateExit(level) {
        return { x: 45, y: 50 }; // posizione fissa o random
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
