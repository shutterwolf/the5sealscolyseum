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

        this.enabled = enemyData.dungeon ? false : true;
        this.state = 'IDLE';
        this.destination = null;
        this.speed = enemyData.speed || 3;  
        this.aggroRange = enemyData.aggroRange || 5;
        this.targetPlayer = null;
        this.localMap = enemyData.localMap || 0;
        this.depth = enemyData.depth || 0;
    }

    // getter corretto
    get position() {
        return { 
            x: this.pos.x,   // X mondo
            y: this.pos.y,   // Y verticale
            z: this.pos.z    // Z mondo
        };
    }

    update(players,dt) {
        if (!this.enabled) return null;

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
            console.log(
                `[SERVER update] Enemy ${this.id} | state=${this.state} | ` +
                `pos=(${this.pos.x.toFixed(2)}, ${this.pos.z.toFixed(2)})`
            );

            if (dist > 0.1) {
                const step = Math.min(dist, this.speed * dt);
                this.pos.x += (dx/dist)*step;
                this.pos.z += (dz/dist)*step;
            }

            if (dist > this.aggroRange) {
                this.state = 'IDLE';
                this.targetPlayer = null;
                return { pos: this.pos, anim: 'idle' };
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
        console.log(
            `[SERVER] Enemy ${this.id} | state=${this.state} | ` +
            `pos=(${this.pos.x.toFixed(2)}, ${this.pos.z.toFixed(2)})`
        );

        if (dist < 0.1) {
            this.state = 'IDLE';
            this.destination = null;
            return { pos: this.pos, anim: 'idle' };
        } else {
            const step = Math.min(dist, this.speed * dt);
            this.pos.x += (dx/dist)*step;
            this.pos.z += (dz/dist)*step;
            return { pos: this.pos, anim: 'walk' };
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

module.exports = Enemy; // oppure
 

