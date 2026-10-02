(function () {
  if (window.top !== window) return;

  const REMINDER_ID = "my-class-recorder-off-reminder";

  let checkInterval = null;
  let extensionContextValid = true;

  startReminderWatcher();

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      if (changes.isRecording) {
        updateReminder();
      }
    });
  } catch (error) {
    extensionContextValid = false;
  }

  function startReminderWatcher() {
    updateReminder();

    if (checkInterval) {
      clearInterval(checkInterval);
    }

    checkInterval = setInterval(() => {
      updateReminder();
    }, 3000);
  }

  async function updateReminder() {
    if (!extensionContextValid) {
      stopWatcher();
      return;
    }

    let data;

    try {
      data = await chrome.storage.local.get(["isRecording"]);
    } catch (error) {
      extensionContextValid = false;
      removeReminder();
      stopWatcher();
      return;
    }

    if (data.isRecording) {
      removeReminder();
      return;
    }

    if (!looksLikeActiveMeeting()) {
      removeReminder();
      return;
    }

    showReminder();
  }

  function stopWatcher() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }

  function looksLikeActiveMeeting() {
    const url = window.location.href;
    const text = (document.body?.innerText || "").toLowerCase();

    const isMeet = url.startsWith("https://meet.google.com/");

    const isTeams =
      url.startsWith("https://teams.microsoft.com/") ||
      url.startsWith("https://teams.live.com/");

    if (!isMeet && !isTeams) {
      return false;
    }

    const endedPhrases = [
      "you left the meeting",
      "you've left the meeting",
      "you have left the meeting",
      "return to home screen",
      "join again",
      "rejoin",
      "call ended",
      "the meeting has ended",
      "você saiu da reunião",
      "a chamada terminou",
      "reingressar"
    ];

    if (endedPhrases.some(phrase => text.includes(phrase))) {
      return false;
    }

    const lobbyPhrases = [
      "join now",
      "ask to join",
      "ready to join",
      "join meeting",
      "participar agora",
      "pedir para participar"
    ];

    const callPhrases = [
      "leave call",
      "leave meeting",
      "present now",
      "turn on captions",
      "more options",
      "people",
      "chat with everyone",
      "raise hand",
      "sair da chamada",
      "sair da reunião",
      "apresentar agora",
      "legendas",
      "mais opções"
    ];

    const looksLikeLobby = lobbyPhrases.some(phrase => text.includes(phrase));
    const looksLikeCall = callPhrases.some(phrase => text.includes(phrase));

    if (looksLikeCall) {
      return true;
    }

    if (looksLikeLobby) {
      return false;
    }

    return false;
  }

  function showReminder() {
    if (document.getElementById(REMINDER_ID)) {
      return;
    }

    const reminder = document.createElement("div");
    reminder.id = REMINDER_ID;

    reminder.style.position = "fixed";
    reminder.style.top = "76px";
    reminder.style.left = "50%";
    reminder.style.transform = "translateX(-50%)";
    reminder.style.zIndex = "999999999";
    reminder.style.background = "#111827";
    reminder.style.color = "white";
    reminder.style.border = "1px solid rgba(255,255,255,0.15)";
    reminder.style.borderRadius = "999px";
    reminder.style.padding = "8px 10px 8px 14px";
    reminder.style.fontFamily = "Arial, sans-serif";
    reminder.style.fontSize = "13px";
    reminder.style.fontWeight = "600";
    reminder.style.boxShadow = "0 8px 24px rgba(0,0,0,0.28)";
    reminder.style.display = "flex";
    reminder.style.alignItems = "center";
    reminder.style.gap = "10px";
    reminder.style.pointerEvents = "auto";

    const text = document.createElement("span");
    text.textContent = "Class Recorder is OFF — press Ctrl+Shift+F";

    const button = document.createElement("button");
    button.textContent = "Start";
    button.style.border = "none";
    button.style.borderRadius = "999px";
    button.style.padding = "5px 10px";
    button.style.background = "#dc2626";
    button.style.color = "white";
    button.style.fontSize = "12px";
    button.style.fontWeight = "700";
    button.style.cursor = "pointer";

    button.addEventListener("click", async () => {
      button.textContent = "Starting...";

      try {
        const response = await chrome.runtime.sendMessage({
          type: "START_RECORDING"
        });

        if (response?.ok) {
          removeReminder();
          return;
        }

        button.textContent = "Use hotkey";
        text.textContent =
          "Please press Ctrl+Shift+F or click the extension icon to start.";
      } catch (error) {
        button.textContent = "Use hotkey";
        text.textContent =
          "Please press Ctrl+Shift+F or click the extension icon to start.";
      }
    });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.title = "Hide reminder";
    closeBtn.style.border = "none";
    closeBtn.style.background = "transparent";
    closeBtn.style.color = "white";
    closeBtn.style.fontSize = "18px";
    closeBtn.style.lineHeight = "1";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.opacity = "0.75";

    closeBtn.addEventListener("click", () => {
      removeReminder();
    });

    reminder.appendChild(text);
    reminder.appendChild(button);
    reminder.appendChild(closeBtn);

    document.documentElement.appendChild(reminder);
  }

  function removeReminder() {
    const existing = document.getElementById(REMINDER_ID);

    if (existing) {
      existing.remove();
    }
  }
})();