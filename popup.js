const statusText = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const reprocessBtn = document.getElementById("reprocessBtn");
const settingsBtn = document.getElementById("settingsBtn");
const micBtn = document.getElementById("micBtn");

async function loadPopupState() {
  const data = await chrome.storage.local.get([
    "isRecording",
    "setupComplete",
    "microphonePermissionGranted"
  ]);

  if (data.isRecording) {
    statusText.textContent = "Status: recording";
    startBtn.disabled = true;
    stopBtn.disabled = false;
    return;
  }

  if (!data.setupComplete) {
    statusText.textContent = "Status: setup needed";
  } else if (!data.microphonePermissionGranted) {
    statusText.textContent = "Status: microphone permission needed";
  } else {
    statusText.textContent = "Status: idle";
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;
}

startBtn.addEventListener("click", async () => {
  statusText.textContent = "Status: starting...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_RECORDING"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not start recording.");
    }

    statusText.textContent = "Status: recording";
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (error) {
    console.error("Start error:", error);
    statusText.textContent = "Status: " + (error.message || String(error));
  }
});

stopBtn.addEventListener("click", async () => {
  statusText.textContent = "Status: stopping...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "STOP_RECORDING"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not stop recording.");
    }

    statusText.textContent = "Status: recording stopped";
    startBtn.disabled = false;
    stopBtn.disabled = true;
  } catch (error) {
    console.error("Stop error:", error);
    statusText.textContent = "Status: " + (error.message || String(error));
  }
});

reprocessBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_REPROCESS" });
});

settingsBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "OPEN_SETUP"
  });
});

micBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "OPEN_MIC_PERMISSION"
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.isRecording) {
    loadPopupState();
  }
});

loadPopupState();