const { EventEmitter } = require('events');

/**
 * WorldEventManager v5
 * 
 * FIX: startsAt per avvio automatico
 * FIX: endsAt calcolato come now + hours allo start
 * FIX: setInterval che controlla eventi scheduled ogni 60s
 */
class WorldEventManager extends EventEmitter {
  constructor({ db, FieldValue }) {
    super();
    this.db = db;
    this.FieldValue = FieldValue;
    this.rooms = [];
    this.activeEvents = new Map(); // eventId -> { eventData, timer }
    this.checkInterval = null;
  }

  addRoom(room) { this.rooms.push(room); }
  removeRoom(room) { this.rooms = this.rooms.filter(r => r !== room); }

  broadcast(type, data) {
    for (const room of this.rooms) room.broadcast(type, data);
  }

  sendToPlayer(playerId, type, data) {
    for (const room of this.rooms) {
      const map = room.sessionToPlayerId;
      if (!map) continue;
      for (const [sid, pid] of map.entries()) {
        if (pid === playerId) {
          const client = room.clients.find(c => c.sessionId === sid);
          if (client) { client.send(type, data); return true; }
        }
      }
    }
    return false;
  }

  /* ---------- Startup: restore + auto-start scheduled events ---------- */
  async init() {
    // Restore already-active events
    await this._restoreActiveEvents();

    // Start cron: check for scheduled events whose startsAt has passed
    this.checkInterval = setInterval(() => this._checkScheduledEvents(), 60000);
    console.log("[WEM] Init complete, checking scheduled events every 60s");
  }

  async _restoreActiveEvents() {
    try {
      const snap = await this.db.collection('world_events').where('status', '==', 'active').get();
      const now = Date.now();
      let restored = 0;

      for (const doc of snap.docs) {
        const event = doc.data();
        const eventId = String(event.eventId);
        const endsAt = this._toDate(event.endsAt);
        const msLeft = endsAt.getTime() - now;

        if (msLeft <= 0) {
          console.log(`[WEM] Event ${eventId} expired, resolving...`);
          await this.resolveEvent(eventId);
          continue;
        }

        const timer = setTimeout(() => this.resolveEvent(eventId), msLeft);
        this.activeEvents.set(eventId, { ...event, _timer: timer });
        restored++;
        console.log(`[WEM] Restored active ${eventId}, ${Math.round(msLeft/1000)}s left`);
      }
      console.log(`[WEM] Restored ${restored} active events`);
    } catch (err) {
      console.error("[WEM] _restoreActiveEvents failed:", err.message);
    }
  }

  async _checkScheduledEvents() {
    try {
        const now = new Date();
        // Query semplice: solo where status (non richiede indice composito)
        const snap = await this.db.collection('world_events')
            .where('status', '==', 'scheduled')
            .get();

        for (const doc of snap.docs) {
            const event = doc.data();
            const startsAt = this._toDate(event.startsAt);
            
            // Filtra in memoria
            if (startsAt > now) continue;
            
            const eventId = String(event.eventId);
            console.log(`[WEM] Auto-starting scheduled event ${eventId}`);
            await this.startEvent(eventId);
        }
    } catch (err) {
        console.error("[WEM] _checkScheduledEvents failed:", err.message);
    }
}

  _toDate(val) {
    if (val?.toDate) return val.toDate();
    if (val instanceof Date) return val;
    return new Date(val);
  }

  /* ---------- Lifecycle ---------- */
  async scheduleEvent(eventData) {
    // startsAt: when the event should auto-start
    // hours: how long it lasts once started
    const payload = {
      ...eventData,
      status: 'scheduled',
      createdAt: new Date()
    };
    await this.db.collection('world_events').doc(String(eventData.eventId)).set(payload);
    return payload;
  }

  async startEvent(eventId) {
    eventId = String(eventId);
    const doc = await this.db.collection('world_events').doc(eventId).get();
    if (!doc.exists) { console.warn('[WEM] Event not found:', eventId); return; }
    const event = doc.data();
    if (event.status !== 'scheduled') return;

    // Calculate endsAt: now + hours
    const hours = event.hours || 72;
    const endsAt = new Date(Date.now() + hours * 3600000);

    await this.db.collection('world_events').doc(eventId).update({
      status: 'active',
      startedAt: new Date(),
      endsAt: endsAt
    });

    const ms = endsAt.getTime() - Date.now();
    let timer = null;
    if (ms > 0) timer = setTimeout(() => this.resolveEvent(eventId), ms);

    this.activeEvents.set(eventId, { ...event, status: 'active', endsAt, _timer: timer });

    this.broadcast('world:event:started', {
      eventId: event.eventId,
      title: event.title,
      type: event.type,
      targetCity: event.targetCity,
      faction1: event.faction1,
      faction2: event.faction2,
      enemiesTotal: event.enemiesTotal,
      enemiesRaceName: event.enemiesRaceName,
      flags: event.flags,
      endsAt: endsAt.toISOString()
    });
    console.log(`[WEM] Event ${eventId} started, ends at ${endsAt.toISOString()}`);
  }

  async resolveEvent(eventId) {
    eventId = String(eventId);
    const cached = this.activeEvents.get(eventId);
    if (!cached) return;
    if (cached._timer) clearTimeout(cached._timer);

    const eventRef = this.db.collection('world_events').doc(eventId);
    const eventDoc = await eventRef.get();
    if (!eventDoc.exists) { this.activeEvents.delete(eventId); return; }
    const event = eventDoc.data();
    if (event.status === 'resolved') { this.activeEvents.delete(eventId); return; }

    let winner = null;
    if (event.type === 'politic') {
      const c1 = event.faction1Count || 0;
      const c2 = event.faction2Count || 0;
      winner = c1 >= c2 ? event.faction1 : event.faction2;
    } else if (event.type === 'siege') {
      winner = (event.enemiesRace || 0) >= (event.enemiesTotal || 1) ? 'defenders' : 'attackers';
    }

    await eventRef.update({ status: 'resolved', resolvedAt: new Date(), winner });
    await this._applyOutcomesToAllParticipants(eventId, event, winner);

    this.activeEvents.delete(eventId);
    this.broadcast('world:event:resolved', { eventId, winner });
    console.log(`[WEM] Event ${eventId} resolved. Winner: ${winner}`);
  }

  /* ---------- Apply outcomes ---------- */
  async _applyOutcomesToAllParticipants(eventId, event, winner) {
    try {
      const playersSnap = await this.db.collection('world_event_players')
        .doc(eventId).collection('players').get();
      if (playersSnap.empty) { console.log(`[WEM] No participants for ${eventId}`); return; }

      const updates = [];
      playersSnap.forEach(doc => {
        updates.push(this._applySingleOutcome(doc.id, eventId, event, winner, doc.data()));
      });

      const results = await Promise.allSettled(updates);
      let ok = 0, fail = 0;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok++;
        else { fail++; console.error(`[WEM] Outcome failed ${playersSnap.docs[i].id}:`, r.reason?.message); }
      });
      console.log(`[WEM] Outcomes: ${ok} OK, ${fail} FAILED`);
    } catch (err) {
      console.error("[WEM] _applyOutcomesToAllParticipants failed:", err.message);
    }
  }

  async _applySingleOutcome(playerId, eventId, event, winner, pState) {
    if (pState.outcomeApplied) return;

    let flagToAdd = null;
    if (event.type === 'politic') {
      flagToAdd = (pState.chosenFaction === winner) ? event.flags[0] : event.flags[1];
    } else if (event.type === 'siege') {
      const kills = pState.raceEnemies || 0;
      if (kills >= 150) flagToAdd = event.flags[2];
      else if (kills >= 50) flagToAdd = event.flags[1];
      else if (kills >= 10) flagToAdd = event.flags[0];
    }
    if (!flagToAdd) return;

    try {
      await this.db.collection('characters').doc(playerId).update({
        flags: this.FieldValue.arrayUnion(flagToAdd)
      });
    } catch (e) {
      console.error(`[WEM] Flag write failed ${playerId}:`, e.message);
    }

    try {
      await this.db.collection('world_event_players').doc(eventId)
        .collection('players').doc(playerId).update({
          outcomeApplied: true, flag: flagToAdd, resolvedAt: new Date()
        });
    } catch (e) {
      console.error(`[WEM] outcomeApplied update failed ${playerId}:`, e.message);
    }

    this.sendToPlayer(playerId, 'world:event:outcome', {
      eventId,
      result: event.type === 'politic' ? (pState.chosenFaction === winner ? 'winner' : 'loser') : 'resolved',
      flag: flagToAdd,
      raceEnemies: pState.raceEnemies || 0
    });
  }

  /* ---------- Player actions ---------- */
  async joinFaction(playerId, eventId, faction) {
    eventId = String(eventId);
    const event = this.activeEvents.get(eventId);
    if (!event) throw new Error('Event not active');

    await this.db.collection('world_event_players').doc(eventId)
      .collection('players').doc(playerId).set({
        chosenFaction: faction, joinedAt: new Date()
      }, { merge: true });

    this.sendToPlayer(playerId, 'world:event:joined', { eventId, faction });
    return { success: true };
  }

  async reportQuestComplete(playerId, eventId, faction) {
    eventId = String(eventId);
    const event = this.activeEvents.get(eventId);
    if (!event || event.type !== 'politic') return { ignored: true };

    const incField = faction === event.faction1 ? 'faction1Count' : 'faction2Count';
    await this.db.collection('world_events').doc(eventId).update({
      [incField]: this.FieldValue.increment(1)
    });

    await this.db.collection('world_event_players').doc(eventId)
      .collection('players').doc(playerId).set({
        chosenFaction: faction, lastQuestAt: new Date()
      }, { merge: true });

    const doc = await this.db.collection('world_events').doc(eventId).get();
    const data = doc.data();

    this.broadcast('world:event:standings', {
      eventId,
      faction1: event.faction1,
      faction2: event.faction2,
      faction1Count: data.faction1Count || 0,
      faction2Count: data.faction2Count || 0
    });
    return { success: true };
  }

  async reportEnemyKill(playerId, eventId, count = 1) {
    eventId = String(eventId);
    const event = this.activeEvents.get(eventId);
    if (!event || event.type !== 'siege') return { ignored: true };

    await this.db.collection('world_events').doc(eventId).update({
      enemiesRace: this.FieldValue.increment(count)
    });

    await this.db.collection('world_event_players').doc(eventId)
      .collection('players').doc(playerId).set({
        raceEnemies: this.FieldValue.increment(count)
      }, { merge: true });

    const doc = await this.db.collection('world_events').doc(eventId).get();
    const data = doc.data();
    const killed = data.enemiesRace || 0;
    const total = data.enemiesTotal || 1;

    this.broadcast('world:siege:progress', {
      eventId, enemiesRace: killed, enemiesTotal: total, remaining: total - killed
    });

    if (killed >= total) {
      await this.resolveEvent(eventId);
      return { success: true, citySaved: true };
    }
    return { success: true, enemiesRace: killed };
  }

  async getActiveEvents() {
    const snap = await this.db.collection('world_events').where('status', '==', 'active').get();
    const out = [];
    snap.forEach(d => out.push(d.data()));
    return out;
  }
}

module.exports = { WorldEventManager };
