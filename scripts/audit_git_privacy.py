"""Audit tracked or staged Git blobs without printing credential values."""
import argparse
import json
import re
import subprocess
from pathlib import Path

def git(*args):
    return subprocess.check_output(['git', '--no-optional-locks', *args])

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--staged', action='store_true')
args = parser.parse_args()
root = Path(git('rev-parse', '--show-toplevel').decode().strip())
vault = root / 'outputs/settings/api-keys.json'
keys = []
if vault.is_file():
    data = json.loads(vault.read_text(encoding='utf-8'))
    keys = [str(entry.get('key') or '') for entry in data.get('providers', {}).values()]
    keys = [key.encode() for key in keys if key and key != 'ollama']
    del data
entries = git('ls-files', '--stage', '-z').split(b'\0')
changed = set(git('diff', '--cached', '--name-only', '-z').split(b'\0')) if args.staged else None
private_path = re.compile(r'(^|/)(outputs|settings|\.env(?:\.[^/]+)?)(/|$)|api-keys\.json$|(?:credentials|secrets?).*\.(?:json|txt|ya?ml|toml|ini|pem|p12)$', re.I)
known_token = re.compile(rb'AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|nvapi-[A-Za-z0-9_-]{30,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}')
failures = []
count = 0
for entry in entries:
    if not entry:
        continue
    metadata, path = entry.split(b'\t', 1)
    if changed is not None and path not in changed:
        continue
    name = path.decode('utf-8')
    blob = git('cat-file', 'blob', metadata.split()[1].decode())
    count += 1
    if private_path.search(name) or any(key in blob for key in keys) or known_token.search(blob):
        failures.append(name)
keys.clear()
if failures:
    print('Credential audit FAILED; blocked paths (values withheld):')
    for name in failures:
        print(name)
    raise SystemExit(1)
print(f'Credential audit passed: {count} Git blobs; no private paths, saved provider keys, or recognized tokens.')
