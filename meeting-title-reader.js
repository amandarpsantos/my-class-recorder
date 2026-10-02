(function () {
  if (window.top !== window) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "GET_MEETING_TITLE") {
      return false;
    }

    sendResponse({
      ok: true,
      title: findMeetingTitle()
    });

    return true;
  });

  function findMeetingTitle() {
    const candidates = [];

    // Browser title
    candidates.push(document.title);

    // Common Google Meet title areas
    const selectors = [
      "[data-meeting-title]",
      "[aria-label*='Meeting']",
      "[aria-label*='meeting']",
      "div[jsname]",
      "h1",
      "h2"
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        const text = cleanText(
          element.getAttribute("data-meeting-title") ||
          element.getAttribute("aria-label") ||
          element.innerText ||
          element.textContent ||
          ""
        );

        if (text) {
          candidates.push(text);
        }
      });
    });

    const best = candidates
      .map(cleanText)
      .filter(Boolean)
      .find(text => looksLikeClassTitle(text));

    return best || cleanText(document.title) || "";
  }

  function looksLikeClassTitle(text) {
    const lower = text.toLowerCase();

    if (!text || text.length < 3) return false;

    const badTitles = [
      "meet",
      "google meet",
      "microsoft teams",
      "teams",
      "you left the meeting",
      "join now",
      "ready to join",
      "people",
      "chat",
      "activities",
      "present now"
    ];

    if (badTitles.includes(lower)) return false;

    return (
      text.includes("-") ||
      text.includes("(") ||
      lower.includes("bespoke") ||
      lower.includes("americlass") ||
      lower.includes("english class") ||
      lower.includes("class")
    );
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }
})();