(function () {
  if (window.top !== window) return;

  function createIndicator() {
    if (document.getElementById("my-class-recorder-indicator")) {
      return;
    }

    const indicator = document.createElement("div");
    indicator.id = "my-class-recorder-indicator";
    indicator.textContent = "● Recording";

    indicator.style.position = "fixed";
    indicator.style.bottom = "18px";
    indicator.style.right = "18px";
    indicator.style.zIndex = "999999999";
    indicator.style.background = "#dc2626";
    indicator.style.color = "white";
    indicator.style.padding = "8px 12px";
    indicator.style.borderRadius = "999px";
    indicator.style.fontFamily = "Arial, sans-serif";
    indicator.style.fontSize = "13px";
    indicator.style.fontWeight = "700";
    indicator.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
    indicator.style.display = "none";
    indicator.style.pointerEvents = "none";

    document.documentElement.appendChild(indicator);
  }

  async function updateIndicator() {
    createIndicator();

    const indicator = document.getElementById("my-class-recorder-indicator");
    const { isRecording } = await chrome.storage.local.get(["isRecording"]);

    indicator.style.display = isRecording ? "block" : "none";
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.isRecording) {
      updateIndicator();
    }
  });

  updateIndicator();
})();