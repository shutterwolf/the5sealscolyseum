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
        this.turnTimer = null;
        this.pendingActors = [];
        this.disposed = false;
        this.maxRange = 1.5; // max attack range in world units
    }

    addActor(id, stats, type = "player") {
        if (this.actors.has(id)) {
            // Already in this combat — just update stats and return
            const existing = this.actors.get(id);
            Object.assign(existing, stats);
            return;
        }
        const entity = this.getEntity(id, type);
        // =========================
        // HP SAFE
        // =========================
        let initialHP = 20;
        let maxHp = 20;
        if (type === "player") {
            initialHP = stats.hp ?? entity?.hp ?? 20;
            maxHp = stats.maxHp ?? entity?.maxHp ?? initialHP;
        } else {
            maxHp = entity?.maxHealth ?? stats.maxHealth ?? 20;
            initialHP = entity?.health ?? stats.hp ?? 20;
        }
        // =========================
        // ATTACK SKILL (NO RICALCOLO)
        // =========================
        let attackSkill = stats.combat ?? stats.attac ?? 5;
        // =========================
        // DEFENSE SKILL
        // =========================
        let defenseSkill = stats.defence ?? 5;
        // =========================
        // WEAPON TYPE (OPTIONAL ONLY)
        // =========================
        const weaponType = stats.weaponType ?? stats.weapon ?? "UNARMED";
        // =========================
        // SHIELD
        // =========================
        const shieldProtection = stats.shieldArmor ?? stats.shieldValue ?? stats.shield ?? 0;
        // =========================
        // ARMOR (SAFE)
        // =========================
        const armorValue =
            (stats.helmArmor ?? 0) +
            (stats.armour ?? 0) +
            (stats.bootsArmor ?? 0) +
            (stats.glovesArmor ?? 0) +
            shieldProtection;
        // =========================
        // FINAL ACTOR
        // =========================
        this.actors.set(id, {
            id,
            type,
            hp: initialHP,
            maxHealth: maxHp,
            combat: attackSkill,
            defence: defenseSkill,
            strength: stats.strength ?? 3,
            wDamage: stats.wDamage ?? 2,
            shield: shieldProtection,
            armour: armorValue,
            weaponType,
            targetId: null,
            lastHitBy: null,
            lastWeaponUsed: null,
            isDead: false
        });
        // =========================
        // SYNC STATE
        // =========================
        if (entity) {
            if (type === "player") entity.hp = initialHP;
            if (type === "enemy") entity.health = initialHP;
        }
        if (this.inProgress) {
            // Se il combattimento è già avviato, lo parcheggiamo per il prossimo round
            this.pendingActors.push(id);
            console.log(`⏳ Actor ${id} (${type}) messo in coda per il Round ${this.round + 1}`);
        } else {
            // Se il combattimento deve ancora partire, lo inseriamo normalmente
            this.turnOrder.push(id);
        }
    }

    normalizeTurnIndex() {
        if (this.turnOrder.length === 0) {
            this.currentIndex = 0;
            return;
        }
        if (this.currentIndex >= this.turnOrder.length) {
            this.currentIndex = 0;
        }
        if (this.currentIndex < 0) {
            this.currentIndex = 0;
        }
    }

    removeActor(id) {
        const actor = this.actors.get(id);
        if (!actor) return;

        // Retarget any actor whose target was this one
        this.actors.forEach((a) => {
            if (a.targetId === id) {
                const newTarget = [...this.actors.values()].find(
                    other => other.type !== a.type && other.id !== id && !other.isDead
                );
                a.targetId = newTarget ? newTarget.id : null;
            }
        });

        // Remove from pending first
        const pendingIndex = this.pendingActors.indexOf(id);
        if (pendingIndex !== -1) {
            this.pendingActors.splice(pendingIndex, 1);
        }

        // Remove from turnOrder
        const index = this.turnOrder.indexOf(id);
        if (index !== -1) {
            this.turnOrder.splice(index, 1);
            if (index < this.currentIndex) {
                this.currentIndex--;
            }
        }

        this.actors.delete(id);
        this.normalizeTurnIndex();

        // If combat has too few actors, end it
        if (this.actors.size < 2) {
            this.endCombat();
            return;
        }

        // If no players left, end it
        const playersLeft = [...this.actors.values()].filter(a => a.type === "player").length;
        if (playersLeft === 0) {
            this.endCombat();
            return;
        }

        // If no enemies left, end it
        const enemiesLeft = [...this.actors.values()].filter(a => a.type === "enemy").length;
        if (enemiesLeft === 0) {
            this.endCombat();
            return;
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
        // Popoliamo il turnOrder iniziale con tutti gli attori inseriti prima del via
        this.turnOrder = [...this.actors.keys()];
        console.log("START", {
            combatId: this.combatId,
            actors: this.turnOrder
        });
        this.rollInitiative();
        console.log("INITIATIVE", {
            combatId: this.combatId,
            turnOrder: this.turnOrder
        });
        this.broadcastToCombat("combatStart", { turnOrder: this.turnOrder });
        const nextActorId = this.getCurrentActorId();
        const nextActor = this.actors.get(nextActorId);
        this.broadcastToCombat("startTurn", {
            actorId: nextActorId,
            targetId: nextActor?.targetId ?? null
        });
        // Avvia il timer per il primo turno
        if (nextActorId) this.startTurnTimer(nextActorId);
    }

    startTurnTimer(actorId) {
        clearTimeout(this.turnTimer);
        this.turnTimer = setTimeout(() => {
            if (this.disposed || !this.inProgress) return;
            // sicurezza: il turno potrebbe essere già cambiato
            if (this.getCurrentActorId() !== actorId) return;
            console.log("FORCED END TURN (timeout):", actorId);
            this.endTurn();
        }, 8000);
    }

    onActorAnimationFinished(actorId) {
        clearTimeout(this.turnTimer);
        console.log("TURN_RESOLVE_BEGIN", {
            combatId: this.combatId,
            actorId,
            currentActorId: this.getCurrentActorId()
        });
        if (!this.inProgress || this.getCurrentActorId() !== actorId) return;

        const actor = this.actors.get(actorId);
        if (!actor || actor.isDead) {
            this.endTurn();
            return;
        }

        if (!actor.targetId) {
            // Try to auto-target an enemy
            const newTarget = [...this.actors.values()].find(
                a => a.type !== actor.type && !a.isDead
            );
            if (newTarget) {
                actor.targetId = newTarget.id;
            } else {
                this.endTurn();
                return;
            }
        }

        const target = this.actors.get(actor.targetId);
        if (!target || target.isDead) {
            // Target is dead, try to find new target
            const newTarget = [...this.actors.values()].find(
                a => a.type !== actor.type && !a.isDead
            );
            if (newTarget) {
                actor.targetId = newTarget.id;
            } else {
                this.endTurn();
                return;
            }
        }

        // Re-fetch target after potential retarget
        const finalTarget = this.actors.get(actor.targetId);
        if (!finalTarget || finalTarget.isDead) {
            this.endTurn();
            return;
        }

        // ===== DISTANCE CHECK =====
        if (!this.isInRange(actorId, actor.targetId)) {
            console.log("OUT OF RANGE:", actorId, "→", actor.targetId);
            this.broadcastToCombat("combatMiss", {
                attackerId: actorId,
                targetId: actor.targetId,
                reason: "out_of_range"
            });
            this.endTurn();
            return;
        }

        finalTarget.lastHitBy = actor.id;
        finalTarget.lastWeaponUsed = actor.weaponType;

        const result = this.resolveHit(actor, finalTarget);
        console.log("HIT_RESULT", {
            combatId: this.combatId,
            attackerId: actor.id,
            targetId: finalTarget.id,
            result,
            targetHpBefore: finalTarget.hp
        });
        const wound = result.wound || 0;
        if (result.hit && wound > 0) {
            finalTarget.hp -= wound;
            if (finalTarget.hp < 0) {
                finalTarget.hp = 0;
            }
            this.updateEntityHP(finalTarget.id, finalTarget.type, finalTarget.hp);
            console.log("HP_APPLY", {
                combatId: this.combatId,
                targetId: finalTarget.id,
                targetHpAfter: finalTarget.hp
            });
        }

        this.broadcastToCombat("damage", {
            attackerId: actorId,
            targetId: actor.targetId,
            wound: wound,
            shieldDamage: result.shieldDamage,
            armorAbsorb: result.armorAbsorb,
            hit: result.hit
        });

        if (finalTarget.hp <= 0) {
            this.killActor(finalTarget);
        }

        this.endTurn();
    }

    killActor(target) {
        target.isDead = true;
        target.lootReady = true;

        // entity state
        const enemyEntity = this.room.state.enemies.get(target.id);
        if (enemyEntity) {
            enemyEntity.isDead = true;
            enemyEntity.lootReady = true;
            enemyEntity.aiState = "dead";
            enemyEntity.inCombat = 0;
            enemyEntity.health = 0;
        }
        target.aiState = "dead";
        target.inCombat = 0;

        const killerId = target.lastHitBy;
        const killer = this.actors.get(killerId);

        let advKey = null;
        let xpGain = 0;

        if (target.type !== "player") {
            this.room.enemyInstances.delete(target.id);
        }

        if (killer && killer.type === "player") {
            const entity = this.getEntity(killerId, "player");
            if (entity) {
                const weaponType = killer.weaponType?.toLowerCase();
                advKey = weaponType + "Adv";
                const currentSkillLevel = Math.max(1, killer.combat || 1);
                const enemyValue = (target.maxHealth) + (target.combat);
                xpGain = Math.max(1, Math.floor((enemyValue * target.combat) / currentSkillLevel));
                if (!isFinite(xpGain) || xpGain < 1) {
                    xpGain = 1;
                }
                entity[advKey] = (entity[advKey] ?? 0) + xpGain;
            }
        }

        this.broadcastToCombat("actorDied", {
            id: target.id,
            killerId: killerId,
            skill: advKey,
            xpGain: xpGain
        });

        this.removeActor(target.id);
    }

    endTurn() {
        clearTimeout(this.turnTimer);
        if (!this.inProgress) return;

        if (this.actors.size < 2) {
            this.endCombat();
            return;
        }

        // FIX: se non ci sono più player, termina il combat
        const playersLeft = [...this.actors.values()].filter(a => a.type === "player").length;
        if (playersLeft === 0) {
            this.endCombat();
            return;
        }

        // FIX: se non ci sono più nemici, termina il combat
        const enemiesLeft = [...this.actors.values()].filter(a => a.type === "enemy").length;
        if (enemiesLeft === 0) {
            this.endCombat();
            return;
        }

        if (!this.turnOrder || this.turnOrder.length === 0) {
            console.error('[CombatCore] turnOrder empty/undefined in endTurn, ending combat');
            this.endCombat();
            return;
        }

        this.currentIndex++;

        if (this.currentIndex >= this.turnOrder.length) {
            this.round++;
            this.currentIndex = 0;
            if (this.pendingActors && this.pendingActors.length > 0) {
                // Add pending actors, avoiding duplicates already in turnOrder
                const toAdd = this.pendingActors.filter(id => !this.turnOrder.includes(id));
                this.turnOrder = [...this.turnOrder, ...toAdd];
                this.pendingActors = [];
            }
        }

        this.normalizeTurnIndex();

        // Skip dead actors
        let safety = 0;
        while (safety < this.turnOrder.length) {
            const nextActorId = this.getCurrentActorId();
            if (!nextActorId) break;
            const nextActor = this.actors.get(nextActorId);
            if (nextActor && !nextActor.isDead) break;
            // Actor is dead, skip
            this.currentIndex++;
            if (this.currentIndex >= this.turnOrder.length) {
                this.round++;
                this.currentIndex = 0;
            }
            this.normalizeTurnIndex();
            safety++;
        }

        const nextActorId = this.getCurrentActorId();
        if (!nextActorId) {
            this.endCombat();
            return;
        }

        const nextActor = this.actors.get(nextActorId);
        console.log("NEXT_TURN", { combatId: this.combatId, round: this.round, currentIndex: this.currentIndex, nextActorId });

        this.broadcastToCombat("startTurn", {
            actorId: nextActorId,
            targetId: nextActor?.targetId ?? null
        });
        this.startTurnTimer(nextActorId);
    }

    rollInitiative() {
        const scored = [];

        for (let [id, actor] of this.actors.entries()) {
            const score = actor.combat - (Math.floor(Math.random() * 12) + 1);
            scored.push({ id, score });
        }

        scored.sort((a, b) => b.score - a.score);

        this.turnOrder = scored.map(s => s.id);
        this.normalizeTurnIndex();
    }

    getCurrentActorId() {
        if (this.turnOrder.length === 0) return null;
        return this.turnOrder[this.currentIndex] || null;
    }

    checkDistances() {
        if (!this.inProgress) return;
        const fleeing = [];
        for (let [id, actor] of this.actors.entries()) {
            if (actor.type !== "player") continue;
            if (!actor.targetId) continue;
            const posA = this.getPosition(id);
            const posB = this.getPosition(actor.targetId);
            if (!posA || !posB) continue;
            const dx = posA.x - posB.x;
            const dz = posA.z - posB.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > this.maxRange * 3) { // 3x attack range = flee threshold
                fleeing.push(id);
            }
        }

        for (let id of fleeing) {
            const p = this.room.state.players.get(id);
            if (p) p.inCombat = 0;
            this.removeActor(id);
            const client = [...this.room.clients].find(
                c => this.room.sessionToPlayerId.get(c.sessionId) === id
            );
            if (client) {
                client.send("disengage", { id, combatId: this.combatId });
                client.send("combatEnd", { combatId: this.combatId });
            }
        }

        const playersLeft = [...this.actors.values()].filter(a => a.type === "player").length;
        if (playersLeft === 0 && this.inProgress) {
            this.endCombat();
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

        return dist <= this.maxRange;
    }

    resolveHit(attacker, defender) {
        console.log("===== resolveHit START =====");
        console.log("ATTACKER:", attacker);
        console.log("DEFENDER:", defender);

        let attackerSkill = 0;
        let defenderSkill = 0;

        const isPlayerAttacker = attacker.type === "player";
        const isPlayerDefender = defender.type === "player";

        console.log("isPlayerAttacker:", isPlayerAttacker);
        console.log("isPlayerDefender:", isPlayerDefender);

        // ===== Attacker skill =====
        if (isPlayerAttacker) {
            const entity = this.getEntity(attacker.id, "player");
            const weapon = entity?.equipped?.slots?.get("WEAPON");
            const weaponType = weapon?.type?.toLowerCase();
            console.log("Attacker weaponType:", weaponType);
            attackerSkill = attacker.combat;
        } else {
            attackerSkill = attacker.combat ?? attacker.attack ?? 0;
        }

        console.log("attackerSkill FINAL:", attackerSkill);

        // ===== Defender skill =====
        if (isPlayerDefender) {
            const entity = this.getEntity(defender.id, "player");

            console.log("Defender equipped:", entity?.equipped);

            if (entity?.aShield > 0) {
                defenderSkill = entity?.aShield ?? entity?.defence ?? 0;
            } else {
                const weapon = entity?.equipped?.slots?.get("WEAPON");
                const weaponType = weapon?.type?.toLowerCase();

                if (weaponType && entity?.[weaponType] != null) {
                    defenderSkill = entity[weaponType];
                } else {
                    defenderSkill = entity?.defence ?? 0;
                }
            }

            console.log("defenderSkill FINAL:", defenderSkill);
        } else {
            defenderSkill = defender.defence ?? defender.defense ?? 0;
        }

        // ===== Roll =====
        const attackRoll = (attackerSkill || 0) + Math.floor(Math.random() * 10) + 1;
        const defenseRoll = (defenderSkill || 0) + Math.floor(Math.random() * 10) + 1;

        console.log("attackRoll:", attackRoll, "defenseRoll:", defenseRoll);

        const diff = attackRoll - defenseRoll;

        console.log("diff:", diff);

        // ===== miss =====
        if (diff <= 0) {
            console.log("MISS -> returning early");
            return { hit: false, shieldDamage: 0, wound: 0 };
        }
        // ===== shield check =====
        let shieldDamage = 0;
        if (isPlayerDefender && defender.shield > 0) {
            const shieldProt = defender.shield ?? 0;
            if (diff <= shieldProt) {
                shieldDamage = diff;        
                return { hit: false, shieldDamage, wound: 0 };
            }
        }    
        // ===== damage =====
        const strengthRoll = Math.max(0, attacker.strength - (Math.floor(Math.random() * 10) + 1));
        const wound = Math.max(0, diff + strengthRoll + (attacker.wDamage || 0));
        console.log("raw wound:", wound, "strengthRoll:", strengthRoll, "diff:", diff);

        // ===== armor =====
        let armorAbsorb = 0;
        if (isPlayerDefender && defender.armour) {
            const locRoll = Math.floor(Math.random() * 20) + 1;
            console.log("armor locRoll:", locRoll);
            let location;
            if (locRoll <= 14) location = 'ARMOUR';
            else if (locRoll <= 16) location = 'GLOVES';
            else if (locRoll <= 18) location = 'BOOTS';
            else location = 'HELM';
            console.log("armor location:", location);
            const entity = this.getEntity(defender.id, "player");
            const armorPiece = entity?.equipped?.slots?.get(location);
            const armorProt = armorPiece?.armourValue || 0;
            console.log("armor piece:", armorPiece, "armorProt:", armorProt);
            armorAbsorb = armorProt;
            console.log("armorAbsorb:", armorAbsorb);
        }
        const finalWound = Math.max(0, wound - armorAbsorb);
        console.log("FINAL wound:", finalWound);
        console.log("===== resolveHit END =====");
        return {
            hit: true,
            shieldDamage,
            wound: finalWound,
            armorAbsorb
        };
    }

    endCombat() {
        clearTimeout(this.turnTimer);
        console.log("END", {
            combatId: this.combatId,
            remainingActors: [...this.actors.keys()]
        });

        this.inProgress = false;

        for (let id of this.actors.keys()) {
            const actor = this.actors.get(id);

            if (actor.type === "enemy") {
                const e = this.room.state.enemies.get(id);
                const logic = this.room.enemyInstances.get(id);

                if (e) e.inCombat = 0;

                if (logic) {
                    logic.destination = null;
                    logic.targetPlayer = null;
                    logic.leaderId = null;
                    logic.state = "idle";
                }
            }

            if (actor.type === "player") {
                const p = this.room.state.players.get(id);
                if (p) p.inCombat = 0;
            }
        }

        this.broadcastToCombat("combatEnd", { combatId: this.combatId });

        this.turnOrder = [];
        this.actors.clear();
        this.currentIndex = 0;

        this.room.activeCombats.delete(this.combatId);
    }

    quietDispose() {
        // Used when merging combats — don't broadcast end, just clean up
        clearTimeout(this.turnTimer);
        this.disposed = true;
        this.inProgress = false;
        this.turnOrder = [];
        this.actors.clear();
        this.pendingActors = [];
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
