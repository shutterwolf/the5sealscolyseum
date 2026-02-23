// server/EnemyHandler.js
class Enemy {
    constructor(enemyData) {
        this.id = enemyData.id;
        this.type = enemyData.enemy;
        this.level = enemyData.level || 1;

        this.pos = {
            x: enemyData.posX || 0,
            y: enemyData.posY || 0,
            z: enemyData.posZ || 0
        };

        // Nei dungeon parte disabilitato
        this.enabled = enemyData.dungeon ? false : true;

        this.state = 'IDLE';        // IDLE, MOVE, AGGRO
        this.destination = null;     // destinazione per MOVE
        this.speed = enemyData.speed || 3;  
        this.aggroRange = enemyData.aggroRange || 8;

        this.targetPlayer = null;   // player in aggro
        this.localMap = enemyData.localMap || 0;
        this.depth = enemyData.depth || 0;

        get position() {
            return { x: this.pos.x, y: this.pos.z }; // y = asse z mondo
        }
    }

    update(players) {
        if (!this.enabled) return null;

        // Se siamo in AGGRO, inseguo il player
        if (this.state === 'AGGRO') {
            if (!this.targetPlayer || !players[this.targetPlayer]) {
                this.state = 'IDLE';
                this.targetPlayer = null;
                return { pos: this.pos, anim: 'idle' };
            }

            const p = players[this.targetPlayer];
            const dx = p.x - this.pos.x;
            const dz = p.z - this.pos.z;
            const dist = Math.sqrt(dx*dx + dz*dz);

            if (dist > 0.1) {
                const step = Math.min(dist, this.speed * 0.1);
                this.pos.x += (dx/dist)*step;
                this.pos.z += (dz/dist)*step;
            }

            return { pos: this.pos, anim: 'run' };
        }

        // Controllo aggro verso tutti i player nella stessa localMap/depth
        for (let pid in players) {
            const player = players[pid];
            if (player.localMap !== this.localMap || player.depth !== this.depth) continue;

            const dx = player.x - this.pos.x;
            const dz = player.z - this.pos.z;
            const dist = Math.sqrt(dx*dx + dz*dz);

            if (dist <= this.aggroRange) {
                this.state = 'AGGRO';
                this.targetPlayer = pid;
                return { pos: this.pos, anim: 'run' };
            }
        }

        // IDLE o MOVE casuale
        if (this.state === 'IDLE' || !this.destination) {
            // nuova destinazione casuale
            const radius = 5;
            this.destination = {
                x: this.pos.x + (Math.random()*2-1)*radius,
                z: this.pos.z + (Math.random()*2-1)*radius
            };
            this.state = 'MOVE';
            return { pos: this.pos, anim: 'walk' };
        }

        // MOVE verso destinazione
        const dx = this.destination.x - this.pos.x;
        const dz = this.destination.z - this.pos.z;
        const dist = Math.sqrt(dx*dx + dz*dz);

        if (dist < 0.1) {
            this.state = 'IDLE';
            this.destination = null;
            return { pos: this.pos, anim: 'idle' };
        } else {
            const step = Math.min(dist, this.speed * 0.1);
            this.pos.x += (dx/dist)*step;
            this.pos.z += (dz/dist)*step;
            return { pos: this.pos, anim: 'walk' };
        }
    }

    setTarget(playerID) {
        this.targetPlayer = playerID;
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

module.exports = Enemy; // oppure
module.exports = { EnemyServer: Enemy }; 

