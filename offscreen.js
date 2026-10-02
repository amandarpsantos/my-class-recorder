let micRecorder = null;
let tabRecorder = null;
let mixedRecorder = null;

let micChunks = [];
let tabChunks = [];
let mixedChunks = [];

let micStream = null;
let tabStream = null;

let tabPlaybackAudioContext = null;
let mixedDestination = null;

let savedTranscriptionProvider = "deepgram";
let savedDeepgramApiKey = null;
let savedGeminiApiKey = null;
let savedSelectedMicrophoneId = null;
let savedMeetingTitle = "Untitled Class";
let savedStudentName = "";
let savedClassProgram = "";
let startedAt = null;

let micBytesRecorded = 0;
let tabBytesRecorded = 0;
let mixedBytesRecorded = 0;

let micChunkCount = 0;
let tabChunkCount = 0;
let mixedChunkCount = 0;

let savedSessionId = null;
let processingChain = Promise.resolve();
const AUDIO_DB_NAME = "ClassRecorderAudio";
const AUDIO_DB_VERSION = 1;
const AUDIO_STORE_NAME = "sessions";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message.type?.startsWith("RECORDER_")) {
    return false;
  }

  handleRecorderMessage(message)
    .then(sendResponse)
    .catch(error => {
      console.error("Offscreen recorder error:", error);

      sendResponse({
        ok: false,
        error: error.message || String(error)
      });
    });

  return true;
});

async function handleRecorderMessage(message) {
  if (message.type === "RECORDER_START") {
    savedTranscriptionProvider = message.transcriptionProvider || "deepgram";
    savedDeepgramApiKey = message.deepgramApiKey || null;
    savedGeminiApiKey = message.geminiApiKey || null;
    savedSelectedMicrophoneId = message.selectedMicrophoneId || null;
    savedMeetingTitle = message.meetingTitle || "Untitled Class";
    savedStudentName = normalizeStudentName(message.studentName || "");
    savedClassProgram = normalizeClassProgram(message.classProgram || "");
    startedAt = message.startedAt || new Date().toISOString();
    savedSessionId = message.sessionId || crypto.randomUUID();

    await startRecording(message.streamId);

    return { ok: true };
  }

  if (message.type === "RECORDER_STOP") {
    await stopRecording();

    return { ok: true };
  }

  if (message.type === "RECORDER_FINALIZE_SESSION") {
    return await finalizeStoredSession(message);
  }

  if (message.type === "RECORDER_REPROCESS") {
    const stored = await getStoredSession(message.sessionId);
    if (!stored) {
      return { ok: false, error: "Saved recording could not be found." };
    }

    // Settings are supplied by the background service worker because
    // chrome.storage may be unavailable in some offscreen document contexts.
    const provider = message.transcriptionProvider || "deepgram";
    const session = {
      sessionId: stored.sessionId,
      transcriptionProvider: provider,
      deepgramApiKey: message.deepgramApiKey || "",
      geminiApiKey: message.geminiApiKey || "",
      meetingTitle: stored.meetingTitle || "Reprocessed Class",
      studentName: normalizeStudentName(stored.studentName || "Student"),
      classProgram: normalizeClassProgram(stored.classProgram || ""),
      startedAt: stored.startedAt || stored.createdAt || new Date().toISOString(),
      stoppedAt: stored.stoppedAt || new Date().toISOString(),
      micBlob: stored.microphone || new Blob([], { type: "audio/webm" }),
      tabBlob: stored.tabAudio || new Blob([], { type: "audio/webm" })
    };

    if ((!session.micBlob || session.micBlob.size === 0) &&
        (!session.tabBlob || session.tabBlob.size === 0)) {
      return { ok: false, error: "The saved session contains no usable audio files." };
    }

    await updateStoredSession(session.sessionId, {
      state: "waiting_for_transcription",
      error: null,
      reprocessRequestedAt: new Date().toISOString()
    });

    processingChain = processingChain
      .then(() => processCapturedSession(session))
      .catch(error => console.error("Reprocessed transcription failed:", error));

    return { ok: true, queued: true, sessionId: session.sessionId };
  }

  return {
    ok: false,
    error: "Unknown recorder message."
  };
}

async function startRecording(streamId) {
  micChunks = [];
  tabChunks = [];
  mixedChunks = [];
  mixedChunks = [];

  micBytesRecorded = 0;
  tabBytesRecorded = 0;
  mixedBytesRecorded = 0;
  mixedBytesRecorded = 0;

  micChunkCount = 0;
  tabChunkCount = 0;
  mixedChunkCount = 0;
  mixedChunkCount = 0;

    console.log("[Diagnostics] Starting recording..."); 
    
  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: savedSelectedMicrophoneId
      ? {
          deviceId: { exact: savedSelectedMicrophoneId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
    video: false
  });

    console.log(
    "[Diagnostics] Tab Stream",
    {
        active: tabStream.active,
        tracks: tabStream.getAudioTracks().length
    }
);

console.log(
    "[Diagnostics] Mic Stream",
    {
        active: micStream.active,
        tracks: micStream.getAudioTracks().length
    }
);
  tabStream.getTracks().forEach(track => {
      track.onended = () => {
        console.warn("Tab audio stream ended. Requesting auto-stop.");
    
        chrome.runtime.sendMessage({
          type: "MEETING_ENDED",
          reason: "Tab audio stream ended"
        }).catch(error => {
          console.warn("Could not request auto-stop after tab audio ended:", error);
    });
  };
});

  micStream.getTracks().forEach(track => {
    track.onended = () => {
      console.warn("Microphone audio stream ended.");
    };
  });

  // Build one mixed class recording for Deepgram while keeping the tab audible.
  // Mic and meeting audio are reduced slightly before mixing to avoid clipping.
  tabPlaybackAudioContext = new AudioContext();
  const tabSource = tabPlaybackAudioContext.createMediaStreamSource(tabStream);
  const micSource = tabPlaybackAudioContext.createMediaStreamSource(micStream);
  mixedDestination = tabPlaybackAudioContext.createMediaStreamDestination();
  const tabGain = tabPlaybackAudioContext.createGain();
  const micGain = tabPlaybackAudioContext.createGain();
  tabGain.gain.value = 0.72;
  micGain.gain.value = 0.72;
  tabSource.connect(tabGain).connect(mixedDestination);
  micSource.connect(micGain).connect(mixedDestination);
  tabSource.connect(tabPlaybackAudioContext.destination);

  micRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm" });
  tabRecorder = new MediaRecorder(tabStream, { mimeType: "audio/webm" });
  mixedRecorder = new MediaRecorder(mixedDestination.stream, { mimeType: "audio/webm" });

  micRecorder.ondataavailable = event => {

    if (event.data && event.data.size > 0) {

        micChunks.push(event.data);

        micChunkCount++;
        micBytesRecorded += event.data.size;

        console.log(
            "[Diagnostics] Mic Chunk",
            {
                size: event.data.size,
                chunkCount: micChunkCount,
                totalBytes: micBytesRecorded
            }
        );

    } else {

        console.warn(
            "[Diagnostics] Empty mic chunk"
        );
    }
};

  tabRecorder.ondataavailable = event => {

    if (event.data && event.data.size > 0) {

        tabChunks.push(event.data);

        tabChunkCount++;
        tabBytesRecorded += event.data.size;

        console.log(
            "[Diagnostics] Tab Chunk",
            {
                size: event.data.size,
                chunkCount: tabChunkCount,
                totalBytes: tabBytesRecorded
            }
        );

    } else {

        console.warn(
            "[Diagnostics] Empty tab chunk"
        );
    }
};

  mixedRecorder.ondataavailable = event => {
    if (event.data && event.data.size > 0) {
      mixedChunks.push(event.data);
      mixedChunkCount++;
      mixedBytesRecorded += event.data.size;
      console.log("[Diagnostics] Mixed Chunk", {
        size: event.data.size,
        chunkCount: mixedChunkCount,
        totalBytes: mixedBytesRecorded
      });
    }
  };

  mixedRecorder.onerror = event => {
    console.error("Mixed recorder error:", event.error || event);
  };

  micRecorder.onerror = event => {
    console.error("Microphone recorder error:", event.error || event);
  };

  tabRecorder.onerror = event => {
    console.error("Tab recorder error:", event.error || event);
  };

  micRecorder.onstop = null;
  tabRecorder.onstop = null;

  // Create chunks every 5 seconds so recording is not only saved at the end.
  micRecorder.start(5000);
  tabRecorder.start(5000);
  mixedRecorder.start(5000);

    console.log("[Diagnostics] Recording started successfully");
  console.log(
    "[Diagnostics] Recorder States After Start",
    {
        mic: micRecorder.state,
        tab: tabRecorder.state
    }
 );
}

async function stopRecording() {
  const stoppedAt = new Date().toISOString();

  // Snapshot everything that belongs to this recording before a new class can start.
  const session = {
    sessionId: savedSessionId || crypto.randomUUID(),
    transcriptionProvider: savedTranscriptionProvider,
    deepgramApiKey: savedDeepgramApiKey,
    geminiApiKey: savedGeminiApiKey,
    meetingTitle: savedMeetingTitle,
    studentName: savedStudentName,
    classProgram: savedClassProgram,
    startedAt,
    stoppedAt,
    micRecorder,
    tabRecorder,
    mixedRecorder,
    micChunks,
    tabChunks,
    mixedChunks,
    micBytesRecorded,
    tabBytesRecorded,
    micChunkCount,
    tabChunkCount,
    mixedBytesRecorded,
    mixedChunkCount
  };

  const micBlobPromise = stopRecorderAndGetBlob(session.micRecorder, session.micChunks);
  const tabBlobPromise = stopRecorderAndGetBlob(session.tabRecorder, session.tabChunks);
  const mixedBlobPromise = stopRecorderAndGetBlob(session.mixedRecorder, session.mixedChunks);

  stopStreams();

  const [micBlob, tabBlob, mixedBlob] = await Promise.all([micBlobPromise, tabBlobPromise, mixedBlobPromise]);

  session.micBlob = micBlob;
  session.tabBlob = tabBlob;
  session.mixedBlob = mixedBlob;

  console.log("[Diagnostics] Final Recording Summary", {
    sessionId: session.sessionId,
    micChunks: session.micChunkCount,
    tabChunks: session.tabChunkCount,
    micBytes: session.micBytesRecorded,
    tabBytes: session.tabBytesRecorded,
    micBlobSize: micBlob?.size || 0,
    tabBlobSize: tabBlob?.size || 0,
    mixedBlobSize: mixedBlob?.size || 0
  });

  // Release all active recorder globals immediately. A new class can start now,
  // while this completed session saves and transcribes in the background.
  resetActiveRecorderState();

  if (!mixedBlob || mixedBlob.size === 0) {
    queueSessionError(session, "Recording failed: no audio was captured.");
    return { ok: false, error: "Recording failed: no audio was captured." };
  }

  // Do not await processing. This is the key TeachAssist behavior:
  // stopping one lesson never blocks starting the next lesson.
  persistAndQueueSession(session).catch(error => {
    console.error("Could not preserve/queue completed session:", error);
    queueSessionError(session, error.message || String(error));
  });

  return {
    ok: true,
    sessionId: session.sessionId,
    queuedForProcessing: true
  };
}

function resetActiveRecorderState() {
  micRecorder = null;
  tabRecorder = null;
  mixedRecorder = null;
  micChunks = [];
  tabChunks = [];
  micBytesRecorded = 0;
  tabBytesRecorded = 0;
  micChunkCount = 0;
  tabChunkCount = 0;
  savedSessionId = null;
  startedAt = null;
}

async function persistAndQueueSession(session) {
  // Preserve the original recordings temporarily in IndexedDB. They are not
  // downloaded unless the dashboard upload fails.
  await saveSessionToIndexedDb(session);

  await updateStoredSession(session.sessionId, {
    state: "waiting_for_transcription"
  });

  // Process completed classes one at a time, but never block the recorder.
  processingChain = processingChain
    .then(() => processCapturedSession(session))
    .catch(error => {
      console.error("Queued transcription failed:", error);
    });
}

async function processCapturedSession(session) {
  await updateStoredSession(session.sessionId, { state: "transcribing" });

  try {
    const teacherLabel = "Teacher Amanda";
    const studentLabel = session.studentName || "Student";
    let transcript;

    if (session.transcriptionProvider === "deepgram") {
      const mixedBlob = session.mixedBlob || session.micBlob;
      const mixedTranscript = await transcribeMixedWithDeepgram({
        blob: mixedBlob,
        apiKey: session.deepgramApiKey,
        teacherLabel,
        studentLabel
      });

      if (!mixedTranscript?.utterances?.length && !(mixedTranscript?.text || "").trim()) {
        throw new Error("No transcript text returned from the mixed class audio.");
      }

      const createdDate = new Date(session.startedAt || Date.now());
      transcript = {
        title: buildTranscriptTitle(createdDate),
        meetingTitle: session.meetingTitle || "Untitled Class",
        studentName: normalizeStudentName(session.studentName),
        classProgram: normalizeClassProgram(session.classProgram),
        teacherName: teacherLabel,
        studentLabel,
        source: "chrome-extension-v3-mixed-diarized",
        createdAt: session.startedAt || new Date().toISOString(),
        stoppedAt: session.stoppedAt || new Date().toISOString(),
        audioDuration: mixedTranscript.audioDuration || null,
        languageCode: mixedTranscript.languageCode || "en/pt",
        text: mixedTranscript.utterances.map(x => `${x.speaker}: ${x.text}`).join("\n\n"),
        utterances: mixedTranscript.utterances,
        sourceTranscripts: { mixedAudio: mixedTranscript },
        transcriptionProvider: "deepgram",
        speakerLabelsEstimated: true
      };
    } else {
      // Gemini keeps the existing source-labelled two-track behavior.
      const micTranscript = await transcribeAudio({
        blob: session.micBlob, provider: session.transcriptionProvider,
        deepgramApiKey: session.deepgramApiKey, geminiApiKey: session.geminiApiKey,
        sourceLabel: teacherLabel
      });
      const tabTranscript = await transcribeAudio({
        blob: session.tabBlob, provider: session.transcriptionProvider,
        deepgramApiKey: session.deepgramApiKey, geminiApiKey: session.geminiApiKey,
        sourceLabel: studentLabel
      });
      transcript = buildMergedTranscriptObject({
        micTranscript, tabTranscript, teacherLabel, studentLabel,
        startedAt: session.startedAt, stoppedAt: session.stoppedAt
      });
    }

    transcript.sessionId = session.sessionId;
    transcript.meetingTitle = session.meetingTitle;
    transcript.classProgram = session.classProgram;

    await updateStoredSession(session.sessionId, {
      state: "transcription_complete",
      transcriptCreatedAt: new Date().toISOString()
    });

    await chrome.runtime.sendMessage({
      type: "TRANSCRIPT_READY",
      sessionId: session.sessionId,
      transcript
    });
  } catch (error) {
    const message = error.message || String(error);
    await updateStoredSession(session.sessionId, {
      state: "transcription_failed", error: message
    }).catch(() => {});

    await chrome.runtime.sendMessage({
      type: "TRANSCRIPT_ERROR",
      sessionId: session.sessionId,
      meetingTitle: session.meetingTitle,
      error: `${message}\n\nThe mixed class audio was preserved.`
    });
  }
}

function queueSessionError(session, message) {
  chrome.runtime.sendMessage({
    type: "TRANSCRIPT_ERROR",
    sessionId: session.sessionId,
    meetingTitle: session.meetingTitle,
    error: `${message}\n\nAny successfully captured audio remains preserved.`
  }).catch(() => {});
}

function stopRecorderAndGetBlob(recorder, chunks) {
  return new Promise(resolve => {
    if (!recorder || recorder.state === "inactive") {
      resolve(new Blob(chunks, { type: "audio/webm" }));
      return;
    }

    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: "audio/webm" }));
    };

    try {
      recorder.stop();
    } catch (error) {
      console.warn("Recorder stop failed:", error);
      resolve(new Blob(chunks, { type: "audio/webm" }));
    }
  });
}

function stopStreams() {
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
  }

  if (tabStream) {
    tabStream.getTracks().forEach(track => track.stop());
  }

  if (tabPlaybackAudioContext) {
    tabPlaybackAudioContext.close().catch(() => {});
  }

  micStream = null;
  tabStream = null;
  tabPlaybackAudioContext = null;
  mixedDestination = null;
}

function buildBackupFolderName({ meetingTitle, startedAt, stoppedAt }) {
  const date = new Date(stoppedAt || startedAt || Date.now());
  const pad = value => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const safeTitle = String(meetingTitle || "Class")
    .replace(/[\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Class";

  return `Class Recorder Recovery/${stamp}_${safeTitle}`;
}

async function saveBlobBackup(blob, filename) {
  if (!blob || blob.size === 0) {
    throw new Error(`Cannot save empty recording: ${filename}`);
  }

  const url = URL.createObjectURL(blob);

  try {
    // The downloads API is not available inside an MV3 offscreen document.
    // Send the object URL to the background service worker, which owns downloads.
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_AUDIO_BACKUP",
      url,
      filename
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Background download failed.");
    }

    // Keep the object URL alive long enough for Chrome to consume it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    return {
      ok: true,
      downloadId: response.downloadId,
      filename,
      size: blob.size
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    console.error("Audio backup failed:", filename, error);
    throw error;
  }
}

function openAudioDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        db.createObjectStore(AUDIO_STORE_NAME, { keyPath: "sessionId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open audio recovery storage."));
  });
}

async function saveSessionToIndexedDb(session) {
  const db = await openAudioDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
      const store = tx.objectStore(AUDIO_STORE_NAME);
      store.put({
        sessionId: session.sessionId,
        meetingTitle: session.meetingTitle,
        studentName: session.studentName,
        classProgram: session.classProgram,
        startedAt: session.startedAt,
        stoppedAt: session.stoppedAt,
        createdAt: new Date().toISOString(),
        state: "audio_preserved",
        mixedAudio: session.mixedBlob || session.micBlob,
        microphone: session.micBlob,
        tabAudio: session.tabBlob,
        error: null
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not preserve class audio."));
      tx.onabort = () => reject(tx.error || new Error("Audio preservation was aborted."));
    });
  } finally {
    db.close();
  }
}

async function getStoredSession(sessionId) {
  const db = await openAudioDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE_NAME, "readonly");
      const request = tx.objectStore(AUDIO_STORE_NAME).get(sessionId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not read saved recording."));
    });
  } finally {
    db.close();
  }
}

async function updateStoredSession(sessionId, updates) {
  const db = await openAudioDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
      const store = tx.objectStore(AUDIO_STORE_NAME);
      const getRequest = store.get(sessionId);
      getRequest.onsuccess = () => {
        const current = getRequest.result || { sessionId };
        store.put({ ...current, ...updates, updatedAt: new Date().toISOString() });
      };
      getRequest.onerror = () => reject(getRequest.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not update stored class session."));
    });
  } finally {
    db.close();
  }
}

async function finalizeStoredSession(message) {
  const sessionId = message.sessionId;
  if (!sessionId) {
    return { ok: false, error: "Missing session ID." };
  }

  const stored = await getStoredSession(sessionId);
  if (!stored) {
    return { ok: true, alreadyRemoved: true };
  }

  if (message.dashboardSaved) {
    await deleteStoredSession(sessionId);
    return { ok: true, deleted: true, downloaded: false };
  }

  const backupFolder = buildBackupFolderName({
    meetingTitle: stored.meetingTitle,
    startedAt: stored.startedAt,
    stoppedAt: stored.stoppedAt
  });

  const transcriptBlob = new Blob([
    JSON.stringify({
      dashboardUploadError: message.dashboardError || "Dashboard upload failed.",
      transcript: message.transcript || null
    }, null, 2)
  ], { type: "application/json" });

  const recoveryAudio = stored.mixedAudio || stored.microphone || stored.tabAudio;
  const results = await Promise.allSettled([
    saveBlobBackup(recoveryAudio, `${backupFolder}/class_audio.webm`),
    saveBlobBackup(transcriptBlob, `${backupFolder}/transcript-recovery.json`)
  ]);

  const failures = results.filter(result => result.status === "rejected");
  if (failures.length > 0) {
    await updateStoredSession(sessionId, {
      state: "recovery_download_failed",
      error: failures.map(result => String(result.reason?.message || result.reason)).join(" | ")
    });
    return {
      ok: false,
      downloaded: false,
      error: "One or more recovery files could not be downloaded. The browser copy was kept."
    };
  }

  await deleteStoredSession(sessionId);
  return { ok: true, downloaded: true, deleted: true };
}

async function deleteStoredSession(sessionId) {
  const db = await openAudioDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
      tx.objectStore(AUDIO_STORE_NAME).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not delete saved class audio."));
      tx.onabort = () => reject(tx.error || new Error("Deleting saved class audio was aborted."));
    });
  } finally {
    db.close();
  }
}

async function transcribeAudio({
  blob,
  provider,
  deepgramApiKey,
  geminiApiKey,
  sourceLabel
}) {
  if (provider === "deepgram") {
    return transcribeWithDeepgram({
      blob,
      apiKey: deepgramApiKey,
      sourceLabel
    });
  }

  return transcribeWithGemini({
    blob,
    apiKey: geminiApiKey,
    sourceLabel
  });
}

async function transcribeMixedWithDeepgram({ blob, apiKey, teacherLabel, studentLabel }) {
  if (!apiKey) throw new Error("No Deepgram API key saved.");
  if (!blob || blob.size === 0) throw new Error("The mixed class recording is empty.");

  const query = new URLSearchParams({
    model: "nova-3",
    language: "multi",
    smart_format: "true",
    punctuate: "true",
    utterances: "true",
    diarize_model: "latest"
  });
  ["não","então","também","porque","você","vocês","gente","a gente","português","Brasil","brasileiro","brasileira"]
    .forEach(term => query.append("keyterm", term));

  const response = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": blob.type || "audio/webm" },
    body: blob
  });
  const responseText = await response.text();
  let data = {};
  try { data = responseText ? JSON.parse(responseText) : {}; } catch (_) {}
  if (!response.ok) {
    throw new Error(`Deepgram transcription failed (${response.status}): ${data?.err_msg || data?.error || data?.message || responseText || "Unknown error"}`);
  }

  const alternative = data?.results?.channels?.[0]?.alternatives?.[0] || {};
  const rawUtterances = Array.isArray(data?.results?.utterances) ? data.results.utterances : [];
  const speakerIds = [...new Set(rawUtterances.map(u => Number(u.speaker)).filter(Number.isFinite))];
  const speakerMap = new Map();
  if (speakerIds.length > 0) speakerMap.set(speakerIds[0], teacherLabel);
  if (speakerIds.length > 1) speakerMap.set(speakerIds[1], studentLabel);
  speakerIds.slice(2).forEach((id, index) => speakerMap.set(id, `Speaker ${index + 3}`));

  const utterances = rawUtterances.map(u => ({
    speaker: speakerMap.get(Number(u.speaker)) || `Speaker ${Number(u.speaker) + 1 || 1}`,
    source: "mixedAudio",
    speakerId: Number.isFinite(Number(u.speaker)) ? Number(u.speaker) : null,
    start: Math.round(Number(u.start || 0) * 1000),
    end: Math.round(Number(u.end || 0) * 1000),
    text: String(u.transcript || u.text || "").trim()
  })).filter(u => u.text);

  return {
    sourceLabel: "Mixed class audio",
    text: String(alternative.transcript || "").trim(),
    utterances,
    audioDuration: Number(data?.metadata?.duration || 0) || null,
    languageCode: Array.isArray(alternative.languages) ? alternative.languages.join("/") : "multi",
    provider: "deepgram",
    requestId: data?.metadata?.request_id || null,
    raw: data
  };
}

async function transcribeWithDeepgram({ blob, apiKey, sourceLabel }) {
  if (!apiKey) {
    throw new Error("No Deepgram API key saved.");
  }

  if (!blob || blob.size === 0) {
    return emptyTranscript(sourceLabel, "Empty audio blob.");
  }

  const query = new URLSearchParams({
    model: "nova-3",
    language: "multi",
    smart_format: "true",
    punctuate: "true",
    utterances: "true"
  });

  // The classes commonly switch between Brazilian Portuguese and English.
  // These Portuguese keyterms help the multilingual model avoid incorrectly
  // interpreting clear Portuguese speech as Spanish. They are hints only;
  // English speech remains supported by language=multi.
  [
    "não",
    "então",
    "também",
    "porque",
    "você",
    "vocês",
    "gente",
    "a gente",
    "português",
    "Brasil",
    "brasileiro",
    "brasileira"
  ].forEach(term => query.append("keyterm", term));

  const response = await fetch(
    `https://api.deepgram.com/v1/listen?${query.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": blob.type || "audio/webm"
      },
      body: blob
    }
  );

  const responseText = await response.text();
  let data = null;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.err_msg ||
      data?.error ||
      data?.message ||
      responseText ||
      "Unknown Deepgram error";

    throw new Error(`Deepgram transcription failed (${response.status}): ${message}`);
  }

  const alternative = data?.results?.channels?.[0]?.alternatives?.[0] || {};
  const rawWords = Array.isArray(alternative.words) ? alternative.words : [];
  const rawUtterances = Array.isArray(data?.results?.utterances)
    ? data.results.utterances
    : [];

  const normalizedData = {
    text: String(alternative.transcript || "").trim(),
    audio_duration: Number(data?.metadata?.duration || 0) || null,
    language_code:
      Array.isArray(alternative.languages) && alternative.languages.length
        ? alternative.languages.join("/")
        : data?.results?.channels?.[0]?.detected_language || "multi",
    words: rawWords.map(word => ({
      text: word.punctuated_word || word.word || "",
      start: Math.round(Number(word.start || 0) * 1000),
      end: Math.round(Number(word.end || 0) * 1000),
      confidence: word.confidence,
      language: word.language
    })),
    utterances: rawUtterances.map(utterance => ({
      start: Math.round(Number(utterance.start || 0) * 1000),
      end: Math.round(Number(utterance.end || 0) * 1000),
      text: utterance.transcript || utterance.text || ""
    }))
  };

  const normalized = normalizeTranscript({ sourceLabel, data: normalizedData });
  normalized.raw = data;
  normalized.provider = "deepgram";
  normalized.requestId = data?.metadata?.request_id || null;
  return normalized;
}

async function transcribeWithGemini({ blob, apiKey, sourceLabel }) {
  if (!apiKey) {
    throw new Error("No Gemini API key saved.");
  }

  if (!blob || blob.size === 0) {
    return emptyTranscript(sourceLabel, "Empty audio blob.");
  }

  let uploadedFile = null;

  try {
    // Chrome records WebM. Gemini sometimes accepts it directly even though
    // the public supported-format list focuses on WAV/MP3/AAC/OGG/FLAC.
    // Try the smaller original first; fall back to 16 kHz mono WAV if needed.
    try {
      uploadedFile = await uploadGeminiFile({
        blob,
        apiKey,
        mimeType: blob.type || "audio/webm",
        displayName: `${sourceLabel}-recording.webm`
      });

      return await requestGeminiTranscript({
        uploadedFile,
        apiKey,
        sourceLabel
      });
    } catch (webmError) {
      console.warn(`${sourceLabel}: direct WebM transcription failed; retrying as WAV.`, webmError);

      if (uploadedFile?.name) {
        await deleteGeminiFile(uploadedFile.name, apiKey).catch(() => {});
      }

      const wavBlob = await convertAudioBlobToWav(blob);
      uploadedFile = await uploadGeminiFile({
        blob: wavBlob,
        apiKey,
        mimeType: "audio/wav",
        displayName: `${sourceLabel}-recording.wav`
      });

      return await requestGeminiTranscript({
        uploadedFile,
        apiKey,
        sourceLabel
      });
    }
  } catch (error) {
    const message = String(error?.message || error || "");
    const lower = message.toLowerCase();

    if (
      lower.includes("no speech") ||
      lower.includes("no spoken audio") ||
      lower.includes("only silence") ||
      lower.includes("audio is silent")
    ) {
      return emptyTranscript(sourceLabel, message);
    }

    throw new Error(`${sourceLabel} Gemini transcription failed: ${message}`);
  } finally {
    if (uploadedFile?.name) {
      await deleteGeminiFile(uploadedFile.name, apiKey).catch(error => {
        console.warn("Could not delete temporary Gemini file:", error);
      });
    }
  }
}

function emptyTranscript(sourceLabel, warning = "") {
  return {
    sourceLabel,
    text: "",
    utterances: [],
    audioDuration: null,
    languageCode: "auto",
    raw: null,
    warning
  };
}

async function uploadGeminiFile({ blob, apiKey, mimeType, displayName }) {
  const startResponse = await fetch(
    "https://generativelanguage.googleapis.com/upload/v1beta/files",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(blob.size),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        file: { display_name: displayName }
      })
    }
  );

  if (!startResponse.ok) {
    throw new Error(
      `Gemini upload initialization failed (${startResponse.status}): ${await safeResponseText(startResponse)}`
    );
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini did not return an upload URL.");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(blob.size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mimeType
    },
    body: blob
  });

  const uploadData = await parseJsonResponse(uploadResponse, "Gemini file upload");
  const file = uploadData?.file;

  if (!file?.uri || !file?.name) {
    throw new Error(`Gemini file upload returned no file URI: ${JSON.stringify(uploadData)}`);
  }

  return await waitForGeminiFileActive(file, apiKey);
}

async function waitForGeminiFileActive(file, apiKey) {
  let current = file;

  for (let attempt = 0; attempt < 60; attempt++) {
    const state = String(current?.state || "ACTIVE").toUpperCase();

    if (state === "ACTIVE" || !current?.state) {
      return current;
    }

    if (state === "FAILED") {
      throw new Error(`Gemini could not process the uploaded audio file: ${JSON.stringify(current)}`);
    }

    await sleep(2000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${current.name}`,
      { headers: { "x-goog-api-key": apiKey } }
    );

    current = await parseJsonResponse(response, "Gemini file status");
  }

  throw new Error("Gemini audio upload did not become ready in time.");
}

async function requestGeminiTranscript({ uploadedFile, apiKey, sourceLabel }) {
  const prompt = `
STRICT VERBATIM BILINGUAL TRANSCRIPTION.

This audio is one isolated source from an English class where English and Brazilian Portuguese may be mixed.
The source label is: ${sourceLabel}.

Rules:
- Transcribe only words actually spoken.
- Never translate.
- Never summarize.
- Never correct grammar.
- Never add examples or inferred words.
- Preserve repetitions, false starts, classroom instructions, corrections, practice sentences, and casual conversation.
- If there is no intelligible speech, return an empty segments array and an empty fullText string.
- Divide the transcript into natural short segments.
- Return startMs and endMs as integer milliseconds from the beginning of this audio file.
- Return valid JSON only, with exactly this shape:
{
  "fullText": "complete source transcript",
  "languageCode": "en", "pt-BR", or "en/pt",
  "audioDurationMs": 0,
  "segments": [
    { "startMs": 0, "endMs": 1000, "text": "spoken words" }
  ]
}
`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              mimeType: uploadedFile.mimeType || uploadedFile.mime_type || "audio/wav",
              fileUri: uploadedFile.uri
            }
          },
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json"
    }
  };

  // Prefer the current stable Flash model. The alias is a fallback so the
  // extension can keep working if Google changes model availability again.
  const modelCandidates = ["gemini-3.5-flash", "gemini-flash-latest"];
  let data = null;
  let lastError = null;

  for (const model of modelCandidates) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (response.ok) {
      data = await response.json();
      break;
    }

    const errorText = await response.text();
    lastError = new Error(`Gemini transcription failed using ${model} (${response.status}): ${errorText}`);

    // A model availability error should try the fallback model. Other errors
    // (invalid key, quota, malformed request) should be reported immediately.
    if (response.status !== 404) {
      throw lastError;
    }
  }

  if (!data) {
    throw lastError || new Error("Gemini transcription failed: no available model.");
  }
  const textPart = data?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!textPart) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "No text returned";
    throw new Error(`Gemini returned no transcript (${reason}).`);
  }

  const parsed = parseGeminiJson(textPart);
  const segments = Array.isArray(parsed.segments) ? parsed.segments : [];

  const utterances = segments
    .map(segment => ({
      speaker: sourceLabel,
      source: sourceLabel,
      start: normalizeMilliseconds(segment.startMs ?? segment.start ?? 0),
      end: normalizeMilliseconds(segment.endMs ?? segment.end ?? segment.startMs ?? 0),
      text: String(segment.text || segment.content || "").trim()
    }))
    .filter(segment => segment.text);

  const fullText = String(parsed.fullText || parsed.text || utterances.map(x => x.text).join(" ")).trim();

  return {
    sourceLabel,
    text: fullText,
    utterances,
    audioDuration: Number(parsed.audioDurationMs || 0) / 1000 || null,
    languageCode: parsed.languageCode || "en/pt",
    raw: data
  };
}

function parseGeminiJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }

    throw new Error(`Gemini returned invalid JSON: ${cleaned.slice(0, 500)}`);
  }
}

function normalizeMilliseconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  const text = String(value || "").trim();
  if (!text) return 0;

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Math.max(0, Math.round(Number(text)));
  }

  const parts = text.split(":").map(Number);
  if (parts.every(Number.isFinite)) {
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + part;
    return Math.round(seconds * 1000);
  }

  return 0;
}

async function deleteGeminiFile(fileName, apiKey) {
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
    method: "DELETE",
    headers: { "x-goog-api-key": apiKey }
  });
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { rawText: text };
  }

  if (!response.ok) {
    const apiMessage = data?.error?.message || data?.message || text || "Unknown error";
    throw new Error(`${label} failed (${response.status}): ${apiMessage}`);
  }

  return data;
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch (_) {
    return "Unable to read server response.";
  }
}

async function convertAudioBlobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeContext = new AudioContext();
  let decoded;

  try {
    decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await decodeContext.close().catch(() => {});
  }

  const targetRate = 16000;
  const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frameCount, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);

  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  return encodeMonoPcmWav(samples, targetRate);
}

function encodeMonoPcmWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function normalizeTranscript({ sourceLabel, data }) {
  let utterances = [];

  if (data.words && data.words.length > 0) {
    utterances = buildChunksFromWords({
      words: data.words,
      sourceLabel
    });
  } else if (data.utterances && data.utterances.length > 0) {
    utterances = data.utterances.map(utterance => ({
      speaker: sourceLabel,
      source: sourceLabel,
      start: utterance.start || 0,
      end: utterance.end || 0,
      text: utterance.text || ""
    }));
  } else if (data.text) {
    utterances = [
      {
        speaker: sourceLabel,
        source: sourceLabel,
        start: 0,
        end: data.audio_duration
          ? Math.round(data.audio_duration * 1000)
          : 0,
        text: data.text
      }
    ];
  }

  return {
    sourceLabel,
    text: data.text || "",
    utterances,
    audioDuration: data.audio_duration || null,
    languageCode: data.language_code || "auto",
    raw: data
  };
}

function buildChunksFromWords({ words, sourceLabel }) {
  const chunks = [];
  let currentWords = [];

  const maxWordsPerChunk = 22;
  const maxGapMs = 1400;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const previousWord = words[i - 1];

    const gap =
      previousWord && word.start && previousWord.end
        ? word.start - previousWord.end
        : 0;

    const text = word.text || "";
    const endsSentence = /[.!?]$/.test(text);

    if (
      currentWords.length > 0 &&
      (gap > maxGapMs || currentWords.length >= maxWordsPerChunk)
    ) {
      chunks.push(makeChunk(currentWords, sourceLabel));
      currentWords = [];
    }

    currentWords.push(word);

    if (endsSentence && currentWords.length >= 4) {
      chunks.push(makeChunk(currentWords, sourceLabel));
      currentWords = [];
    }
  }

  if (currentWords.length > 0) {
    chunks.push(makeChunk(currentWords, sourceLabel));
  }

  return chunks;
}

function makeChunk(words, sourceLabel) {
  return {
    speaker: sourceLabel,
    source: sourceLabel,
    start: words[0]?.start || 0,
    end: words[words.length - 1]?.end || 0,
    text: words.map(word => word.text).join(" ")
  };
}

function buildMergedTranscriptObject({
  micTranscript,
  tabTranscript,
  teacherLabel,
  studentLabel,
  startedAt,
  stoppedAt
}) {
  const createdDate = new Date(startedAt || Date.now());

  const mergedUtterances = [
    ...micTranscript.utterances,
    ...tabTranscript.utterances
  ].sort((a, b) => {
    return (a.start || 0) - (b.start || 0);
  });

  const fullText = mergedUtterances
    .map(utterance => `${utterance.speaker}: ${utterance.text}`)
    .join("\n\n");

  const maxDuration = Math.max(
    micTranscript.audioDuration || 0,
    tabTranscript.audioDuration || 0
  );

  return {
    title: buildTranscriptTitle(createdDate),

    meetingTitle: savedMeetingTitle || "Untitled Class",
    studentName: normalizeStudentName(savedStudentName),
    classProgram: normalizeClassProgram(savedClassProgram),
    teacherName: teacherLabel,
    studentLabel,
    source: "chrome-extension-v3-source-labeled",

    createdAt: startedAt || new Date().toISOString(),
    stoppedAt: stoppedAt || new Date().toISOString(),
    audioDuration: maxDuration || null,
    languageCode: "en/pt",

    text: fullText,
    utterances: mergedUtterances,

    sourceTranscripts: {
      microphone: micTranscript,
      tabAudio: tabTranscript
    },

    transcriptionProvider: savedTranscriptionProvider,

    rawProviderResponse: {
      microphone: micTranscript.raw,
      tabAudio: tabTranscript.raw
    },

    dashboardSaveStatus: "not_configured"
  };
}

function buildTranscriptTitle(createdDate) {
  const student = normalizeStudentName(savedStudentName);
  const program = normalizeClassProgram(savedClassProgram);

  if (student && program && student.toLowerCase() !== program.toLowerCase()) {
    return `Class Transcript - ${student} - ${program}`;
  }

  if (student) {
    return `Class Transcript - ${student}`;
  }

  if (program) {
    return `Class Transcript - ${program}`;
  }

  return `Class Transcript - ${createdDate.toLocaleString()}`;
}

function normalizeClassProgram(program) {
  const cleaned = String(program || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  return cleaned;
}

function normalizeStudentName(name) {
  const cleaned = String(name || "")
    .replace(/\s+/g, " ")
    .trim();

  const genericNames = [
    "meet",
    "google meet",
    "microsoft teams",
    "teams",
    "meeting",
    "untitled class"
  ];

  if (genericNames.includes(cleaned.toLowerCase())) {
    return "";
  }

  return cleaned;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}