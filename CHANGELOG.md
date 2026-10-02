# Changelog — My Class Recorder

## v0.5.7 — Single-audio transcription
- Records one mixed class-audio track and sends a single request per class to Deepgram, with diarization for speaker separation.
- Keeps the separate source tracks temporarily for compatibility and the Gemini provider.
- If the dashboard upload fails, downloads `class_audio.webm` and `transcript-recovery.json`; on success, temporary audio is deleted.
- Note: Deepgram numbers speakers in the order they first speak, so teacher/student labels can occasionally be reversed.

## v0.5.6 — Smart cleanup
- Audio is held temporarily in IndexedDB during transcription and dashboard upload.
- After a successful upload, temporary audio and full local transcript data are deleted.
- After a failed upload, recovery files are downloaded automatically; browser audio is deleted only once every recovery download succeeds.

## v0.5.5 — Storage quota recovery
- Uploads completed transcripts to the dashboard before saving locally.
- Keeps only compact metadata in transcript history and clears bulky data automatically when Chrome storage is full, preserving API keys and settings.

## v0.5.3
- Fixed reprocessing failing with "Cannot read properties of undefined (reading local)": the service worker now reads settings from `chrome.storage.local` and passes them to the offscreen worker.

## v0.5.2 — Reprocess saved recordings
- Added a recovery page to re-transcribe saved `microphone.webm` and `tab_audio.webm` files.
- Imported audio is preserved in IndexedDB before transcription begins.
- Fixed offscreen-document handling so starting a new class no longer closes an active background transcription.

## v0.5.1
- Restored the Ctrl+Shift+F hotkey listener in Meet and Teams.
- Added Brazilian Portuguese keyterm hints to Deepgram Nova-3 so Portuguese is not transcribed as Spanish.

## v0.5.0 — Back-to-back classes
- Stops capture and releases the recorder before transcription, so the next class can start immediately while earlier ones process in a queue.
- Saves audio to persistent IndexedDB before transcription, plus a downloadable backup.

## v0.4.1 — Recovery
- Saves raw audio to `Downloads/Class Recorder Recovery` before transcription starts, so a class is never lost if a service or the connection fails.
- Shows the real transcription error on the transcript page.

## v0.4.0 — Multiple providers
- Added Deepgram (default) and Gemini as selectable providers.
- Deepgram uses Nova-3 with multilingual mode for English/Portuguese code-switching.

## v0.3.0 — Gemini
- Replaced AssemblyAI with Gemini 2.5 Flash, using the Files API for long audio and a 16 kHz WAV fallback.
