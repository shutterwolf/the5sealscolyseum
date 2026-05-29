// server.js
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const MyRoom = require("./MyRoom");

const app = express();

app.use(cors({
    origin: true,
    credentials: true
}));

const httpServer = http.createServer(app);

const gameServer = new Server({
    transport: new WebSocketTransport({
        server: httpServer
    })
});

gameServer.define("my_room", MyRoom);

app.get("/", (req, res) => res.send("Server Colyseus online ✅"));

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
