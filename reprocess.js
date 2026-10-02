const DB_NAME = "ClassRecorderAudio";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

const studentNameInput = document.getElementById("studentName");
const meetingTitleInput = document.getElementById("meetingTitle");
const classProgramInput = document.getElementById("classProgram");
const micFileInput = document.getElementById("micFile");
const tabFileInput = document.getElementById("tabFile");
const reprocessBtn = document.getElementById("reprocessBtn");
const statusText = document.getElementById("status");

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open recovery storage."));
  });
}

async function saveSession(record) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save selected recordings."));
      tx.onabort = () => reject(tx.error || new Error("Saving selected recordings was interrupted."));
    });
  } finally {
    db.close();
  }
}

reprocessBtn.addEventListener("click", async () => {
  const micFile = micFileInput.files?.[0] || null;
  const tabFile = tabFileInput.files?.[0] || null;

  if (!micFile && !tabFile) {
    statusText.textContent = "Choose at least one audio file.";
    return;
  }

  reprocessBtn.disabled = true;
  statusText.textContent = "Preserving the recordings...";

  try {
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const emptyAudio = new Blob([], { type: "audio/webm" });

    await saveSession({
      sessionId,
      meetingTitle: meetingTitleInput.value.trim() || "Reprocessed Class",
      studentName: studentNameInput.value.trim() || "Student",
      classProgram: classProgramInput.value.trim(),
      startedAt: now,
      stoppedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "audio_preserved",
      microphone: micFile || emptyAudio,
      tabAudio: tabFile || emptyAudio,
      importedForReprocessing: true,
      originalMicrophoneFilename: micFile?.name || null,
      originalTabAudioFilename: tabFile?.name || null,
      error: null
    });

    statusText.textContent = "Adding the recording to the transcription queue...";
    const response = await chrome.runtime.sendMessage({
      type: "QUEUE_REPROCESS_SESSION",
      sessionId
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not start reprocessing.");
    }

    statusText.textContent = "Queued successfully. You may close this page; the transcript will open when ready.";
    micFileInput.value = "";
    tabFileInput.value = "";
  } catch (error) {
    console.error("Reprocess error:", error);
    statusText.textContent = "Could not reprocess: " + (error.message || String(error));
  } finally {
    reprocessBtn.disabled = false;
  }
});
