# Changelog

All notable changes to YuE2 Studio are documented here. The same notes are used for GitHub releases.

## [Unreleased]

### Added
- **Live jukebox fallback.** Writing credits/quota or generation failures pause new requests while current audio and ready songs continue. Past library songs shuffle once per cycle; missing/corrupt files are skipped. Resume generation explicitly after resolving the problem. Live excludes raw errors and private panels from broadcast capture.
- **MCP 1.1.0 adapters.** Nineteen tools expose advanced YuE2 controls, planned ABC, Stable/Woosh effects, stems, lyric synchronization, cover art/transcription, audio export and typed Studio mixing with validated payloads and readiness checks.
- **Shared song queue.** Several people (for example the studio PC and a browser on the home network) can queue songs at the same time; they are made one after another on the GPU. The Create page and Library show the line with each song's owner, position (**Up next**, **Waiting in line · N ahead of you**) and live progress. Anyone can keep clicking **Add to queue**. Each browser picks a display name. Only the person who queued a song, or the studio PC, can cancel it. The library refreshes for everyone when any song finishes.

- **Keys → Writing model dropdown.** The Model box now lists the models the chosen provider actually offers (live from NVIDIA NIM, OpenAI, Groq, xAI, Anthropic, Gemini, or your Local LLM server), with song-friendly picks under **Recommended** and image/speech/embedding/safety models hidden. **Type a model ID…** still allows any ID; a warning shows when a typed ID isn't in the provider's list.

### Security
- The local service now only accepts commands from Studio itself (the desktop window, pages served by Studio on this PC or the home-network address). Other websites open in a browser can no longer control Studio in the background, and DNS-rebinding hosts are refused.

### Fixed
- Writing vault normalization and API updates now use provider-specific defaults, repair known inherited IDs, and migrate the retired NVIDIA MiniMax model to DeepSeek. Custom model IDs remain supported.
- YuE2 no longer imports the inherited caption corpus. The compatibility statistics route reports it disabled; installer payloads exclude dormant Music3 workers and caption assets. Song generation remains exclusively YuE2.
- Credential audits cover all saved provider keys, with values withheld; private settings, old executable backups, and Windows shortcuts stay excluded from source publication.
- Sidecar API metadata now reports the current 0.7.0 application version.
- MCP server: song folders with spaces (most of the library) now work with `update_song`/`rate_song`; replies are always UTF-8 on Windows (non-English characters previously broke the reply for every MCP client); the connected agent's name (Claude, Codex, Grok) labels its activity and queued songs.
- NVIDIA NIM's free tier gets 150s per writing call instead of 90s (lyrics took 82–98s in testing), and the desktop bridge waits up to 480s. Timeouts now name the real provider instead of "Local LLM timed out".
- Job-starting endpoints return the song's queue position immediately.
- Switching the Writing provider no longer keeps the previous provider's model (e.g. `gemini-3.6-flash` under NVIDIA NIM).
- The default NVIDIA NIM model `minimaxai/minimax-m3` was retired from NVIDIA's catalog; the default is now `deepseek-ai/deepseek-v4.1-flash`.
- Finished jobs are trimmed (last 150 kept) so the job list no longer grows for the life of the process.

## [0.7.0] — 2026-09-19

### Added
- **Live** top mode: an automatic song maker as well as a broadcast-style player. It randomly picks a template and vocal or instrumental, automatically starts with random playback-ready songs from the catalog, and maintains a configurable 3/5/8-song ready buffer (5 by default). Live fills the remaining buffer with new generations and keeps making the next song in the background instead of waiting for playback to consume a slot. The setup panel hides once the show starts; the broadcast view shows the current song and a compact numbered playback queue with **Up next** and generated-track positions while one song generates at a time. Vocal songs with lyrics are synchronized before entering playback so the live karaoke layer can follow them. No compatibility filter — odd pairings are allowed. No streaming service or broadcast setup is required.
- MCP integration for visible, local agent-to-Studio actions. The MCP panel shows connection state and recent activity; the accompanying agent skill documents safe use.
- Fifteen extra templates filling gaps versus common prompt catalogs: Atlanta trap, Brooklyn drill, East Coast boom bap, pop rap, Latin pop, corridos, reggae, soul R&B, gospel, cafe bossa nova, contemporary folk, heroic trailer cue, fantasy adventure cue, bedtime lullaby, cute character theme. Each has a 320×320 WebP thumbnail like the original 25 (Create, Easy “More templates”, and Live).
- Writing can use a **Local LLM** (Ollama OpenAI-compatible `/v1` on this PC or the network) instead of a cloud key. Keys → Writing → Local LLM: server URL, model, optional dummy key. Those fields only show when Local LLM is selected. One request at a time.
- Vocal songs with lyrics automatically run Whisper lyric sync after the thumbnail. Instrumentals skip it. Manual re-sync remains in the song menu.
- Live writes a Local LLM title (not the template name) plus lyrics, then rolls a vocal cast: female, male, mixed duet, or same-gender duo with two different characters. Character picker only lists voices that fit the open slot (no greyed-out cards). Added 80s hair band and 80s techno templates, plus four more built-in characters.
- Writing supports a saved private-network Ollama server and Gemma 3 4B recommendation alongside cloud providers. Gemini cloud writing uses the 3.6 Flash default and preserves the fuller co-producer prompt for Easy mode.

### Fixed
- Live Orbitwave reads the Studio library and grows as songs are added. Rings stay equally spaced (they no longer stretch wider toward the edge). Type is 125px. The playing title is cyan; the newest title is amber. The camera no longer orbits — only the title rings spin.

## [0.6.2] — 2026-09-13

### Changed
- Windows generation uses cuDNN attention and CUDA graphs instead of math SDPA. On an RTX 3090, a 4:22 song generated in 3:09 (was ~15 minutes). FlashAttention is still Linux-only on this torch wheel; GraphAR auto-flash is forced to cuDNN, with eager decode if graph capture fails. 24 GB cards use a 1024 NAR tile. Clear VRAM or restart so the worker reloads.

### Fixed
- Library playback bars are the original spectrum analyser again (same-origin blob tap). They had become scrolling fake waves after the native-audio mute fix.

### Added
- **Radio** in the top modes: play the library as a station from the desktop or a LAN browser.
- Optional **LAN sharing** on port **6969** (System on/off, no password). Desktop sidecar stays on 7794.

### Notes
- Official “faster than playback” Linux numbers assume FlashAttention. This Windows build uses cuDNN + CUDA graphs instead.
- Do not expose LAN sharing to the public internet.

## [0.6.1] — 2026-09-13

### Fixed
- SheetSage2 install rewrites `config.json` so the model uses the local MERT folder. Verification treated that rewrite as a missing file, so install always ended with “required files are still missing” and a 2 KB remaining download. Config is now marked mutable. Weights already on disk are reused.
- After a song finishes, the library banner no longer keeps a red elapsed clock running. Library playback uses the native audio element (Web Audio was muting cross-origin tracks in the desktop WebView).

## [0.6.0] — 2026-09-13

### Added
- **Remix this song** in the library menu: generate a new recording from the saved YuE2 score. Keep the melody, or keep melody and chords.
- **Cover from audio** with optional SheetSage2: transcribe a recording to an editable ABC lead sheet, then re-sing it with YuE2. Install SheetSage2 from Models (CC-BY-NC).
- Video Studio scene tiles (black, white, grayscale, chroma green/blue/magenta, plus washes). Scene color is backdrop only.
- New visualizer presets: Analog, Equalizer, Cascade, Stereo, Silk, Dots, plus reworked Sunburst, Mesh, and Peak.
- `/api/video/prepare` unloads the YuE2 GPU worker before a canvas capture.

### Changed
- Generation style is a compact official YuE2 line, not MiniMax structured captions. Performance tags such as `[Spoken]` move out of lyrics into style.
- Off-mode semantic CFG uses the official **1.01** default when the form is left at 1.0.
- Voice-profile compiled prompt is compact YuE2 style and is applied on generate.
- Native ABC placeholder uses Vocal/Ins voices. Remix melody mode strips chord quotes from music lines only.
- Peak, Bars, Wave, Grid, and Equalizer sit on the bottom edge in both 16:9 and 9:16. Lyrics stay above Peak.
- Video Studio capture: looping background video is not seeked every clock tick; note particles use cached sprites; photo/video backgrounds skip extra glow passes; draw rate is capped during render; FFmpeg uses `-preset veryfast`.

### Fixed
- Library and Video Studio playback no longer restart on status polls.
- Library listing no longer renames audio files on GET (that could yank a playing wav).
- Particles draw with visualizers on every scene, including black.

### Removed
- Weak or duplicate Video Studio presets: Aurora, Skyline, Flow, Rings, Spiral, Helix, Vista, Contour, Disc, Ribbon.
- Primary/Secondary color pickers in Video Studio.

### Notes
- Remix uses the saved score (`score.abc`). Cover from audio needs SheetSage2 installed.
- Covers are a new performance of the transcribed tune, not a mix of the original vocal take.
- Model weights, private runtimes, API keys, and personal media are not in this source tree.

## [0.5.1] — 2026-09-12

- Video Studio visualizers: derived multi-color palettes, full-spectrum Peak and Disc, cinematic atmosphere, richer Orbit depth, corrected Bars/Skyline.

## [0.5.0] — 2026-09-11

- Sony Woosh-Flow in Effects (CC-BY-NC), optional Models installer, mono playback through both ears, Combine sound tracks, Gemini prompt help for effects.
