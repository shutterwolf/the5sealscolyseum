// db.js
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
console.log(serviceAccount.project_id);
console.log(serviceAccount.client_email);
console.log(serviceAccount.private_key.startsWith("-----BEGIN PRIVATE KEY-----"));
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log("Admin app project:", admin.app().options.projectId);
console.log("Firestore project:", db.projectId);

module.exports = { db, admin };
