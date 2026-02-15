// server/combat/CombatCore.js
class CombatCore {
    constructor(room) {
        this.room = room;          // riferimento alla room Colyseus
        this.actors = [];          // lista degli attori in combat
        this.inProgress = false;
        this.activeTurn = 1;
        this.currentActorIndex = 0;
    }

    log(msg) {
        console.log('[COMBAT]', msg);
        // opzionale: invia log ai client
        // this.room.broadcast("combatLog", msg);
    }

    /* =========================
       ACTOR MANAGEMENT
    ========================= */
    addActor(id, stats) {
        // id = playerId o enemyId
        if (!id) return;

        // Evita duplicati
        if (this.actors.find(a => a.id === id)) return;

        const actor = {
            id,
            stats: Object.assign({}, stats),
            target: null,
            inCombat: true
        };

        this.actors.push(actor);
        this.log(`ADD ACTOR: ${id}`);
        return actor;
    }

    removeActor(actor) {
        const idx = this.actors.indexOf(actor);
        if (idx !== -1) this.actors.splice(idx, 1);

        actor.inCombat = false;

        this.log(`REMOVE ACTOR: ${actor.id}`);

        // Aggiorna i target degli altri
        this.actors.forEach(a => {
            if (a.target === actor) {
                a.target = this.actors.find(x => x !== a) || null;
            }
        });

        // Fine combattimento se meno di 2 attori
        if (this.actors.length < 2) {
            this.endCombat();
        }
    }

    /* =========================
       INITIATIVE
    ========================= */
    _initiativeScore(actor, firstRound = false) {
        const table = {
            BLADE: { first: 1, combat: 4 },
            SWORD: { first: 2, combat: 3 },
            MACE: { first: 3, combat: 2 },
            HAMMER: { first: 2, combat: 2 },
            POLE: { first: 4, combat: 1 },
            NATURAL_FAST: { first: 3, combat: 3 },
            NATURAL_MEDIUM: { first: 2, combat: 2 },
            NATURAL_HEAVY: { first: 1, combat: 1 },
            NATURAL_BITE: { first: 3, combat: 3 }
        };

        const type = actor.stats.attackType || "NATURAL_MEDIUM";
        const skill = actor.stats.combat || 0;
        const data = table[type] || table.NATURAL_MEDIUM;

        return firstRound ? data.first + skill : data.combat + skill;
    }

    rollInitiative() {
        const diceSides = 12;
        const firstRound = this.activeTurn === 1;

        const scored = this.actors.map(actor => {
            const score = this._initiativeScore(actor, firstRound) - Math.floor(Math.random() * diceSides) + 1;
            return { actor, score };
        });

        scored.sort((a, b) => b.score - a.score);
        this.actors = scored.map(s => s.actor);

        this.log(`ROUND ${this.activeTurn} ORDER: ${this.actors.map(a => a.id).join(", ")}`);
    }

    /* =========================
       START / END COMBAT
    ========================= */
    startCombat() {
        if (this.actors.length < 2) return;

        this.inProgress = true;
        this.currentActorIndex = 0;

        // assegna target automatico: ogni attore attacca il primo disponibile diverso da sé
        this.actors.forEach(actor => {
            if (!actor.target) {
                actor.target = this.actors.find(a => a !== actor) || null;
            }
        });

        this.rollInitiative();
        this.log(`COMBAT START - ROUND ${this.activeTurn}`);
        this.nextActor();
    }

    endCombat() {
        this.log("COMBAT ENDED");
        this.actors.forEach(a => a.inCombat = false);
        this.actors = [];
        this.inProgress = false;
        this.activeTurn = 1;
        this.currentActorIndex = 0;
    }

    /* =========================
       TURN FLOW
    ========================= */
    nextActor() {
        if (!this.inProgress || this.actors.length < 2) {
            this.endCombat();
            return;
        }

        if (this.currentActorIndex >= this.actors.length) {
            this.activeTurn++;
            this.currentActorIndex = 0;
            if (this.activeTurn > 1) this.rollInitiative();
        }

        const attacker = this.actors[this.currentActorIndex];
        const defender = attacker.target;

        if (!defender) {
            this.currentActorIndex++;
            return this.nextActor();
        }

        this.log(`ATTACK TURN: ${attacker.id} -> ${defender.id}`);
        this.resolveHit(attacker, defender);
    }

    /* =========================
       ATTACK RESOLUTION
    ========================= */
    resolveHit(attacker, defender) {
        // Semplice calcolo danno random
        const att = attacker.stats.combat || 0;
        const def = defender.stats.defence || 0;

        const diceAt = Math.floor(Math.random() * 10);
        const diceDef = Math.floor(Math.random() * 10);

        let combat = att + diceAt - (def + diceDef);
        if (combat <= 0) combat = 0;

        let wound = 0;
        const wDamage = attacker.stats.wDamage || 1;
        const rolls = Math.min(wDamage, combat);

        for (let i = 0; i < rolls; i++) {
            wound += 1 + Math.floor(Math.random() * 4);
        }

        if (attacker.stats.strength > wDamage) {
            wound += Math.min(attacker.stats.strength - wDamage, combat);
        }

        // riduci salute del defender
        defender.stats.hp -= wound;
        this.log(`${defender.id} takes ${wound} damage, HP left: ${defender.stats.hp}`);

        // check morte
        if (defender.stats.hp <= 0) {
            this.log(`${defender.id} is defeated`);
            this.removeActor(defender);
        }

        // passa al prossimo attore
        this.currentActorIndex++;
        this.nextActor();
    }

    /* =========================
       DISENGAGE / DISTANCE CHECK
    ========================= */
    checkDistance(actorPositions) {
        // actorPositions = { id: { x, y, z } }
        const cutoff = 0.8;
        const toRemove = [];

        for (const actor of this.actors) {
            if (!actor.target) continue;
            const aPos = actorPositions[actor.id];
            const tPos = actorPositions[actor.target.id];
            if (!aPos || !tPos) continue;

            const dx = aPos.x - tPos.x;
            const dy = aPos.y - tPos.y;
            const dz = aPos.z - tPos.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

            if (dist > cutoff) {
                this.log(`${actor.id} disengaged (distance)`);
                toRemove.push(actor);
            }
        }

        toRemove.forEach(actor => this.removeActor(actor));
    }
}

module.exports = CombatCore;
