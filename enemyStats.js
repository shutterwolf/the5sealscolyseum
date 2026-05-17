module.exports= {
    orc: {
        id: 0,
        DunLevel: 2,
        strength: 7, courage: 6, fortune: 4, willing: 0,
        attac: 2, defence: 2, wDamage: 1, armor: 1,
        swordmanship: 2, shooting: 1,
        race: 'orc',
        wRange: 0,
        maxHealth:18,
        attackType: "SWORD", radius: 7, aggroRange: 5,
        enemyspeed: 0.8
    },
    goblin: {
        id: 1,
        DunLevel: 1,
        strength: 4, courage: 4, fortune: 4, willing: 0,
        attac: 1, defence: 2, wDamage: 2, armor: 1,
        swordmanship: 2, shooting: 2,
        race: 'goblin',
        wRange: 0,
        maxHealth:12,
        attackType: "BLADE", radius: 7, aggroRange: 5,
        enemyspeed: 0.8
    },
    skeleton: {
        id: 2,
        DunLevel: 1,
        strength: 5, courage: 5, fortune: 5, willing: 1,
        attac: 3, defence: 2, wDamage: 2, armor: 1,
        swordmanship: 2, shooting: 3,
        race: 'undead',
        wRange: 0,
        maxHealth:15,
        attackType: "SWORD", radius: 7, aggroRange: 5,
        enemyspeed: 1
    },

    "skeleton archer": {
        id: 3,
        DunLevel: 1,
        strength: 5, courage: 5, fortune: 5, willing: 2,
        attac: 1, defence: 1, wDamage: 2, armor: 1,
        swordmanship: 2, shooting: 3,
        race: 'undead',
        wRange: 5,
        maxHealth:15,
        attackType: "BOW", radius: 7, aggroRange: 5,
        enemyspeed: 1
    },

    zombie: {
        id: 4,
        DunLevel: 1,
        strength: 6, courage: 5, fortune: 4, willing: 2,
        attac: 2, defence: 1, wDamage: 2, armor: 1,
        swordmanship: 1, shooting: 0,
        race: 'undead',
        wRange: 0,
        maxHealth:20,
        attackType: "NATURAL_MEDIUM", radius: 7, aggroRange: 5,
        enemyspeed: 0.8
    },

    orcsword: {
        id: 5,
        DunLevel: 2,
        strength: 7, courage: 6, fortune: 4, willing: 0,
        attac: 2, defence: 3, wDamage: 2, armor: 2,
        swordmanship: 2, shooting: 1,
        race: 'orc',
        wRange: 0,
        maxHealth:18,
        attackType: "SWORD", radius: 7, aggroRange: 5,
        enemyspeed: 0.8
    },

    goblinspear: {
        id: 6,
        DunLevel: 1,
        strength: 4, courage: 4, fortune: 4, willing: 0,
        attac: 2, defence: 1, wDamage: 3, armor: 2,
        swordmanship: 2, shooting: 1,
        race: 'goblin',
        wRange: 0,
        maxHealth:12,
        attackType: "SPEAR", radius: 7, aggroRange: 5,
        enemyspeed: 0.8
    },

    bandit: {
        id: 7,
        DunLevel: 1,
        strength: 5, courage: 5, fortune: 5, willing: 5,
        attac: 3, defence: 2, wDamage: 2, armor: 2,
        swordmanship: 2, shooting: 2,
        race: 'human',
        wRange: 0,
        maxHealth:15,
        attackType: "BLADE", radius: 7, aggroRange: 5,
        enemyspeed: 1
    },

    SKChamp: {
        id: 8,
        DunLevel: 2,
        strength: 6, courage: 6, fortune: 6, willing: 6,
        attac: 3, defence: 3, wDamage: 2, armor: 3,
        swordmanship: 3, shooting: 1,
        race: 'undead',
        wRange: 0,
        maxHealth:18,
        attackType: "SWORD", radius: 7, aggroRange: 5,
        enemyspeed: 1.5
    },

    Mummy: {
        id: 9,
        DunLevel: 2,
        strength: 7, courage: 5, fortune: 5, willing: 6,
        attac: 3, defence: 2, wDamage: 1, armor: 2,
        swordmanship: 3, shooting: 1,
        race: 'undead',
        wRange: 0,
        maxHealth:20,
        attackType: "NATURAL_HEAVY", radius: 7, aggroRange: 5,
        enemyspeed: 0.8
    },

    Banshee: {
        id: 10,
        DunLevel: 2,
        strength: 6, courage: 6, fortune: 5, willing: 6,
        attac: 3, defence: 2, wDamage: 2, armor: 2,
        swordmanship: 3, shooting: 1,
        race: 'undead',
        wRange: 0,
        maxHealth:15,
        attackType: "NATURAL_MEDIUM", radius: 7, aggroRange: 5,
        enemyspeed: 1.2
    },

    werewolf: {
        id: 11,
        DunLevel: 3,
        strength: 6, courage: 6, fortune: 6, willing: 6,
        attac: 3, defence: 3, wDamage: 3, armor: 2,
        swordmanship: 3, shooting: 1,
        race: 'werewolf',
        wRange: 0,
        maxHealth:25,
        attackType: "NATURAL_FAST", radius: 7, aggroRange: 5,
        enemyspeed: 1.2
    },

    bug: {
        id: 12,
        DunLevel: 1,
        strength: 4, courage: 4, fortune: 4, willing: 4,
        attac: 2, defence: 1, wDamage: 1, armor: 1,
        swordmanship: 2, shooting: 1,
        race: 'bee',
        wRange: 0,
        maxHealth:10,
        attackType: "NATURAL_BITE", radius: 7, aggroRange: 5,
        enemyspeed: 0.8
    },

    "bug queen": {
        id: 13,
        DunLevel: 2,
        strength: 5, courage: 5, fortune: 5, willing: 5,
        attac: 3, defence: 2, wDamage: 2, armor: 3,
        swordmanship: 2, shooting: 1,
        race: 'bee',
        wRange: 0,
        maxHealth:15,
        attackType: "NATURAL_BITE", radius: 7, aggroRange: 5,
        enemyspeed: 1.2
    },

    Icegar: {
        id: 14,
        DunLevel: 2,
        strength: 5, courage: 5, fortune: 5, willing: 5,
        attac: 3, defence: 3, wDamage: 2, armor: 3,
        swordmanship: 3, shooting: 1,
        race: 'Human',
        wRange: 0,
        maxHealth:18,
        attackType: "SWORD", radius: 7, aggroRange: 5,
        enemyspeed: 1
    },

    "goblin champ": {
        id: 15,
        DunLevel: 2,
        strength: 4, courage: 4, fortune: 4, willing: 4,
        attac: 3, defence: 3, wDamage: 3, armor: 2,
        swordmanship: 3, shooting: 1,
        race: 'goblin',
        wRange: 0,
        maxHealth:15,
        attackType: "HAMMER", radius: 7, aggroRange: 5,
        enemyspeed: 0.8
    },

    minotaur: {
        id: 16,
        DunLevel: 3,
        strength: 6, courage: 6, fortune: 6, willing: 6,
        attac: 3, defence: 3, wDamage: 3, armor: 2,
        swordmanship: 3, shooting: 1,
        race: 'minotaur',
        wRange: 0,
        maxHealth:25,
        attackType: "NATURAL_HEAVY", radius: 7, aggroRange: 5,
        enemyspeed: 1.2
    },

    spider: {
        id: 17,
        DunLevel: 3,
        strength: 6, courage: 6, fortune: 6, willing: 6,
        attac: 2, defence: 2, wDamage: 2, armor: 1,
        swordmanship: 2, shooting: 0,
        race: 'bee',
        wRange: 0,
        maxHealth:15,
        attackType: "NATURAL_BITE", radius: 7, aggroRange: 5,
        enemyspeed: 1
    },

    bear: {
        id: 18,
        DunLevel: 3,
        strength: 7, courage: 6, fortune: 5, willing: 5,
        attac: 2, defence: 2, wDamage: 3, armor: 2,
        swordmanship: 2, shooting: 0,
        race: 'bear',
        wRange: 0,
        maxHealth:35,
        attackType: "NATURAL_HEAVY", radius: 7, aggroRange: 5,
        enemyspeed: 1
    },

    sandspider: {
        id: 19,
        DunLevel: 3,
        strength: 6, courage: 6, fortune: 6, willing: 6,
        attac: 2, defence: 3, wDamage: 2, armor: 2,
        swordmanship: 2, shooting: 0,
        race: 'bee',
        wRange: 0,
        maxHealth:15,
        attackType: "NATURAL_BITE", radius: 7, aggroRange: 5,
        enemyspeed: 1
    },

    necromancer: {
        id: 20,
        DunLevel: 3,
        strength: 6, courage: 6, fortune: 6, willing: 6,
        attac: 3, defence: 3, wDamage: 2, armor: 1,
        swordmanship: 2, shooting: 0,
        race: 'human',
        wRange: 0,
        attackType: "SWORD", radius: 7, aggroRange: 5,
        maxHealth:18,
        enemyspeed: 1
    }

};
