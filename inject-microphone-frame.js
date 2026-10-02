(function () {
  if (window.top !== window) return;

  if (document.getElementById("my-recorder-microphone-frame")) {
    return;
  }

  const iframe = document.createElement("iframe");

  iframe.id = "my-recorder-microphone-frame";
  iframe.src = chrome.runtime.getURL("microphone-sources.html");
  iframe.allow = "microphone";
  iframe.style.display = "none";

  document.documentElement.appendChild(iframe);
})();