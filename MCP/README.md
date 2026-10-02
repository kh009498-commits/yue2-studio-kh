# YuE2 Studio MCP

This folder contains a local stdio MCP server for YuE2 Studio. It does not automate the desktop window. Instead it calls the Studio's loopback service and reports each action back to the app's visible **MCP** page.

Every client runs the same command: `python/venv/Scripts/python.exe MCP/server.py`. Open YuE2 Studio before calling a tool. Set `YUE2_STUDIO_URL` only if you intentionally moved the local service.

Registered clients on the studio PC:

- **Codex:** `[mcp_servers.yue2_studio]` in `%USERPROFILE%\.codex\config.toml`.
- **Claude Desktop / Cowork:** `mcpServers.yue2_studio` in `%APPDATA%\Claude\claude_desktop_config.json`. Restart Claude Desktop after editing it.
- **Grok or any other MCP client:** point it at the same command. The server learns the client's name during the MCP handshake and shows it on the Studio MCP page and in the song queue. Set `YUE2_AGENT_NAME` to override the label.

`SKILL.md` has a standard skill header (`name`, `description`), so it can also be installed as a skill in clients that support skills.

Available tools cover status, songs, generation and jobs, song editing and ratings, playlists, voice profiles, AI writing, and sound effects. See `SKILL.md` for agent behavior and safety guidance.

## Local MCP 1.1.0 interface

The application remains 0.7.0; the stdio bridge interface is 1.1.0 with 19 tools. Existing tool names remain available. `get_song` adds the actual planned ABC score, `generate_song` exposes native advanced controls, and `effects` selects Stable or Woosh. Added adapters: `extract_stems`, `synchronize_lyrics`, `regenerate_cover`, `transcribe_cover`, `export_audio`, and `studio_mix`. Read the skill for mutation/output behavior and engine limitations.

`server.tool_specs()` returns canonical JSON input schemas without launching Studio or starting MCP heartbeats. Schemas live in `tool_schema.py`; stdio `tools/list` uses the same data. No credential/provider-settings or installation tools exist. Requests are validated before submission, including action requirements and engine/planning constraints. Backend readiness checks remain authoritative if capability state changes after preflight.

Offline regression tests: `python/venv/Scripts/python.exe -B -m pytest python/tests/test_mcp_adapters.py -q -p no:cacheprovider`. No provider/GPU calls are needed.
