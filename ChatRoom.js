// ChatRoom.js
const { Room } = require("colyseus");

exports.ChatRoom = class ChatRoom extends Room {
  onCreate(options) {
    console.log("ChatRoom creata");
    this.messages = []; // memorizza i messaggi in memoria

    this.onMessage("send", (client, message) => {
      if (typeof message !== "string" || message.trim() === "") return;
    
      const msgObj = {
        id: client.sessionId,
        name: options?.name ?? "Anon",
        text: message,
        timestamp: Date.now()
      };
    
      this.messages.push(msgObj);
      if (this.messages.length > 50) this.messages.shift();
    
      this.broadcast("message", msgObj);
    });
  }

  onJoin(client, options) {
    console.log(client.sessionId, "entrato");
    client.send("init", this.messages); // invia chat corrente
  }

  onLeave(client, consented) {
    console.log(client.sessionId, "uscito");
  }

  onDispose() {
    console.log("ChatRoom chiusa");
  }
};
