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
  apiKey: "AIzaSyCAQa_uqAfUbhE6pDtIGOqBeEoc6fDfXdU",
  authDomain: "pricekeeper-demo.firebaseapp.com",
  projectId: "pricekeeper-demo",
  storageBucket: "pricekeeper-demo.firebasestorage.app",
  messagingSenderId: "4655239573",
  appId: "1:4655239573:web:e906b916c21e922333269c"
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