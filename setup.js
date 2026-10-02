const transcriptionProviderInput = document.getElementById("transcriptionProvider");
const deepgramApiKeyInput = document.getElementById("deepgramApiKey");
const geminiApiKeyInput = document.getElementById("geminiApiKey");
const deepgramSettings = document.getElementById("deepgramSettings");
const geminiSettings = document.getElementById("geminiSettings");
const transcriptSaveEndpointInput = document.getElementById("transcriptSaveEndpoint");
const transcriptSaveTokenInput = document.getElementById("transcriptSaveToken");
const saveBtn = document.getElementById("saveBtn");
const statusText = document.getElementById("status");

function updateProviderFields() {
  const provider = transcriptionProviderInput.value;
  deepgramSettings.hidden = provider !== "deepgram";
  geminiSettings.hidden = provider !== "gemini";
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    "transcriptionProvider",
    "deepgramApiKey",
    "geminiApiKey",
    "assemblyApiKey",
    "transcriptSaveEndpoint",
    "transcriptSaveToken"
  ]);

  const migratedGeminiKey = data.geminiApiKey || data.assemblyApiKey || "";
  const provider = data.transcriptionProvider || (data.deepgramApiKey ? "deepgram" : "deepgram");

  transcriptionProviderInput.value = provider;
  deepgramApiKeyInput.value = data.deepgramApiKey || "";
  geminiApiKeyInput.value = migratedGeminiKey;

  if (data.transcriptSaveEndpoint) {
    transcriptSaveEndpointInput.value = data.transcriptSaveEndpoint;
  }

  if (data.transcriptSaveToken) {
    transcriptSaveTokenInput.value = data.transcriptSaveToken;
  }

  updateProviderFields();
}

transcriptionProviderInput.addEventListener("change", () => {
  updateProviderFields();
  statusText.textContent = "";
});

saveBtn.addEventListener("click", async () => {
  const transcriptionProvider = transcriptionProviderInput.value;
  const deepgramApiKey = deepgramApiKeyInput.value.trim();
  const geminiApiKey = geminiApiKeyInput.value.trim();
  const transcriptSaveEndpoint = transcriptSaveEndpointInput.value.trim();
  const transcriptSaveToken = transcriptSaveTokenInput.value.trim();

  if (transcriptionProvider === "deepgram" && !deepgramApiKey) {
    statusText.textContent = "Please add your Deepgram API key.";
    return;
  }

  if (transcriptionProvider === "gemini" && !geminiApiKey) {
    statusText.textContent = "Please add your Gemini API key.";
    return;
  }

  await chrome.storage.local.set({
    transcriptionProvider,
    deepgramApiKey,
    geminiApiKey,
    transcriptSaveEndpoint,
    transcriptSaveToken,
    setupComplete: true
  });

  const providerName = transcriptionProvider === "deepgram" ? "Deepgram" : "Gemini";
  statusText.textContent = `${providerName} setup complete. You can close this tab.`;
});

loadSettings();
