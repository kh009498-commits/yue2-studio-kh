"""YuE2 Studio MCP: a dependency-free stdio MCP bridge to the visible local Studio."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import re
import threading
import uuid
from typing import Any

BASE_URL = os.environ.get("YUE2_STUDIO_URL", "http://127.0.0.1:7794").rstrip("/")
PROTOCOL_VERSION = "2024-11-05"

# Which assistant is connected (Claude, Codex, Grok...). Learned from the MCP
# "initialize" handshake so songs it queues are labelled with its name in
# Studio's shared queue. YUE2_AGENT_NAME overrides it for any client.
AGENT_NAME = os.environ.get("YUE2_AGENT_NAME", "").strip()[:40]


def agent_name() -> str:
    return AGENT_NAME or "AI agent"


def agent_id() -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", agent_name().lower()).strip("-") or "agent"
    return f"mcp-{slug}"[:64].ljust(8, "0")


def seg(value: Any) -> str:
    """One URL path piece. Song folders contain spaces and may be nested (Genre/Title)."""
    return urllib.parse.quote(str(value), safe="/")


def seg1(value: Any) -> str:
    """A single path piece that must not contain '/' (ids)."""
    return urllib.parse.quote(str(value), safe="")

TOOLS = [
    ("studio_status", "Read Studio readiness, installed features, GPU status, and recent jobs.", {}),
    ("list_songs", "List every song in the Studio library.", {}),
    ("get_song", "Get one song by its folder_name, including metadata, lyrics, score, and assets.", {"folder": {"type": "string"}}),
    ("generate_song", "Queue a YuE2 song generation in the visible Studio job queue. Rejects titles/lyrics that use the Studio lyric ban list.", {"description": {"type": "string", "description": "Structured music description."}, "title": {"type": "string"}, "lyrics": {"type": "string"}, "instrumental": {"type": "boolean"}, "artist": {"type": "string"}, "genre": {"type": "string"}, "steps": {"type": "integer", "minimum": 1, "maximum": 200}, "seed": {"type": "integer"}}),
    ("get_job", "Read the live progress of a Studio job.", {"job_id": {"type": "string"}}),
    ("clear_memory", "Unload YuE2 models from VRAM. Studio refuses while any song job is queued or running.", {}),
    ("cancel_job", "Cancel a queued or running Studio job.", {"job_id": {"type": "string"}}),
    ("update_song", "Update editable metadata and lyrics for a library song.", {"folder": {"type": "string"}, "title": {"type": "string"}, "artist": {"type": "string"}, "album": {"type": "string"}, "genre": {"type": "string"}, "year": {"type": "string"}, "track_number": {"type": "string"}, "description": {"type": "string"}, "lyrics": {"type": "string"}, "lyrics_language": {"type": "string"}}),
    ("rate_song", "Set a library song rating from 0 through 5.", {"folder": {"type": "string"}, "rating": {"type": "integer", "minimum": 0, "maximum": 5}}),
    ("playlists", "List playlists, create one, or add/remove a song. action is list, create, add, or remove.", {"action": {"type": "string", "enum": ["list", "create", "add", "remove"]}, "name": {"type": "string"}, "playlist_id": {"type": "string"}, "song_id": {"type": "string"}}),
    ("voices", "List voice profiles, create a profile, or compile chosen slots into a generation prompt. action is list, create, or compile.", {"action": {"type": "string", "enum": ["list", "create", "compile"]}, "profile": {"type": "object"}, "slots": {"type": "object"}, "description": {"type": "string"}, "lyrics": {"type": "string"}}),
    ("write_song", "Use Studio's configured writing provider to generate, optimize, title, describe, compose, or translate song text.", {"action": {"type": "string", "enum": ["generate", "optimize", "title", "describe", "compose", "translate"]}, "idea": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}, "lyrics": {"type": "string"}, "language": {"type": "string"}, "instrumental": {"type": "boolean"}}),
    ("effects", "List sound effects or queue a generated sound effect. action is list or generate.", {"action": {"type": "string", "enum": ["list", "generate"]}, "prompt": {"type": "string"}, "name": {"type": "string"}, "duration": {"type": "number"}}),
]
REQUIRED = {
    "get_song": ["folder"], "generate_song": ["description"], "get_job": ["job_id"],
    "cancel_job": ["job_id"], "update_song": ["folder", "title"], "rate_song": ["folder", "rating"],
    "write_song": ["action"],
}

def emit(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def request(method: str, path: str, payload: Any = None, timeout: int = 190) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    joiner = "&" if "?" in path else "?"
    tagged = f"{path}{joiner}studio_client={seg1(agent_id())}&studio_name={seg1(agent_name())}"
    req = urllib.request.Request(BASE_URL + tagged, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {"ok": True}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try: detail = json.loads(detail).get("detail", detail)
        except json.JSONDecodeError: pass
        raise RuntimeError(f"Studio returned {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"YuE2 Studio is not reachable at {BASE_URL}. Open the desktop app first. ({error.reason})") from error

def audit(tool: str, summary: str, status: str) -> None:
    try: request("POST", "/api/mcp/activity", {"tool": tool, "summary": summary[:500], "status": status})
    except Exception: pass

def ban_list_violations(title: str, lyrics: str) -> list[str]:
    """Check agent-supplied text against the Studio's live lyric ban list.

    Studio applies the list only to its own AI writer, so lyrics an agent writes
    itself would otherwise reach generation unchecked. Uses the app's matcher so
    aliases and wildcards (e.g. "Where _____ grows") behave identically.
    """
    python_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python")
    if python_dir not in sys.path:
        sys.path.insert(0, python_dir)
    import lyric_preferences
    avoid = request("GET", "/api/settings/lyric-preferences").get("avoid", "")
    return list(dict.fromkeys(lyric_preferences.violations(title, avoid) + lyric_preferences.violations(lyrics, avoid)))

def call(tool: str, a: dict[str, Any]) -> Any:
    if tool == "studio_status": return request("GET", "/api/status")
    if tool == "clear_memory": return request("POST", "/api/clear-memory")
    if tool == "list_songs": return request("GET", "/api/library")
    if tool == "get_song": return next((x for x in request("GET", "/api/library")["items"] if x.get("folder_name") == a["folder"]), None) or (_ for _ in ()).throw(RuntimeError("Song not found"))
    if tool == "generate_song":
        banned = ban_list_violations(a.get("title", ""), a.get("lyrics", ""))
        if banned: raise RuntimeError("Title or lyrics use banned words/phrases: " + "; ".join(banned) + ". Revise them with different concrete imagery and resubmit.")
        return request("POST", "/api/generate", {"description": a["description"], "title": a.get("title", ""), "lyrics": a.get("lyrics", ""), "instrumental": a.get("instrumental", False), "artist": a.get("artist", ""), "genre": a.get("genre", ""), "steps": a.get("steps", 32), "seed": a.get("seed")})
    if tool == "get_job": return request("GET", "/api/jobs/" + seg1(a["job_id"]))
    if tool == "cancel_job": return request("POST", "/api/jobs/" + seg1(a["job_id"]) + "/cancel")
    if tool == "update_song":
        body = {k: a.get(k, "") for k in ("title", "artist", "album", "genre", "year", "track_number", "description", "lyrics", "lyrics_language")}
        if not body["title"]: raise RuntimeError("title is required when updating a song")
        return request("PATCH", "/api/library/" + seg(a["folder"]), body)
    if tool == "rate_song": return request("PATCH", "/api/library/" + seg(a["folder"]) + "/rating", {"rating": a["rating"]})
    if tool == "playlists":
        action = a.get("action", "list")
        if action == "list": return request("GET", "/api/playlists")
        if action == "create": return request("POST", "/api/playlists", {"name": a["name"]})
        endpoint = f"/api/playlists/{seg1(a['playlist_id'])}/songs/{seg1(a['song_id'])}"
        return request("POST" if action == "add" else "DELETE", endpoint)
    if tool == "voices":
        action = a.get("action", "list")
        if action == "list": return request("GET", "/api/voices?archived=true")
        if action == "create": return request("POST", "/api/voices", a.get("profile", {}))
        return request("POST", "/api/voices/compile", {"slots": a.get("slots", {}), "description": a.get("description", ""), "lyrics": a.get("lyrics", "")})
    if tool == "write_song": return request("POST", "/api/assist/writing", {"action": a["action"], "idea": a.get("idea", ""), "title": a.get("title", ""), "description": a.get("description", ""), "lyrics": a.get("lyrics", ""), "language": a.get("language", "en"), "instrumental": a.get("instrumental", False)}, timeout=600)
    if tool == "effects":
        if a.get("action", "list") == "list": return request("GET", "/api/effects")
        return request("POST", "/api/effects/generate", {"prompt": a["prompt"], "name": a.get("name", ""), "duration": a.get("duration", 5)})
    raise RuntimeError(f"Unknown tool: {tool}")

SESSION_ID = uuid.uuid4().hex
HEARTBEAT_SECONDS = 5
_heartbeat_stop = threading.Event()

def _announce(connected: bool) -> None:
    try: request("POST", "/api/mcp/connection", {"session": SESSION_ID, "name": agent_name(), "connected": connected}, timeout=3)
    except Exception: pass  # Studio may not be open yet; the next beat retries.

def start_heartbeat() -> None:
    """Keep Studio's connection indicator live, including when Studio opens after the agent."""
    def beat() -> None:
        while not _heartbeat_stop.is_set():
            _announce(True)
            _heartbeat_stop.wait(HEARTBEAT_SECONDS)
    if not getattr(start_heartbeat, "started", False):
        start_heartbeat.started = True
        threading.Thread(target=beat, name="yue2-mcp-heartbeat", daemon=True).start()

def stop_heartbeat() -> None:
    _heartbeat_stop.set()
    _announce(False)

def main() -> None:
    global AGENT_NAME
    # MCP speaks UTF-8 JSON. On Windows a piped stdout defaults to the ANSI code
    # page (cp1252), which turns characters such as "×", "·" or accented song
    # titles into bytes that Claude, Codex and Grok cannot decode.
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    for line in sys.stdin:
        ident = None
        line = line.lstrip("\ufeff").strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            method, ident = msg.get("method"), msg.get("id")
            if method == "initialize":
                if not AGENT_NAME:
                    client = str(((msg.get("params") or {}).get("clientInfo") or {}).get("name") or "")
                    AGENT_NAME = _friendly_client(client)
                start_heartbeat()
                emit({"jsonrpc": "2.0", "id": ident, "result": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {}}, "serverInfo": {"name": "yue2-studio", "version": "1.0.0"}}})
            elif method == "notifications/initialized": pass
            elif method == "tools/list":
                tools = [{"name": name, "description": desc, "inputSchema": {"type": "object", "properties": props, "required": REQUIRED.get(name, [])}} for name, desc, props in TOOLS]
                emit({"jsonrpc": "2.0", "id": ident, "result": {"tools": tools}})
            elif method == "tools/call":
                name = msg["params"]["name"]; args = msg["params"].get("arguments", {})
                audit(name, "Working in YuE2 Studio", "started")
                try:
                    result = call(name, args)
                    audit(name, "Completed in YuE2 Studio", "succeeded")
                    emit({"jsonrpc": "2.0", "id": ident, "result": {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}})
                except Exception as error:
                    audit(name, str(error), "failed")
                    emit({"jsonrpc": "2.0", "id": ident, "result": {"isError": True, "content": [{"type": "text", "text": str(error)}]}})
            elif ident is not None: emit({"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": "Method not found"}})
        except Exception as error:
            if ident is not None: emit({"jsonrpc": "2.0", "id": ident, "error": {"code": -32603, "message": str(error)}})
    stop_heartbeat()


def _friendly_client(raw: str) -> str:
    """'claude-ai' -> 'Claude', 'codex-mcp-client' -> 'Codex', 'grok' -> 'Grok'."""
    lowered = raw.lower()
    for needle, label in (("claude", "Claude"), ("codex", "Codex"), ("grok", "Grok"), ("cursor", "Cursor")):
        if needle in lowered:
            return label
    return raw.strip()[:40] or "AI agent"

if __name__ == "__main__": main()
