(function () {
  if (window.top !== window) return;

  let intervalId = null;
  let endDetectedCount = 0;
  let stopSent = false;

  startWatcher();

  function startWatcher() {
    if (intervalId) {
      clearInterval(intervalId);
    }

    intervalId = setInterval(checkMeetingEnded, 2000);
  }

  async function checkMeetingEnded() {
    if (stopSent) return;

    let isRecording = false;

    try {
      const data = await chrome.storage.local.get(["isRecording"]);
      isRecording = !!data.isRecording;
    } catch (error) {
      return;
    }

    if (!isRecording) {
      endDetectedCount = 0;
      return;
    }

    const text = (document.body?.innerText || "").toLowerCase();

    const exactEndPhrases = [
      "you've ended the meeting for everyone",
      "you have ended the meeting for everyone",
      "you've left the meeting",
      "you have left the meeting",
      "return to home screen",
      "meeting ended",
      "call ended",
      "a chamada terminou",
      "você saiu da reunião"
    ];

    const foundEndPhrase = exactEndPhrases.some(phrase =>
      text.includes(phrase)
    );

    if (!foundEndPhrase) {
      endDetectedCount = 0;
      return;
    }

    endDetectedCount += 1;

    // Require the end screen to be detected several times,
    // so we don't stop because of a brief UI flicker.
    if (endDetectedCount < 3) {
      return;
    }

    stopSent = true;

    try {
      await chrome.runtime.sendMessage({
        type: "MEETING_ENDED",
        reason: "meeting_end_screen_detected"
      });
    } catch (error) {
      console.warn("Could not auto-stop after meeting end screen:", error);
      stopSent = false;
    }
  }
})();