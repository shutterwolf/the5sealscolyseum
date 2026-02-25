// server/EnemyHandler.js
class Enemy {
    constructor(enemyData) {
        this.id = enemyData.id;
        this.type = enemyData.enemy;
        this.level = enemyData.level || 1;

        this.pos = {
            x: isFinite(enemyData.posX) ? enemyData.posX : 0,
            y: isFinite(enemyData.posY) ? enemyData.posY : 5, // altezza sicura
            z: isFinite(enemyData.posZ) ? enemyData.posZ : 0
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
            x: isFinite(this.pos.x) ? this.pos.x : 0,
            y: isFinite(this.pos.y) ? this.pos.y : 5,
            z: isFinite(this.pos.z) ? this.pos.z : 0
        };
    }

    update(players, dt) {
        if (!this.enabled) return null;

        // ------------------------
        // Aggro su un player
        // ------------------------
        if (this.state === 'AGGRO') {
            const player = players[this.targetPlayer];
            if (!player) {
                this.state = 'IDLE';
                this.targetPlayer = null;
                return { pos: this.position, anim: 'idle' };
            }

            let dx = player.x - this.pos.x;
            let dz = player.z - this.pos.z;
            const dist = Math.sqrt(dx*dx + dz*dz);

            // evita divisione per zero
            if (dist > 0.0001) {
                const step = Math.min(dist, this.speed * dt);
                this.pos.x += (dx/dist) * step;
                this.pos.z += (dz/dist) * step;
            }

            if (dist > this.aggroRange) {
                this.state = 'IDLE';
                this.targetPlayer = null;
                return { pos: this.position, anim: 'idle' };
            }

            return { pos: this.position, anim: 'run' };
        }

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
                return { pos: this.position, anim: 'run' };
            }
        }

        // ------------------------
        // Movimento casuale (IDLE -> MOVE)
        // ------------------------
        if (!this.destination || this.state === 'IDLE') {
            const radius = 5;
            this.destination = {
                x: this.pos.x + (Math.random()*2 -1) * radius,
                z: this.pos.z + (Math.random()*2 -1) * radius
            };
            this.state = 'MOVE';
            return { pos: this.position, anim: 'walk' };
        }

        // ------------------------
        // MOVE verso destinazione
        // ------------------------
        let dx = this.destination.x - this.pos.x;
        let dz = this.destination.z - this.pos.z;
        const dist = Math.sqrt(dx*dx + dz*dz);

        if (dist < 0.1 || !isFinite(dist)) {
            this.state = 'IDLE';
            this.destination = null;
            return { pos: this.position, anim: 'idle' };
        } else {
            const step = Math.min(dist, this.speed * dt);
            if (dist > 0.0001) {
                this.pos.x += (dx/dist) * step;
                this.pos.z += (dz/dist) * step;
            }
            return { pos: this.position, anim: 'walk' };
        }
    }

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
