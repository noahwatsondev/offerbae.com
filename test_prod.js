const firebase = require('./src/config/firebase');
const db = firebase.db;
async function go() {
    try {
        const snap = await db.collection('products').limit(1).get();
        console.log(snap.docs[0].data());
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
go();
