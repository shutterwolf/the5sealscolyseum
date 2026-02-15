import { CombatState, ActorState } from "./CombatState";

export class CombatCore {

  private cutoff: number = 0.8;

  constructor(private state: CombatState) {}

  /* =========================================
     PUBLIC API
  ========================================= */

  public addActor(data: {
    id: string,
    type: "player" | "enemy",
    x: number,
    y: number,
    z: number,
    hp: number,
    combat: number,
    defence: number,
    strength: number,
    wDamage: number
  }) {

    if (this.state.actors.has(data.id)) return;

    const actor = new ActorState();

    actor.id = data.id;
    actor.type = data.type;
    actor.x = data.x;
    actor.y = data.y;
    actor.z = data.z;

    actor.hp = data.hp;
    actor.combat = data.combat;
    actor.defence = data.defence;
    actor.strength = data.strength;
    actor.wDamage = data.wDamage;

    actor.inCombat = true;
    actor.targetId = "";

    this.state.actors.set(actor.id, actor);
  }

  public removeActor(id: string) {

    if (!this.state.actors.has(id)) return;

    this.state.actors.delete(id);

    this.state.turnOrder =
      this.state.turnOrder.filter(x => x !== id);

    if (this.state.currentIndex >= this.state.turnOrder.length) {
      this.state.currentIndex = 0;
    }

    if (this.state.actors.size < 2) {
      this.endCombat();
    }
  }

  public setTarget(attackerId: string, targetId: string) {

    const attacker = this.state.actors.get(attackerId);
    const target = this.state.actors.get(targetId);

    if (!attacker || !target) return;

    attacker.targetId = targetId;
  }

  public startCombat() {

    if (this.state.actors.size < 2) return;

    this.state.inProgress = true;
    this.state.round = 1;

    this.rollInitiative();
    this.state.currentIndex = 0;
  }

  public attack(attackerId: string, targetId: string) {

    if (!this.state.inProgress) return;

    const attacker = this.state.actors.get(attackerId);
    const target = this.state.actors.get(targetId);

    if (!attacker || !target) return;

    if (this.getCurrentActorId() !== attackerId) return;

    attacker.targetId = targetId;

    if (!this.isInRange(attacker, target)) {
      this.removeActor(attackerId);
      return;
    }

    const damage = this.resolveHit(attacker, target);

    if (damage > 0) {
      target.hp -= damage;
    }

    if (target.hp <= 0) {
      this.removeActor(targetId);
    }

    this.endTurn();
  }

  public updatePosition(id: string, x: number, y: number, z: number) {

    const actor = this.state.actors.get(id);
    if (!actor) return;

    actor.x = x;
    actor.y = y;
    actor.z = z;
  }

  /* =========================================
     TURN LOGIC
  ========================================= */

  private endTurn() {

    this.checkDistances();

    if (this.state.actors.size < 2) {
      this.endCombat();
      return;
    }

    this.state.currentIndex++;

    if (this.state.currentIndex >= this.state.turnOrder.length) {
      this.state.currentIndex = 0;
      this.state.round++;
      this.rollInitiative();
    }
  }

  private rollInitiative() {

    const scored: { id: string, score: number }[] = [];

    this.state.actors.forEach(actor => {

      const score =
        actor.combat -
        Math.floor(Math.random() * 12) + 1;

      scored.push({ id: actor.id, score });
    });

    scored.sort((a, b) => b.score - a.score);

    this.state.turnOrder = scored.map(s => s.id);
  }

  private getCurrentActorId(): string {
    return this.state.turnOrder[this.state.currentIndex];
  }

  /* =========================================
     DISTANCE CHECK
  ========================================= */

  private checkDistances() {

    const toRemove: string[] = [];

    this.state.actors.forEach(actor => {

      if (!actor.targetId) return;

      const target = this.state.actors.get(actor.targetId);
      if (!target) return;

      if (!this.isInRange(actor, target)) {
        toRemove.push(actor.id);
      }
    });

    toRemove.forEach(id => this.removeActor(id));
  }

  private isInRange(a: ActorState, b: ActorState): boolean {

    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;

    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

    return dist <= this.cutoff;
  }

  /* =========================================
     DAMAGE SYSTEM
  ========================================= */

  private resolveHit(attacker: ActorState, target: ActorState): number {

    const att = attacker.combat;
    const def = target.defence;

    const diceAt = Math.floor(Math.random() * 10);
    const diceDef = Math.floor(Math.random() * 10);

    const combat = (att + diceAt) - (def + diceDef);

    if (combat <= 0) return 0;

    let wound = 0;
    const rolls = Math.min(attacker.wDamage, combat);

    for (let i = 0; i < rolls; i++) {
      wound += 1 + Math.floor(Math.random() * 4);
    }

    if (attacker.strength > attacker.wDamage) {
      wound += Math.min(
        attacker.strength - attacker.wDamage,
        combat
      );
    }

    return wound;
  }

  /* =========================================
     END COMBAT
  ========================================= */

  private endCombat() {
    this.state.inProgress = false;
    this.state.turnOrder = [];
    this.state.currentIndex = 0;
  }
}
