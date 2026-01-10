// -------- IMPORTS --------
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server, Room } = require("colyseus");
const { Schema, MapSchema, type } = require("@colyseus/schema");
const fs = require("fs");
const path = require("path");

// -------- PATH AL JSON DEI PERSONAGGI --------
const CHAR_FILE = path.join(__dirname, "characters.json");

// -------- DEFINIZIONE STATE COLYSEUS --------
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

// -------- LA ROOM DEL GIOCO --------
class MyRoom extends Room {
    onCreate(options) {
        console.log("Room created!");
        this.setState(new MyRoomState());

        // --- messaggio di test ---
        this.onMessage("hello", (client, message) => {
            console.log(`Received hello from ${client.sessionId}: ${message}`);
        });

        // --- listener playerInfo ---
        this.onMessage("playerInfo", (client, data) => {
            // salva dati base nello state
            this.state.players.set(client.sessionId, new PlayerState());
            this.state.players.get(client.sessionId).name = data.name;
            console.log(`PlayerInfo ricevuto da ${client.sessionId}:`, data);
        });

        // --- listener checkCharacter ---
        this.onMessage("checkCharacter", (client, data) => {
            const characters = loadCharacters();
            const char = characters[data.playerId];
            console.log(`Check character for ${data.playerId}: exists=${!!char}`);
            client.send("characterExistence", {
                exists: !!char,
                character: char || null
            });
        });

        // --- listener saveCharacter ---
        this.onMessage("saveCharacter", (client, data) => {
            const characters = loadCharacters();
            characters[data.id] = data;
            saveCharacters(characters);
            console.log(`Character saved: ${data.name} (${data.id})`);
            client.send("characterSaved", { ok: true });
        });
    }

    onJoin(client, options) {
        console.log(`Player joined: ${client.sessionId}, options: ${JSON.stringify(options)}`);
        this.state.players.set(client.sessionId, new PlayerState());
    }

    onLeave(client, consented) {
        console.log(`Player left: ${client.sessionId}, consented: ${consented}`);
        this.state.players.delete(client.sessionId);
    }

    onDispose() {
        console.log("Room disposed");
    }
}

// -------- FUNZIONI DI SALVATAGGIO / CARICAMENTO --------
function loadCharacters() {
    if (!fs.existsSync(CHAR_FILE)) return {};
    const raw = fs.readFileSync(CHAR_FILE);
    return JSON.parse(raw);
}

function saveCharacters(data) {
    fs.writeFileSync(CHAR_FILE, JSON.stringify(data, null, 2));
}

// -------- SERVER EXPRESS + COLYSEUS --------
const app = express();

// --- CORS per permettere richieste da PlayCanvas ---
app.use(cors()); // permette tutte le origini
// oppure più restrittivo:
// app.use(cors({ origin: "https://launch.playcanvas.com" }));

const server = http.createServer(app);
const gameServer = new Server({ server });

// Definisci la room
gameServer.define("my_room", MyRoom);
console.log("Colyseus rooms defined: my_room");

// -------- AVVIO SERVER --------
const PORT = process.env.PORT || 2567;
server.listen(PORT, () => {
    console.log(`Colyseus server listening on port ${PORT}`);
});

// -------- ROUTE DI TEST HTTP --------
app.get("/", (req, res) => {
    res.send("Colyseus server online ✅");
});

// -------- ROUTE PER PING SVEGLIA SERVER --------
app.get("/ping", (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send("pong");
});
