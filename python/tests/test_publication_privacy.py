"""Publication audits reject credentials without returning their values."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


def run(*args, cwd):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


@pytest.mark.parametrize('provider', ['gemini', 'nvidia', 'openai', 'anthropic', 'groq', 'xai'])
def test_git_audit_catches_each_saved_provider_key_without_disclosing_it(tmp_path, provider):
    assert run('git', 'init', '-q', cwd=tmp_path).returncode == 0
    vault = tmp_path / 'outputs/settings/api-keys.json'
    vault.parent.mkdir(parents=True)
    secret = f'fixture-only-{provider}-credential-value'
    vault.write_text(json.dumps({'providers': {provider: {'key': secret}}}), encoding='utf-8')
    staged = tmp_path / 'example.txt'
    staged.write_text(secret, encoding='utf-8')
    assert run('git', 'add', 'example.txt', cwd=tmp_path).returncode == 0
    result = run(sys.executable, str(ROOT / 'scripts/audit_git_privacy.py'), '--staged', cwd=tmp_path)
    assert result.returncode == 1
    assert 'example.txt' in result.stdout
    assert secret not in result.stdout + result.stderr
    staged.write_text('public content', encoding='utf-8')
    assert run('git', 'add', 'example.txt', cwd=tmp_path).returncode == 0
    result = run(sys.executable, str(ROOT / 'scripts/audit_git_privacy.py'), '--staged', cwd=tmp_path)
    assert result.returncode == 0


def test_git_audit_rejects_private_paths_without_key_values(tmp_path):
    assert run('git', 'init', '-q', cwd=tmp_path).returncode == 0
    (tmp_path / '.env.local').write_text('CONFIG=fixture', encoding='utf-8')
    assert run('git', 'add', '.env.local', cwd=tmp_path).returncode == 0
    result = run(sys.executable, str(ROOT / 'scripts/audit_git_privacy.py'), '--staged', cwd=tmp_path)
    assert result.returncode == 1
    assert '.env.local' in result.stdout


def test_installer_audit_catches_non_gemini_key_in_binary(tmp_path):
    pwsh = shutil.which('pwsh')
    if not pwsh:
        pytest.skip('PowerShell installer audit requires pwsh')
    scripts = tmp_path / 'scripts'
    scripts.mkdir()
    shutil.copyfile(ROOT / 'scripts/audit-installer.ps1', scripts / 'audit-installer.ps1')
    vault = tmp_path / 'outputs/settings/api-keys.json'
    vault.parent.mkdir(parents=True)
    secret = 'fixture-only-nvidia-private-value'
    vault.write_text(json.dumps({'providers': {'nvidia': {'key': secret}}}), encoding='utf-8')
    payload = tmp_path / 'payload'
    payload.mkdir()
    (payload / 'public.bin').write_bytes(b'\x00binary:' + secret.encode() + b'\x00')
    result = run(pwsh, '-NoProfile', '-File', str(scripts / 'audit-installer.ps1'), '-Payload', str(payload), cwd=tmp_path)
    assert result.returncode != 0
    assert 'Private credential found' in result.stderr
    assert secret not in result.stdout + result.stderr
    (payload / 'public.bin').write_bytes(b'\x00public\x00')
    result = run(pwsh, '-NoProfile', '-File', str(scripts / 'audit-installer.ps1'), '-Payload', str(payload), cwd=tmp_path)
    assert result.returncode == 0
