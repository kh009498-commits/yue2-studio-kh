"""Offline MCP contracts: no live app, provider calls, downloads, or GPU work."""
import importlib.util
import io
import json
from pathlib import Path
import sys
from unittest.mock import patch

import pytest

import main

MCP = Path(__file__).resolve().parents[2] / 'MCP'
sys.path.insert(0, str(MCP))
spec = importlib.util.spec_from_file_location('yue2_mcp_test_server', MCP / 'server.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

READY = {
    'service': {'online': True}, 'stems': {'ready': True}, 'lyrics_sync': {'ready': True},
    'cover_art': {'ready': True}, 'sheetsage': {'ready': True}, 'exports': {'ready': True},
    'sound_effects': {'ready': False, 'models': {'stable': {'ready': True}, 'woosh': {'ready': True}}},
}
JOB = {'job': {'id': 'original-job-id', 'owner_name': 'Codex', 'queue_position': 2}}


def backend(method, path, payload=None, **kwargs):
    if path == '/api/status':
        return READY
    if path == '/api/settings/lyric-preferences':
        return {'avoid': 'forbidden fixture phrase'}
    return JOB


def test_advanced_generation_maps_to_native_contract_and_keeps_job_identity():
    args = {'description': 'Japanese, jazz trio, warm alto', 'title': 'Lantern Boats',
            'lyrics': '[Verse]\nLantern boats drift home', 'album': 'Harbor', 'cot_mode': 'melody',
            'abc_score': 'X:1\nK:C\nC D E', 'voice_slots': {'female': 'voice-clear-alto'},
            'voice_snapshots': [{'id': 'voice-clear-alto', 'name': 'Clear alto'}],
            'lyrics_language': 'ja', 'english_translation': '[Verse]\nLantern boats drift home',
            'exclude_styles': 'distortion', 'vocal_gender': 'female', 'cfg': 1.2, 'top_k': 70,
            'temperature': 0.8, 'steps': 40, 'seed': 42}
    with patch.object(bridge, 'request', side_effect=backend) as request:
        result = bridge.call('generate_song', args)
    posts = [call for call in request.call_args_list if call.args[0] == 'POST']
    assert len(posts) == 1
    assert posts[0].args == ('POST', '/api/generate', args)
    native = main.GenerateRequest.model_validate(posts[0].args[2])
    assert native.cot_mode == 'melody' and native.abc_score == args['abc_score']
    assert result is JOB


def test_existing_minimal_generation_still_uses_backend_defaults():
    with patch.object(bridge, 'request', side_effect=backend) as request:
        bridge.call('generate_song', {'description': 'instrumental piano'})
    native = main.GenerateRequest.model_validate(request.call_args.args[2])
    assert native.steps == 32 and native.cot_mode == 'full' and native.top_k == 100


def test_advertised_payload_fields_match_actual_backend_models():
    assert set(bridge.GENERATE_PROPERTIES) == set(main.GenerateRequest.model_fields)
    assert set(bridge.EFFECT_PROPERTIES) - {'action', 'folder', 'effect_id'} == set(main.SoundEffectRequest.model_fields)
    assert set(bridge.MIX_PROPERTIES) - {'action', 'folder'} == set(main.StudioBounceRequest.model_fields)
    native = main.GenerateRequest.model_json_schema()['properties']
    for field in ('steps', 'cfg', 'top_k', 'temperature'):
        for bound in ('minimum', 'maximum'):
            assert bridge.GENERATE_PROPERTIES[field][bound] == native[field][bound]


@pytest.mark.parametrize('extra', [{'cot_mode': 'wrong'}, {'steps': True}, {'cfg': float('nan')},
                                  {'temperature': 6}, {'top_k': 0}, {'lyrics_language': 'j'},
                                  {'cot_mode': 'off', 'abc_score': 'X:1'}, {'provider': 'nvidia'}])
def test_bad_controls_fail_before_any_request(extra):
    with patch.object(bridge, 'request') as request, pytest.raises(ValueError):
        bridge.call('generate_song', {'description': 'piano', **extra})
    request.assert_not_called()


def test_live_lyric_bans_are_checked_before_submission():
    with patch.object(bridge, 'request', side_effect=backend) as request, pytest.raises(RuntimeError, match='banned'):
        bridge.call('generate_song', {'description': 'piano', 'title': 'forbidden fixture phrase'})
    assert all(call.args[0] == 'GET' for call in request.call_args_list)


def test_not_ready_does_not_submit_or_install():
    with patch.object(bridge, 'request', return_value={'service': {'online': False, 'detail': 'Not installed'}}) as request:
        with pytest.raises(RuntimeError, match='Not installed'):
            bridge.call('generate_song', {'description': 'piano'})
    request.assert_called_once_with('GET', '/api/status')


def test_submission_error_is_not_retried():
    def fail(method, path, payload=None, **kwargs):
        if method == 'POST':
            raise RuntimeError('Studio returned 409: fixture conflict')
        return backend(method, path, payload, **kwargs)
    with patch.object(bridge, 'request', side_effect=fail) as request, pytest.raises(RuntimeError, match='409'):
        bridge.call('generate_song', {'description': 'piano'})
    assert sum(call.args[0] == 'POST' for call in request.call_args_list) == 1


def test_get_song_preserves_submitted_score_and_adds_actual_planned_score():
    submitted = {'folder_name': 'Jazz/Sea Glass', 'abc_score': 'submitted', 'studio': {'tracks': []}}
    with patch.object(bridge, 'request', side_effect=[{'items': [submitted]}, {'abc': 'planned', 'has_score': True}]) as request:
        result = bridge.call('get_song', {'folder': 'Jazz/Sea Glass'})
    assert result['abc_score'] == 'submitted' and result['planned_abc_score'] == 'planned'
    assert request.call_args.args == ('GET', '/api/library/Jazz/Sea%20Glass/score')
    assert submitted.get('planned_abc_score') is None


@pytest.mark.parametrize('engine,steps,sampler', [('stable', 8, 'pingpong'), ('woosh', 32, 'dopri5')])
def test_effect_engine_has_working_defaults_and_own_readiness(engine, steps, sampler):
    with patch.object(bridge, 'request', side_effect=backend) as request:
        result = bridge.call('effects', {'action': 'generate', 'engine': engine, 'prompt': 'A wooden creak'})
    body = request.call_args.args[2]
    assert request.call_args.args[:2] == ('POST', '/api/effects/generate')
    parsed = main.SoundEffectRequest.model_validate(body)
    assert (parsed.engine, parsed.steps, parsed.sampler) == (engine, steps, sampler)
    assert result is JOB


@pytest.mark.parametrize('extra', [{'engine': 'woosh', 'duration': 6}, {'engine': 'woosh', 'sampler': 'pingpong'},
                                  {'engine': 'stable', 'sampler': 'dopri5'}, {'negative_prompt': 'speech'}])
def test_invalid_effect_combinations_never_queue(extra):
    with patch.object(bridge, 'request') as request, pytest.raises(ValueError):
        bridge.call('effects', {'action': 'generate', 'prompt': 'A creak', **extra})
    request.assert_not_called()


def test_studio_effect_generation_and_existing_effect_add_use_native_routes():
    with patch.object(bridge, 'request', side_effect=backend) as request:
        bridge.call('effects', {'action': 'generate', 'prompt': 'Metal creak', 'folder': 'Folk/Sea Glass',
                                'engine': 'woosh', 'sampler': 'euler', 'seed': 7, 'negative_prompt': 'speech'})
    assert request.call_args.args[1] == '/api/library/Folk/Sea%20Glass/studio/generate-sfx'
    assert request.call_args.args[2]['negative_prompt'] == 'speech'
    with patch.object(bridge, 'request', return_value={'file': 'fixture.wav'}) as request:
        bridge.call('effects', {'action': 'add_to_studio', 'folder': 'Folk/Sea Glass', 'effect_id': 'rain?one'})
    request.assert_called_once_with('POST', '/api/effects/rain%3Fone/add-to-studio/Folk/Sea%20Glass')


@pytest.mark.parametrize('tool,args,suffix,body', [
    ('extract_stems', {'mode': '4'}, 'stems', {'mode': '4'}),
    ('synchronize_lyrics', {}, 'lyrics-sync', None),
    ('regenerate_cover', {'direction': 'Moonlit harbor'}, 'cover', {'direction': 'Moonlit harbor'}),
    ('transcribe_cover', {'melody_only': False, 'reuse_cached': False}, 'cover-transcribe', {'melody_only': False, 'reuse_cached': False}),
])
def test_new_job_adapters_preserve_body_path_and_job(tool, args, suffix, body):
    with patch.object(bridge, 'request', side_effect=backend) as request:
        assert bridge.call(tool, {'folder': 'Jazz/Sea Glass', **args}) is JOB
    assert request.call_args.args == ('POST', f'/api/library/Jazz/Sea%20Glass/{suffix}', body)


def test_mix_and_export_are_synchronous_and_use_explicit_track_state():
    track = {'name': 'song.wav', 'gain': 0.7, 'use_clips': True,
             'clips': [{'id': 'clip-1', 'start': 0, 'source_in': 1, 'source_out': 4, 'gain_left': 0.8}],
             'effects': [{'id': 'effect-1', 'start': 0, 'end': 3, 'kind': 'limiter', 'amount': 0.4}]}
    args = {'action': 'bounce', 'folder': 'Jazz/Sea Glass', 'tracks': [track],
            'variant': 'custom', 'selection': {'start': 0, 'end': 3}, 'content_end': 3}
    with patch.object(bridge, 'request', side_effect=backend) as request:
        bridge.call('studio_mix', args)
    native = main.StudioBounceRequest.model_validate(request.call_args.args[2])
    assert native.selection.end == 3 and native.tracks[0].clips[0].source_in == 1
    assert request.call_args.args[:2] == ('POST', '/api/library/Jazz/Sea%20Glass/studio/bounce')
    assert request.call_args.kwargs == {'timeout': 600}
    with patch.object(bridge, 'request', return_value={'saved': True}) as request:
        bridge.call('studio_mix', {'action': 'save', 'folder': 'Jazz/Sea Glass', 'tracks': [track]})
    request.assert_called_once_with('PATCH', '/api/library/Jazz/Sea%20Glass/studio', {'tracks': [track]})
    with patch.object(bridge, 'request', side_effect=backend) as request:
        bridge.call('export_audio', {'folder': 'Jazz/Sea Glass', 'format': 'flac'})
    request.assert_called_with('POST', '/api/library/Jazz/Sea%20Glass/export/flac', timeout=600)


@pytest.mark.parametrize('extra', [{'tracks': [{'name': 'song.wav', 'cuts': [{'start': 4, 'end': 3}]}]},
                                  {'tracks': [{'name': 'song.wav', 'clips': [{'source_in': 4, 'source_out': 2}]}]},
                                  {'tracks': [{'name': 'song.wav', 'gain': 2}]}, {'tracks': [{'name': ''}]},
                                  {'selection': {'start': 3, 'end': 2}}])
def test_invalid_mix_ranges_never_mutate(extra):
    with patch.object(bridge, 'request') as request, pytest.raises(ValueError):
        bridge.call('studio_mix', {'action': 'bounce', 'folder': 'Jazz/Sea Glass', 'tracks': [], **extra})
    request.assert_not_called()


def test_attribute_urls_are_encoded_and_no_credentials_are_added():
    response = io.BytesIO(json.dumps(JOB).encode())
    with patch.object(bridge, 'AGENT_NAME', 'Codex'), patch.object(bridge.urllib.request, 'urlopen', return_value=response) as opened:
        assert bridge.request('POST', '/api/generate', {'description': 'piano'}) == JOB
    req = opened.call_args.args[0]
    assert 'studio_client=mcp-codex' in req.full_url and 'studio_name=Codex' in req.full_url
    assert req.get_header('Authorization') is None


def test_protocol_lists_exact_schemas_and_version_without_live_requests():
    incoming = io.StringIO('\n'.join(json.dumps(item) for item in [
        {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
        {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
    ]))
    outgoing = io.StringIO()
    with patch.object(bridge.sys, 'stdin', incoming), patch.object(bridge.sys, 'stdout', outgoing), \
         patch.object(bridge, 'start_heartbeat'), patch.object(bridge, 'stop_heartbeat'), patch.object(bridge, 'request') as request:
        bridge.main()
    messages = [json.loads(line) for line in outgoing.getvalue().splitlines()]
    assert messages[0]['result']['serverInfo']['version'] == '1.1.0'
    assert messages[1]['result']['tools'] == bridge.tool_specs()
    assert len(bridge.tool_specs()) == 19
    assert not any('key' in item['name'] or 'install' in item['name'] for item in bridge.tool_specs())
    request.assert_not_called()
