import admin from 'firebase-admin';

// Initialize Firebase Admin SDK using environment variables
// This avoids needing to store a JSON key file in the repo
const firebaseApp = admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Replace escaped newlines in the private key
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

export const firebaseAuth = admin.auth();
export default firebaseApp;
