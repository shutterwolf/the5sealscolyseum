// CombatCoreRealtime.js
const { Schema, type } = require("@colyseus/schema");

class CombatCore {

    constructor(room, combatId) {
        this.room = room;
        this.combatId = combatId; // <-- fondamentale
        this.inProgress = false;
        this.round = 1;
        this.currentIndex = 0;
        this.turnOrder = [];
        this.actors = new Map();
    }

    /* =========================
       ACTOR MANAGEMENT
    ========================= */
    addActor(id, stats) {
        if (this.actors.has(id)) return;

        const player = this.room.state.players.get(id);
        const hp = player?.hp ?? stats.hp ?? 20;

        this.actors.set(id, {
            hp: hp,
            combat: stats.combat ?? 5,
            defence: stats.defence ?? 5,
            strength: stats.strength ?? 3,
            wDamage: stats.wDamage ?? 2,
            targetId: null
        });

        // sincronizza HP con PlayerState
        if (player) player.hp = hp;
    }

    removeActor(id) {
        if (!this.actors.has(id)) return;
    
        this.actors.delete(id);
    
        const removedIndex = this.turnOrder.indexOf(id);
        this.turnOrder = this.turnOrder.filter(x => x !== id);
    
        if (removedIndex < this.currentIndex) {
            this.currentIndex--;
        }
        if (this.currentIndex >= this.turnOrder.length) {
            this.currentIndex = 0;
        }
    
        if (this.actors.size < 2 && this.inProgress) {
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
       - automatizzato, realtime
       - turno passa solo quando client segnala fine animazione
    ========================= */
    startCombat() {
        if (this.actors.size < 2) return;

        this.inProgress = true;
        this.round = 1;
        this.currentIndex = 0;

        this.rollInitiative();

        this.broadcastToCombat("combatStart", { turnOrder: this.turnOrder });

        // il primo turno parte subito sul client
        const actorId = this.getCurrentActorId();
        this.broadcastToCombat("startTurn", { actorId });
    }

    onActorAnimationFinished(actorId) {
        if (!this.inProgress) return;
        if (this.getCurrentActorId() !== actorId) return;

        const actor = this.actors.get(actorId);
        if (!actor || !actor.targetId) {
            this.endTurn();
            return;
        }

        // calcola e applica danno
        const target = this.actors.get(actor.targetId);
        if (!target) {
            this.endTurn();
            return;
        }

        if (!this.isInRange(actorId, actor.targetId)) {
            // fuori range → disengage
            this.removeActor(actorId);
            if (!this.inProgress) return;
            this.broadcastToCombat("disengage", { id: actorId });
            return;
        }

        const damage = this.resolveHit(actor, target);
        if (damage > 0) {
            target.hp -= damage;

            const targetPlayer = this.room.state.players.get(actor.targetId);
            if (targetPlayer) targetPlayer.hp = target.hp;
        }

        if (target.hp <= 0) {
            this.removeActor(actor.targetId);
            this.broadcastToCombat("actorDied", { id: actor.targetId });
        }

        this.broadcastToCombat("damage", {
            attackerId: actorId,
            targetId: actor.targetId,
            damage
        });

        // Passa al turno successivo
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

        // Turno successivo
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

        for (let id of toRemove) {
            if (!this.inProgress) break;
            this.removeActor(id);
            if (this.inProgress) {
                this.broadcastToCombat("disengage", { id });
            }
        }
    }

    isInRange(idA, idB) {
        const playerA = this.room.state.players.get(idA);
        const playerB = this.room.state.players.get(idB);

        if (!playerA || !playerB) return false;

        const dx = playerA.playerPos.x - playerB.playerPos.x;
        const dy = playerA.playerPos.y - playerB.playerPos.y;
        const dz = playerA.playerPos.z - playerB.playerPos.z;

        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return dist <= 0.8; // cutoff
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

    endCombat() {
        this.inProgress = false;
    
        // libera i player
        for (let id of this.actors.keys()) {
    
            const player = this.room.state.players.get(id);
            if (player) {
                player.inCombat = 0;
            }
        }
    
        // avvisa solo i partecipanti
        this.broadcastToCombat("combatEnd", {
            combatId: this.combatId
        });
    
        this.turnOrder = [];
        this.actors.clear();
        this.currentIndex = 0;
    
        // rimuove se stesso dalla room
        this.room.activeCombats.delete(this.combatId);
    }
    
    broadcastToCombat(type, payload) {
        for (let id of this.actors.keys()) {
    
            const client = [...this.room.clients].find(c =>
                this.room.sessionToPlayerId.get(c.sessionId) === id
            );
    
            if (client) {
                client.send(type, {
                    combatId: this.combatId,
                    ...payload
                });
            }
        }
    }
}

module.exports = CombatCore;
