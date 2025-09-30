const admin = require('firebase-admin');

// Export lazy getters to allow initialization to happen elsewhere (e.g. server.js)
// without causing "App not defined" errors at require time.
module.exports = {
    get db() {
        try {
            return admin.firestore();
        } catch (e) {
            console.error('Firestore accessed before initialization.');
            throw e;
        }
    },
    get bucket() {
        try {
            return admin.storage().bucket();
        } catch (e) {
            console.error('Storage bucket accessed before initialization.');
            throw e;
        }
    },
    admin // Export admin in case it's needed
};
