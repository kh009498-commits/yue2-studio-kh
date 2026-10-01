# YuE2 Studio MCP

This folder contains a local stdio MCP server for YuE2 Studio. It does not automate the desktop window. Instead it calls the Studio's loopback service and reports each action back to the app's visible **MCP** page.

Every client runs the same command: `python/venv/Scripts/python.exe MCP/server.py`. Open YuE2 Studio before calling a tool. Set `YUE2_STUDIO_URL` only if you intentionally moved the local service.

Registered clients on the studio PC:

- **Codex:** `[mcp_servers.yue2_studio]` in `%USERPROFILE%\.codex\config.toml`.
- **Claude Desktop / Cowork:** `mcpServers.yue2_studio` in `%APPDATA%\Claude\claude_desktop_config.json`. Restart Claude Desktop after editing it.
- **Grok or any other MCP client:** point it at the same command. The server learns the client's name during the MCP handshake and shows it on the Studio MCP page and in the song queue. Set `YUE2_AGENT_NAME` to override the label.

`SKILL.md` has a standard skill header (`name`, `description`), so it can also be installed as a skill in clients that support skills.

Available tools cover status, songs, generation and jobs, song editing and ratings, playlists, voice profiles, AI writing, and sound effects. See `SKILL.md` for agent behavior and safety guidance.
