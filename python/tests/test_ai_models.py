"""Keys → Writing model dropdown: live provider lists, filtered to song writers."""
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import log_buffer
with patch.object(log_buffer, "install"):
    import main
import ai_models
from fastapi.testclient import TestClient

NVIDIA_IDS = [
    "openai/gpt-oss-20b", "nvidia/nemotron-3.5-lightning-30b-a3b",
    "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3", "z-ai/glm-5.3-flash", "moonshotai/kimi-k3",
    "nvidia/nv-embedqa-mistral-7b-v2", "meta/llama-guard-4-12b", "bigcode/starcoder2-15b",
    "nvidia/nvclip", "google/deplot", "nvidia/nemotron-4-340b-reward", "mistralai/mistral-large",
]


def fake_get_json(url, headers, timeout=20):
    return {"data": [{"id": name} for name in NVIDIA_IDS]}


def setup_function():
    ai_models._CACHE.clear()


def test_nvidia_list_hides_non_writers_and_puts_song_models_first():
    with patch.object(ai_models, "_get_json", side_effect=fake_get_json), \
         patch.object(ai_models.ai_vault, "load", return_value={"providers": {}}):
        result = ai_models.list_models("nvidia")
    assert result["recommended"] == ["openai/gpt-oss-20b", "nvidia/nemotron-3.5-lightning-30b-a3b", "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3-flash", "z-ai/glm-5.3", "moonshotai/kimi-k3"]
    assert result["models"] == ["mistralai/mistral-large"]
    assert result["default"] == "openai/gpt-oss-20b"


def test_key_providers_ask_for_a_key_instead_of_calling_out():
    with patch.object(ai_models, "_get_json") as fetch, \
         patch.object(ai_models.ai_vault, "load", return_value={"providers": {}}):
        result = ai_models.list_models("openai")
    fetch.assert_not_called()
    assert "API key" in result["error"]


def test_typed_key_is_used_but_never_returned():
    seen = {}
    def capture(url, headers, timeout=20):
        seen.update(headers); return {"data": [{"id": "gpt-4.1-mini"}, {"id": "whisper-1"}, {"id": "dall-e-3"}]}
    with patch.object(ai_models, "_get_json", side_effect=capture), \
         patch.object(ai_models.ai_vault, "load", return_value={"providers": {}}):
        response = TestClient(main.app).post("/api/settings/ai-models", json={"provider": "openai", "key": "sk-secret-typed-key"})
    assert response.status_code == 200
    assert seen["Authorization"] == "Bearer sk-secret-typed-key"
    assert "sk-secret" not in response.text
    assert response.json()["models"] == ["gpt-4.1-mini"]


def test_provider_errors_come_back_as_a_message_not_a_crash():
    with patch.object(ai_models, "_get_json", side_effect=RuntimeError("The provider rejected this API key. Check it and try again.")), \
         patch.object(ai_models.ai_vault, "load", return_value={"providers": {}}):
        response = TestClient(main.app).post("/api/settings/ai-models", json={"provider": "nvidia"})
    assert response.status_code == 200
    assert response.json()["error"].startswith("The provider rejected")


def test_default_nvidia_model_is_no_longer_the_retired_minimax():
    import ai_assist, inspect
    assert "minimaxai/minimax-m3\"" not in inspect.getsource(ai_assist._openai_compat)
