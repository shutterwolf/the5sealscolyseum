// server/EnemyHandler.js
class Enemy {
    constructor(enemyData) {
        this.id = enemyData.id;
        this.type = enemyData.enemy;
        this.level = enemyData.level || 1;

        this.pos = {
            x: enemyData.posX,
            y: enemyData.posY,
            z: enemyData.posZ
        };

        this.enabled = enemyData.dungeon ? false : true;
        this.state = 'IDLE';
        this.destination = null;
        this.speed = enemyData.speed || 3;
        this.aggroRange = enemyData.aggroRange || 5;
        this.targetPlayer = null;
        this.localMap = enemyData.localMap || 0;
        this.depth = enemyData.depth || 0;
    }

    // getter posizione sicura
    get position() {
        return { 
            x: isFinite(this.pos.x),
            y: isFinite(this.pos.y),
            z: isFinite(this.pos.z)
        };
    }

    // aggiornamento server → client
    update(players, dt) {
        if (!this.enabled) return null;

        // ------------------------
        // Aggro check su tutti i player
        // ------------------------
        for (let pid in players) {
            const player = players[pid];
            if (!player) continue;
            if (player.localMap !== this.localMap || player.depth !== this.depth) continue;

            const dx = player.x - this.pos.x;
            const dz = player.z - this.pos.z;
            const dist = Math.sqrt(dx*dx + dz*dz);

            if (dist <= this.aggroRange) {
                this.state = 'AGGRO';
                this.targetPlayer = pid;

                const dirX = dist > 0.001 ? dx / dist : 0;
                const dirZ = dist > 0.001 ? dz / dist : 0;

                return {
                    moveDir: { x: dirX, z: dirZ },
                    state: 'AGGRO',
                    anim: 'walk' // sempre walk
                };
            }
        }

        // ------------------------
        // Movimento casuale (IDLE -> MOVE)
        // ------------------------
        if (!this.destination || this.state === 'IDLE') {
            const r = this.radius || 5; // usa il valore passato al costruttore
            this.destination = {
                x: this.pos.x + (Math.random() * 2 - 1) * r,
                z: this.pos.z + (Math.random() * 2 - 1) * r
            };
            this.state = 'MOVE';
        }

        // ------------------------
        // MOVE verso destinazione
        // ------------------------
        const dx = this.destination.x - this.pos.x;
        const dz = this.destination.z - this.pos.z;
        const dist = Math.sqrt(dx*dx + dz*dz);

        if (dist < 0.1 || !isFinite(dist)) {
            this.state = 'IDLE';
            this.destination = null;
            return { moveDir: { x: 0, z: 0 }, state: 'IDLE', anim: 'idle' };
        } else {
            const dirX = dist > 0.001 ? dx / dist : 0;
            const dirZ = dist > 0.001 ? dz / dist : 0;

            return {
                moveDir: { x: dirX, z: dirZ },
                state: this.state,
                anim: 'walk' // sempre walk
            };
        }
    }

    // aggiornamento posizione dal client (con rigidbody)
    updatePositionFromClient(pos) {
        if (!pos) return;
        this.pos.x = pos.x;
        this.pos.y = pos.y;
        this.pos.z = pos.z;
    }

    // targeting manuale
    setTarget(playerID, pos) {
        this.targetPlayer = playerID;
        if (pos) this.destination = pos;
        this.state = 'AGGRO';
    }

    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
        this.state = 'IDLE';
        this.targetPlayer = null;
        this.destination = null;
    }
}

module.exports = Enemy;
