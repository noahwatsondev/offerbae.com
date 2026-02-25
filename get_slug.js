const firebase = require('./src/config/firebase');
const db = firebase.db;
async function go() {
    const snap = await db.collection('advertisers').limit(1).get();
    console.log(snap.docs[0].data().slug);
    process.exit(0);
}
go();
