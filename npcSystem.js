const townShops = require("./townShops");

// ============================================================
// CONSTANTS
// ============================================================

const REPUTATION_THRESHOLDS = {
  HERO:      80,
  RENOWNED:  50,
  KNOWN:     20,
  NEUTRAL:   0,
  SUSPECT:  -20,
  OUTLAW:   -50
};

const AFFINITY_THRESHOLDS = {
  DEVOTED:   80,
  TRUSTED:   40,
  NEUTRAL:   0,
  COLD:     -20,
  HOSTILE:  -50
};

// Base attitude score used to calculate final effective attitude
const ATTITUDE_BASE = {
  friendly:  2,
  neutral:   0,
  diffident: -1,
  hostile:   -3
};

// How much reputation contributes to effective attitude (scaled)
const REPUTATION_WEIGHT = 0.03;

// How much affinity contributes to effective attitude (scaled)
const AFFINITY_WEIGHT   = 0.05;

// ============================================================
// PERSONALITY MODIFIERS
// Defines how each personality trait biases reputation and
// affinity contributions and applies special behavior rules.
// ============================================================

const PERSONALITY_RULES = {
  honest: {
    reputationBias:  1.0,
    affinityBias:    1.0,
    // Honest NPCs ignore negative flags if the player has high reputation
    flagOverride: (flags, reputation) =>
      reputation >= REPUTATION_THRESHOLDS.RENOWNED ? [] : flags
  },
  dishonest: {
    reputationBias:  0.5,
    affinityBias:    1.5,
    // Dishonest NPCs respond more to personal affinity than global rep
    flagOverride: null
  },
  greedy: {
    reputationBias:  0.8,
    affinityBias:    0.8,
    // Greedy NPCs apply a price modifier based on affinity
    priceModifier: (affinity) => {
      if (affinity >= AFFINITY_THRESHOLDS.TRUSTED)  return 0.90; // 10% discount
      if (affinity >= AFFINITY_THRESHOLDS.NEUTRAL)  return 1.10; // 10% markup
      return 1.25; // 25% markup for cold/hostile
    }
  },
  fearful: {
    reputationBias:  1.2,
    affinityBias:    0.8,
    // Fearful NPCs close shop if reputation is very negative
    refuseService: (reputation) => reputation <= REPUTATION_THRESHOLDS.OUTLAW
  },
  proud: {
    reputationBias:  1.3,
    affinityBias:    0.7,
    // Proud NPCs give extra bonus to players with very high reputation
    reputationBonus: (reputation) =>
      reputation >= REPUTATION_THRESHOLDS.HERO ? 2 : 0
  },
  loyal: {
    reputationBias:  0.9,
    affinityBias:    1.4,
    // Loyal NPCs penalize players with negative affinity more heavily
    affinityPenalty: (affinity) => affinity < 0 ? affinity * 0.5 : 0
  },
  manipulative: {
    reputationBias:  0.6,
    affinityBias:    1.6,
    // Manipulative NPCs pretend to be friendly even when affinity is low
    maskAttitude: true
  },
  cautious: {
    reputationBias:  1.1,
    affinityBias:    1.1,
    // Cautious NPCs require a minimum affinity to unlock some services
    minAffinityForFullService: AFFINITY_THRESHOLDS.NEUTRAL + 10
  },
  ambitious: {
    reputationBias:  1.5,
    affinityBias:    0.9,
    // Ambitious NPCs are strongly attracted to power (high reputation)
    reputationBonus: (reputation) =>
      reputation >= REPUTATION_THRESHOLDS.RENOWNED ? 1.5 : 0
  }
};

// ============================================================
// SOCIABILITY MODIFIERS
// Controls dialogue verbosity tier returned
// ============================================================

const SOCIABILITY_DIALOGUE = {
  talkative: "verbose",
  normal:    "standard",
  taciturn:  "brief"
};

// ============================================================
// FLAGS
// Each flag has a townId scope (null = global) and a modifier
// applied to the effective attitude score.
// ============================================================

const FLAGS = {
  // Player defended Marasil → all Marasil merchants gain +bonus toward player
  defender_of_marasil: {
    townId: 11,
    description: "Player defended Marasil",
    affinityBonus: 20,
    reputationBonus: 10
  },

  // Player helped Foren during crisis
  hero_of_foren: {
    townId: 0,
    description: "Player saved Foren",
    affinityBonus: 25,
    reputationBonus: 15
  },

  // Player betrayed Rekdar — all Rekdar NPCs are hostile
  betrayed_rekdar: {
    townId: 2,
    description: "Player betrayed Rekdar",
    affinityBonus: -30,
    reputationBonus: -20
  },

  // Player is allied with the thieves guild — thieves role NPCs are friendly globally
  thieves_guild_ally: {
    townId: null,
    roleFilter: "thieves",
    description: "Player is allied with the Thieves Guild",
    affinityBonus: 30,
    reputationBonus: 0
  },

  // Player is an outlaw — guards/barracks are hostile globally
  outlaw: {
    townId: null,
    roleFilter: "barracks",
    description: "Player is declared outlaw",
    affinityBonus: -40,
    reputationBonus: -30
  },

  // Player aided the temple order — all temple NPCs are friendly
  temple_order_ally: {
    townId: null,
    roleFilter: "temple",
    description: "Player aided the Temple Order",
    affinityBonus: 25,
    reputationBonus: 10
  },

  // Player burned Vigo ships — Vigo port NPCs hostile
  burned_vigo_ships: {
    townId: 4,
    description: "Player destroyed Vigo fleet",
    affinityBonus: -35,
    reputationBonus: -25
  },

  // Player completed the Bastralion quest — merchants give discounts
  bastralion_quest: {
    townId: 3,
    roleFilter: "merchant",
    description: "Player completed the Bastralion merchant quest",
    affinityBonus: 20,
    reputationBonus: 5
  }
};

// ============================================================
// CORE FUNCTION: getNpcState
//
// Returns the effective behavioral state for a given NPC,
// taking into account:
//   - base personality + attitude + sociability
//   - player global reputation
//   - per-NPC affinity
//   - active flags
//
// @param {string}   npcKey     - key from townShops (e.g. "01_11_blacksmith")
// @param {number}   reputation - global player reputation (-100 to 100)
// @param {number}   affinity   - per-NPC affinity (-100 to 100)
// @param {string[]} activeFlags - list of active flag keys from FLAGS
//
// @returns {object} npcState
// ============================================================

function getNpcState(npcKey, reputation, affinity, activeFlags = []) {
  const npc = townShops[npcKey];
  if (!npc) {
    throw new Error(`NPC not found: ${npcKey}`);
  }

  const rules = PERSONALITY_RULES[npc.personality] || {
    reputationBias: 1.0,
    affinityBias:   1.0
  };

  // --- Apply flag bonuses ---
  let flagRepBonus    = 0;
  let flagAffinityBonus = 0;

  for (const flagKey of activeFlags) {
    const flag = FLAGS[flagKey];
    if (!flag) continue;

    const townMatch = flag.townId === null || flag.townId === npc.townId;
    const roleMatch = !flag.roleFilter || flag.roleFilter === npc.role;

    if (townMatch && roleMatch) {
      // Allow personality to suppress flags
      const effectiveFlags = rules.flagOverride
        ? rules.flagOverride([flagKey], reputation)
        : [flagKey];

      if (effectiveFlags.includes(flagKey)) {
        flagRepBonus      += flag.reputationBonus || 0;
        flagAffinityBonus += flag.affinityBonus || 0;
      }
    }
  }

  // --- Effective reputation and affinity after flags ---
  const effectiveReputation = Math.max(-100, Math.min(100, reputation + flagRepBonus));
  const effectiveAffinity   = Math.max(-100, Math.min(100, affinity + flagAffinityBonus));

  // --- Compute base attitude score ---
  let score = ATTITUDE_BASE[npc.attitude] ?? 0;

  // Add reputation contribution (scaled by personality bias)
  score += effectiveReputation * REPUTATION_WEIGHT * rules.reputationBias;

  // Add affinity contribution (scaled by personality bias)
  score += effectiveAffinity * AFFINITY_WEIGHT * rules.affinityBias;

  // Personality-specific bonuses
  if (rules.reputationBonus) {
    score += rules.reputationBonus(effectiveReputation);
  }
  if (rules.affinityPenalty) {
    score += rules.affinityPenalty(effectiveAffinity);
  }

  // --- Derive effective attitude tier from score ---
  let effectiveAttitude;
  if (score >= 3)       effectiveAttitude = "friendly";
  else if (score >= 1)  effectiveAttitude = "neutral";
  else if (score >= -1) effectiveAttitude = "diffident";
  else                  effectiveAttitude = "hostile";

  // Manipulative NPCs mask their real attitude as neutral or friendly
  let displayAttitude = effectiveAttitude;
  if (rules.maskAttitude) {
    if (effectiveAttitude === "hostile")   displayAttitude = "diffident";
    if (effectiveAttitude === "diffident") displayAttitude = "neutral";
  }

  // --- Service availability ---
  const refusesService = rules.refuseService
    ? rules.refuseService(effectiveReputation)
    : false;

  const limitedService = rules.minAffinityForFullService
    ? effectiveAffinity < rules.minAffinityForFullService
    : false;

  // --- Price modifier ---
  const priceModifier = rules.priceModifier
    ? rules.priceModifier(effectiveAffinity)
    : 1.0;

  // --- Dialogue tier ---
  const dialogueTier = SOCIABILITY_DIALOGUE[npc.sociability] || "standard";

  return {
    npcKey,
    npcName:          npc.npcName,
    role:             npc.role,
    townName:         npc.townName,
    townId:           npc.townId,
    personality:      npc.personality,
    baseAttitude:     npc.attitude,
    effectiveAttitude,
    displayAttitude,
    dialogueTier,
    priceModifier,
    refusesService,
    limitedService,
    effectiveReputation,
    effectiveAffinity,
    activeFlags:      activeFlags.filter(f => {
      const flag = FLAGS[f];
      if (!flag) return false;
      const townMatch = flag.townId === null || flag.townId === npc.townId;
      const roleMatch = !flag.roleFilter || flag.roleFilter === npc.role;
      return townMatch && roleMatch;
    })
  };
}

// ============================================================
// HELPER: getTownNpcs
// Returns all NPC keys belonging to a specific townId
// ============================================================

function getTownNpcs(townId) {
  return Object.keys(townShops).filter(
    key => townShops[key].townId === townId
  );
}

// ============================================================
// HELPER: getAllNpcStates
// Returns getNpcState for every NPC in townShops at once.
// Useful for bulk evaluation (e.g. loading a new town).
// ============================================================

function getAllNpcStates(townId, reputation, affinityMap = {}, activeFlags = []) {
  const keys = townId !== undefined ? getTownNpcs(townId) : Object.keys(townShops);
  const result = {};
  for (const key of keys) {
    const affinity = affinityMap[key] ?? 0;
    result[key] = getNpcState(key, reputation, affinity, activeFlags);
  }
  return result;
}

// ============================================================
// HELPER: updateAffinity
// Clamps affinity changes and returns the new value.
// delta can be positive (gain) or negative (loss).
// ============================================================

function updateAffinity(currentAffinity, delta) {
  return Math.max(-100, Math.min(100, currentAffinity + delta));
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getNpcState,
  getTownNpcs,
  getAllNpcStates,
  updateAffinity,
  FLAGS,
  REPUTATION_THRESHOLDS,
  AFFINITY_THRESHOLDS,
  PERSONALITY_RULES
};
