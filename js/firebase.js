// ============================================================
// VivyRTC — Firebase Initialization (Signaling Only)
// ============================================================
//
// Firebase is used ONLY for signaling (exchanging call metadata,
// SDP offers/answers, and ICE candidates through Firestore).
// It is NEVER used to carry audio/video — that always travels
// directly between browsers via WebRTC (RTCPeerConnection).
//
// This file loads the Firebase SDK straight from Google's CDN
// as ES modules, so there is no npm install and no build step.
// It works as-is on GitHub Pages.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ------------------------------------------------------------
// PASTE YOUR OWN FIREBASE WEB CONFIG BELOW.
//
// Get this from: Firebase Console → Project Settings →
// "Your apps" → Web app → SDK setup and configuration → Config.
//
// It looks like this (values are placeholders — replace them
// with YOUR project's real values):
//
// {
//   apiKey: "AIzaSy...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project",
//   storageBucket: "your-project.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abcdef123456"
// }
//
// Do NOT commit real production secrets to a public repo if you
// can avoid it, but note: Firebase Web API keys are not secret
// in the traditional sense — they identify your project, they
// do not grant access on their own. Access is controlled by
// your Firestore Security Rules (see the rules provided
// separately in this project). Still, treat this file as
// project-specific configuration, not a security boundary.
// ------------------------------------------------------------

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN_HERE",
  projectId: "PASTE_YOUR_PROJECT_ID_HERE",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID_HERE",
  appId: "PASTE_YOUR_APP_ID_HERE"
};

// ------------------------------------------------------------
// Basic guard: warn loudly in the console (and on-screen via
// app.js) if the config still has placeholder values, instead
// of failing with a cryptic Firebase error.
// ------------------------------------------------------------

function configHasPlaceholders(config) {
  return Object.values(config).some(
    (value) => typeof value === "string" && value.startsWith("PASTE_YOUR_")
  );
}

export const isFirebaseConfigured = !configHasPlaceholders(firebaseConfig);

if (!isFirebaseConfigured) {
  console.warn(
    "[VivyRTC] Firebase config still contains placeholder values. " +
      "Open js/firebase.js and paste your real Firebase Web config " +
      "before creating or joining a call."
  );
}

// ------------------------------------------------------------
// Initialize Firebase app + Firestore.
//
// If the config is still placeholders, initializeApp() itself
// will generally not throw (Firebase is lenient about this),
// but any actual Firestore read/write will fail. app.js checks
// isFirebaseConfigured before attempting a call, so the user
// gets a clear message instead of a raw SDK error.
// ------------------------------------------------------------

let app = null;
let db = null;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  console.error("[VivyRTC] Failed to initialize Firebase:", err);
}

export { app, db };
