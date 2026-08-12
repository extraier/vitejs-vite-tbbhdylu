#!/usr/bin/env python3
"""
migrate_legacy_task_chats.py
============================
Migrate task-related subcollections from the legacy
/users/{ownerUid}/tasks/{taskId}/{comments|statusUpdates} location to
the event-scoped canonical location
/users/{ownerUid}/events/{eventId}/tasks/{taskId}/{comments|statusUpdates}.

Run AFTER the frontend patches (TaskActivityTimeline, TaskComments,
App.jsx handleUpdateAssignedTaskStatus, HelperDashboard queries +
status writer) have been deployed. Without the new code, the canonical
path is empty and these writes are orphans.

The script is idempotent: it skips any destination doc that already
exists (compared by id) so re-running it after a partial completion
will not duplicate messages.

Usage:
    export FIREBASE_SA=/path/to/savetheday-2377a.json
    python3 scripts/migrate_legacy_task_chats.py [--dry-run]

The script prints a summary table at the end. Review it before
re-running without --dry-run.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import google.auth.transport.requests
from google.oauth2 import service_account

PROJECT_ID = "savetheday-2377a"
APP_ID = "savetheday-production"
DATABASE_ID = "(default)"
BASE_URL = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
    f"/databases/{DATABASE_ID}/documents"
)
SCOPES = ["https://www.googleapis.com/auth/datastore"]


def get_token(sa_path: str) -> tuple[str, str]:
    creds = service_account.Credentials.from_service_account_file(sa_path, scopes=SCOPES)
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token, creds.project_id


def firestore_get(token: str, path: str) -> dict:
    """GET a document or collection. Returns parsed JSON or {error: str}."""
    url = f"{BASE_URL}/{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        if e.code == 404:
            return {"documents": []}
        return {"error": body[:1000]}


def firestore_post(token: str, path: str, body: dict) -> dict:
    """POST a new document to a collection. Path is the collection path."""
    url = f"{BASE_URL}/{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": body[:1000]}


def list_all_users(token: str) -> list[str]:
    out = []
    next_token = None
    while True:
        url = f"{BASE_URL}/artifacts/{APP_ID}/users?pageSize=200"
        if next_token:
            url += f"&pageToken={next_token}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        out.extend(d["name"].split("/")[-1] for d in data.get("documents", []))
        next_token = data.get("nextPageToken")
        if not next_token:
            break
    return out


def find_legacy_tasks(token: str, owner_uid: str) -> list[dict]:
    """Return [{taskId, eventId, doc}] for legacy /users/{uid}/tasks/ docs
    that have a non-null eventId field."""
    tasks = firestore_get(token, f"artifacts/{APP_ID}/users/{owner_uid}/tasks")
    if "documents" not in tasks:
        return []
    out = []
    for d in tasks["documents"]:
        tid = d["name"].split("/")[-1]
        fields = d.get("fields", {})
        eid_field = fields.get("eventId", {})
        eid = eid_field.get("stringValue") if isinstance(eid_field, dict) else None
        if not eid:
            continue
        out.append({"taskId": tid, "eventId": eid, "doc": d})
    return out


def list_subcollection(token: str, owner_uid: str, kind: str, task_id: str,
                       event_id: str | None = None) -> list[dict]:
    """List docs in a subcollection. kind in ('legacy', 'canonical').
    Returns [{id, fields}]."""
    if kind == "legacy":
        path = f"artifacts/{APP_ID}/users/{owner_uid}/tasks/{task_id}/comments"
    elif kind == "canonical":
        path = (
            f"artifacts/{APP_ID}/users/{owner_uid}/events/{event_id}"
            f"/tasks/{task_id}/comments"
        )
    elif kind == "legacy_status":
        path = f"artifacts/{APP_ID}/users/{owner_uid}/tasks/{task_id}/statusUpdates"
    elif kind == "canonical_status":
        path = (
            f"artifacts/{APP_ID}/users/{owner_uid}/events/{event_id}"
            f"/tasks/{task_id}/statusUpdates"
        )
    else:
        raise ValueError(kind)
    out = []
    next_token = None
    while True:
        url = f"{BASE_URL}/{path}?pageSize=200"
        if next_token:
            url += f"&pageToken={next_token}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        for d in data.get("documents", []):
            out.append({"id": d["name"].split("/")[-1], "fields": d.get("fields", {})})
        next_token = data.get("nextPageToken")
        if not next_token:
            break
    return out


def migrate(token: str, dry_run: bool) -> dict:
    users = list_all_users(token)
    summary = {
        "users_scanned": len(users),
        "tasks_with_eventId": 0,
        "comments_migrated": 0,
        "comments_skipped_existing": 0,
        "status_updates_migrated": 0,
        "status_updates_skipped_existing": 0,
        "errors": [],
    }

    for uid in users:
        legacy = find_legacy_tasks(token, uid)
        if not legacy:
            continue
        summary["tasks_with_eventId"] += len(legacy)
        for t in legacy:
            tid, eid = t["taskId"], t["eventId"]

            # Comments
            for comment in list_subcollection(token, uid, "legacy", tid):
                cid = comment["id"]
                existing = list_subcollection(token, uid, "canonical", tid, eid)
                if any(c["id"] == cid for c in existing):
                    summary["comments_skipped_existing"] += 1
                    continue
                fields = comment["fields"]
                # Add eventId to the body if missing
                fields = dict(fields)
                fields["eventId"] = {"stringValue": eid}
                if dry_run:
                    print(f"[DRY-RUN] POST comment {cid} → /events/{eid}/tasks/{tid}/comments")
                else:
                    res = firestore_post(
                        token,
                        f"artifacts/{APP_ID}/users/{uid}/events/{eid}/tasks/{tid}/comments",
                        {"fields": fields},
                    )
                    if "error" in res:
                        summary["errors"].append({
                            "kind": "comment", "uid": uid, "taskId": tid,
                            "commentId": cid, "error": res["error"][:200],
                        })
                        continue
                    summary["comments_migrated"] += 1
                    time.sleep(0.05)

            # Status updates
            for st in list_subcollection(token, uid, "legacy_status", tid):
                sid = st["id"]
                existing = list_subcollection(token, uid, "canonical_status", tid, eid)
                if any(c["id"] == sid for c in existing):
                    summary["status_updates_skipped_existing"] += 1
                    continue
                fields = st["fields"]
                fields = dict(fields)
                fields["eventId"] = {"stringValue": eid}
                if dry_run:
                    print(f"[DRY-RUN] POST statusUpdate {sid} → /events/{eid}/tasks/{tid}/statusUpdates")
                else:
                    res = firestore_post(
                        token,
                        f"artifacts/{APP_ID}/users/{uid}/events/{eid}/tasks/{tid}/statusUpdates",
                        {"fields": fields},
                    )
                    if "error" in res:
                        summary["errors"].append({
                            "kind": "statusUpdate", "uid": uid, "taskId": tid,
                            "updateId": sid, "error": res["error"][:200],
                        })
                        continue
                    summary["status_updates_migrated"] += 1
                    time.sleep(0.05)

    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Walk the data and print what would be written, but do not POST.",
    )
    parser.add_argument(
        "--sa",
        default=os.environ.get("FIREBASE_SA"),
        help="Path to Firebase service account JSON (default: $FIREBASE_SA).",
    )
    args = parser.parse_args()
    if not args.sa:
        sys.exit("ERROR: pass --sa or set FIREBASE_SA env var")
    token, project = get_token(args.sa)
    assert project == PROJECT_ID, f"SA is for {project!r}, expected {PROJECT_ID!r}"
    print(f"Project: {PROJECT_ID}")
    print(f"App ID:   {APP_ID}")
    print(f"Dry-run:  {args.dry_run}")
    print()

    summary = migrate(token, args.dry_run)

    print()
    print("=== Migration summary ===")
    for k, v in summary.items():
        if k == "errors":
            continue
        print(f"  {k}: {v}")
    if summary["errors"]:
        print()
        print(f"  errors: {len(summary['errors'])}")
        for e in summary["errors"][:10]:
            print(f"    {e}")
    return 0 if not summary["errors"] else 1


if __name__ == "__main__":
    sys.exit(main())