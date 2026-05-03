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
    
        // valori sicuri
        let initialHP = 20;
        if (type === "player") {
            if (entity && typeof entity.phealth === "number") initialHP = entity.phealth;
            else if (typeof stats.hp === "number") initialHP = stats.hp;
        } else {
            if (entity && typeof entity.health === "number") initialHP = entity.health;
            else if (typeof stats.hp === "number") initialHP = stats.hp;
        }
        let attackSkill = stats.combat ?? 5;

        if (type === "player") {
        
            const weaponType = stats.equipped?.WEAPON?.type?.toLowerCase();
        
            switch (weaponType) {
                case "blades":
                    attackSkill = stats.blades ?? stats.combat ?? 5;
                    break;
        
                case "maces":
                    attackSkill = stats.maces ?? stats.combat ?? 5;
                    break;
        
                case "axes":
                    attackSkill = stats.axes ?? stats.combat ?? 5;
                    break;
        
                case "polearms":
                    attackSkill = stats.polearms ?? stats.combat ?? 5;
                    break;
            }
        }
        
        let defenseSkill = stats.defence ?? 5;
        let shieldProtection = 0;
        
        if (type === "player" && stats.equipped?.SHIELD) {
            defenseSkill = stats.aShield ?? defenseSkill;
            shieldProtection = stats.shield?.protection ?? 0;
        }
        this.actors.set(id, {
            id,
            type,
            hp: initialHP,
            combat: attackSkill ?? 5,
            defence: defenseSkill ?? 5,
            strength: stats.strength ?? 3,
            wDamage: stats.wDamage ?? 2,
            shield: shieldProtection ?? 0,
            targetId: null
        });
    
        // Aggiorna lo state corretto
        if (entity) {
            if (type === "player") entity.phealth = initialHP;
            if (type === "enemy") entity.health = initialHP;
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
        /*
        if (!this.isInRange(actorId, actor.targetId)) {
            this.removeActor(actorId);
            this.broadcastToCombat("disengage", { id: actorId });
            return;
        }*/
        const result = this.resolveHit(actor, target);
        const damage = result.wound;
        if (result.hit && result.wound > 0) {
            target.hp -= damage;
            this.updateEntityHP(target.id, target.type, target.hp);
        }

        this.broadcastToCombat("damage", {
            attackerId: actorId,
            targetId: actor.targetId,
            damage: result.wound,
            shieldDamage: result.shieldDamage,
            armorAbsorb: result.armorAbsorb,
            hit: result.hit
        });
        
        if (target.hp <= 0) {
            this.broadcastToCombat("actorDied", { id: target.id });
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
        
            const weaponType = entity?.equipped?.WEAPON?.type?.toLowerCase();
        
            console.log("Attacker weaponType (SERVER STATE):", weaponType);
        
            if (weaponType) {
                attackerSkill = entity?.[weaponType] ?? entity?.combat ?? 0;
            } else {
                attackerSkill = entity?.combat ?? 0;
            }
        
            console.log("attackerSkill FINAL:", attackerSkill);
        }
    
        // ===== Defender skill =====
        if (isPlayerDefender) {
            const entity = this.getEntity(defender.id, "player");
        
            console.log("Defender equipped (SERVER STATE):", entity?.equipped);
        
            if (entity?.equipped?.SHIELD) {
                defenderSkill = entity?.aShield ?? entity?.defence ?? 0;
            } else {
                const weaponType = entity?.equipped?.WEAPON?.type?.toLowerCase();
        
                defenderSkill = entity?.[weaponType] ?? entity?.defence ?? 0;
            }
        
            console.log("defenderSkill FINAL:", defenderSkill);
        }
    
        // ===== Roll =====
        const attackRoll = safe(attackerSkill) + Math.floor(Math.random() * 10) + 1;
        const defenseRoll = safe(defenderSkill) + Math.floor(Math.random() * 10) + 1;
    
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
    
        if (isPlayerDefender && defender.equipped?.SHIELD && defender.equipped.SHIELD !== 0) {
    
            const shieldProt = defender.shield?.protection ?? 0;
    
            console.log("Shield protection:", shieldProt);
    
            if (diff <= shieldProt) {
                shieldDamage = diff * (Math.floor(Math.random() * 4) + 1);
    
                console.log("BLOCKED BY SHIELD -> shieldDamage:", shieldDamage);
    
                return { hit: false, shieldDamage, wound: 0 };
            }
        }
    
        // ===== damage =====
        const roll = Math.floor(Math.random() * 4) + 1;
        const wound = diff * roll;
    
        console.log("raw wound:", wound, "roll multiplier:", roll);
    
        // ===== armor =====
        let armorAbsorb = 0;
    
        if (isPlayerDefender && defender.armor) {
    
            const locRoll = Math.floor(Math.random() * 12) + 1;
    
            console.log("armor locRoll:", locRoll);
    
            let location;
    
            if (locRoll <= 6) location = 'ARMOUR';
            else if (locRoll <= 8) location = 'GLOVES';
            else if (locRoll <= 10) location = 'BOOTS';
            else location = 'HELM';
    
            console.log("armor location:", location);
    
            const armorPiece = defender.equipped?.[location];
    
            const armorProt = (armorPiece?.armourValue ?? 0) + (armorPiece?.variable ?? 0);
    
            console.log("armor piece:", armorPiece, "armorProt:", armorProt);
    
            armorAbsorb = armorProt > 0
                ? Math.floor(Math.random() * armorProt) + 1
                : 0;
    
            console.log("armorAbsorb:", armorAbsorb);
        }
    
        const finalWound = Math.max(0, wound - armorAbsorb);
    
        console.log("FINAL wound:", finalWound);
    
        console.log("===== resolveHit END =====");
    
        return {
            hit: true,
            shieldDamage: shieldDamage,
            wound: finalWound,
            armorAbsorb: armorAbsorb
        };
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
            if (actor.type === "player") {
                const p = this.room.state.players.get(id);
                if (p) p.inCombat = false; // oppure p.inCombat = 0 se usi numeri
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
