---
name: yue2-studio
description: Make and manage songs in the local YuE2 Studio app through its MCP tools (studio_status, generate_song, get_job, list_songs, write_song, playlists, voices, effects). Use when the user asks to create a song, check song progress, or organize their YuE2 library.
---

# YuE2 Studio MCP

Use this MCP when an agent (Claude, Codex, Grok, or another MCP client) needs to work with the running YuE2 Studio desktop app without controlling its window. It speaks to the app's existing local service, and every tool invocation is shown in the Studio **MCP** screen with the agent's name.

## Preconditions

- YuE2 Studio must be open and ready. The local service listens only on `127.0.0.1:7794`. If a tool says Studio is not reachable, launch `YuE2 Studio.exe` from the app folder (the user authorized launching it as needed) and poll `studio_status` until ready. When your song work is done and the queue is idle, call `clear_memory`, then close the window gracefully. Don't close it while any job, including one owned by someone else, is queued or running. Never drive the window's controls; use MCP tools only.
- Start with `studio_status`. Do not queue generation when the model or service reports not ready.
- Songs share one GPU queue with everyone using Studio (the studio PC and browsers on the home network). New songs join the back of the line. `studio_status` returns `queue` with each song's position, owner, and phase. Songs you queue are labelled with your agent name.
- Treat song generation, cancellation, updates, ratings, playlists, profile creation, and effect generation as state-changing actions. Explain the intended action before invoking it when appropriate. Only cancel jobs you queued unless the user asks otherwise.

## Tool guide

- Use `list_songs` before addressing a song, then pass its exact `folder_name` (it may contain spaces and a genre folder, such as `Acoustic bluegrass/Frogs at the Creek`) to `get_song`, `update_song`, or `rate_song`.
- Use `generate_song` to submit a YuE2 generation. It needs a `description` (music style: genre, instruments, mood, vocal type) and, for vocal songs, `lyrics` with section tags such as `[Verse]`, `[Chorus]`, `[Bridge]` on their own lines. It returns a job id. Follow it with `get_job` every 30–60 seconds rather than rapidly. A song takes a few minutes, longer if others are ahead in the queue.
- `generate_song` rejects a title or lyrics that use the Studio lyric ban list (Settings → lyric preferences), reporting each banned word or phrase. Revise with different concrete imagery and resubmit; do not swap in equally formulaic filler.
- `clear_memory` unloads YuE2 from VRAM so another app (image or video generation) can use the GPU. Studio refuses while any song job is queued or running, so confirm the queue is idle first.
- `write_song` uses the app's configured AI-writing provider (set in the app's **Keys** tab) to generate, optimize, title, describe, compose, or translate song text. It does not generate audio. You may instead write the style and lyrics yourself and pass them to `generate_song`.
- `voices` manages or compiles the Studio voice profiles. `effects` lists effects or queues a sound-effect job. `playlists` handles playlist listing and membership.

## Visibility and privacy

The MCP records the tool name, outcome, and a non-sensitive summary in the Studio MCP page. It never sends local Studio data outside the machine by itself. API keys remain inside YuE2 Studio's local vault and are never returned by this MCP.

Do not use browser or computer-control tools for normal YuE2 work once this MCP is connected. Use the Studio GUI only to let the user inspect connection status, live activity, generated jobs, and results.
