// schemas.js
const { Schema, MapSchema, ArraySchema, type } = require("@colyseus/schema");

// --- Schema ---
class Vec3 extends Schema {
    constructor(x = 0, y = 0, z = 0) {
        super();
        this.x = x;
        this.y = y;
        this.z = z;
    }
}

class PreySchema extends Schema {
    constructor() {
        super();
        this.id = "";
        this.type = "deer";
        this.x = 0;
        this.z = 0;
        this.destX = 0;
        this.destZ = 0;
        this.health = 15;
        this.maxHealth = 15;
        this.aiState = "idle";
        this.currentAnim = "deer-idle.json";
        this.isDead = false;
        this.lootReady = false;
        this.deathTime = 0;
        this.localMap = 0;
        this.dungeonId = "";
        this.depth = 0;
        this.speed = 2.5;
        this.radius = 6;
        this.wanderRange = 5;
        this.originX = 0;
        this.originZ = 0;
    }
}
type("string") (PreySchema.prototype, "id");
type("string") (PreySchema.prototype, "type");
type("number") (PreySchema.prototype, "x");
type("number") (PreySchema.prototype, "z");
type("number") (PreySchema.prototype, "destX");
type("number") (PreySchema.prototype, "destZ");
type("number") (PreySchema.prototype, "health");
type("number") (PreySchema.prototype, "maxHealth");
type("string") (PreySchema.prototype, "aiState");
type("string") (PreySchema.prototype, "currentAnim");
type("boolean")(PreySchema.prototype, "isDead");
type("boolean")(PreySchema.prototype, "lootReady");
type("number") (PreySchema.prototype, "deathTime");
type("number") (PreySchema.prototype, "localMap");
type("string") (PreySchema.prototype, "dungeonId");
type("number") (PreySchema.prototype, "depth");
type("number") (PreySchema.prototype, "speed");
type("number") (PreySchema.prototype, "radius");
type("number") (PreySchema.prototype, "wanderRange");
type("number") (PreySchema.prototype, "originX");
type("number") (PreySchema.prototype, "originZ");

class Quat extends Schema {
    constructor(x = 0, y = 0, z = 0, w = 1) {
        super();
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
}
type("number")(Quat.prototype, "x");
type("number")(Quat.prototype, "y");
type("number")(Quat.prototype, "z");
type("number")(Quat.prototype, "w");

class DoorState extends Schema {
    constructor() {
        super();
        this.x = 0;
        this.y = 0;
        this.closed = true;
        this.state = "closed"; // closed | opening | open | broken
        // 🔐 type of door logic
        this.lockType = "key"; // key | puzzle | trigger
        // 🔑 key system
        this.keyNumber = 0;
        // 🧩 puzzle / lockpick system
        this.openProgress = 0; // 0-100
        // ⚡ trigger system
        this.triggerId = 0;
        // 💥 optional break system
        this.resistance = 100;
        // 🧭 visuals
        this.orientation = "vertical";
        this.material = "wood";
    }
}
type("number")(DoorState.prototype, "x");
type("number")(DoorState.prototype, "y");
type("boolean")(DoorState.prototype, "closed");
type("string")(DoorState.prototype, "state");
type("string")(DoorState.prototype, "lockType");
type("number")(DoorState.prototype, "triggerId");
type("number")(DoorState.prototype, "keyNumber");
type("number")(DoorState.prototype, "openProgress");
type("number")(DoorState.prototype, "resistance");
type("string")(DoorState.prototype, "orientation");
type("string")(DoorState.prototype, "material");

class WorldState extends Schema {
    constructor() {
        super();
        this.timeOfDay = 8;        // 08:00
        this.isDay = true;
        this.weather = "sunny";    // sunny | rain | snow
    }
}

type("number")(WorldState.prototype, "timeOfDay");
type("boolean")(WorldState.prototype, "isDay");
type("string")(WorldState.prototype, "weather");

class EquippedItem extends Schema {
    constructor() {
        super();
        this.lootID = 0;
        this.name = "";
        this.armourValue = 1;
        this.damageValue = 0;
        this.resistence = 0;
        this.variable = 0;
        this.obj = "";
        this.slot = ""; // sempre string
        this.special = "";
        this.twohand = false;
        this.type = "";
        this.value = 0;
    }
}

type("number")(EquippedItem.prototype, "lootID");
type("string")(EquippedItem.prototype, "name");
type("number")(EquippedItem.prototype, "armourValue");
type("number")(EquippedItem.prototype, "damageValue");
type("number")(EquippedItem.prototype, "variable");
type("number")(EquippedItem.prototype, "resistence");
type("string")(EquippedItem.prototype, "obj");
type("string")(EquippedItem.prototype, "slot");
type("string")(EquippedItem.prototype, "special");
type("boolean")(EquippedItem.prototype, "twohand");
type("string")(EquippedItem.prototype, "type");
type("number")(EquippedItem.prototype, "value");

class Equipped extends Schema {
    constructor() {
        super();
        this.slots = new MapSchema();
    }
}
type({ map: EquippedItem })(Equipped.prototype, "slots");

class PlayerState extends Schema {
    constructor() {
        super();
        this.id = "";
        this.user = "";
        this.email = "";
        this.name = "";
        this.lang = "en";
        this.race = "Human";
        this.sex = "M";
        this.texTure = "";
        this.playerPos = new Vec3();
        this.rotation = new Quat();
        this.activeWeapon = "";
        this.anim = "stand1";
        this.speed = 1;
        this.localMap = 0;
        this.depth = 0;
        this.dungeonId = "";
        this.hp=0;
        this.combat = 0;
        this.mace = 0;
        this.sword = 0;
        this.blade = 0;
        this.axe = 0;
        this.defence = 2;
        this.aShield = 2;
        this.inCombat = 0;
        this.partyId = "";
        this.equipped = new Equipped();
    }
}
type("string")(PlayerState.prototype, "id");
type("string")(PlayerState.prototype, "user");
type("string")(PlayerState.prototype, "email");
type("string")(PlayerState.prototype, "name");
type("string")(PlayerState.prototype, "lang");
type("string")(PlayerState.prototype, "race");
type("string")(PlayerState.prototype, "sex");
type("string")(PlayerState.prototype, "texTure");
type(Vec3)(PlayerState.prototype, "playerPos");
type(Quat)(PlayerState.prototype, "rotation");
type("string")(PlayerState.prototype, "activeWeapon");
type("string")(PlayerState.prototype, "anim");
type("number")(PlayerState.prototype, "speed");
type("number")(PlayerState.prototype, "localMap");
type("number")(PlayerState.prototype, "depth");
type("string")(PlayerState.prototype, "dungeonId");
type("number")(PlayerState.prototype, "hp");
type("number")(PlayerState.prototype, "combat");
type("number")(PlayerState.prototype, "mace");
type("number")(PlayerState.prototype, "sword");
type("number")(PlayerState.prototype, "blade");
type("number")(PlayerState.prototype, "axe");
type("number")(PlayerState.prototype, "defence");
type("number")(PlayerState.prototype, "aShield");
type("number")(PlayerState.prototype, "inCombat");
type("string")(PlayerState.prototype, "partyId");
type(Equipped)(PlayerState.prototype, "equipped");

class ChatMessage extends Schema {
    constructor(id = "", name = "Anon", text = "", timestamp = Date.now()) {
        super();
        this.id = id;
        this.name = name;
        this.text = text;
        this.timestamp = timestamp;
    }
}
type("string")(ChatMessage.prototype, "id");
type("string")(ChatMessage.prototype, "name");
type("string")(ChatMessage.prototype, "text");
type("number")(ChatMessage.prototype, "timestamp");

class EnemySchema extends Schema {
    constructor() {
        super();
        this.id = "";
        this.typeId = 0;
        this.type = "";
        this.pos = new Vec3();
        this.rot = new Vec3();
        this.health = 0;
        this.aiState = "idle";
        this.currentAnim = "idle";
        this.inCombat = 0;

        this.localMap = 0;      
        this.dungeonId = "";    
        this.depth = 0;
        this.destX = 0;
        this.destZ = 0;
        this.idleUntil = 0;
        this.targetPlayerId = "";
        this.speed = 0;
        this.radius = 0;
        this.wRange = 0;
        this.maxHealth = 0;
        this.ownerId="";
        this.questId=0;
        this.isDead=false;
        this.lootReady=false;
    }
}

type("string")(EnemySchema.prototype, "id");
type("number")(EnemySchema.prototype, "typeId");
type("string")(EnemySchema.prototype, "type");
type(Vec3)(EnemySchema.prototype, "pos");
type(Vec3)(EnemySchema.prototype, "rot");
type("number")(EnemySchema.prototype, "health");
type("string")(EnemySchema.prototype, "aiState");
type("string")(EnemySchema.prototype, "currentAnim");
type("number")(EnemySchema.prototype, "inCombat");
type("number")(EnemySchema.prototype, "localMap");
type("string")(EnemySchema.prototype, "dungeonId");
type("number")(EnemySchema.prototype, "depth");
type("number")(EnemySchema.prototype, "destX");
type("number")(EnemySchema.prototype, "destZ");
type("number")(EnemySchema.prototype, "idleUntil");
type("string")(EnemySchema.prototype, "targetPlayerId");
type("number")(EnemySchema.prototype, "speed");
type("number")(EnemySchema.prototype, "radius");
type("number")(EnemySchema.prototype, "wRange");
type("number")(EnemySchema.prototype, "maxHealth");
type("string")(EnemySchema.prototype, "ownerId");
type("number")(EnemySchema.prototype, "questId");
type("boolean")(EnemySchema.prototype, "isDead");
type("boolean")(EnemySchema.prototype, "lootReady");

class MyRoomState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
        this.enemies = new MapSchema(); // 👈
        this.preys    = new MapSchema(); 
        this.world = new WorldState();
        this.chat = new ArraySchema();
        this.doors = new MapSchema();
    }
}

type({ map: PlayerState })(MyRoomState.prototype, "players");
type({ map: EnemySchema })(MyRoomState.prototype, "enemies"); // 👈
type({ map: PreySchema  })(MyRoomState.prototype, "preys");
type(WorldState)(MyRoomState.prototype, "world");
type([ChatMessage])(MyRoomState.prototype, "chat");
type({ map: DoorState })(MyRoomState.prototype, "doors");

module.exports = {
    Vec3, Quat, DoorState, WorldState,
    EquippedItem, Equipped,
    PlayerState, ChatMessage,
    EnemySchema, MyRoomState,
    PreySchema 
};
