"""Stable template metadata round-trip with a mocked engine and temp library."""
import json
from pathlib import Path
from unittest.mock import patch
import pytest
from pydantic import ValidationError
from jobs import Job
import main


@pytest.mark.parametrize('template_id', ['night-cloud-pads', '', 'custom-stable'])
def test_template_id_survives_generation_and_library(tmp_path, template_id):
    params = main.GenerateRequest(title='Quiet Test', description='Soft piano', genre='Gentle midnight piano',
                                  instrumental=True, template_id=template_id, seed=1).model_dump()
    def fake_engine(job, request, output):
        output.write_bytes(b'RIFF')
        return {'duration': 60, 'sample_rate': 44100}
    job = Job('mock-night-song', 'yue2', params)
    with patch.object(main, 'LIBRARY_ROOT', tmp_path), patch.object(main.yue2_engine, 'generate', side_effect=fake_engine), \
         patch.object(main.cover_art, 'available', return_value=False), patch.object(main.ai_assist, 'ensure_unique_title', side_effect=lambda title, **kw: title):
        result = main.generate(job)
        saved = json.loads((Path(result['folder']) / 'song.json').read_text(encoding='utf-8'))
        assert saved['template_id'] == template_id
        assert saved['genre'] == 'Gentle midnight piano'
        assert main.library()[0]['template_id'] == template_id


def test_template_id_bound():
    with pytest.raises(ValidationError):
        main.GenerateRequest(description='piano', template_id='x' * 241)
