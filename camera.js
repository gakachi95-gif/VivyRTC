// VivyRTC Camera Test — Stage 1
// Pure browser MediaDevices API. No third-party SDKs.

(function () {
  "use strict";

  const localVideo = document.getElementById("localVideo");
  const placeholder = document.getElementById("placeholder");
  const statusBox = document.getElementById("statusBox");

  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const muteBtn = document.getElementById("muteBtn");
  const cameraOffBtn = document.getElementById("cameraOffBtn");
  const switchBtn = document.getElementById("switchBtn");

  let currentStream = null;
  let isMicMuted = false;
  let isCameraOff = false;
  let currentFacingMode = "user"; // "user" = front camera, "environment" = back camera

  function setStatus(message, isError) {
    statusBox.textContent = message || "";
    statusBox.style.color = isError ? "#e05260" : "#f2c94c";
  }

  function updateButtonStates(streamActive) {
    startBtn.disabled = streamActive;
    stopBtn.disabled = !streamActive;
    muteBtn.disabled = !streamActive;
    cameraOffBtn.disabled = !streamActive;
    switchBtn.disabled = !streamActive;
  }

  async function startCamera() {
    setStatus("Requesting camera and microphone access...", false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("getUserMedia is not supported in this browser.", true);
      return;
    }

    // Must be served over HTTPS (or localhost) for camera access to work.
    const isSecure =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (!isSecure) {
      setStatus(
        "Camera access requires HTTPS. Please open this page over https:// (GitHub Pages provides this automatically).",
        true
      );
      return;
    }

    const constraints = {
      video: { facingMode: currentFacingMode },
      audio: true
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentStream = stream;

      localVideo.srcObject = stream;
      placeholder.style.display = "none";

      isMicMuted = false;
      isCameraOff = false;
      muteBtn.textContent = "Mute Microphone";
      cameraOffBtn.textContent = "Turn Camera Off";

      updateButtonStates(true);
      setStatus("Camera and microphone active.", false);
    } catch (err) {
      handleGetUserMediaError(err);
    }
  }

  function handleGetUserMediaError(err) {
    let message = "Could not access camera/microphone.";

    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        message =
          "Permission denied. Please allow camera and microphone access in your browser settings and try again.";
        break;
      case "NotFoundError":
      case "DevicesNotFoundError":
        message = "No camera or microphone found on this device.";
        break;
      case "NotReadableError":
      case "TrackStartError":
        message =
          "Camera or microphone is already in use by another application.";
        break;
      case "OverconstrainedError":
        message =
          "No camera matches the requested settings. Trying default camera may help.";
        break;
      case "SecurityError":
        message = "Camera access is blocked due to a security restriction (page must be served over HTTPS).";
        break;
      default:
        message = "Unexpected error: " + (err.message || err.name || "unknown error");
    }

    setStatus(message, true);
    updateButtonStates(false);
    console.error("getUserMedia error:", err);
  }

  function stopCamera() {
    if (!currentStream) return;

    currentStream.getTracks().forEach(function (track) {
      track.stop();
    });

    currentStream = null;
    localVideo.srcObject = null;
    placeholder.style.display = "flex";

    updateButtonStates(false);
    setStatus("Camera stopped.", false);
  }

  function toggleMute() {
    if (!currentStream) return;

    isMicMuted = !isMicMuted;
    currentStream.getAudioTracks().forEach(function (track) {
      track.enabled = !isMicMuted;
    });

    muteBtn.textContent = isMicMuted ? "Unmute Microphone" : "Mute Microphone";
    setStatus(isMicMuted ? "Microphone muted." : "Microphone unmuted.", false);
  }

  function toggleCameraOff() {
    if (!currentStream) return;

    isCameraOff = !isCameraOff;
    currentStream.getVideoTracks().forEach(function (track) {
      track.enabled = !isCameraOff;
    });

    cameraOffBtn.textContent = isCameraOff ? "Turn Camera On" : "Turn Camera Off";
    setStatus(isCameraOff ? "Camera turned off." : "Camera turned on.", false);
  }

  async function switchCamera() {
    if (!currentStream) return;

    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    setStatus("Switching camera...", false);

    // Stop existing video track(s) only; keep audio flowing where possible.
    currentStream.getVideoTracks().forEach(function (track) {
      track.stop();
    });

    try {
      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacingMode }
      });

      const newVideoTrack = newVideoStream.getVideoTracks()[0];

      // Remove old video track from currentStream and add the new one.
      currentStream.getVideoTracks().forEach(function (track) {
        currentStream.removeTrack(track);
      });
      currentStream.addTrack(newVideoTrack);

      // Re-apply mute/camera-off state to the new track.
      newVideoTrack.enabled = !isCameraOff;

      localVideo.srcObject = currentStream;
      setStatus(
        currentFacingMode === "user"
          ? "Switched to front camera."
          : "Switched to back camera.",
        false
      );
    } catch (err) {
      // Revert facing mode on failure (e.g. device has no second camera).
      currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
      handleGetUserMediaError(err);
    }
  }

  startBtn.addEventListener("click", startCamera);
  stopBtn.addEventListener("click", stopCamera);
  muteBtn.addEventListener("click", toggleMute);
  cameraOffBtn.addEventListener("click", toggleCameraOff);
  switchBtn.addEventListener("click", switchCamera);

  // Stop tracks if the user navigates away, to release the camera/mic.
  window.addEventListener("beforeunload", function () {
    if (currentStream) {
      currentStream.getTracks().forEach(function (track) {
        track.stop();
      });
    }
  });

  updateButtonStates(false);
})();
