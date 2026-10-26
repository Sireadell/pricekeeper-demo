// ============================================================
//  firebase.js — THE ONLY FILE YOU NEED TO EDIT
//  Paste your Firebase project config below.
//  Get it from: console.firebase.google.com
//  → Your project → Project Settings → Your apps → Web app
//
//  Also acts as a Firebase SDK barrel (Phase C.5): re-exports every
//  Firestore + Auth primitive used in this codebase so consumers can
//  `import { ... } from './firebase.js'` instead of pinning each
//  call site to the v10.12.0 CDN URL. To bump SDK version, edit only
//  the URLs in this file.
// ============================================================

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider,
  signInWithPopup, signOut, onAuthStateChanged, signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, getDoc, getDocs, addDoc, updateDoc,
  onSnapshot, query, where, orderBy, limit,
  serverTimestamp, writeBatch, runTransaction,
  Timestamp, increment, deleteField,
  disableNetwork, enableNetwork,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
// ── PASTE YOUR CONFIG HERE ───────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyA9TNeVrXMwP7irTeR1UkqvLQcFXmmabag",
  authDomain: "pricekeeper-demo-2.firebaseapp.com",
  projectId: "pricekeeper-demo-2",
  storageBucket: "pricekeeper-demo-2.firebasestorage.app",
  messagingSenderId: "1078259047859",
  appId: "1:1078259047859:web:4ff251940cc9ab97c5ffc6"
};
// ─────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);

export const auth     = getAuth(app);
export const provider = new GoogleAuthProvider();
// Always show the account chooser so shared devices can select the correct owner.
provider.setCustomParameters({ prompt: 'select_account' });

// Modern offline persistence — replaces deprecated enableIndexedDbPersistence
// Supports multiple tabs without errors
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// ── Firebase SDK re-exports (Phase C.5 barrel) ────────────────
// Auth
export {
  signInWithPopup, signOut, onAuthStateChanged, signInAnonymously,
  GoogleAuthProvider,
};
// Firestore
export {
  collection, doc, setDoc, deleteDoc, getDoc, getDocs, addDoc, updateDoc,
  onSnapshot, query, where, orderBy, limit,
  serverTimestamp, writeBatch, runTransaction,
  Timestamp, increment, deleteField,
  disableNetwork, enableNetwork,
};