const http = require("http");
const express = require("express");
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

        // Messaggi generici di test
        this.onMessage("hello", (client, message) => {
            console.log("Received hello from", client.sessionId, ":", message);
        });

        // Controlla se il personaggio esiste
        this.onMessage("checkCharacter", (client, data) => {
            const characters = loadCharacters();
            const char = characters[data.playerId];
            client.send("characterExistence", {
                exists: !!char,
                character: char || null
            });
        });

        // Salva il personaggio
        this.onMessage("saveCharacter", (client, data) => {
            const characters = loadCharacters();
            characters[data.id] = data;
            saveCharacters(characters);
            console.log(`Character saved: ${data.name} (${data.id})`);
            client.send("characterSaved", { ok: true });
        });
    }

onJoin(client, options) {
    console.log("Player joined:", client.sessionId);
    this.state.players.set(client.sessionId, new PlayerState());
}

onLeave(client, consented) {
    console.log("Player left:", client.sessionId);
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
const server = http.createServer(app);
const gameServer = new Server({ server });

// Definisci la room
gameServer.define("my_room", MyRoom);

// Avvio server
server.listen(2567, () => {
    console.log("Colyseus server listening on ws://localhost:2567");
});
