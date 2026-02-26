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
        this.radius = enemyData.radius || 5;
        this.aggroRange = enemyData.aggroRange || 5;

        this.targetPlayer = null;
        this.localMap = enemyData.localMap || 0;
        this.depth = enemyData.depth || 0;
    }

    get position() {
        return { 
            x: isFinite(this.pos.x) ? this.pos.x : 0,
            y: isFinite(this.pos.y) ? this.pos.y : 0,
            z: isFinite(this.pos.z) ? this.pos.z : 0
        };
    }

    update(players, dt) {
        if (!this.enabled) return null;

        // Aggro check
        for (let pid in players) {
            const player = players[pid];
            if (!player) continue;
            if (player.localMap !== this.localMap || player.depth !== this.depth) continue;

            const dx = player.playerPos.x - this.pos.x;
            const dz = player.playerPos.z - this.pos.z;
            const dist = Math.sqrt(dx*dx + dz*dz);

            if (dist <= this.aggroRange) {
                this.state = 'AGGRO';
                this.targetPlayer = pid;

                const dirX = dist > 0.001 ? dx / dist : 0;
                const dirZ = dist > 0.001 ? dz / dist : 0;

                console.log(`[Enemy ${this.id}] Aggro su player ${pid}, distanza: ${dist.toFixed(2)}`);
                return {
                    moveDir: { x: dirX * this.speed, z: dirZ * this.speed },
                    state: 'AGGRO',
                    anim: 'walk'
                };
            }
        }

        // Movimento casuale
        if (!this.destination || this.state === 'IDLE') {

            // controlliamo che non generi ogni frame
            const chance = Math.floor(Math.random() * 2); // 0..19
            if (chance === 0) { // 1 su 20 frame, simile al tuo v===1
                // calcolo sicuro della nuova posizione casuale
                const dx = Math.floor((Math.random() * (this.radius*2)) - this.radius);
                const dz = Math.floor((Math.random() * (this.radius*2)) - this.radius);
                this.destination = new pc.Vec3(this.pos.x + dx, this.pos.y, this.pos.z + dz);

                this.state = 'MOVE';
        
                console.log(`[Enemy ${this.id}] Nuova destinazione casuale: x=${this.destination.x.toFixed(2)}, z=${this.destination.z.toFixed(2)}");
            }
        }

        // Movimento verso destinazione
        if (!this.destination) {
            // se non c'è destinazione, non muovere
            return { moveDir: { x: 0, z: 0 }, state: this.state, anim: 'idle' };
        }
        
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
                moveDir: { x: dirX * this.speed, z: dirZ * this.speed },
                state: this.state,
                anim: 'walk'
            };
        }
    }

    updatePositionFromClient(pos) {
        if (!pos) return;
        this.pos.x = pos.x;
        this.pos.y = pos.y;
        this.pos.z = pos.z;
    }

    setTarget(playerID, pos) {
        this.targetPlayer = playerID;
        if (pos) this.destination = pos;
        this.state = 'AGGRO';
    }

    enable() { this.enabled = true; }
    disable() { 
        this.enabled = false; 
        this.state = 'IDLE'; 
        this.targetPlayer = null; 
        this.destination = null; 
    }
}

module.exports = Enemy;
