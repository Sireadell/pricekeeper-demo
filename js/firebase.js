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

// Two databases. The live site uses the shop database. Every other address
// (the preview site that test runs use, pull request previews, localhost)
// uses a separate test database, so test runs never touch the live shop.
// shop.html holds the same switch.
const LIVE_HOSTS = ["pricekeeper-demo.web.app", "pricekeeper-demo.firebaseapp.com"];
const LIVE_CONFIG = {
  apiKey: "AIzaSyBvTKbkPYdhOKKHEOIjMWg2BQ3Ouu2KjQs",
  authDomain: "pricekeeper-demo-3.firebaseapp.com",
  projectId: "pricekeeper-demo-3",
  storageBucket: "pricekeeper-demo-3.firebasestorage.app",
  messagingSenderId: "849318202665",
  appId: "1:849318202665:web:d2bae843cbfa8495123b38"
};
const TEST_CONFIG = {
  apiKey: "AIzaSyDlVKVy7ddQo8Xl88QlMWbZj92KWGffG2Y",
  authDomain: "pricekeeper-demo-6.firebaseapp.com",
  projectId: "pricekeeper-demo-6",
  storageBucket: "pricekeeper-demo-6.firebasestorage.app",
  messagingSenderId: "222949724153",
  appId: "1:222949724153:web:a6a2bfcd2b48d004f2b728"
};
const firebaseConfig =
  LIVE_HOSTS.includes(globalThis.location?.hostname) ? LIVE_CONFIG : TEST_CONFIG;
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