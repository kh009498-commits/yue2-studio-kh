"""List the writing models a provider actually offers, for the Keys dropdown.

Each provider publishes a live model list. We ask it (with the saved key, or a
key the user just typed and has not saved yet), drop models that cannot write
lyrics (image, speech, embedding, safety, code-only...), and put known-good
song writers first. Keys are only sent to the provider they belong to and are
never returned to the page.
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Any

import ai_vault

from writing_models import DEFAULT_MODELS

# Shown first ("Recommended") when the provider still lists them.
RECOMMENDED: dict[str, tuple[str, ...]] = {
    "nvidia": (
        "openai/gpt-oss-20b",
        "nvidia/nemotron-3.5-lightning-30b-a3b",
        "deepseek-ai/deepseek-v4.1-flash",
        "z-ai/glm-5.3-flash",
        "z-ai/glm-5.3",
        "moonshotai/kimi-k3",
        "writer/palmyra-creative-122b",
    ),
    "ollama": ("gemma3:4b", "ministral-3:8b-instruct-2512-q4_K_M", "aya-expanse:8b", "qwen3.5:9b"),
}

LIST_URLS = {
    "nvidia": "https://integrate.api.nvidia.com/v1/models",
    "openai": "https://api.openai.com/v1/models",
    "groq": "https://api.groq.com/openai/v1/models",
    "xai": "https://api.x.ai/v1/models",
    "anthropic": "https://api.anthropic.com/v1/models",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
}

# Models that are not general text chat, so they cannot write a song.
NOT_A_WRITER = re.compile(
    r"embed|retriev|rerank|guard|safety|reward|moderation|parse|clip|deplot|kosmos|"
    r"(?:^|/)vila$|neva|fuyu|detector|calibration|whisper|tts|transcri|audio|realtime|"
    r"image|imagen|veo|dall-e|diffusion|sora|search|computer-use|"
    r"code|coder|starcoder|codestral|aqa|translate|chatqa|synthetic|babbage|davinci|turbo-instruct",
    re.I,
)
NEEDS_KEY = {"openai", "groq", "xai", "anthropic", "gemini"}
_CACHE: dict[tuple[str, str, str], tuple[float, list[str]]] = {}
_CACHE_SECONDS = 600
_LOCK = threading.Lock()


def _get_json(url: str, headers: dict[str, str], timeout: int = 20) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json", **headers}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code in {401, 403}:
            raise RuntimeError("The provider rejected this API key. Check it and try again.") from error
        raise RuntimeError(f"The provider's model list returned HTTP {error.code}.") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError("Could not reach the provider to list models. Check the internet connection.") from error
    except json.JSONDecodeError as error:
        raise RuntimeError("The provider returned an unreadable model list.") from error


def _fetch(provider: str, key: str, base_url: str) -> list[str]:
    if provider == "ollama":
        url = base_url.rstrip("/") + "/models"
        data = _get_json(url, {"Authorization": f"Bearer {key or 'ollama'}"}, timeout=8)
        return [str(item.get("id") or "") for item in data.get("data", [])]
    if provider == "gemini":
        data = _get_json(LIST_URLS["gemini"], {"X-goog-api-key": key})
        return [
            str(item.get("name") or "").removeprefix("models/")
            for item in data.get("models", [])
            if "generateContent" in (item.get("supportedGenerationMethods") or [])
        ]
    if provider == "anthropic":
        data = _get_json(LIST_URLS["anthropic"] + "?limit=100", {"x-api-key": key, "anthropic-version": "2023-06-01"})
        return [str(item.get("id") or "") for item in data.get("data", [])]
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    data = _get_json(LIST_URLS[provider], headers)
    return [str(item.get("id") or "") for item in data.get("data", [])]


def list_models(provider: str, *, key: str = "", base_url: str = "") -> dict[str, Any]:
    """Return {models, recommended, default} for the Writing dropdown."""
    if provider not in DEFAULT_MODELS:
        raise ValueError("This provider does not write lyrics.")
    saved = ai_vault.load()["providers"].get(provider) or {}
    key = (key or "").strip() or str(saved.get("key") or "")
    if provider == "ollama":
        base_url = ai_vault.normalize_ollama_url(base_url or str(saved.get("base_url") or "") or ai_vault.OLLAMA_DEFAULT_URL)
    result: dict[str, Any] = {
        "provider": provider,
        "default": DEFAULT_MODELS[provider],
        "models": [],
        "recommended": [],
    }
    if provider in NEEDS_KEY and not key:
        result["error"] = "Paste this provider's API key to load its model list."
        return result
    cache_key = (provider, key[-8:], base_url)
    with _LOCK:
        cached = _CACHE.get(cache_key)
    if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        names = cached[1]
    else:
        names = sorted({name for name in _fetch(provider, key, base_url) if name and not NOT_A_WRITER.search(name)}, key=str.lower)
        with _LOCK:
            _CACHE[cache_key] = (time.monotonic(), names)
    recommended = [name for name in RECOMMENDED.get(provider, ()) if name in names]
    result["recommended"] = recommended
    result["models"] = [name for name in names if name not in recommended]
    return result
