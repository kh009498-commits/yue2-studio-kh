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

from tool_schema import SERVER_VERSION, GENERATE_PROPERTIES, EFFECT_PROPERTIES, MIX_PROPERTIES, SLOTS, ACTION_REQUIRED, input_schema, validate_value

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
    ("generate_song", "Queue local YuE2 audio with optional score planning, ABC, profiles, language, exclusions and sampling controls. Live lyric bans and readiness are enforced; returns the original job id, never retries a submission.", GENERATE_PROPERTIES),
    ("get_job", "Read the live progress of a Studio job.", {"job_id": {"type": "string"}}),
    ("clear_memory", "Unload YuE2 models from VRAM. Studio refuses while any song job is queued or running.", {}),
    ("cancel_job", "Cancel a queued or running Studio job.", {"job_id": {"type": "string"}}),
    ("update_song", "Update editable metadata and lyrics for a library song.", {"folder": {"type": "string"}, "title": {"type": "string"}, "artist": {"type": "string"}, "album": {"type": "string"}, "genre": {"type": "string"}, "year": {"type": "string"}, "track_number": {"type": "string"}, "description": {"type": "string"}, "lyrics": {"type": "string"}, "lyrics_language": {"type": "string"}}),
    ("rate_song", "Set a library song rating from 0 through 5.", {"folder": {"type": "string"}, "rating": {"type": "integer", "minimum": 0, "maximum": 5}}),
    ("playlists", "List playlists, create one, or add/remove a song. action is list, create, add, or remove.", {"action": {"type": "string", "enum": ["list", "create", "add", "remove"]}, "name": {"type": "string"}, "playlist_id": {"type": "string"}, "song_id": {"type": "string"}}),
    ("voices", "List voice profiles, create a profile, or compile chosen slots into a generation prompt. action is list, create, or compile.", {"action": {"type": "string", "enum": ["list", "create", "compile"]}, "profile": {"type": "object"}, "slots": SLOTS, "snapshots": {"type": "array", "items": {"type": "object"}}, "description": {"type": "string"}, "lyrics": {"type": "string"}}),
    ("write_song", "Use Studio's configured writing provider to generate, optimize, title, describe, compose, or translate song text.", {"action": {"type": "string", "enum": ["generate", "optimize", "title", "describe", "compose", "translate"]}, "idea": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}, "lyrics": {"type": "string"}, "language": {"type": "string"}, "instrumental": {"type": "boolean"}}),
    ("effects", "List effects, generate via Stable CPU or Woosh GPU, or add an existing effect to Studio. Woosh unloads YuE2, supports <=5 seconds, and is CC-BY-NC. Optional folder generates directly into that song's Studio.", EFFECT_PROPERTIES),
    ("extract_stems", "Queue installed local Demucs separation (2: vocals/accompaniment, 4: vocals/drums/bass/other); returns a job id. Does not install models.", {"folder": {"type": "string"}, "mode": {"type": "string", "enum": ["2", "4"], "default": "2"}}),
    ("synchronize_lyrics", "Queue alignment of an existing vocal song's saved lyrics. Requires installed lyric-sync models; returns a job id.", {"folder": {"type": "string"}}),
    ("regenerate_cover", "Queue a new local square cover image for an existing song. Replaces the saved cover on success; returns a job id.", {"folder": {"type": "string"}, "direction": {"type": "string", "maxLength": 1200}}),
    ("transcribe_cover", "Queue installed SheetSage2 transcription of a library recording to an ABC score. This does not generate a new cover performance; pass the resulting score to generate_song. SheetSage2 is CC-BY-NC.", {"folder": {"type": "string"}, "melody_only": {"type": "boolean", "default": True}, "reuse_cached": {"type": "boolean", "default": True}}),
    ("export_audio", "Convert a library song to tagged MP3 or FLAC using installed FFmpeg. Synchronous: returns filename/download_url, not a job. Replaces an existing song.mp3 or song.flac export.", {"folder": {"type": "string"}, "format": {"type": "string", "enum": ["mp3", "flac"]}}),
    ("studio_mix", "Save a complete explicit track session or synchronously bounce supplied tracks to WAV and save their session state. Read get_song first for track/source names. A full custom bounce creates a new library take; selections and instrumental/acapella variants return a mix download. No browser video rendering.", MIX_PROPERTIES),
]
REQUIRED = {
    "get_song": ["folder"], "generate_song": ["description"], "get_job": ["job_id"],
    "cancel_job": ["job_id"], "update_song": ["folder", "title"], "rate_song": ["folder", "rating"],
    "write_song": ["action"],
    "extract_stems": ["folder"], "synchronize_lyrics": ["folder"], "regenerate_cover": ["folder"],
    "transcribe_cover": ["folder"], "export_audio": ["folder", "format"],
    "studio_mix": ["action", "folder", "tracks"],
}

def tool_specs() -> list[dict]:
    """Canonical machine-readable interface, also usable without starting Studio."""
    return [{"name": name, "description": desc, "inputSchema": input_schema(name, props, REQUIRED.get(name, []))} for name, desc, props in TOOLS]


def validate_arguments(tool: str, args: dict) -> None:
    spec = next((item for item in tool_specs() if item["name"] == tool), None)
    if spec is None:
        raise ValueError("Unknown tool")
    validate_value(args, spec["inputSchema"], tool)
    for field in ACTION_REQUIRED.get(tool, {}).get(args.get("action", "list"), []):
        if field not in args:
            raise ValueError(f"{tool}.{field}: required for this action")
    if tool == "generate_song" and str(args.get("abc_score") or "").strip() and args.get("cot_mode", "full") == "off":
        raise ValueError("An ABC score requires Full or Melody planning mode.")
    if tool == "studio_mix":
        if args["action"] == "save" and any(key in args for key in ("variant", "selection", "content_end")):
            raise ValueError("variant, selection and content_end apply only to bounce.")
        regions = [args["selection"]] if args.get("selection") else []
        for track in args["tracks"]:
            regions.extend(track.get("cuts", []) + track.get("effects", []))
            for clip in track.get("clips", []):
                if clip.get("source_out") is not None and clip["source_out"] <= clip.get("source_in", 0):
                    raise ValueError("Clip source_out must be after source_in.")
        if any(region["end"] <= region["start"] for region in regions):
            raise ValueError("Range end must be after start.")


def require_ready(feature: str, engine: str | None = None) -> None:
    state = request("GET", "/api/status").get(feature) or {}
    if engine:
        state = (state.get("models") or {}).get(engine) or (state if engine == "stable" else {})
    flag = "online" if feature == "service" else "ready"
    if not state.get(flag):
        raise RuntimeError(state.get("detail") or f"{engine or feature} is not ready. Inspect studio_status; no job was submitted.")


def effect_payload(args: dict) -> dict:
    engine = args.get("engine", "stable")
    body = {key: args[key] for key in EFFECT_PROPERTIES if key in args and key not in {"action", "folder", "effect_id"}}
    body.setdefault("engine", engine)
    body.setdefault("duration", 5)
    body.setdefault("steps", 32 if engine == "woosh" else 8)
    body.setdefault("sampler", "dopri5" if engine == "woosh" else "pingpong")
    if engine == "woosh" and body["duration"] > 5:
        raise ValueError("Woosh supports at most 5 seconds; shorten the request or choose Stable.")
    allowed = {"dopri5", "euler"} if engine == "woosh" else {"pingpong", "euler", "rk4", "dpmpp"}
    if body["sampler"] not in allowed:
        raise ValueError("The selected sampler is not supported by this effect engine.")
    if engine == "stable" and body.get("negative_prompt"):
        raise ValueError("Stable ignores negative prompts; describe the desired sound in prompt or choose Woosh.")
    return body


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
    validate_arguments(tool, a)
    if tool == "studio_status": return request("GET", "/api/status")
    if tool == "clear_memory": return request("POST", "/api/clear-memory")
    if tool == "list_songs": return request("GET", "/api/library")
    if tool == "get_song":
        song = next((x for x in request("GET", "/api/library")["items"] if x.get("folder_name") == a["folder"]), None)
        if song is None:
            raise RuntimeError("Song not found")
        score = request("GET", "/api/library/" + seg(a["folder"]) + "/score")
        return {**song, "planned_abc_score": score.get("abc", ""), "has_score": bool(score.get("has_score"))}
    if tool == "generate_song":
        require_ready("service")
        banned = ban_list_violations(a.get("title", ""), a.get("lyrics", ""))
        if banned: raise RuntimeError("Title or lyrics use banned words/phrases: " + "; ".join(banned) + ". Revise them with different concrete imagery and resubmit.")
        body = {key: a[key] for key in GENERATE_PROPERTIES if key in a}
        return request("POST", "/api/generate", body)
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
        return request("POST", "/api/voices/compile", {"slots": a.get("slots", {}), "description": a.get("description", ""), "lyrics": a.get("lyrics", ""), "snapshots": a.get("snapshots", [])})
    if tool == "write_song": return request("POST", "/api/assist/writing", {"action": a["action"], "idea": a.get("idea", ""), "title": a.get("title", ""), "description": a.get("description", ""), "lyrics": a.get("lyrics", ""), "language": a.get("language", "en"), "instrumental": a.get("instrumental", False)}, timeout=600)
    if tool == "effects":
        action = a.get("action", "list")
        if action == "list": return request("GET", "/api/effects")
        if action == "add_to_studio":
            return request("POST", f"/api/effects/{seg1(a['effect_id'])}/add-to-studio/{seg(a['folder'])}")
        body = effect_payload(a)
        require_ready("sound_effects", body["engine"])
        path = "/api/library/" + seg(a["folder"]) + "/studio/generate-sfx" if a.get("folder") else "/api/effects/generate"
        return request("POST", path, body)
    if tool in {"extract_stems", "synchronize_lyrics", "regenerate_cover", "transcribe_cover"}:
        feature, suffix, fields = {
            "extract_stems": ("stems", "stems", ("mode",)),
            "synchronize_lyrics": ("lyrics_sync", "lyrics-sync", ()),
            "regenerate_cover": ("cover_art", "cover", ("direction",)),
            "transcribe_cover": ("sheetsage", "cover-transcribe", ("melody_only", "reuse_cached")),
        }[tool]
        require_ready(feature)
        body = {key: a[key] for key in fields if key in a} if fields else None
        return request("POST", "/api/library/" + seg(a["folder"]) + "/" + suffix, body)
    if tool == "export_audio":
        require_ready("exports")
        return request("POST", "/api/library/" + seg(a["folder"]) + "/export/" + a["format"], timeout=600)
    if tool == "studio_mix":
        body = {key: a[key] for key in ("tracks", "variant", "selection", "content_end") if key in a}
        path = "/api/library/" + seg(a["folder"]) + "/studio"
        if a["action"] == "save":
            return request("PATCH", path, body)
        require_ready("exports")
        return request("POST", path + "/bounce", body, timeout=600)
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
                emit({"jsonrpc": "2.0", "id": ident, "result": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {}}, "serverInfo": {"name": "yue2-studio", "version": SERVER_VERSION}}})
            elif method == "notifications/initialized": pass
            elif method == "tools/list":
                tools = tool_specs()
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
