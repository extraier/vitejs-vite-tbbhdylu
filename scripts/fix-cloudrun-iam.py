#!/usr/bin/env python3
"""
scripts/fix-cloudrun-iam.py — Fix missing allUsers:roles/run.invoker IAM
bindings on every Firebase Functions Cloud Run service.

Why this exists (2026-07-15)
----------------------------
When you deploy Firebase Cloud Functions (Gen 2) via `firebase deploy
--only functions`, the Firebase CLI normally adds the public invoker
binding automatically so that browser-side callables can hit the
function with a Firebase ID token. SOMETIMES this binding gets dropped
(e.g. after deploying only one function, restoring from a backup, or
deploying through CI without proper service account permissions).

When the binding is missing, every callable returns a 401/403 error
that looks like an auth failure but is actually an IAM misconfiguration.
The browser-side error message is just "internal" — completely
unhelpful. This script adds the missing binding to ALL Cloud Run
services in the project.

Run with:
    python3 scripts/fix-cloudrun-iam.py [PROJECT_ID] [REGION]

Defaults:
    PROJECT_ID = savetheday-2377a
    REGION     = us-central1
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT_ID = sys.argv[1] if len(sys.argv) > 1 else 'savetheday-2377a'
REGION = sys.argv[2] if len(sys.argv) > 2 else 'us-central1'
RUN_BASE = 'https://run.googleapis.com/v2'
INVOKER_ROLE = 'roles/run.invoker'
ALL_USERS = 'allUsers'


def get_token():
    """Use the active gcloud account to print an access token."""
    result = subprocess.run(
        ['gcloud', 'auth', 'print-access-token'],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def list_services(token):
    """List all Cloud Run services in the region."""
    url = f'{RUN_BASE}/projects/{PROJECT_ID}/locations/{REGION}/services'
    req = urllib.request.Request(url, method='GET')
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Accept', 'application/json')
    resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read())
    return data.get('services', [])


def get_iam_policy(token, service_name):
    url = f'{RUN_BASE}/{service_name}:getIamPolicy'
    req = urllib.request.Request(url, method='GET')
    req.add_header('Authorization', f'Bearer {token}')
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read())


def set_iam_policy(token, service_name, policy):
    url = f'{RUN_BASE}/{service_name}:setIamPolicy'
    body = json.dumps({'policy': policy}).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read())


def has_invoker_binding(policy):
    return any(
        b.get('role') == INVOKER_ROLE and ALL_USERS in b.get('members', [])
        for b in policy.get('bindings', [])
    )


def main():
    token = get_token()
    print(f'Project: {PROJECT_ID} | Region: {REGION}')
    services = list_services(token)
    print(f'Found {len(services)} Cloud Run services.\n')

    fixed = 0
    ok = 0
    errors = 0
    for svc in services:
        name = svc['name'].split('/')[-1]
        try:
            policy = get_iam_policy(token, svc['name'])
            if has_invoker_binding(policy):
                print(f'  ✓ {name}: OK')
                ok += 1
                continue
            policy.setdefault('bindings', []).append(
                {'role': INVOKER_ROLE, 'members': [ALL_USERS]}
            )
            set_iam_policy(token, svc['name'], policy)
            print(f'  ✚ {name}: fixed (added allUsers → {INVOKER_ROLE})')
            fixed += 1
        except urllib.error.HTTPError as e:
            print(f'  ✗ {name}: HTTP {e.code} {e.reason}')
            errors += 1
        except Exception as e:
            print(f'  ✗ {name}: {e}')
            errors += 1

    print(f'\nSummary: {ok} already-OK, {fixed} fixed, {errors} errors')
    if errors:
        sys.exit(1)


if __name__ == '__main__':
    main()