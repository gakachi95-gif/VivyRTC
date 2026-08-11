// ============================================================
// VivyRTC — WebRTC Peer Connection Module
// ============================================================
//
// Owns the native RTCPeerConnection lifecycle: creation, ICE
// server configuration, track handling, and state reporting.
// This module knows nothing about Firestore or the UI — it only
// deals with WebRTC primitives. signaling.js moves data between
// this module and Firestore; app.js wires it all to the screen.
// ============================================================

// ------------------------------------------------------------
// ICE server configuration.
//
// STUN servers help each peer discover its public IP/port so
// the other side can reach it directly. Two independent public
// STUN servers are used for redundancy.
//
// IMPORTANT: STUN alone does not guarantee connectivity on every
// network. Some networks (symmetric NATs, some carrier-grade
// NATs on mobile, restrictive corporate firewalls) will NOT be
// reachable with STUN alone and require a TURN server, which
// relays media when a direct peer-to-peer path isn't possible.
//
// This array is intentionally structured so a TURN entry can be
// appended later without changing any other code:
//
//   ICE_SERVERS.iceServers.push({
//     urls: "turn:your.turn.server:3478",
//     username: "your-username",
//     credential: "your-credential"
//   });
// ------------------------------------------------------------

export const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
    // TURN server(s) go here later, e.g.:
    // { urls: "turn:your.turn.server:3478", username: "...", credential: "..." }
  ]
};

/**
 * Creates a new RTCPeerConnection wired up with the callbacks
 * needed to drive the UI and signaling layers.
 *
 * @param {Object} callbacks
 * @param {(stream: MediaStream) => void} callbacks.onTrack
 *        Called when the remote peer's media stream arrives.
 * @param {(candidate: RTCIceCandidate|null) => void} callbacks.onIceCandidate
 *        Called for every local ICE candidate as it's discovered.
 *        Called with null once ICE gathering completes (informational only —
 *        candidates are sent individually as they're found, not batched).
 * @param {(state: RTCPeerConnectionState) => void} [callbacks.onConnectionStateChange]
 * @param {(state: RTCIceConnectionState) => void} [callbacks.onIceConnectionStateChange]
 * @returns {RTCPeerConnection}
 */
export function createPeerConnection({
  onTrack,
  onIceCandidate,
  onConnectionStateChange,
  onIceConnectionStateChange
}) {
  const pc = new RTCPeerConnection(ICE_SERVERS);

  // Remote tracks arrive one at a time; group them into a single
  // MediaStream so the caller can attach it to a <video> element once.
  const remoteStream = new MediaStream();

  pc.ontrack = (event) => {
    event.streams[0]
      ? event.streams[0].getTracks().forEach((track) => remoteStream.addTrack(track))
      : remoteStream.addTrack(event.track);

    if (typeof onTrack === "function") {
      onTrack(remoteStream);
    }
  };

  // Fired for every ICE candidate the local ICE agent discovers.
  // Each one must be sent to the remote peer individually via
  // signaling — do NOT wait for gathering to finish before sending.
  pc.onicecandidate = (event) => {
    if (typeof onIceCandidate === "function") {
      onIceCandidate(event.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    if (typeof onConnectionStateChange === "function") {
      onConnectionStateChange(pc.connectionState);
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (typeof onIceConnectionStateChange === "function") {
      onIceConnectionStateChange(pc.iceConnectionState);
    }
  };

  return pc;
}

/**
 * Adds every track of the local MediaStream to the peer connection
 * so it gets sent to the remote peer.
 */
export function addLocalTracks(pc, localStream) {
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });
}

/**
 * Returns the RTCRtpSender objects currently sending video, so
 * camera.js can call replaceTrack() on them when switching cameras
 * mid-call.
 */
export function getVideoSenders(pc) {
  if (!pc) return [];
  return pc.getSenders().filter((sender) => sender.track && sender.track.kind === "video");
}

/**
 * Fully tears down a peer connection: stops any local tracks still
 * attached to its senders, removes event handlers, and closes it.
 * Safe to call with null/undefined.
 */
export function closePeerConnection(pc) {
  if (!pc) return;

  pc.ontrack = null;
  pc.onicecandidate = null;
  pc.onconnectionstatechange = null;
  pc.oniceconnectionstatechange = null;

  pc.getSenders().forEach((sender) => {
    // Do not stop the track here — camera.js owns the local stream's
    // tracks and is responsible for stopping them via stopLocalStream().
    // We only detach the sender by closing the connection below.
    void sender;
  });

  try {
    pc.close();
  } catch (err) {
    console.error("[VivyRTC] Error closing RTCPeerConnection:", err);
  }
}
