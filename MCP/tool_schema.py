"""Dependency-free MCP input contracts for existing YuE2 Studio routes."""
from __future__ import annotations

import math
from typing import Any

SERVER_VERSION = "1.1.0"


def text(limit: int, minimum: int = 0, **extra: Any) -> dict:
    return {"type": "string", "minLength": minimum, "maxLength": limit, **extra}


def number(low: float, high: float, integer: bool = False, **extra: Any) -> dict:
    return {"type": "integer" if integer else "number", "minimum": low, "maximum": high, **extra}


SLOTS = {"type": "object", "properties": {name: {"type": "string"} for name in ("female", "male", "backing")}, "additionalProperties": False}
GENERATE_PROPERTIES = {
    "template_id": text(240, description="Optional stable Studio template ID for catalog filtering; metadata only, not a calmness guarantee."),
    "description": text(12000, 1, description="Compact YuE2 music style; musical directions stay separate from lyrics."),
    "title": text(120), "artist": text(160), "album": text(160), "genre": text(120),
    "lyrics": text(24000), "instrumental": {"type": "boolean"},
    "seed": {"type": ["integer", "null"]},
    "cot_mode": {"type": "string", "enum": ["full", "melody", "off"], "default": "full", "description": "Full plans melody/chords, melody plans melody, off skips score planning. ABC requires full or melody."},
    "abc_score": {"type": ["string", "null"], "maxLength": 24000},
    "steps": number(1, 200, True, default=32), "cfg": number(0, 20, default=1.0),
    "top_k": number(1, 16384, True, default=100), "temperature": number(0, 5, default=1.0),
    "exclude_styles": text(2000),
    "vocal_gender": {"type": "string", "enum": ["auto", "female", "male"], "default": "auto"},
    "lyrics_language": text(12, 2, default="en"), "english_translation": text(24000),
    "voice_slots": SLOTS,
    "voice_snapshots": {"type": "array", "items": {"type": "object"}, "description": "Optional saved profile snapshots returned by voices compile."},
}
EFFECT_PROPERTIES = {
    "action": {"type": "string", "enum": ["list", "generate", "add_to_studio"], "default": "list"},
    "engine": {"type": "string", "enum": ["stable", "woosh"], "default": "stable"},
    "prompt": text(1000, 3), "name": text(80), "negative_prompt": text(500, description="Woosh only; Stable ignores negative prompts."),
    "duration": number(0.5, 120, default=5, description="Woosh supports at most 5 seconds; larger requests are rejected rather than silently shortened."),
    "seed": {"type": ["integer", "null"], "minimum": 0, "maximum": 2147483647},
    "steps": number(1, 100, True, description="Default 8 for Stable, 32 for Woosh; DOPRI5 uses adaptive integration."),
    "sampler": {"type": "string", "enum": ["pingpong", "euler", "rk4", "dpmpp", "dopri5"], "description": "Stable: pingpong/euler/rk4/dpmpp (default pingpong). Woosh: dopri5/euler (default dopri5)."},
    "chunked_decode": {"type": "boolean", "default": True}, "cfg": number(0, 10, default=4.5),
    "folder": {"type": "string", "description": "Exact library folder_name. For generate, creates a Studio SFX track; required for add_to_studio."},
    "effect_id": {"type": "string"},
}
RANGE = {"type": "object", "properties": {"start": number(0, 10800), "end": {"type": "number", "exclusiveMinimum": 0, "maximum": 10800}}, "required": ["start", "end"], "additionalProperties": False}
EFFECT_REGION = {"type": "object", "properties": {
    **RANGE["properties"], "id": text(80, 1),
    "kind": {"type": "string", "enum": ["gain_up", "gain_down", "echo", "reverb", "auto_level", "normalize", "clarity", "compressor", "auto_pan", "low_pass", "high_pass", "telephone", "saturation", "tremolo", "stereo_widen", "limiter"]},
    "amount": number(0, 1), "instance": {"type": ["integer", "null"], "minimum": 1, "maximum": 10000},
    "fade_in": number(0, 120), "fade_out": number(0, 120),
}, "required": ["start", "end", "id", "kind"], "additionalProperties": False}
CLIP = {"type": "object", "properties": {
    "id": text(80), "start": number(0, 10800), "source_in": number(0, 10800),
    "source_out": {"type": ["number", "null"], "exclusiveMinimum": 0, "maximum": 10800},
    "fade_in": number(0, 120), "fade_out": number(0, 120),
    "gain": number(0, 4), "gain_left": number(0, 4), "gain_right": number(0, 4),
}, "additionalProperties": False}
TRACK = {"type": "object", "properties": {
    "name": text(80, 1, description="Existing source name from song metadata; song.wav selects the original mix."),
    "lane": {"type": ["string", "null"], "minLength": 1, "maxLength": 80},
    "gain": number(0, 1), "muted": {"type": "boolean"}, "solo": {"type": "boolean"},
    "offset": number(0, 10800), "trim_start": number(0, 10800),
    "trim_end": {"type": ["number", "null"], "exclusiveMinimum": 0, "maximum": 10800},
    "fade_in": number(0, 120), "fade_out": number(0, 120),
    "cuts": {"type": "array", "items": RANGE, "maxItems": 64},
    "effects": {"type": "array", "items": EFFECT_REGION},
    "clips": {"type": "array", "items": CLIP, "maxItems": 256}, "use_clips": {"type": "boolean"},
}, "required": ["name"], "additionalProperties": False}
MIX_PROPERTIES = {
    "action": {"type": "string", "enum": ["save", "bounce"]}, "folder": {"type": "string"},
    "tracks": {"type": "array", "items": TRACK, "description": "Complete explicit session. Save replaces saved track state; bounce renders these supplied tracks."},
    "variant": {"type": "string", "enum": ["custom", "instrumental", "acapella"], "default": "custom"},
    "selection": {"type": ["object", "null"], **{key: value for key, value in RANGE.items() if key != "type"}},
    "content_end": {"type": ["number", "null"], "exclusiveMinimum": 0, "maximum": 3600},
}
ACTION_REQUIRED = {
    "effects": {"generate": ["prompt"], "add_to_studio": ["folder", "effect_id"]},
    "playlists": {"create": ["name"], "add": ["playlist_id", "song_id"], "remove": ["playlist_id", "song_id"]},
    "voices": {"create": ["profile"]},
}


def input_schema(name: str, properties: dict, required: list[str]) -> dict:
    result = {"type": "object", "properties": properties, "required": required, "additionalProperties": False}
    if name in ACTION_REQUIRED:
        result["allOf"] = [{"if": {"properties": {"action": {"const": action}}, "required": ["action"]}, "then": {"required": fields}} for action, fields in ACTION_REQUIRED[name].items()]
    if name == "generate_song":
        result["allOf"] = [{"if": {"properties": {"cot_mode": {"const": "off"}}, "required": ["cot_mode"]}, "then": {"properties": {"abc_score": {"type": ["string", "null"], "pattern": r"^\s*$"}}}}]
    if name == "effects":
        result["allOf"].append({"if": {"properties": {"action": {"const": "generate"}}, "required": ["action"]}, "then": {
            "if": {"properties": {"engine": {"const": "woosh"}}, "required": ["engine"]},
            "then": {"properties": {"duration": {"maximum": 5}, "sampler": {"enum": ["dopri5", "euler"]}}},
            "else": {"properties": {"sampler": {"enum": ["pingpong", "euler", "rk4", "dpmpp"]}, "negative_prompt": {"enum": [""]}}},
        }})
    return result


def validate_value(value: Any, schema: dict, path: str) -> None:
    expected = schema.get("type")
    expected = expected if isinstance(expected, list) else [expected]
    actual = ("null" if value is None else "boolean" if isinstance(value, bool) else "integer" if isinstance(value, int)
              else "number" if isinstance(value, float) else "string" if isinstance(value, str)
              else "object" if isinstance(value, dict) else "array" if isinstance(value, list) else "unknown")
    if actual not in expected and not (actual == "integer" and "number" in expected):
        raise ValueError(f"{path}: expected {' or '.join(expected)}")
    if value is None:
        return
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path}: choose one of {', '.join(map(str, schema['enum']))}")
    if actual in {"integer", "number"}:
        if not math.isfinite(value):
            raise ValueError(f"{path}: must be finite")
        for bound, bad in (("minimum", value < schema.get("minimum", -math.inf)), ("maximum", value > schema.get("maximum", math.inf)), ("exclusiveMinimum", value <= schema.get("exclusiveMinimum", -math.inf))):
            if bad:
                raise ValueError(f"{path}: outside {bound} {schema[bound]}")
    if actual in {"string", "array"}:
        suffix = "Length" if actual == "string" else "Items"
        if len(value) < schema.get("min" + suffix, 0) or len(value) > schema.get("max" + suffix, math.inf):
            raise ValueError(f"{path}: length outside supported bounds")
    if actual == "array" and "items" in schema:
        for index, item in enumerate(value):
            validate_value(item, schema["items"], f"{path}[{index}]")
    if actual == "object":
        for key in schema.get("required", []):
            if key not in value:
                raise ValueError(f"{path}.{key}: required")
        properties = schema.get("properties", {})
        for key, item in value.items():
            if key in properties:
                validate_value(item, properties[key], f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                raise ValueError(f"{path}: unsupported field")
