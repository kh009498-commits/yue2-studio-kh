# Live automatic jukebox fallback - 2026-10-02

Implemented in the authoritative local checkout, preserving PR4 changes and all dirty MCP 1.1.0 work. Source publication uses the existing draft pull request. No merge, paid request, GPU generation, app launch, installation, process termination or settings update is part of this change.

## Behavior

- Live latches a generation pause on writing/submission/job/status failures, including Gemini HTTP402 / RESOURCE_EXHAUSTED, credits/quota depletion and 429. No automatic writing-provider switch or generation retry. Pending draws and prefetched text are discarded; a running GPU job can finish and join the queue.
- The current audio element and ready playback order survive the mode switch. Past library audio fills a persistent shuffled pool, including vocal songs without synchronized lyrics. Song IDs already allocated in the current cycle and played IDs are tracked. Cycles reshuffle, with no immediate boundary repeat when alternatives exist. Current audio survives deletion from the library until it ends; deleted future entries and corrupt/missing/slow media are skipped. A single playable song repeats; an empty pool waits honestly and recovers when library audio arrives.
- Jukebox starts playback with one available song rather than waiting for the generation buffer. The pause and shuffle history survive browser/app reload in local storage; autoplay still requires Start live. Played queue history is bounded. Stop does not clear the pause.
- The neutral Jukebox stage contains no raw provider response, job phase or error banner. A collapsed Station controls section shows a fixed sanitized reason and explicit Resume generation. Resume performs a read-only backend job check before allowing another paid request; outstanding/ambiguous requests and running jobs block resume. Writing and submission deadlines ignore stale results; a late accepted submission is observed rather than resent. Known-job status recovery polls at most once per 30 seconds while paused.
- All private drawers and modals (Logs, Keys, System, Job, MCP and others) are excluded from the full app render while Live is selected, even if previously opened. Their utility controls are disabled in Live. Normal views retain existing private operator tools.
- Private station diagnostics accept only fixed event/reason enums. The backend keeps 50 events, deduplicates each event/reason for 30 seconds and uses the existing bounded rotating log. No raw errors, prompt/title content, credentials or signed URLs enter these events. Logging failures never block playback.

## Verification

- Full offline Python suite: 418 passed, 18 subtests passed; existing deprecation warnings only.
- `node scripts/tests/live-jukebox.mjs`: passed. Real LivePage hooks/timers and audio-loading effects are mocked; coverage includes 402, no paid retry, preserved player, prefetch race, terminal failure, late/ambiguous responses, explicit resume/reload reconciliation, deleted/new songs, corrupt/missing/slow media, empty/single pools and 60 tracks across 12 full shuffled cycles.
- Existing `live-completion.mjs` and `orbit-audio.mjs`: passed. The old 98% completion-freeze negative control still reproduces the old bug. Existing source-contract assertions were updated for the new shuffle and tracked submission methods.
- TypeScript/frontend and native 0.7.0 release builds: passed. Existing frontend chunk-size warning remains.
- Staged executable matches the release-build SHA256. Built executable and frontend assets contain none of the saved provider key values (UTF8/UTF16 audit; values withheld).
- Original source files and original root/release executables are backed up with verified hashes in the task workspace's `live-fallback-backup`. Root executable, credential vault and all five pre-existing dirty MCP files match pre-build fingerprints.

## Staged delivery / pending activation

`release/live-jukebox-2026-10-02/YuE2 Studio.exe` is staged with `SHA256SUMS.txt`; it uses the existing project runtime, not a standalone portable installation. The root `YuE2 Studio.exe` was not replaced. Activate after broadcast playback and jobs are idle: install the staged root executable and restart the app/sidecar so both the embedded frontend and enum-only logging endpoint are loaded. No running stream or process was interrupted. Live visual/audio QA in the actual app remains pending that safe activation; verification here used mocks and builds only.
