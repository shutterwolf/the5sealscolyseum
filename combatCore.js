class CombatCore {

    constructor(room) {
        this.room = room;               // riferimento alla Room Colyseus
        this.cutoff = 0.8;

        this.inProgress = false;
        this.round = 1;
        this.currentIndex = 0;
        this.turnOrder = [];
        this.actors = new Map();        // id -> actor data
        // actor data: { hp, combat, defence, strength, wDamage, targetId }
    }

    /* =========================
       ACTOR MANAGEMENT
    ========================= */
    addActor(id, stats) {
        if (this.actors.has(id)) return;

        this.actors.set(id, {
            hp: stats.hp || 10,
            combat: stats.combat || 5,
            defence: stats.defence || 5,
            strength: stats.strength || 3,
            wDamage: stats.wDamage || 2,
            targetId: null
        });
    }

    removeActor(id) {
        this.actors.delete(id);
        this.turnOrder = this.turnOrder.filter(x => x !== id);

        if (this.currentIndex >= this.turnOrder.length) {
            this.currentIndex = 0;
        }

        if (this.actors.size < 2) {
            this.endCombat();
        }
    }

    setTarget(attackerId, targetId) {
        const actor = this.actors.get(attackerId);
        if (!actor) return;
        actor.targetId = targetId;
    }

    /* =========================
       COMBAT FLOW
    ========================= */
    startCombat() {
        if (this.actors.size < 2) return;

        this.inProgress = true;
        this.round = 1;
        this.currentIndex = 0;

        this.rollInitiative();

        this.room.broadcast("combatStart", { turnOrder: this.turnOrder });
    }

    attack(attackerId, targetId) {
        if (!this.inProgress) return;
        if (this.turnOrder[this.currentIndex] !== attackerId) return;

        const attacker = this.actors.get(attackerId);
        const target = this.actors.get(targetId);

        if (!attacker || !target) return;

        attacker.targetId = targetId;

        if (!this.isInRange(attackerId, targetId)) {
            this.removeActor(attackerId);
            this.room.broadcast("disengage", { id: attackerId });
            return;
        }

        const damage = this.resolveHit(attacker, target);

        if (damage > 0) target.hp -= damage;

        if (target.hp <= 0) {
            this.removeActor(targetId);
            this.room.broadcast("actorDied", { id: targetId });
        }

        this.room.broadcast("damage", {
            attackerId,
            targetId,
            damage
        });

        this.endTurn();
    }

    endTurn() {
        this.checkDistances();

        if (this.actors.size < 2) {
            this.endCombat();
            return;
        }

        this.currentIndex++;
        if (this.currentIndex >= this.turnOrder.length) {
            this.currentIndex = 0;
            this.round++;
            this.rollInitiative();
        }

        this.room.broadcast("nextTurn", {
            currentActor: this.turnOrder[this.currentIndex]
        });
    }

    rollInitiative() {
        const scored = [];
        for (let [id, actor] of this.actors.entries()) {
            const score = actor.combat - Math.floor(Math.random() * 12) + 1;
            scored.push({ id, score });
        }
        scored.sort((a, b) => b.score - a.score);
        this.turnOrder = scored.map(s => s.id);
    }

    getCurrentActorId() {
        return this.turnOrder[this.currentIndex];
    }

    /* =========================
       DISTANCE CHECK
    ========================= */
    checkDistances() {
        const toRemove = [];

        for (let [id, actor] of this.actors.entries()) {
            if (!actor.targetId) continue;
            if (!this.isInRange(id, actor.targetId)) {
                toRemove.push(id);
            }
        }

        toRemove.forEach(id => {
            this.removeActor(id);
            this.room.broadcast("disengage", { id });
        });
    }

    isInRange(idA, idB) {
        const playerA = this.room.state.players.get(idA);
        const playerB = this.room.state.players.get(idB);

        if (!playerA || !playerB) return false;

        const dx = playerA.playerPos.x - playerB.playerPos.x;
        const dy = playerA.playerPos.y - playerB.playerPos.y;
        const dz = playerA.playerPos.z - playerB.playerPos.z;

        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return dist <= this.cutoff;
    }

    /* =========================
       DAMAGE RESOLUTION
    ========================= */
    resolveHit(attacker, target) {
        const diceAt = Math.floor(Math.random() * 10);
        const diceDef = Math.floor(Math.random() * 10);
        const combat = (attacker.combat + diceAt) - (target.defence + diceDef);
        if (combat <= 0) return 0;

        let wound = 0;
        const rolls = Math.min(attacker.wDamage, combat);
        for (let i = 0; i < rolls; i++) {
            wound += 1 + Math.floor(Math.random() * 4);
        }
        if (attacker.strength > attacker.wDamage) {
            wound += Math.min(attacker.strength - attacker.wDamage, combat);
        }
        return wound;
    }

    /* =========================
       END COMBAT
    ========================= */
    endCombat() {
        this.inProgress = false;
        this.turnOrder = [];
        this.currentIndex = 0;
        this.room.broadcast("combatEnd");
    }

}

module.exports = CombatCore;
