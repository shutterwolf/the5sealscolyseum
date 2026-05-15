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
        // =========================
        // HP SAFE
        // =========================
        let initialHP = 20;
        if (type === "player") {
            initialHP =
                entity?.phealth ??
                stats.hp ??
                20;
        } else {
            initialHP =
                entity?.health ??
                stats.hp ??
                20;
        }
        // =========================
        // ATTACK SKILL (NO RICALCOLO)
        // =========================
        let attackSkill = stats.combat ?? 5;
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
            combat: attackSkill,
            defence: defenseSkill,
            strength: stats.strength ?? 3,
            wDamage: stats.wDamage ?? 2,
            shield: shieldProtection,
            armour: armorValue,
            weaponType,
            targetId: null
        });
        // =========================
        // SYNC STATE
        // =========================
        if (entity) {
            if (type === "player") entity.phealth = initialHP;
            if (type === "enemy") entity.health = initialHP;
        }
    }

    removeActor(id) {
        if (!this.actors.has(id)) return;
        const wasCurrent = this.turnOrder[this.currentIndex] === id;
        // ✅ QUI
        const indexRemoved = this.turnOrder.indexOf(id);
        this.actors.delete(id);
        this.turnOrder = this.turnOrder.filter(x => x !== id);
        if (this.turnOrder.length === 0) {
            this.currentIndex = 0;
            return;
        }
        if (wasCurrent) {
            if (this.currentIndex >= this.turnOrder.length) {
                this.currentIndex = 0;
            }
        } else {
            if (indexRemoved !== -1 && indexRemoved < this.currentIndex) {
                this.currentIndex--;
            }
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
        console.log("START", {
            combatId: this.combatId,
            actors: [...this.actors.keys()]
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
    }

    onActorAnimationFinished(actorId) {
        console.log("TURN_RESOLVE_BEGIN", {
            combatId: this.combatId,
            actorId,
            currentActorId: this.getCurrentActorId()
        });
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
        target.lastHitBy = actor.id;
        target.lastWeaponUsed = actor.weaponType;
        /*
        if (!this.isInRange(actorId, actor.targetId)) {
            this.removeActor(actorId);
            this.broadcastToCombat("disengage", { id: actorId });
            return;
        }*/
        const result = this.resolveHit(actor, target);
        console.log("HIT_RESULT", {
            combatId: this.combatId,
            attackerId: actor.id,
            targetId: target.id,
            result,
            targetHpBefore: target.hp
        });
        const wound = result.wound || 0;
        if (result.hit && wound > 0) {
            target.hp -= wound;
            this.updateEntityHP(target.id, target.type, target.hp);
            console.log("HP_APPLY", {
                combatId: this.combatId,
                targetId: target.id,
                targetHpAfter: target.hp
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
        
        if (target.hp <= 0) {
            target.isDead = true;
            target.lootReady = true;
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
                if (!entity) return;
        
                const weaponType = killer.weaponType?.toLowerCase();
                advKey = weaponType + "Adv";
        
                const currentSkillLevel = entity[weaponType] ?? 1;
        
                const enemyValue =
                    (target.hpMax ?? 10) +
                    (target.combat ?? 0);
        
                xpGain = Math.max(
                    1,
                    Math.floor((enemyValue * 0.3) / currentSkillLevel)
                );
        
                entity[advKey] = (entity[advKey] ?? 0) + xpGain;
            }
        
            this.broadcastToCombat("actorDied", {
                id: target.id,
                killerId: killerId,
                skill: advKey,
                xpGain: xpGain
            });
        
            this.removeActor(target.id);
        }
        this.endTurn();
    }

    endTurn() {
        if (this.actors.size < 2) {
            this.endCombat();
            return;
        }
    
        this.currentIndex++;
    
        // 👉 FINE ROUND
        if (this.currentIndex >= this.turnOrder.length) {
            this.round++;
    
            // 🔥 ricalcola iniziativa SOLO qui
            this.rollInitiative();
            this.currentIndex = 0;
        }
        const nextActorId = this.getCurrentActorId();
        const nextActor = this.actors.get(nextActorId);
        console.log("NEXT_TURN", {
            combatId: this.combatId,
            round: this.round,
            currentIndex: this.currentIndex,
            nextActorId
        });
        this.broadcastToCombat("startTurn", {
            actorId: nextActorId,
            targetId: nextActor?.targetId ?? null
        });
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
        
            if (weaponType && entity?.[weaponType] != null) {
                attackerSkill = entity[weaponType];
            } else {
                attackerSkill = entity?.combat ?? 0;
            }
        } else {
            attackerSkill = attacker.combat ?? attacker.attack ?? 0;
        }
        
        console.log("attackerSkill FINAL:", attackerSkill);
    
        // ===== Defender skill =====
        if (isPlayerDefender) {
            const entity = this.getEntity(defender.id, "player");
        
            console.log("Defender equipped:", entity?.equipped);
        
            if (entity?.shield > 0) {
                defenderSkill = entity?.aShield ?? entity?.defence ?? 0;
            } else {
                const weaponType = entity?.equipped?.WEAPON?.type?.toLowerCase();
        
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
        const roll =
            Math.floor(Math.random() * attacker.strength) +
            (attacker.wDamage || 0);
        const wound = diff + roll;
        console.log("raw wound:", wound, "roll multiplier:", roll, "diff",diff);
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
            const armorProt = armorPiece.armourValue || 0;
            console.log("armor piece:", armorPiece, "armorProt:", armorProt);
            armorAbsorb = armorProt > 0
                ? Math.floor(Math.random() * armorProt) + 1
                : 0;
            console.log("armorAbsorb:", armorAbsorb);
        }
        const finalWound = wound - armorAbsorb;
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
                    logic.targetPlayerId = null;
                    logic.leaderId = null;
    
                    // 🔥 RIATTIVA AI
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
            if (p) p.phealth = hp;   // ← usa phealth
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
