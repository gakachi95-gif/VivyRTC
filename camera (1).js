// ============================================================
// VivyRTC — Local Camera / Microphone Module
// ============================================================
//
// This is the Phase 1 getUserMedia logic, preserved exactly
// (same constraints, same error handling, same switch-camera
// approach), refactored into an ES module of exported functions
// instead of an IIFE wired directly to Phase-1-only buttons.
//
// app.js is responsible for the UI (buttons, status text).
// This module is only responsible for the MediaStream itself.
// ============================================================

let currentStream = null;
let isMicMuted = false;
let isCameraOff = false;
let currentFacingMode = "user"; // "user" = front camera, "environment" = back camera

/**
 * Returns a friendly, human-readable message for a getUserMedia
 * error, mirroring the exact error handling from Phase 1.
 */
export function describeMediaError(err) {
  switch (err.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Permission denied. Please allow camera and microphone access in your browser settings and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "Camera or microphone is already in use by another application.";
    case "OverconstrainedError":
      return "No camera matches the requested settings. Trying the default camera may help.";
    case "SecurityError":
      return "Camera access is blocked due to a security restriction (page must be served over HTTPS).";
    default:
      return "Unexpected error: " + (err.message || err.name || "unknown error");
  }
}

/**
 * Checks that the page is running in a secure context, since
 * getUserMedia requires HTTPS (or localhost). Same check as
 * Phase 1.
 */
export function isSecureContext() {
  return (
    window.location.protocol === "https:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

/**
 * Requests camera + microphone access and attaches the resulting
 * MediaStream to the given <video> element. Returns the stream.
 * Throws an Error with a friendly `.message` on failure — callers
 * should catch and display err.message directly.
 */
export async function startLocalStream(videoElement) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("getUserMedia is not supported in this browser.");
  }

  if (!isSecureContext()) {
    throw new Error(
      "Camera access requires HTTPS. Please open this page over https:// (GitHub Pages provides this automatically)."
    );
  }

  const constraints = {
    video: { facingMode: currentFacingMode },
    audio: true
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;

    isMicMuted = false;
    isCameraOff = false;

    if (videoElement) {
      videoElement.srcObject = stream;
    }

    return stream;
  } catch (err) {
    console.error("[VivyRTC] getUserMedia error:", err);
    throw new Error(describeMediaError(err));
  }
}

/**
 * Stops all local tracks and clears the video element. Safe to
 * call even if no stream is active.
 */
export function stopLocalStream(videoElement) {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }

  currentStream = null;

  if (videoElement) {
    videoElement.srcObject = null;
  }
}

/**
 * Toggles the microphone on/off by enabling/disabling the audio
 * track (this does NOT stop the track, so it can be re-enabled
 * instantly). Returns the new muted state (true = muted).
 */
export function toggleMic() {
  if (!currentStream) return isMicMuted;

  isMicMuted = !isMicMuted;
  currentStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMicMuted;
  });

  return isMicMuted;
}

/**
 * Toggles the camera on/off by enabling/disabling the video
 * track. Returns the new "off" state (true = camera off).
 */
export function toggleCamera() {
  if (!currentStream) return isCameraOff;

  isCameraOff = !isCameraOff;
  currentStream.getVideoTracks().forEach((track) => {
    track.enabled = !isCameraOff;
  });

  return isCameraOff;
}

/**
 * Switches between front ("user") and back ("environment")
 * camera. Replaces only the video track on the existing stream
 * so audio keeps flowing uninterrupted. Also swaps the outgoing
 * track on any active RTCPeerConnection senders passed in, so a
 * live call keeps working after switching cameras.
 *
 * @param {HTMLVideoElement} videoElement - local preview element
 * @param {RTCRtpSender[]} [videoSenders] - optional senders from
 *        an active RTCPeerConnection whose track should be
 *        replaced with the new camera's track.
 */
export async function switchCamera(videoElement, videoSenders = []) {
  if (!currentStream) {
    throw new Error("Start the camera before switching.");
  }

  const previousFacingMode = currentFacingMode;
  currentFacingMode = currentFacingMode === "user" ? "environment" : "user";

  // Stop the existing video track(s) only; audio track is untouched.
  currentStream.getVideoTracks().forEach((track) => track.stop());

  try {
    const newVideoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode }
    });

    const newVideoTrack = newVideoStream.getVideoTracks()[0];

    // Remove old video track(s) from currentStream and add the new one.
    currentStream.getVideoTracks().forEach((track) => {
      currentStream.removeTrack(track);
    });
    currentStream.addTrack(newVideoTrack);

    // Re-apply the current camera-off state to the new track.
    newVideoTrack.enabled = !isCameraOff;

    if (videoElement) {
      videoElement.srcObject = currentStream;
    }

    // If there's a live call, replace the outgoing track too so
    // the remote side sees the new camera without renegotiating.
    for (const sender of videoSenders) {
      if (sender && typeof sender.replaceTrack === "function") {
        await sender.replaceTrack(newVideoTrack);
      }
    }

    return currentFacingMode;
  } catch (err) {
    // Revert facing mode on failure (e.g. device has no second camera).
    currentFacingMode = previousFacingMode;
    console.error("[VivyRTC] switchCamera error:", err);
    throw new Error(describeMediaError(err));
  }
}

/** Returns the currently active local MediaStream, or null. */
export function getLocalStream() {
  return currentStream;
}

/** Returns whether the microphone is currently muted. */
export function getIsMicMuted() {
  return isMicMuted;
}

/** Returns whether the camera is currently turned off. */
export function getIsCameraOff() {
  return isCameraOff;
}

// Release the camera/mic if the tab is closed or navigated away,
// same safety behavior as Phase 1.
window.addEventListener("beforeunload", () => {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }
});
