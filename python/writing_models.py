"""Shared defaults for text writing; audio is always rendered by YuE2."""

DEFAULT_MODELS = {
    "gemini": "gemini-3.6-flash",
    "xai": "grok-3",
    "groq": "llama-3.3-70b-versatile",
    "openai": "gpt-4.1-mini",
    "anthropic": "claude-sonnet-4-5",
    "nvidia": "deepseek-ai/deepseek-v4.1-flash",
    "ollama": "gemma3:4b",
}


def normalize_writing_model(provider: str, model: str) -> str:
    """Repair blank and known inherited defaults while preserving custom IDs."""
    model = model.strip()
    default = DEFAULT_MODELS[provider]
    if not model:
        return default
    if provider == "gemini" and model in {"gemini-2.5-flash", "gemini-3.5-flash"}:
        return default
    if provider == "nvidia" and model == "minimaxai/minimax-m3":
        return default
    if model != default and model in DEFAULT_MODELS.values():
        return default
    return model
