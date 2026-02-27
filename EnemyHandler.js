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

    update(players, dt, room) {
    if (!this.enabled) {
        console.log(`[Enemy ${this.id}] disabled, skipping update.`);
        return null;
    }

    let updateData = null;

    // 1️⃣ Aggro check
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

            updateData = {
                moveDir: { x: dirX * this.speed, z: dirZ * this.speed },
                state: 'AGGRO',
                anim: 'walk',
                destX: player.playerPos.x,
                destZ: player.playerPos.z
            };
            console.log(`[Enemy ${this.id}] Aggro su player ${pid}, destX: ${updateData.destX}, destZ: ${updateData.destZ}`);
            break;
        }
    }

    // 2️⃣ Movimento casuale se non in Aggro
    if (!updateData && (!this.destination || this.state === 'IDLE')) {
        if (!this.nextMoveTime || Date.now() >= this.nextMoveTime) {
            const dx = Math.floor((Math.random() * (this.radius*2)) - this.radius);
            const dz = Math.floor((Math.random() * (this.radius*2)) - this.radius);

            this.destination = {
                x: this.pos.x + dx,
                y: this.pos.y,
                z: this.pos.z + dz
            };
            this.state = 'MOVE';
            this.nextMoveTime = Date.now() + 1000;

            updateData = {
                moveDir: { x: 0, z: 0 },
                state: 'MOVE',
                anim: 'walk',
                destX: this.destination.x,
                destZ: this.destination.z
            };
            console.log(`[Enemy ${this.id}] Movimento casuale, nuova destinazione: ${this.destination.x}, ${this.destination.z}`);
        }
    }

    // 3️⃣ Movimento verso destinazione
    if (!updateData && this.destination) {
        const dx = this.destination.x - this.pos.x;
        const dz = this.destination.z - this.pos.z;
        const dist = Math.sqrt(dx*dx + dz*dz);

        if (dist < 0.1 || !isFinite(dist)) {
            this.state = 'IDLE';
            this.destination = null;
            updateData = { moveDir: { x: 0, z: 0 }, state: 'IDLE', anim: 'idle', destX: this.pos.x, destZ: this.pos.z };
            console.log(`[Enemy ${this.id}] Raggiunta destinazione, resto in IDLE`);
        } else {
            const dirX = dx / dist;
            const dirZ = dz / dist;

            this.pos.x += dirX * this.speed * dt;
            this.pos.z += dirZ * this.speed * dt;

            updateData = {
                moveDir: { x: dirX * this.speed, z: dirZ * this.speed },
                state: this.state,
                anim: 'walk',
                destX: this.destination.x,
                destZ: this.destination.z
            };
            console.log(`[Enemy ${this.id}] Muovo verso destinazione: ${this.destination.x}, ${this.destination.z}, posizione attuale: ${this.pos.x.toFixed(2)}, ${this.pos.z.toFixed(2)}`);
        }
    }

    // 4️⃣ Invio update al client
    if (updateData && room) {
        room.send("enemyMove", {
            id: this.id,
            destX: updateData.destX,
            destZ: updateData.destZ,
            state: updateData.state,
            anim: updateData.anim
        });
        console.log(`[Enemy ${this.id}] Inviato update al client: state=${updateData.state}, anim=${updateData.anim}`);
    }

    return updateData;
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
