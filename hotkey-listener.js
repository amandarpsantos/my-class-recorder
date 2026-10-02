(function () {
  if (window.top !== window) return;

  createHotkeyBackupButton();

  window.addEventListener(
    "keydown",
    event => {
      const isCtrlShiftS =
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "s";

      const isCtrlShiftF =
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "f";

      if (!isCtrlShiftS && !isCtrlShiftF) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      toggleRecordingFromPage();
    },
    true
  );

  function createHotkeyBackupButton() {
    if (document.getElementById("my-class-recorder-mini-button")) {
      return;
    }

    const button = document.createElement("button");
    button.id = "my-class-recorder-mini-button";
    button.textContent = "Recorder";

    button.style.position = "fixed";
    button.style.bottom = "58px";
    button.style.right = "18px";
    button.style.zIndex = "999999999";
    button.style.background = "#2563eb";
    button.style.color = "white";
    button.style.border = "none";
    button.style.borderRadius = "999px";
    button.style.padding = "8px 12px";
    button.style.fontFamily = "Arial, sans-serif";
    button.style.fontSize = "13px";
    button.style.fontWeight = "700";
    button.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
    button.style.cursor = "pointer";

    button.addEventListener("click", () => {
      toggleRecordingFromPage();
    });

    document.documentElement.appendChild(button);
  }

  function toggleRecordingFromPage() {
    try {
      chrome.runtime.sendMessage({
        type: "TOGGLE_RECORDING_FROM_PAGE"
      });
    } catch (error) {
      console.warn(
        "My Class Recorder: extension context invalidated. Refresh this Meet/Teams tab."
      );
    }
  }
})();