const allowMicBtn = document.getElementById("allowMicBtn");
const statusText = document.getElementById("status");

allowMicBtn.addEventListener("click", async () => {
  try {
    statusText.textContent = "Requesting microphone permission...";

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });

    stream.getTracks().forEach(track => track.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();

    const microphones = devices
      .filter(device => device.kind === "audioinput")
      .map(device => ({
        deviceId: device.deviceId,
        groupId: device.groupId,
        label: device.label || "Microphone",
        kind: device.kind
      }));

    await chrome.storage.local.set({
      microphonePermissionGranted: true,
      microphonePermissionError: null,
      microphones,
      selectedMicrophoneId: microphones[0]?.deviceId || null
    });

    statusText.textContent = "Microphone permission granted. You can close this tab.";
  } catch (error) {
    const message =
      (error.name || "Error") + " - " + (error.message || String(error));

    await chrome.storage.local.set({
      microphonePermissionGranted: false,
      microphonePermissionError: message
    });

    statusText.textContent = "Microphone permission failed: " + message;
  }
});