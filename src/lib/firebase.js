import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging } from "firebase/messaging";

// Replace these with your actual Firebase config keys
const firebaseConfig = {
  apiKey: "AIzaSyB77z4hjPKhs040QiQomfjVragZMIXI3rg",
  authDomain: "love-learning-f2aa2.firebaseapp.com",
  projectId: "love-learning-f2aa2",
  storageBucket: "love-learning-f2aa2.firebasestorage.app",
  messagingSenderId: "881085942229",
  appId: "1:881085942229:web:a40063af9807ff0797d55c",
  measurementId: "G-22E1T8RW2R"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Messaging might require a service worker, we'll initialize it safely
export let messaging = null;
try {
  messaging = getMessaging(app);
} catch (error) {
  console.log("Firebase Messaging not supported in this environment");
}
