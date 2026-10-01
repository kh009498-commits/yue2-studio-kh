# API keys and optional cloud help

YuE2, stems, local covers, SFX, and Video Studio stay local. Cloud keys are optional helpers for **writing**, later **images**, and later **video**.

## Enable is not “save”

| State | What happens |
|---|---|
| No key | Create / Studio / Video Studio look like today |
| Key saved, Enable off | Key sits in the vault. No spend |
| Key saved, Enable on | Cloud buttons may call that provider |

The first **Generate Lyrics** / **Optimize** click turns Writing Enable on so a saved key can actually be used. Uncheck **Enable** in the KEYS tab to stop spending. The key stays saved.

## KEYS tab (left rail)

Between LOGS and SYSTEM. Groups:

1. **Writing** — titles and lyrics (Gemini 3.6 Flash default, or NVIDIA NIM / Grok / Groq / OpenAI / Anthropic / Local LLM)
2. **Still images** — 1:1 square covers only. Default remains local SD 1.5
3. **Motion / video** — 16:9 landscape or 9:16 portrait. Default remains local Video Studio

Saving a Gemini key does not replace local YuE2. It never generates the song. To replace a previously saved cloud key, paste the intended key into the field and click **Save this category**; selecting a provider or model alone does not replace an existing key.

## Writing models

Keys → Writing lists the chosen provider's current writing models, with recommended choices first and an option to type a model ID. Switching providers resets the model instead of carrying another provider's ID across. Blank IDs use that provider's default. NVIDIA NIM defaults to `deepseek-ai/deepseek-v4.1-flash`; the retired `minimaxai/minimax-m3` choice migrates to that default. Custom IDs are preserved except known defaults inherited from a different provider.

Writing helpers generate text only. YuE2 generates all song audio locally; there is no MiniMax music fallback. A provider error is reported rather than sending the request to another provider. Available models and provider pricing can change; refresh the list before selecting one.

All provider keys stay in ignored `outputs/settings/api-keys.json`. Source publication runs `python scripts/audit_git_privacy.py --staged`; installer audits check every saved provider key in memory and never print values.

## Writing buttons (Create)

On the lyrics box:

- **Generate Lyrics** — theme/idea modal, or random from the current description
- **Optimize** — rewrite the current lyric stream (tags only)

Preview first. **Apply** writes lyrics. If the model also returned a YuE2 caption, Apply can move that into **Music Description**. The lyric stream must stay section tags + sung words only (`[Verse]`, `[Chorus]`, …).

Empty title may pick up a suggested title such as *Event Horizon*. A title you typed is not replaced.

## Job rules the model is told

| Job | Hard rule |
|---|---|
| Writing | YuE2 caption + official lyric tags. No `[Spoken]` in the lyric stream |
| Images | **1:1** square, no text on the art |
| Video | **16:9** or **9:16**, never square |

## Files

| File | Role |
|---|---|
| `python/ai_vault.py` | Load / save / mask keys. Enable flags |
| `python/ai_guides.py` | How-to packs (lyrics-only vs full caption) |
| `python/ai_assist.py` | Provider calls. Parse / split caption out of lyrics |
| `src/KeysDrawer.tsx` | KEYS UI |

Local music generation works with zero keys and with Enable off.
# GitHub exclusion

Each provider key is local-only, stored in `outputs/settings/api-keys.json`. Never include a key in GitHub commits, issue reports, screenshots, release packages, or documentation. The vault is excluded by `.gitignore`; do not force-add it.
