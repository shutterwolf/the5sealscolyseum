// CombatCore.js
const { Schema, type } = require("@colyseus/schema");

class CombatCore {
    constructor(room, combatId) {
        this.room = room;
        this.combatId = combatId;
        this.inProgress = false;
        this.round = 1;
        this.currentIndex = 0;
        this.turnOrder = [];
        this.actors = new Map();
    }

    addActor(id, stats, type = "player") {
        if (this.actors.has(id)) return;

        const entity = this.getEntity(id, type);
        const hp = type === "player" ? entity?.hp ?? stats.hp ?? 20 : entity?.health ?? stats.hp ?? 20;
        this.actors.set(id, {
            id,
            type,
            hp,
            combat: stats.combat ?? 5,
            defence: stats.defence ?? 5,
            strength: stats.strength ?? 3,
            wDamage: stats.wDamage ?? 2,
            targetId: null
        });

        if (entity) {
            if (type === "player") entity.hp = hp;
            if (type === "enemy") entity.health = hp;
        }
    }

    removeActor(id) {
        if (!this.actors.has(id)) return;
        const indexRemoved = this.turnOrder.indexOf(id);
        this.actors.delete(id);
        this.turnOrder = this.turnOrder.filter(x => x !== id);
        // 🔹 Fix currentIndex se necessario
        if (indexRemoved <= this.currentIndex && this.currentIndex > 0) {
            this.currentIndex--;
        }
        if (this.actors.size < 2 && this.inProgress) {
            this.endCombat();
        }
    }


    setTarget(attackerId, targetId) {
        const attacker = this.actors.get(attackerId);
        const target = this.actors.get(targetId);
        if (!attacker || !target) return;
        if (attacker.type === target.type) return; // evita friendly fire
        attacker.targetId = targetId;
    }

    startCombat() {
        console.log("🥊 startCombat called, actors:", this.actors.size, [...this.actors.keys()]);
        if (this.actors.size < 2) {
            console.log("❌ Not enough actors, aborting");
            return;
        }
        this.inProgress = true;
        this.round = 1;
        this.currentIndex = 0;
        this.rollInitiative();
        console.log("🎲 turnOrder:", this.turnOrder);
        this.broadcastToCombat("combatStart", { turnOrder: this.turnOrder });
        const nextActorId = this.getCurrentActorId();
        const nextActor = this.actors.get(nextActorId);
        this.broadcastToCombat("startTurn", {
            actorId: nextActorId,
            targetId: nextActor?.targetId ?? null
        });
    }

    onActorAnimationFinished(actorId) {
        console.log("SERVER RECEIVED:", actorId, "CURRENT:", this.getCurrentActorId());
        if (!this.inProgress || this.getCurrentActorId() !== actorId) return;

        const actor = this.actors.get(actorId);
        if (!actor || !actor.targetId) {
            this.endTurn();
            return;
        }

        const target = this.actors.get(actor.targetId);
        if (!target) {
            this.endTurn();
            return;
        }

        if (!this.isInRange(actorId, actor.targetId)) {
            this.removeActor(actorId);
            this.broadcastToCombat("disengage", { id: actorId });
            return;
        }

        const damage = this.resolveHit(actor, target);
        if (damage > 0) {
            target.hp -= damage;
            this.updateEntityHP(target.id, target.type, target.hp);
        }

        if (target.hp <= 0) {
            this.removeActor(target.id);
            this.broadcastToCombat("actorDied", { id: target.id });
        }

        this.broadcastToCombat("damage", {
            attackerId: actorId,
            targetId: actor.targetId,
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

        do {
            this.currentIndex++;
            if (this.currentIndex >= this.turnOrder.length) {
                this.currentIndex = 0;
                this.round++;
                this.rollInitiative();
            }
        } while (!this.actors.has(this.turnOrder[this.currentIndex]));

        const nextActorId = this.getCurrentActorId();
        this.broadcastToCombat("startTurn", { actorId: nextActorId });
    }

    rollInitiative() {
        const scored = [];
        for (let [id, actor] of this.actors.entries()) {
            const score = actor.combat - (Math.floor(Math.random() * 12) + 1);
            scored.push({ id, score });
        }
        scored.sort((a, b) => b.score - a.score);
        this.turnOrder = scored.map(s => s.id);
    }

    getCurrentActorId() {
        return this.turnOrder[this.currentIndex];
    }

    checkDistances() {
        const toRemove = [];
        for (let [id, actor] of this.actors.entries()) {
            if (!actor.targetId) continue;
            if (!this.isInRange(id, actor.targetId)) toRemove.push(id);
        }

        for (let id of toRemove) {
            if (!this.inProgress) break;
            this.removeActor(id);
            this.broadcastToCombat("disengage", { id });
        }
    }

    isInRange(idA, idB) {
        const posA = this.getPosition(idA);
        const posB = this.getPosition(idB);
        if (!posA || !posB) return false;

        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        const dz = posA.z - posB.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

        return dist <= 0.8;
    }

    resolveHit(attacker, target) {
        const diceAt = Math.floor(Math.random() * 10)+1;
        const diceDef = Math.floor(Math.random() * 10)+1;
        const combat = (attacker.combat + diceAt) - (target.defence + diceDef);
        if (combat <= 0) return 0;

        let wound = 0;
        const rolls = Math.min(attacker.wDamage, combat);
        for (let i = 0; i < rolls; i++) wound += 1 + Math.floor(Math.random() * 4);

        if (attacker.strength > attacker.wDamage) {
            wound += Math.min(attacker.strength - attacker.wDamage, combat);
        }
        return wound;
    }

    endCombat() {
        this.inProgress = false;
        for (let id of this.actors.keys()) {
            const actor = this.actors.get(id);
            this.updateEntityHP(id, actor.type, actor.hp);
            if (actor.type === "enemy") {
                const e = this.room.state.enemies.get(id);
                if (e) e.inCombat = 0;
            }
        }
        this.broadcastToCombat("combatEnd", { combatId: this.combatId });
        this.turnOrder = [];
        this.actors.clear();
        this.currentIndex = 0;
        this.room.activeCombats.delete(this.combatId);
    }

    broadcastToCombat(type, payload) {
        console.log(`📡 broadcastToCombat: ${type}`, payload);
    const fullPayload = { combatId: this.combatId, ...payload };

    // startTurn: only send to the player whose turn it is
    if (type === "startTurn" && payload.actorId) {
        const actor = this.actors.get(payload.actorId);
        if (actor && actor.type === "player") {
            const client = [...this.room.clients].find(
                c => this.room.sessionToPlayerId.get(c.sessionId) === payload.actorId
            );
            console.log("🔍 startTurn client found:", !!client, "sessionToPlayerId:", [...this.room.sessionToPlayerId.entries()]);
            if (client) client.send(type, fullPayload);
            return;
        }
    }

    // Everything else → all players in this combat
    const playerIdsInCombat = [...this.actors.values()]
        .filter(a => a.type === "player")
        .map(a => a.id);
        console.log("🎯 playerIdsInCombat:", playerIdsInCombat, "clients:", this.room.clients.length);

    for (const client of this.room.clients) {
        const playerId = this.room.sessionToPlayerId.get(client.sessionId);
        console.log("  client", client.sessionId, "→ playerId:", playerId);
        if (playerIdsInCombat.includes(playerId)) {
            client.send(type, fullPayload);
        }
    }
}


    updateEntityHP(id, type, hp) {
        if (type === "player") {
            const p = this.room.state.players.get(id);
            if (p) p.hp = hp;
        } else {
            const e = this.room.state.enemies.get(id);
            if (e) e.health = hp;
        }
    }

    getEntity(id, type) {
        if (type === "player") return this.room.state.players.get(id);
        if (type === "enemy") return this.room.state.enemies.get(id);
        return null;
    }

    getPosition(id) {
        const p = this.room.state.players.get(id);
        if (p) return p.playerPos;
        const e = this.room.state.enemies.get(id);
        if (e) return e.pos;
        return null;
    }
}

module.exports = CombatCore;
