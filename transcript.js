const metadata = document.getElementById("metadata");
const dashboardStatus = document.getElementById("dashboardStatus");
const transcriptContainer = document.getElementById("transcriptContainer");
const copyFullBtn = document.getElementById("copyFullBtn");
const copyCleanBtn = document.getElementById("copyCleanBtn");

let currentTranscript = null;

async function loadTranscript() {
  const { latestTranscript } = await chrome.storage.local.get([
    "latestTranscript"
  ]);

  if (!latestTranscript) {
    transcriptContainer.textContent = "No transcript found.";
    metadata.textContent = "";
    return;
  }

  currentTranscript = prepareTranscriptForDisplay(latestTranscript);
  renderTranscript(currentTranscript);
}

function prepareTranscriptForDisplay(transcript) {
  const utterances = transcript.utterances || [];
  const mergedUtterances = mergeCloseSameSpeakerChunks(utterances);
  const cleanText = buildCleanTextFromUtterances(mergedUtterances);

  return {
    ...transcript,
    utterances: mergedUtterances,
    // Preserve explicit error/fallback text when there are no utterances.
    text: cleanText || transcript.text || ""
  };
}

function renderTranscript(transcript) {
  document.title = transcript.title || "Class Transcript";

  const pageTitle = document.querySelector(".transcript-header h1");
  if (pageTitle) {
    pageTitle.textContent = transcript.title || "Class Transcript";
  }

  const createdAt = transcript.createdAt
    ? new Date(transcript.createdAt).toLocaleString()
    : "Unknown date";

  const duration = transcript.audioDuration
    ? formatDurationSeconds(transcript.audioDuration)
    : "Unknown duration";

  const studentInfo = transcript.studentName
    ? `Student: ${transcript.studentName} • `
    : "";

  metadata.textContent =
    `${studentInfo}${createdAt} • Duration: ${duration} • Language: ${transcript.languageCode || "auto"}`;

  renderDashboardStatus(transcript);

  if (transcript.utterances && transcript.utterances.length > 0) {
    renderUtterances(transcript.utterances);
    return;
  }

  transcriptContainer.innerHTML = "";

  const fallback = document.createElement("div");
  fallback.className = "plain-transcript";
  fallback.textContent = transcript.text || "No transcript text returned.";

  transcriptContainer.appendChild(fallback);
}

function renderUtterances(utterances) {
  transcriptContainer.innerHTML = "";

  utterances.forEach(utterance => {
    const card = document.createElement("article");
    card.className = "speaker-card";

    const speaker = document.createElement("h2");
    speaker.textContent = utterance.speaker || "Speaker";

    const time = document.createElement("p");
    time.className = "timestamp";
    time.textContent = `${formatMs(utterance.start)} - ${formatMs(utterance.end)}`;

    const text = document.createElement("p");
    text.className = "utterance-text";
    text.textContent = utterance.text || "";

    card.appendChild(speaker);
    card.appendChild(time);
    card.appendChild(text);

    transcriptContainer.appendChild(card);
  });
}

function mergeCloseSameSpeakerChunks(utterances) {
  const merged = [];

  const maxGapMs = 2500;
  const maxMergedWords = 55;

  utterances.forEach(utterance => {
    const cleanText = String(utterance.text || "").trim();

    if (!cleanText) {
      return;
    }

    const last = merged[merged.length - 1];

    if (!last) {
      merged.push({
        ...utterance,
        text: cleanText
      });
      return;
    }

    const sameSpeaker = last.speaker === utterance.speaker;
    const gap = (utterance.start || 0) - (last.end || 0);
    const combinedWordCount =
      countWords(last.text) + countWords(cleanText);

    const shouldMerge =
      sameSpeaker &&
      gap >= 0 &&
      gap <= maxGapMs &&
      combinedWordCount <= maxMergedWords;

    if (shouldMerge) {
      last.end = Math.max(last.end || 0, utterance.end || 0);
      last.text = joinTranscriptText(last.text, cleanText);
    } else {
      merged.push({
        ...utterance,
        text: cleanText
      });
    }
  });

  return merged;
}

function buildCleanTextFromUtterances(utterances) {
  if (!utterances || utterances.length === 0) {
    return "";
  }

  return utterances
    .map(utterance => `${utterance.speaker || "Speaker"}: ${utterance.text || ""}`)
    .join("\n\n");
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function joinTranscriptText(first, second) {
  const a = String(first || "").trim();
  const b = String(second || "").trim();

  if (!a) return b;
  if (!b) return a;

  return `${a} ${b}`;
}

function renderDashboardStatus(transcript) {
  if (!transcript.dashboardSaveStatus || transcript.dashboardSaveStatus === "not_configured") {
    dashboardStatus.textContent = "Dashboard save: not configured";
    return;
  }

  if (transcript.dashboardSaveStatus === "saving") {
    dashboardStatus.textContent = "Dashboard save: saving...";
    return;
  }

  if (transcript.dashboardSaveStatus === "saved") {
    dashboardStatus.textContent = "Dashboard save: saved";
    return;
  }

  if (transcript.dashboardSaveStatus === "failed") {
    dashboardStatus.textContent =
      "Dashboard save failed: " + (transcript.dashboardSaveError || "");
    return;
  }

  dashboardStatus.textContent = "";
}

copyFullBtn.addEventListener("click", async () => {
  if (!currentTranscript) return;

  await navigator.clipboard.writeText(buildFullTranscriptText(currentTranscript));
  copyFullBtn.textContent = "Copied!";

  setTimeout(() => {
    copyFullBtn.textContent = "Copy Full Transcript";
  }, 1500);
});

copyCleanBtn.addEventListener("click", async () => {
  if (!currentTranscript) return;

  await navigator.clipboard.writeText(currentTranscript.text || "");
  copyCleanBtn.textContent = "Copied!";

  setTimeout(() => {
    copyCleanBtn.textContent = "Copy Clean Text";
  }, 1500);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.latestTranscript) {
    currentTranscript = prepareTranscriptForDisplay(changes.latestTranscript.newValue);
    renderTranscript(currentTranscript);
  }
});

function buildFullTranscriptText(transcript) {
  if (transcript.utterances && transcript.utterances.length > 0) {
    return transcript.utterances
      .map(utterance => {
        return [
          utterance.speaker || "Speaker",
          `${formatMs(utterance.start)} - ${formatMs(utterance.end)}`,
          utterance.text || ""
        ].join("\n");
      })
      .join("\n\n");
  }

  return transcript.text || "";
}

function formatMs(ms) {
  if (typeof ms !== "number") return "0:00";

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDurationSeconds(seconds) {
  if (typeof seconds !== "number") return "Unknown duration";

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

loadTranscript();