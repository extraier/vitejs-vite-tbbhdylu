#!/usr/bin/env python3
"""Seed the 6 stock invitation templates to Firebase Storage + Firestore.

Uses ONLY REST APIs (no firebase-admin / google-auth-library) — both had
issues with the gcloud ADC path. We mint an access token via `gcloud auth
print-access-token` and hit the Firestore + Storage REST endpoints directly.

Run: python3 functions/scripts/seed-default-templates.py
"""

import base64
import hashlib
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

APP_ID = 'savetheday-production'
PROJECT_ID = 'savetheday-2377a'
# Firebase Storage newer-style bucket (the legacy .appspot.com one was
# never created for this project). Public URL form: storage.googleapis.com/{bucket}/{path}
BUCKET_NAME = f'{PROJECT_ID}.firebasestorage.app'

# Each entry: (templateId, label, sourceFilename, palette, layout)
TEMPLATES = [
    ('plain',       '簡約純白', 'plain.svg',    {'bg': '#ffffff', 'text': '#1e293b', 'accent': '#e11d48', 'muted': '#64748b'}, 'centered'),
    ('tpl-rose',    '玫瑰金邊', 'rose.svg',     {'bg': '#fff1f2', 'text': '#881337', 'accent': '#e11d48', 'muted': '#9f1239'}, 'ornate'),
    ('tpl-jade',    '翡翠中式', 'jade.svg',     {'bg': '#ecfdf5', 'text': '#064e3b', 'accent': '#047857', 'muted': '#065f46'}, 'stacked'),
    ('tpl-midnight','深藍星夜', 'midnight.svg', {'bg': '#0f172a', 'text': '#f8fafc', 'accent': '#fbbf24', 'muted': '#cbd5e1'}, 'centered'),
    ('tpl-blush',   '裸粉花卉', 'blush.svg',    {'bg': '#fdf2f8', 'text': '#500724', 'accent': '#db2777', 'muted': '#831843'}, 'ornate'),
    ('tpl-sage',    '鼠尾草綠', 'sage.svg',     {'bg': '#f0fdf4', 'text': '#14532d', 'accent': '#16a34a', 'muted': '#166534'}, 'stacked'),
]


def get_access_token() -> str:
    return subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()


def http(method: str, url: str, token: str, body=None, content_type=None) -> dict:
    headers = {'Authorization': f'Bearer {token}'}
    data = None
    if body is not None:
        if isinstance(body, (dict, list)):
            data = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        else:
            data = body
            if content_type:
                headers['Content-Type'] = content_type
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else {}
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode(errors='replace')
        raise RuntimeError(f'{method} {url} → HTTP {e.code}: {body_txt[:500]}')


def upload_storage_object(token: str, path: str, data: bytes, content_type: str) -> dict:
    """Upload to Cloud Storage via the v1 JSON API (firebase storage v0 is dead).

    The Cloud Storage JSON API uses a media upload pattern:
      POST https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={path}
    Authorization can be Bearer (OAuth2 access token) for an admin/service-account.
    """
    enc = urllib.parse.quote(path, safe='/')
    url = f'https://storage.googleapis.com/upload/storage/v1/b/{BUCKET_NAME}/o?uploadType=media&name={enc}'
    req = urllib.request.Request(url, data=data, method='POST', headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': content_type,
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Storage upload {path} → HTTP {e.code}: {e.read().decode(errors="replace")[:300]}')


def make_public(token: str, path: str) -> bool:
    """Grant allUsers READ on the bucket via IAM. Works for Firebase
    Storage buckets where the legacy /acl/allUsers endpoint returns
    400 ("Invalid HTTP method/URL pair") and the v1 /acl POST returns
    404 (uniform bucket-level access).

    On first call we patch the bucket IAM to add allUsers →
    roles/storage.objectViewer. Subsequent calls for other objects are
    no-ops because the bucket-level grant covers them.
    """
    # Idempotent: only attempt the IAM patch once per process. The bucket
    # already has allUsers → objectViewer after the first call, so further
    # patches just succeed silently.
    if getattr(make_public, '_patched', False):
        return True
    url = f'https://storage.googleapis.com/storage/v1/b/{BUCKET_NAME}/iam'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req, timeout=15) as r:
        policy = json.loads(r.read())
    # Find or create the objectViewer binding.
    binding = next((b for b in policy.get('bindings', []) if b['role'] == 'roles/storage.objectViewer'), None)
    if binding and 'allUsers' in binding.get('members', []):
        make_public._patched = True
        return True
    if binding:
        binding.setdefault('members', []).append('allUsers')
    else:
        policy.setdefault('bindings', []).append({
            'role': 'roles/storage.objectViewer',
            'members': ['allUsers'],
        })
    req = urllib.request.Request(url, data=json.dumps(policy).encode(), method='PUT', headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
            make_public._patched = True
            print('    ✓ granted allUsers objectViewer on bucket')
            return True
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode(errors='replace')
        print(f'    WARN bucket IAM: {e.code} {body_txt[:200]}')
        return False


def firestore_set(token: str, doc_path: str, fields: dict) -> dict:
    """PATCH a Firestore doc via the v1 REST API. Converts JS-style values to
    Firestore's typed-value format.
    """
    url = f'https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{doc_path}'
    body = {'fields': {k: _to_firestore_value(v) for k, v in fields.items()}}
    return http('PATCH', url, token, body)


def firestore_get(token: str, doc_path: str) -> dict | None:
    url = f'https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{doc_path}'
    req = urllib.request.Request(url, method='GET', headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def _to_firestore_value(v):
    """Convert Python value → Firestore REST typed value."""
    if v is None:
        return {'nullValue': None}
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, int):
        return {'integerValue': str(v)}
    if isinstance(v, float):
        return {'doubleValue': v}
    if isinstance(v, str):
        return {'stringValue': v}
    if isinstance(v, dict):
        return {'mapValue': {'fields': {k: _to_firestore_value(val) for k, val in v.items()}}}
    if isinstance(v, list):
        return {'arrayValue': {'values': [_to_firestore_value(x) for x in v]}}
    if isinstance(v, _ServerTimestamp):
        return {'timestampValue': _now_iso()}  # pre-resolve so we don't need a separate update mask
    raise TypeError(f'Unsupported Firestore value type: {type(v).__name__}')


class _ServerTimestamp:
    pass


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def main():
    print(f'[seed] project={PROJECT_ID} bucket={BUCKET_NAME} appId={APP_ID}')
    token = get_access_token()
    print(f'[seed] token_len={len(token)}')

    repo_root = Path(__file__).resolve().parent.parent.parent
    source_dir = repo_root / 'public' / 'templates'
    print(f'[seed] source={source_dir}')

    uploaded = 0
    skipped = 0

    for tid, label, fname, palette, layout in TEMPLATES:
        local = source_dir / fname
        if not local.exists():
            print(f'  ⚠ {tid}: missing {local}')
            skipped += 1
            continue

        data = local.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        storage_path = f'invitation-templates/{tid}.svg'
        print(f'  {tid} ({label}) — {len(data)} bytes → {storage_path}')

        # 1. Storage upload.
        try:
            upload_storage_object(token, storage_path, data, 'image/svg+xml')
        except RuntimeError as e:
            if '401' in str(e) or '403' in str(e):
                token = get_access_token()
                upload_storage_object(token, storage_path, data, 'image/svg+xml')
            else:
                print(f'    ✗ upload failed: {e}')
                skipped += 1
                continue

        # 2. Public read.
        make_public(token, storage_path)

        # 3. Firestore doc.
        public_url = f'https://storage.googleapis.com/{BUCKET_NAME}/{storage_path}'
        doc_path = f'artifacts/{APP_ID}/templates/{tid}'
        try:
            firestore_set(token, doc_path, {
                'label': label,
                'palette': palette,
                'layout': layout,
                'storagePath': storage_path,
                'publicUrl': public_url,
                'bytes': len(data),
                'sha256': sha,
                'isPremium': False,
                'updatedAt': _ServerTimestamp(),
                'updatedBy': 'seed-script',
            })
        except Exception as e:
            print(f'    ✗ Firestore write failed: {e}')
            continue

        uploaded += 1
        print(f'    ✓')

    # 4. Cache-buster.
    try:
        firestore_set(token, f'artifacts/{APP_ID}/meta/templates',
                      {'updatedAt': _ServerTimestamp()})
        print('  ✓ cache-buster bumped')
    except Exception as e:
        print(f'  WARN: cache-buster: {e}')

    print(f'[seed] ✅ uploaded={uploaded} skipped={skipped}')


if __name__ == '__main__':
    main()