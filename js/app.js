// ============================================================
// VivyRTC — Application Orchestrator (Phase 2)
// ============================================================
//
// Wires together camera.js (local media), webrtc.js (peer
// connection), and signaling.js (Firestore) to implement the
// full 1-to-1 call flow, UI state, timer, and error handling.
// ============================================================

import { isFirebaseConfigured } from "./firebase.js";

import {
  startLocalStream,
  stopLocalStream,
  toggleMic,
  toggleCamera,
  getLocalStream
} from "./camera.js";

import {
  createPeerConnection,
  addLocalTracks,
  getVideoSenders,
  closePeerConnection
} from "./webrtc.js";

import {
  generateLocalId,
  createCall,
  getCallOffer,
  setAnswer,
  listenForAnswer,
  listenForCallStatus,
  addCallerCandidate,
  addReceiverCandidate,
  listenForCallerCandidates,
  listenForReceiverCandidates,
  updateCallStatus
} from "./signaling.js";

// ------------------------------------------------------------
// DOM references
// ------------------------------------------------------------

const remoteVideo = document.getElementById("remoteVideo");
const remotePlaceholder = document.getElementById("remotePlaceholder");
const remotePlaceholderText = document.getElementById("remotePlaceholderText");
const localVideo = document.getElementById("localVideo");

const statusText = document.getElementById("statusText");
const callTimer = document.getElementById("callTimer");
const messageBox = document.getElementById("messageBox");

const setupPanel = document.getElementById("setupPanel");
const startCameraBtn = document.getElementById("startCameraBtn");
const callIdInput = document.getElementById("callIdInput");
const createCallBtn = document.getElementById("createCallBtn");
const joinCallBtn = document.getElementById("joinCallBtn");

const callControls = document.getElementById("callControls");
const micBtn = document.getElementById("micBtn");
const cameraBtn = document.getElementById("cameraBtn");
const endCallBtn = document.getElementById("endCallBtn");

// ------------------------------------------------------------
// State
// ------------------------------------------------------------

const localId = generateLocalId();

let pc = null;
let currentCallId = null;
let role = null; // "caller" | "receiver" | null
let unsubscribers = [];
let timerInterval = null;
let callStartTime = null;
let hasConnectedOnce = false;

// ------------------------------------------------------------
// UI helpers
// ------------------------------------------------------------

function setStatus(text, stateClass) {
  statusText.textContent = text;
  statusText.className = "status-pill" + (stateClass ? " " + stateClass : "");
}

function showMessage(text, isError) {
  messageBox.textContent = text || "";
  messageBox.classList.toggle("message-error", Boolean(isError));
}

function clearMessage() {
  showMessage("", false);
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return minutes + ":" + seconds;
}

function startTimer() {
  if (timerInterval) return; // already running
  callStartTime = Date.now();
  callTimer.hidden = false;
  callTimer.textContent = "00:00";
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    callTimer.textContent = formatDuration(elapsed);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  callStartTime = null;
  callTimer.hidden = true;
  callTimer.textContent = "00:00";
}

function showSetupPanel() {
  callControls.hidden = true;
  setupPanel.hidden = false;
}

function showCallControls() {
  setupPanel.hidden = true;
  callControls.hidden = false;
}

function resetControlButtons() {
  micBtn.classList.remove("control-btn-off");
  micBtn.querySelector(".control-icon").textContent = "🎤";
  micBtn.setAttribute("aria-label", "Mute microphone");

  cameraBtn.classList.remove("control-btn-off");
  cameraBtn.querySelector(".control-icon").textContent = "📹";
  cameraBtn.setAttribute("aria-label", "Turn camera off");
}

// ------------------------------------------------------------
// Remote video / autoplay handling
// ------------------------------------------------------------

function handleRemoteTrack(stream) {
  remoteVideo.srcObject = stream;
  remotePlaceholder.hidden = true;
  attemptPlayRemote();
}

function attemptPlayRemote() {
  const playPromise = remoteVideo.play();
  if (!playPromise || typeof playPromise.catch !== "function") return;

  playPromise.catch((err) => {
    console.warn("[VivyRTC] Autoplay blocked, waiting for user interaction:", err);
    showMessage("Tap anywhere on the screen to enable video and audio.", false);

    const resume = () => {
      remoteVideo
        .play()
        .then(() => {
          clearMessage();
        })
        .catch(() => {
          /* still blocked, user can tap again */
        });
    };

    document.addEventListener("click", resume, { once: true });
  });
}

// ------------------------------------------------------------
// Connection state handling
// ------------------------------------------------------------

function handleConnectionStateChange(state) {
  console.log("[VivyRTC] connectionState:", state);

  switch (state) {
    case "connecting":
      setStatus("Connecting...", "status-connecting");
      break;

    case "connected":
      setStatus("Connected", "status-connected");
      showCallControls();
      clearMessage();
      hasConnectedOnce = true;
      startTimer();
      break;

    case "disconnected":
      setStatus("Disconnected", "status-failed");
      showMessage("Connection lost. Trying to reconnect...", true);
      break;

    case "failed":
      setStatus("Failed", "status-failed");
      showMessage("The call connection failed. Ending call.", true);
      endCall(true);
      break;

    case "closed":
      setStatus("Ended", "");
      break;

    default:
      break;
  }
}

function handleIceConnectionStateChange(state) {
  console.log("[VivyRTC] iceConnectionState:", state);

  if (state === "failed" && pc && pc.connectionState !== "failed") {
    setStatus("Failed", "status-failed");
    showMessage("Network connection failed between devices. Ending call.", true);
    endCall(true);
  }
}

// ------------------------------------------------------------
// Camera start
// ------------------------------------------------------------

async function handleStartCamera() {
  clearMessage();
  setStatus("Starting camera...", "status-connecting");
  startCameraBtn.disabled = true;

  try {
    await startLocalStream(localVideo);
    setStatus("Camera ready", "");
    remotePlaceholderText.textContent = "Enter a Call ID, then Create or Join a call";
    startCameraBtn.textContent = "Camera Active";
    createCallBtn.disabled = false;
    joinCallBtn.disabled = false;
  } catch (err) {
    setStatus("Camera error", "status-failed");
    showMessage(err.message, true);
    startCameraBtn.disabled = false;
  }
}

// ------------------------------------------------------------
// Create call (caller flow)
// ------------------------------------------------------------

async function handleCreateCall() {
  const callId = callIdInput.value.trim();

  if (!callId) {
    showMessage("Please enter a Call ID.", true);
    return;
  }

  if (!isFirebaseConfigured) {
    showMessage("Firebase is not configured yet. Open js/firebase.js and paste your project config.", true);
    return;
  }

  const localStream = getLocalStream();
  if (!localStream) {
    showMessage("Start your camera first.", true);
    return;
  }

  clearMessage();
  createCallBtn.disabled = true;
  joinCallBtn.disabled = true;
  callIdInput.disabled = true;
  setStatus("Creating call...", "status-connecting");

  role = "caller";
  currentCallId = callId;

  pc = createPeerConnection({
    onTrack: handleRemoteTrack,
    onIceCandidate: (candidate) => {
      if (candidate) {
        addCallerCandidate(callId, candidate);
      }
    },
    onConnectionStateChange: handleConnectionStateChange,
    onIceConnectionStateChange: handleIceConnectionStateChange
  });

  addLocalTracks(pc, localStream);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await createCall(callId, offer, localId);
  } catch (err) {
    console.error("[VivyRTC] handleCreateCall error:", err);
    showMessage(err.message || "Could not create the call.", true);
    resetToIdle();
    return;
  }

  setStatus("Waiting for someone to join...", "status-connecting");
  remotePlaceholderText.textContent = "Waiting for someone to join...";

  const unsubAnswer = listenForAnswer(callId, async (answer) => {
    if (!pc || pc.currentRemoteDescription) return; // already applied

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      setStatus("Connecting...", "status-connecting");
    } catch (err) {
      console.error("[VivyRTC] setRemoteDescription (answer) error:", err);
      showMessage("The answer received was invalid. Ask the other person to try joining again.", true);
    }
  });

  const unsubReceiverCandidates = listenForReceiverCandidates(callId, async (candidateData) => {
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (err) {
      console.error("[VivyRTC] addIceCandidate (receiver) error:", err);
    }
  });

  const unsubStatus = listenForCallStatus(callId, (status) => {
    if (status === "ended") {
      showMessage("The other person left the call.", false);
      endCall(false);
    }
  });

  unsubscribers.push(unsubAnswer, unsubReceiverCandidates, unsubStatus);
}

// ------------------------------------------------------------
// Join call (receiver flow)
// ------------------------------------------------------------

async function handleJoinCall() {
  const callId = callIdInput.value.trim();

  if (!callId) {
    showMessage("Please enter a Call ID.", true);
    return;
  }

  if (!isFirebaseConfigured) {
    showMessage("Firebase is not configured yet. Open js/firebase.js and paste your project config.", true);
    return;
  }

  const localStream = getLocalStream();
  if (!localStream) {
    showMessage("Start your camera first.", true);
    return;
  }

  clearMessage();
  createCallBtn.disabled = true;
  joinCallBtn.disabled = true;
  callIdInput.disabled = true;
  setStatus("Joining call...", "status-connecting");

  role = "receiver";
  currentCallId = callId;

  try {
    const offer = await getCallOffer(callId);

    pc = createPeerConnection({
      onTrack: handleRemoteTrack,
      onIceCandidate: (candidate) => {
        if (candidate) {
          addReceiverCandidate(callId, candidate);
        }
      },
      onConnectionStateChange: handleConnectionStateChange,
      onIceConnectionStateChange: handleIceConnectionStateChange
    });

    addLocalTracks(pc, localStream);

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await setAnswer(callId, answer, localId);

    setStatus("Connecting...", "status-connecting");

    const unsubCallerCandidates = listenForCallerCandidates(callId, async (candidateData) => {
      if (!pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateData));
      } catch (err) {
        console.error("[VivyRTC] addIceCandidate (caller) error:", err);
      }
    });

    const unsubStatus = listenForCallStatus(callId, (status) => {
      if (status === "ended") {
        showMessage("The other person left the call.", false);
        endCall(false);
      }
    });

    unsubscribers.push(unsubCallerCandidates, unsubStatus);
  } catch (err) {
    console.error("[VivyRTC] handleJoinCall error:", err);
    showMessage(err.message || "Could not join the call.", true);
    setStatus("Failed", "status-failed");
    resetToIdle();
  }
}

// ------------------------------------------------------------
// In-call controls
// ------------------------------------------------------------

function handleMicToggle() {
  const muted = toggleMic();
  micBtn.classList.toggle("control-btn-off", muted);
  micBtn.querySelector(".control-icon").textContent = muted ? "🔇" : "🎤";
  micBtn.setAttribute("aria-label", muted ? "Unmute microphone" : "Mute microphone");
}

function handleCameraToggle() {
  const off = toggleCamera();
  cameraBtn.classList.toggle("control-btn-off", off);
  cameraBtn.querySelector(".control-icon").textContent = off ? "🚫" : "📹";
  cameraBtn.setAttribute("aria-label", off ? "Turn camera on" : "Turn camera off");
}

// Kept available for future use (e.g. a switch-camera button),
// mirrors senders from the live peer connection so a camera swap
// is reflected to the remote peer immediately.
function currentVideoSenders() {
  return getVideoSenders(pc);
}
void currentVideoSenders;

// ------------------------------------------------------------
// End call / reset
// ------------------------------------------------------------

function endCall(notifyRemote) {
  // Unsubscribe first so our own status update below doesn't
  // trigger our own "remote left" handler.
  unsubscribers.forEach((unsub) => {
    try {
      unsub();
    } catch (err) {
      console.error("[VivyRTC] Error unsubscribing listener:", err);
    }
  });
  unsubscribers = [];

  stopTimer();

  if (pc) {
    closePeerConnection(pc);
    pc = null;
  }

  stopLocalStream(localVideo);

  remoteVideo.srcObject = null;
  remotePlaceholder.hidden = false;

  if (notifyRemote && currentCallId) {
    updateCallStatus(currentCallId, "ended");
  }

  resetToIdle();
}

function resetToIdle() {
  currentCallId = null;
  role = null;
  hasConnectedOnce = false;

  setStatus("Idle", "");
  remotePlaceholderText.textContent = "Start your camera to begin";

  resetControlButtons();
  showSetupPanel();

  startCameraBtn.disabled = false;
  startCameraBtn.textContent = "Start Camera";
  createCallBtn.disabled = true;
  joinCallBtn.disabled = true;
  callIdInput.disabled = false;
}

// ------------------------------------------------------------
// Event wiring
// ------------------------------------------------------------

startCameraBtn.addEventListener("click", handleStartCamera);
createCallBtn.addEventListener("click", handleCreateCall);
joinCallBtn.addEventListener("click", handleJoinCall);
micBtn.addEventListener("click", handleMicToggle);
cameraBtn.addEventListener("click", handleCameraToggle);
endCallBtn.addEventListener("click", () => endCall(true));

window.addEventListener("beforeunload", () => {
  if (currentCallId) {
    updateCallStatus(currentCallId, "ended");
  }
});

// ------------------------------------------------------------
// Initial UI state
// ------------------------------------------------------------

resetToIdle();

if (!isFirebaseConfigured) {
  showMessage(
    "Firebase is not configured yet. You can still test your camera, but Create/Join Call will not work until js/firebase.js has your real config.",
    true
  );
}
