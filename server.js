const http = require("http");
const express = require("express");
const { Server, Room } = require("colyseus");
const { Schema, MapSchema, type } = require("@colyseus/schema");
const fs = require("fs");
const path = require("path");

const CHAR_FILE = path.join(__dirname, "characters.json");

// --- State ---
class PlayerState extends Schema {
    constructor() {
        super();
        this.name = "";
    }
}
type("string")(PlayerState.prototype, "name");

class MyRoomState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
    }
}
type({ map: PlayerState })(MyRoomState.prototype, "players");

// --- Room ---
class MyRoom extends Room {
    onCreate(options) {
        console.log("Room created!");
        this.setState(new MyRoomState());

        this.onMessage("playerInfo", (client, data) => {
            console.log(`📨 playerInfo ricevuto da ${client.sessionId}:`, data);
            this.state.players.set(client.sessionId, new PlayerState());
            this.state.players.get(client.sessionId).name = data.name;
        });

        this.onMessage("checkCharacter", (client, data) => {
            const characters = loadCharacters();
            const char = characters[data.playerId];
            console.log(`📨 checkCharacter ricevuto da ${client.sessionId}: exists=${!!char}`);
            client.send("characterExistence", { exists: !!char, character: char || null });
        });

        this.onMessage("saveCharacter", (client, data) => {
            const characters = loadCharacters();
            characters[data.id] = data;
            saveCharacters(characters);
            console.log(`Character saved: ${data.name} (${data.id})`);
            client.send("characterSaved", { ok: true });
        });
    }

    onJoin(client, options) {
        console.log(`🟢 Player joined: ${client.sessionId}, options: ${JSON.stringify(options)}`);
        this.state.players.set(client.sessionId, new PlayerState());
        if (options && options.playerId) {
            this.state.players.get(client.sessionId).name = options.playerId; // o un mapping a playerData.name
        }
    }

    onLeave(client, consented) {
        console.log(`⚠️ Player left: ${client.sessionId}, consented: ${consented}`);
        this.state.players.delete(client.sessionId);
    }
}

// --- Functions ---
function loadCharacters() {
    if (!fs.existsSync(CHAR_FILE)) return {};
    return JSON.parse(fs.readFileSync(CHAR_FILE));
}
function saveCharacters(data) {
    fs.writeFileSync(CHAR_FILE, JSON.stringify(data, null, 2));
}

// --- Server ---
const app = express();
const server = http.createServer(app);
const gameServer = new Server({ server });

// Room
gameServer.define("my_room", MyRoom);

// Route test
app.get("/", (req,res)=>res.send("Colyseus server online ✅"));

const PORT = process.env.PORT || 2567;
server.listen(PORT, ()=>console.log(`Colyseus server listening on port ${PORT}`));

