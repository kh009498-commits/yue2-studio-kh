# YuE2 Studio local progress — 2026-10-01

The authoritative working project is `<project-root>`, version 0.7.0 with unreleased improvements. Its starting commit was `606c89048e6750d58dd420926b5a60642e46c671`; GitHub `main` was identical when checked. The `github` remote is `krakenunbound/yue2-studio`; the Hugging Face `origin` remote is not a publication destination for these changes.

## Preserved local work

The existing September 25 work adds a shared GPU song queue with browser ownership and owner-aware cancellation, a live provider model picker, origin protection, NVIDIA writing timeouts, and MCP agent labels, heartbeat leases, Unicode replies, and song-path handling. Existing historical QA records remain intact. Older build logs refer to the former `F:\YuE2-3B` path.

## Current fixes

- Shared writing defaults serve the model catalog, vault, and writing payloads. Blank models now use the selected provider's default. API provider changes without an explicit model reset the model; known inherited defaults are repaired. Explicit custom IDs remain supported.
- NVIDIA writing defaults to `deepseek-ai/deepseek-v4.1-flash`. The retired `minimaxai/minimax-m3` saved ID migrates to DeepSeek. The local writer selection was already NVIDIA/DeepSeek; credentials and private settings were not changed.
- Audio rendering calls `yue2_engine.generate` directly. There is no automatic MiniMax audio or writing-provider fallback. Failed provider requests remain errors.
- Active app imports no longer load MiniMax's caption library, and the unused reference-label helper is removed. `/api/assist/caption-library` remains compatible and reports `available=false` with zero counts. Dormant historical Music3 modules/corpus remain in the source tree for now, but installer staging excludes them and temporary helper scripts.
- Sidecar API metadata now agrees with the existing 0.7.0 package/Tauri version.
- Publication audits scan Git blobs for private paths, all saved provider keys, and recognized token formats, withholding values. Installer audits check all saved provider keys, including binary payloads. API-key vaults, outputs/settings, media, models, private runtimes, old executable backups, and Windows shortcuts are excluded from source publication.

## Validation

- Final offline Python suite: **380 passed, 18 subtests passed**. Existing audioop/FastAPI/Starlette deprecation warnings remain.
- The first full-suite run exposed a pre-existing cancellation fixture using a non-local TestClient address. It now uses the studio PC loopback address, preserving the ownership checks; the final full suite passes.
- `npm run build`: passed; existing bundle-size warning remains.
- `npm run tauri build -- --no-bundle`: passed, building version 0.7.0. The user's root executable was not replaced or launched.
- Both JavaScript checks passed: `scripts/tests/live-completion.mjs` and `scripts/tests/orbit-audio.mjs`.
- Installer staging/audit PowerShell scripts parse successfully. Synthetic tests verify all six cloud-provider credentials are rejected from staged content without disclosure, and a non-Gemini credential is rejected from a binary installer payload.
- Full tracked-index credential audit passed before staging (1,411 blobs). The publication workflow additionally requires staged-content and final full-index audits before commit/push.
- Built native executable and frontend output privacy audit: passed (no saved provider keys or private settings).

No paid API calls, generation jobs, app launches, installs, release uploads, merges, or deployments were performed. Tests use synthetic credentials and temporary vaults. Publication is a new GitHub branch and draft pull request; private settings remain local.
