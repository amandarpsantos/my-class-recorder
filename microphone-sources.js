async function updateMicrophoneDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();

    const microphones = devices
      .filter(device => device.kind === "audioinput")
      .map(device => ({
        deviceId: device.deviceId,
        groupId: device.groupId,
        label: device.label || "Microphone",
        kind: device.kind
      }));

    if (microphones.length > 0) {
      await chrome.storage.local.set({
        microphones,
        selectedMicrophoneId: microphones[0]?.deviceId || null
      });
    }
  } catch (error) {
    console.warn("Could not update microphone devices:", error);
  }
}

updateMicrophoneDevices();