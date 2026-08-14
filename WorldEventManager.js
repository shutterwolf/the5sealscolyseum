const { EventEmitter } = require('events');

/**
 * WorldEventManager
 * Orchestrates global timed events (political, siege, etc.)
 * Works with Colyseus rooms — no Redis required, uses in-memory Maps.
 * Persists event config/outcome to Firestore (your existing db).
 */
class WorldEventManager extends EventEmitter {
  constructor({ db }) {
    super();
    this.db = db;
    this.rooms = [];              // Colyseus Room instances
    this.activeEvents = new Map();  // eventId -> active event state
    this.timers = new Map();        // eventId -> timeout handle
    this.handlers = new Map();      // type -> HandlerClass
    this.rumors = new Map();        // eventId -> rumors[]
    this.playerStates = new Map();  // playerId -> { eventId -> state }
  }

  /* ---------- Room management ---------- */

  addRoom(room) {
    this.rooms.push(room);
  }

  removeRoom(room) {
    this.rooms = this.rooms.filter(r => r !== room);
  }

  broadcast(type, data) {
    for (const room of this.rooms) {
      room.broadcast(type, data);
    }
  }

  sendToPlayer(playerId, type, data) {
    for (const room of this.rooms) {
      const map = room.sessionToPlayerId;
      if (!map) continue;
      let sessionId = null;
      for (const [sid, pid] of map.entries()) {
        if (pid === playerId) { sessionId = sid; break; }
      }
      if (!sessionId) continue;
      const client = room.clients.find(c => c.sessionId === sessionId);
      if (client) {
        client.send(type, data);
        return true;
      }
    }
    return false;
  }

  /* ---------- Helpers ---------- */

  _getPlayerCity(playerId) {
    for (const room of this.rooms) {
      const p = room.state.players.get(playerId);
      if (p) {
        // Your schema uses dungeonId + localMap/depth.
        // When dungeonId is empty, localMap represents the city/overworld.
        return (p.dungeonId === "" || p.dungeonId === undefined)
          ? String(p.localMap ?? "")
          : null;
      }
    }
    return null;
  }

  _isPlayerInCity(playerId, cityId) {
    return this._getPlayerCity(playerId) === String(cityId);
  }

  _ensurePlayerState(playerId, eventId) {
    if (!this.playerStates.has(playerId)) {
      this.playerStates.set(playerId, {});
    }
    const states = this.playerStates.get(playerId);
    if (!states[eventId]) {
      states[eventId] = {
        knownRumors: [],
        chosenFaction: null,
        factionWeight: 0,
        enemiesKilled: 0,
        activeQuest: null,
        outcomeReceived: false,
        effects: [],
        flags: []
      };
    }
    return states[eventId];
  }

  /* ---------- Registration ---------- */

  registerHandler(type, HandlerClass) {
    this.handlers.set(type, HandlerClass);
  }

  loadRumors(eventId, rumorsArray) {
    this.rumors.set(eventId, rumorsArray);
  }

  /* ---------- Event lifecycle ---------- */

  async scheduleEvent(eventData) {
    const docRef = this.db.collection('world_events').doc(eventData.eventId);
    const payload = {
      ...eventData,
      status: 'scheduled',
      createdAt: new Date()
    };
    await docRef.set(payload);
    return payload;
  }

  async startEvent(eventId) {
    const doc = await this.db.collection('world_events').doc(eventId).get();
    if (!doc.exists) {
      console.warn('[WorldEventManager] Event not found:', eventId);
      return;
    }
    const event = doc.data();
    if (event.status !== 'scheduled') return;

    const HandlerClass = this.handlers.get(event.type);
    if (!HandlerClass) throw new Error('No handler for type: ' + event.type);

    const handler = new HandlerClass(this, event);

    // Build active state
    const activeState = {
      ...event,
      handler,
      startedAt: Date.now()
    };

    if (event.type === 'political') {
      activeState.factions = {};
      for (const f of event.config.factions || []) activeState.factions[f] = 0;
    }

    if (event.type === 'siege') {
      activeState.siege = {
        totalEnemies: event.config.totalEnemies || 5000,
        killed: 0
      };
    }

    this.activeEvents.set(eventId, activeState);

    await this.db.collection('world_events').doc(eventId).update({
      status: 'active',
      startedAt: new Date()
    });

    // Dispatch rumors
    await this._dispatchRumors(event);

    // Handler start hook
    await handler.onStart();

    // Auto-resolve timer
    const endsAt = event.endsAt.toDate ? event.endsAt.toDate() : new Date(event.endsAt);
    const msUntilEnd = endsAt.getTime() - Date.now();
    if (msUntilEnd > 0) {
      const timer = setTimeout(() => this.resolveEvent(eventId), msUntilEnd);
      this.timers.set(eventId, timer);
    }

    this.broadcast('world:event:started', {
      eventId: event.eventId,
      type: event.type,
      targetCity: event.targetCity,
      endsAt: endsAt.toISOString()
    });

    console.log(`[WorldEventManager] Event ${eventId} started. Ends at ${endsAt.toISOString()}`);
  }

  async resolveEvent(eventId) {
    const active = this.activeEvents.get(eventId);
    if (!active) return;

    const outcome = await active.handler.calculateOutcome();
    await active.handler.applyOutcome(outcome);

    await this.db.collection('world_events').doc(eventId).update({
      status: 'resolved',
      resolvedAt: new Date(),
      winner: outcome.winner || null,
      outcomeData: outcome
    });

    this.activeEvents.delete(eventId);
    if (this.timers.has(eventId)) {
      clearTimeout(this.timers.get(eventId));
      this.timers.delete(eventId);
    }

    this.broadcast('world:event:resolved', {
      eventId,
      type: active.type,
      winner: outcome.winner,
      summary: outcome.summary
    });

    console.log(`[WorldEventManager] Event ${eventId} resolved. Winner: ${outcome.winner || 'none'}`);
  }

  /* ---------- Rumors ---------- */

  async _dispatchRumors(event) {
    const allRumors = this.rumors.get(event.eventId) || [];
    // Sort by chain order
    allRumors.sort((a, b) => (a.chainOrder || 0) - (b.chainOrder || 0));

    for (const rumor of allRumors) {
      if (rumor.chainDelayMs > 0) {
        setTimeout(() => this._sendRumor(rumor, event), rumor.chainDelayMs);
      } else {
        await this._sendRumor(rumor, event);
      }
    }
  }

  async _sendRumor(rumor, event) {
    const targetCity = String(event.targetCity);

    for (const room of this.rooms) {
      room.state.players.forEach((player, playerId) => {
        const inTargetCity = this._isPlayerInCity(playerId, targetCity);

        if (rumor.distributionScope === 'global') {
          this._deliverRumor(playerId, rumor, event);
          return;
        }

        if (rumor.distributionScope === 'regional') {
          // Simplified: deliver to everyone for now; refine with region logic if needed
          this._deliverRumor(playerId, rumor, event);
          return;
        }

        // local scope
        if (inTargetCity) {
          this._deliverRumor(playerId, rumor, event);
        } else {
          // Distant players get generic news once
          const ps = this._ensurePlayerState(playerId, event.eventId);
          if (!ps._distantRumorSent) {
            ps._distantRumorSent = true;
            this.sendToPlayer(playerId, 'world:rumor:received', {
              eventId: event.eventId,
              rumor: {
                rumorId: `distant_${event.eventId}`,
                text: `Ci sono gravi problemi a ${event.targetCity}. Dicono che la situazione sia critica.`,
                topic: 'distant_news',
                sourceNpcName: 'Viaggiatore',
                sourceNpcId: 'npc_generic_traveler',
                isDistant: true
              }
            });
          }
        }
      });
    }
  }

  _deliverRumor(playerId, rumor, event) {
    this.sendToPlayer(playerId, 'world:rumor:received', {
      eventId: event.eventId,
      rumor: {
        rumorId: rumor.rumorId,
        text: rumor.text,
        topic: rumor.topic,
        sourceNpcName: rumor.sourceNpcName,
        sourceNpcId: rumor.sourceNpcId,
        factionSpin: rumor.factionSpin || null
      }
    });

    const ps = this._ensurePlayerState(playerId, event.eventId);
    if (!ps.knownRumors.find(r => r.rumorId === rumor.rumorId)) {
      ps.knownRumors.push({
        rumorId: rumor.rumorId,
        receivedAt: new Date(),
        sourceNpcId: rumor.sourceNpcId
      });
    }
  }

  /* ---------- Player actions ---------- */

  async playerChooseFaction(playerId, eventId, faction) {
    const active = this.activeEvents.get(eventId);
    if (!active) throw new Error('Event not active');

    const result = await active.handler.onPlayerChooseFaction(playerId, faction);
    const ps = this._ensurePlayerState(playerId, eventId);
    ps.chosenFaction = faction;
    if (result.weight) ps.factionWeight = result.weight;

    return result;
  }

  async playerQuestProgress(playerId, eventId, data) {
    const active = this.activeEvents.get(eventId);
    if (!active) throw new Error('Event not active');
    return await active.handler.onQuestProgress(playerId, data);
  }

  async playerEnemyKilled(playerId, eventId, data) {
    const active = this.activeEvents.get(eventId);
    if (!active || active.type !== 'siege') return { ignored: true };
    return await active.handler.onEnemyKilled(playerId, data);
  }

  async getActiveEventsForPlayer(playerId) {
    const out = [];
    for (const [eventId, event] of this.activeEvents) {
      const ps = this._ensurePlayerState(playerId, eventId);
      out.push({
        eventId,
        type: event.type,
        targetCity: event.targetCity,
        endsAt: event.endsAt,
        playerState: {
          chosenFaction: ps.chosenFaction,
          factionWeight: ps.factionWeight,
          enemiesKilled: ps.enemiesKilled,
          knownRumorsCount: ps.knownRumors.length
        }
      });
    }
    return out;
  }

  /* ---------- Area lock helpers (used by siege) ---------- */

  isAreaLocked(playerId, areaId) {
    // Check player state for active locks
    const now = Date.now();
    for (const [eventId, ps] of this.playerStates.get(playerId) || {}) {
      if (!ps.effects) continue;
      for (const eff of ps.effects) {
        if (eff.type === 'area_lock' && eff.areaId === areaId) {
          const expires = eff.appliedAt + eff.duration;
          if (expires > now) return { locked: true, reason: eff.reason, expiresAt: expires };
        }
      }
    }
    return { locked: false };
  }
}

module.exports = { WorldEventManager };
