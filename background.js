let activeRecordingTabId = null;
let isStopping = false;

// ─────────────────────────────────────────────────────────────
// DEBUG LOGGER
// ─────────────────────────────────────────────────────────────

async function logDebug(event, data = {}) {
  const { debugLog = [] } = await chrome.storage.local.get(["debugLog"]);

  debugLog.push({
    time: new Date().toISOString(),
    event,
    data
  });

  while (debugLog.length > 200) {
    debugLog.shift();
  }

  await chrome.storage.local.set({ debugLog });

  console.log("[DEBUG]", event, data);
}

chrome.runtime.onInstalled.addListener(async () => {
  await setRecordingState(false);
  await clearRecordingTabId();

  await chrome.tabs.create({
    url: chrome.runtime.getURL("setup.html")
  });
});

chrome.runtime.onStartup.addListener(async () => {
  await setRecordingState(false);
  await clearRecordingTabId();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type?.startsWith("RECORDER_")) {
    return false;
  }

  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => {
      console.error("Background error:", error);

      sendResponse({
        ok: false,
        error: error.message || String(error)
      });
    });

  return true;
});

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async command => {
    if (
      command !== "start-meetings-recording" &&
      command !== "start-meetings-recording-space"
    ) {
      return;
    }

    try {
      const { isRecording } = await chrome.storage.local.get(["isRecording"]);

      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (error) {
      console.error("Command hotkey error:", error);
    }
  });
}

/**
 * SAFETY FIX:
 * If the meeting tab closes, stop and process the recording.
 * This checks chrome.storage.local instead of relying only on activeRecordingTabId,
 * because service worker memory can be lost.
 */
chrome.tabs.onRemoved.addListener(async tabId => {
  try {
    const recordingTabId = await getStoredRecordingTabId();

    if (tabId !== recordingTabId && tabId !== activeRecordingTabId) {
      return;
    }

    console.warn("Recording tab was closed. Auto-stopping recorder.");

    const { isRecording } = await chrome.storage.local.get(["isRecording"]);

    if (isRecording) {
      await stopRecording("recording_tab_closed");
    } else {
      await setRecordingState(false);
      await clearRecordingTabId();
    }
  } catch (error) {
    console.error("Auto-stop on tab close error:", error);
    await setRecordingState(false);
    await clearRecordingTabId();
  }
});

/**
 * SAFETY FIX:
 * If the recording tab navigates away from Meet/Teams, stop and process recording.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  try {
    const recordingTabId = await getStoredRecordingTabId();

    if (tabId !== recordingTabId && tabId !== activeRecordingTabId) {
      return;
    }

    if (!changeInfo.url) {
      return;
    }

    const stillOnMeetingPage =
      changeInfo.url.startsWith("https://meet.google.com/") ||
      changeInfo.url.startsWith("https://teams.microsoft.com/") ||
      changeInfo.url.startsWith("https://teams.live.com/");

    if (stillOnMeetingPage) {
      return;
    }

    console.warn("Recording tab navigated away. Auto-stopping recorder.");

    const { isRecording } = await chrome.storage.local.get(["isRecording"]);

    if (isRecording) {
      await stopRecording("recording_tab_navigated");
    } else {
      await setRecordingState(false);
      await clearRecordingTabId();
    }
  } catch (error) {
    console.error("Auto-stop on navigation error:", error);
    await setRecordingState(false);
    await clearRecordingTabId();
  }
});

async function handleMessage(message, sender) {
  if (message.type === "START_RECORDING") {
    return await startRecording(sender?.tab?.id || null);
  }

  if (message.type === "STOP_RECORDING") {
    return await stopRecording("manual_stop");
  }

  if (message.type === "TOGGLE_RECORDING_FROM_PAGE") {
    const { isRecording } = await chrome.storage.local.get(["isRecording"]);

    if (isRecording) {
      return await stopRecording("hotkey_toggle_stop");
    }

    return await startRecording(sender?.tab?.id || null);
  }

  if (message.type === "MEETING_ENDED") {
    const { isRecording } = await chrome.storage.local.get(["isRecording"]);

    if (isRecording) {
      return await stopRecording(message.reason || "meeting_ended");
    }

    await setRecordingState(false);
    await clearRecordingTabId();

    return { ok: true, alreadyStopped: true };
  }

  if (message.type === "SAVE_AUDIO_BACKUP") {
    const { url, filename } = message;

    if (!url || !filename) {
      return { ok: false, error: "Missing backup URL or filename." };
    }

    const downloadId = await chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    });

    return { ok: true, downloadId, filename };
  }

  if (message.type === "TRANSCRIPT_READY") {
    return await handleTranscriptReady(message.transcript);
  }

  if (message.type === "TRANSCRIPT_ERROR") {
    return await handleTranscriptError(message.error);
  }

  if (message.type === "OPEN_REPROCESS") {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("reprocess.html")
    });
    return { ok: true };
  }

  if (message.type === "QUEUE_REPROCESS_SESSION") {
    const { sessionId } = message;
    if (!sessionId) {
      return { ok: false, error: "Missing saved session ID." };
    }

    // Read extension settings in the service worker. Some Chrome builds do not
    // expose chrome.storage reliably inside an offscreen document.
    const settings = await chrome.storage.local.get([
      "transcriptionProvider",
      "deepgramApiKey",
      "geminiApiKey",
      "assemblyApiKey"
    ]);

    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      type: "RECORDER_REPROCESS",
      sessionId,
      transcriptionProvider: settings.transcriptionProvider || "deepgram",
      deepgramApiKey: settings.deepgramApiKey || "",
      geminiApiKey: settings.geminiApiKey || settings.assemblyApiKey || ""
    });
    return response || { ok: false, error: "Reprocessing did not start." };
  }

  if (message.type === "OPEN_SETUP") {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("setup.html")
    });

    return { ok: true };
  }

  if (message.type === "OPEN_MIC_PERMISSION") {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("permissions.html")
    });

    return { ok: true };
  }

  return {
    ok: false,
    error: "Unknown message."
  };
}

async function startRecording(tabIdFromSender = null) {
  const { isRecording } = await chrome.storage.local.get(["isRecording"]);

  await chrome.storage.local.set({
  debugLog: []
});

  await logDebug("START_RECORDING_BEGIN");  
    
  if (isRecording) {
    return { ok: true, alreadyRecording: true };
  }

  const settings = await chrome.storage.local.get([
    "transcriptionProvider",
    "deepgramApiKey",
    "geminiApiKey",
    "assemblyApiKey",
    "setupComplete",
    "microphonePermissionGranted",
    "microphonePermissionError",
    "selectedMicrophoneId"
  ]);

  const transcriptionProvider = settings.transcriptionProvider || "deepgram";
  const deepgramApiKey = settings.deepgramApiKey || "";
  const geminiApiKey = settings.geminiApiKey || settings.assemblyApiKey || "";
  const selectedApiKey = transcriptionProvider === "deepgram"
    ? deepgramApiKey
    : geminiApiKey;

  if (!selectedApiKey || !settings.setupComplete) {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("setup.html")
    });

    const providerName = transcriptionProvider === "deepgram" ? "Deepgram" : "Gemini";
    throw new Error(`Please add your ${providerName} API key first.`);
  }

  if (!settings.microphonePermissionGranted) {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("permissions.html")
    });

    throw new Error(
      settings.microphonePermissionError ||
      "Please grant microphone permission first."
    );
  }

  let tab;

  if (tabIdFromSender) {
    tab = await chrome.tabs.get(tabIdFromSender);
  } else {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    tab = tabs[0];
  }

  if (!tab?.id) {
    throw new Error("No recordable tab found.");
  }

  if (
    !tab.url?.startsWith("https://meet.google.com/") &&
    !tab.url?.startsWith("https://teams.microsoft.com/") &&
    !tab.url?.startsWith("https://teams.live.com/")
  ) {
    throw new Error("Please start recording from a Google Meet or Teams tab.");
  }

  activeRecordingTabId = tab.id;
  await storeRecordingTabId(tab.id);

  const pageMeetingTitle = await getMeetingTitleFromPage(tab.id);
  const rawTabTitle = tab.title || "Untitled Class";
  const meetingTitle = cleanMeetingTitle(pageMeetingTitle || rawTabTitle);
  const studentName = extractStudentName(meetingTitle);
  const classProgram = extractClassProgram(meetingTitle);

  console.log("TITLE DEBUG:", {
    pageMeetingTitle,
    rawTabTitle,
    meetingTitle,
    studentName,
    classProgram
  });

  await ensureOffscreenDocument();

  await ensureOffscreenDocument();

  await logDebug("OFFSCREEN_READY");

  await logDebug("REQUESTING_STREAM_ID");

  const streamId = await chrome.tabCapture.getMediaStreamId({
  targetTabId: tab.id
});

  await logDebug("STREAM_ID_RECEIVED", {
  hasStreamId: !!streamId
});

const response = await chrome.runtime.sendMessage({
  type: "RECORDER_START",
  streamId,
  sessionId: crypto.randomUUID(),
  transcriptionProvider,
  deepgramApiKey,
  geminiApiKey,
  selectedMicrophoneId: settings.selectedMicrophoneId || null,
  startedAt: new Date().toISOString(),
  meetingTitle,
  studentName,
  classProgram
});

  if (!response?.ok) {
    await setRecordingState(false);
    await clearRecordingTabId();
    throw new Error(response?.error || "Recorder did not start.");
  }

  await setRecordingState(true);

  return { ok: true };
}

async function stopRecording(reason = "manual_stop") {
  const { isRecording } = await chrome.storage.local.get(["isRecording"]);

  if (!isRecording || isStopping) {
    await setRecordingState(false);
    await clearRecordingTabId();

    return {
      ok: true,
      alreadyStoppingOrStopped: true
    };
  }

  isStopping = true;

  // Clear REC immediately so you know the stop command worked.
  await setRecordingState(false);

  try {
    let response;

    try {
      response = await chrome.runtime.sendMessage({
        type: "RECORDER_STOP",
        reason
      });
    } catch (error) {
      console.warn("Recorder stop message failed:", error);

      await handleTranscriptError(
        "Recording stopped unexpectedly. The recorder page may have closed or crashed before it could finish processing."
      );

      activeRecordingTabId = null;
      await clearRecordingTabId();

      return {
        ok: false,
        error: error.message || String(error)
      };
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Recorder did not stop.");
    }

    activeRecordingTabId = null;
    await clearRecordingTabId();

    return { ok: true };
  } finally {
    isStopping = false;
  }
}

async function handleTranscriptReady(transcript) {
  const finalTranscript = {
    ...transcript,
    savedAt: null,
    dashboardSaveStatus: "not_configured",
    dashboardUrl: null
  };

  let dashboardResult = null;
  try {
    dashboardResult = await saveTranscriptToDashboard(finalTranscript);
  } catch (error) {
    dashboardResult = {
      ok: false,
      dashboardSaveStatus: "failed",
      dashboardSaveError: String(error?.message || error)
    };
  }

  const storedTranscript = {
    ...finalTranscript,
    savedAt: dashboardResult?.savedAt || null,
    dashboardSaveStatus: dashboardResult?.dashboardSaveStatus || "failed",
    dashboardUrl: dashboardResult?.dashboardUrl || null,
    dashboardId: dashboardResult?.dashboardId || null,
    dashboardSaveError: dashboardResult?.dashboardSaveError || null
  };

  const dashboardSaved = storedTranscript.dashboardSaveStatus === "saved";
  let finalizeResult = null;

  try {
    finalizeResult = await chrome.runtime.sendMessage({
      type: "RECORDER_FINALIZE_SESSION",
      sessionId: transcript.sessionId,
      dashboardSaved,
      dashboardError: storedTranscript.dashboardSaveError,
      transcript: dashboardSaved ? null : storedTranscript
    });
  } catch (error) {
    finalizeResult = { ok: false, error: String(error?.message || error) };
  }

  // Never keep full transcripts after a confirmed dashboard upload. Store only
  // a tiny status record so Chrome storage cannot fill up again.
  if (dashboardSaved) {
    await chrome.storage.local.remove(["latestTranscript", "transcriptHistory", "debugLog"]);
    await chrome.storage.local.set({
      lastUploadResult: {
        title: storedTranscript.title || storedTranscript.meetingTitle || "Untitled Class",
        savedAt: storedTranscript.savedAt,
        dashboardUrl: storedTranscript.dashboardUrl,
        dashboardId: storedTranscript.dashboardId,
        status: "saved"
      },
      lastStorageError: null
    });
  } else {
    // On failure, the offscreen document downloads both audio tracks and a JSON
    // transcript recovery file. Keep only compact failure metadata locally.
    await chrome.storage.local.remove(["latestTranscript", "transcriptHistory", "debugLog"]);
    await chrome.storage.local.set({
      lastUploadResult: {
        title: storedTranscript.title || storedTranscript.meetingTitle || "Untitled Class",
        createdAt: storedTranscript.createdAt || new Date().toISOString(),
        status: "failed",
        error: storedTranscript.dashboardSaveError,
        recoveryDownloaded: Boolean(finalizeResult?.downloaded),
        recoveryError: finalizeResult?.error || null
      }
    });
  }

  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title: dashboardSaved ? "Lesson uploaded" : "Dashboard upload failed",
      message: dashboardSaved
        ? "The lesson was uploaded and temporary local files were deleted."
        : finalizeResult?.downloaded
          ? "Recovery audio and transcript files were downloaded."
          : "Recovery files could not all be downloaded. The browser copy was kept."
    });
  } catch (_) {}

  return { ok: true, dashboardSaved, finalizeResult };
}

function compactTranscriptHistoryEntry(transcript = {}) {
  return {
    title: transcript.title || "Untitled Class",
    createdAt: transcript.createdAt || new Date().toISOString(),
    savedAt: transcript.savedAt || null,
    studentName: transcript.studentName || "",
    classProgram: transcript.classProgram || "",
    audioDuration: transcript.audioDuration || null,
    dashboardSaveStatus: transcript.dashboardSaveStatus || "unknown",
    dashboardUrl: transcript.dashboardUrl || null,
    dashboardId: transcript.dashboardId || null,
    dashboardSaveError: transcript.dashboardSaveError || null
  };
}

async function handleTranscriptError(errorMessage) {
  const transcript = {
    title: "Transcription Error",
    createdAt: new Date().toISOString(),
    text: "Transcription Error:\n\n" + (errorMessage || "Unknown error"),
    utterances: [],
    error: errorMessage || "Unknown error",
    dashboardSaveStatus: "not_saved"
  };

  const { transcriptHistory = [] } = await chrome.storage.local.get(["transcriptHistory"]);
  transcriptHistory.push(transcript);
  while (transcriptHistory.length > 50) transcriptHistory.shift();

  await chrome.storage.local.set({
    latestTranscript: transcript,
    transcriptHistory
  });

  // Do not stop or reset a newer recording session.
  await openTranscriptPageOnce();

  return { ok: true };
}

async function saveTranscriptToDashboard(transcript) {
  const settings = await chrome.storage.local.get([
    "transcriptSaveEndpoint",
    "transcriptSaveToken"
  ]);

  if (!settings.transcriptSaveEndpoint) {
    return {
      skipped: true,
      dashboardSaveStatus: "not_configured"
    };
  }

  const payload = {
    token: settings.transcriptSaveToken,
    transcript
  };

  let response;
  try {
    response = await fetch(settings.transcriptSaveEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      redirect: "follow",
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const message = `Dashboard network error: ${error?.message || error}`;
    return {
      ok: false,
      dashboardSaveStatus: "failed",
      dashboardSaveError: message
    };
  }

  const responseText = await response.text();
  let result = {};

  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    result = { rawResponse: responseText };
  }

  if (!response.ok || result.ok === false) {
    return {
      ...result,
      ok: false,
      dashboardSaveStatus: "failed",
      dashboardSaveError:
        result.error ||
        `Dashboard save failed: ${response.status} ${responseText}`
    };
  }

  return {
    ...result,
    ok: true,
    savedAt: new Date().toISOString(),
    dashboardSaveStatus: "saved",
    dashboardUrl: result.url || null,
    dashboardId: result.id || null
  };
}

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen.html")]
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record microphone and tab audio for class transcription."
  });
}

async function setRecordingState(isRecording) {
  await chrome.storage.local.set({
    isRecording
  });

  await chrome.action.setBadgeText({
    text: isRecording ? "REC" : ""
  });

  if (isRecording) {
    await chrome.action.setBadgeBackgroundColor({
      color: "#dc2626"
    });
  }
}

async function openTranscriptPageOnce() {
  const transcriptUrl = chrome.runtime.getURL("transcript.html");

  const existingTabs = await chrome.tabs.query({
    url: transcriptUrl
  });

  if (existingTabs.length > 0) {
    await chrome.tabs.update(existingTabs[0].id, {
      active: true
    });

    return;
  }

  await chrome.tabs.create({
    url: transcriptUrl
  });
}

async function storeRecordingTabId(tabId) {
  activeRecordingTabId = tabId;

  await chrome.storage.local.set({
    recordingTabId: tabId
  });
}

async function clearRecordingTabId() {
  activeRecordingTabId = null;

  await chrome.storage.local.remove(["recordingTabId"]);
}

async function getStoredRecordingTabId() {
  const { recordingTabId } = await chrome.storage.local.get(["recordingTabId"]);
  return recordingTabId || null;
}

async function getMeetingTitleFromPage(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "GET_MEETING_TITLE"
    });

    if (response?.ok && response.title) {
      return response.title;
    }
  } catch (error) {
    console.warn("Could not read meeting title from page:", error);
  }

  return "";
}

function cleanMeetingTitle(title) {
  return String(title || "Untitled Class")
    .replace(" - Google Meet", "")
    .replace(" | Google Meet", "")
    .replace(" Google Meet", "")
    .replace(" | Microsoft Teams", "")
    .replace(" Microsoft Teams", "")
    .replace(/\s+/g, " ")
    .trim() || "Untitled Class";
}

function extractStudentName(meetingTitle) {
  const title = cleanMeetingTitle(meetingTitle);

  const genericTitles = [
    "google meet",
    "meet",
    "microsoft teams",
    "teams",
    "meeting",
    "untitled class",
    ""
  ];

  if (genericTitles.includes(title.toLowerCase())) {
    return "";
  }

  // Example:
  // Aula de inglês (c/ Teacher) | Company Name
  const pipeMatch = title.match(/^(.+?)\s*\|\s*(.+)$/);
  if (pipeMatch && pipeMatch[2]) {
    const afterPipe = pipeMatch[2].trim();

    if (afterPipe) {
      return afterPipe;
    }
  }

  // Example:
  // English Classes 2026 (Student Name)
  const parenthesesMatch = title.match(/\(([^)]+)\)/);
  if (parenthesesMatch && parenthesesMatch[1]) {
    const insideParentheses = parenthesesMatch[1].trim();

    // Avoid returning things like "c/ Amanda" as the student name.
    if (!insideParentheses.toLowerCase().includes("amanda")) {
      return insideParentheses;
    }
  }

  const dashMatch = title.match(/^(.+?)\s*-\s*(.+)$/);
  if (dashMatch && dashMatch[1] && dashMatch[2]) {
    const beforeDash = dashMatch[1].trim();
    const afterDash = dashMatch[2].trim();

    const beforeIsGeneric = genericTitles.includes(beforeDash.toLowerCase());

    if (beforeIsGeneric && afterDash) {
      return extractStudentName(afterDash);
    }

    if (beforeDash) {
      return beforeDash;
    }
  }

  const classProviderMatch = title.match(
    /^(.+?)(?:\s+)?(?:be?spoke|americlass|english class|class)\b/i
  );

  if (classProviderMatch && classProviderMatch[1]) {
    return classProviderMatch[1].trim();
  }

  return "";
}

function extractClassProgram(meetingTitle) {
  const title = cleanMeetingTitle(meetingTitle);
  const lower = title.toLowerCase();

  if (lower.includes("americlass") || lower.includes("amer class")) {
    return "AmeriClass";
  }

  if (lower.includes("bespoke")) {
    return "Bespoke Class";
  }

  if (lower.includes("mint communica") || lower.includes("mint")) {
    return "Mint Communica";
  }

  return "";
}