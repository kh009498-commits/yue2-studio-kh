"""Provider changes and blank models must never silently select another provider."""
from pathlib import Path
from unittest.mock import patch

import pytest

import ai_assist
import ai_models
import ai_vault
from writing_models import DEFAULT_MODELS


@pytest.mark.parametrize('provider, expected', DEFAULT_MODELS.items())
def test_blank_saved_writer_uses_provider_default(provider, expected):
    result = ai_vault._normalize({'capabilities': {'writing': {'provider': provider, 'model': '  '}}})
    assert result['capabilities']['writing']['model'] == expected
    assert ai_models.DEFAULT_MODELS[provider] == expected


@pytest.mark.parametrize('model', ['', 'gemini-3.6-flash', 'minimaxai/minimax-m3'])
def test_nvidia_repaired_on_load_and_save(tmp_path, model):
    incoming = {'provider': 'nvidia', 'model': model, 'enabled': False}
    loaded = ai_vault._normalize({'capabilities': {'writing': incoming}})
    with patch.object(ai_vault, 'VAULT_PATH', tmp_path / 'api-keys.json'):
        saved = ai_vault.apply_update({'capabilities': {'writing': incoming}})
    assert loaded['capabilities']['writing']['model'] == DEFAULT_MODELS['nvidia']
    assert saved['capabilities']['writing']['model'] == DEFAULT_MODELS['nvidia']


def test_provider_switch_without_model_resets_and_custom_model_survives(tmp_path):
    with patch.object(ai_vault, 'VAULT_PATH', tmp_path / 'api-keys.json'):
        ai_vault.apply_update({'capabilities': {'writing': {'provider': 'gemini', 'model': 'custom-gemini'}}})
        switched = ai_vault.apply_update({'capabilities': {'writing': {'provider': 'nvidia'}}})
        assert switched['capabilities']['writing']['model'] == DEFAULT_MODELS['nvidia']
        custom = ai_vault.apply_update({'capabilities': {'writing': {'model': 'vendor/custom-writer'}}})
        assert custom['capabilities']['writing']['model'] == 'vendor/custom-writer'
        assert ai_vault.load()['capabilities']['writing']['model'] == 'vendor/custom-writer'


def test_nvidia_payload_uses_shared_default_without_fallback():
    with patch.object(ai_assist, '_http', return_value={'choices': [{'message': {'content': 'draft'}}]}) as call:
        assert ai_assist._openai_compat('nvidia', '', 'test-only', 'system', 'user') == 'draft'
    import json
    payload = json.loads(call.call_args.args[0].data)
    assert payload['model'] == DEFAULT_MODELS['nvidia']
    assert call.call_count == 1


def test_native_caption_endpoint_does_not_load_legacy_corpus():
    import main
    assert main.assist_caption_library() == {'available': False, 'families': 0, 'cards': 0, 'templates': 0}
    assert 'caption_library' not in main.__dict__
    assert 'caption_library' not in ai_assist.__dict__


def test_installer_excludes_legacy_inference_and_caption_corpus():
    root = Path(__file__).resolve().parents[2]
    script = (root / 'scripts/stage-installer.ps1').read_text(encoding='utf-8')
    assert "@('cover_art', 'video_studio')" in script
    assert "'^(music3_|caption_library\\.py$|_tmp_)'" in script
    assert "@('caption_library'," not in script
