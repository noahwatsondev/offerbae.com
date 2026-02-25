const firebase = require('./src/config/firebase');
const db = firebase.db;
async function go() {
    const snap = await db.collection('products').limit(1).get();
    console.log(Object.keys(snap.docs[0].data()));
    process.exit(0);
}
go();
