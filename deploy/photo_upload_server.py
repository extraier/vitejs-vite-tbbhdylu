#!/usr/bin/env python3
"""
Photo upload server for Save The Day 囍程.

Replaces Firebase Storage for guest photo uploads (cheaper, owner-controlled).

Routes:
  POST /upload   multipart/form-data with fields:
                   file:       the image (image/jpeg, image/png, image/webp)
                   eventId:    Firestore event id
                   guestId:    guest id (random 6-char string)
                   uploaderName:  display name
                 → 200 { "url": "https://ugreen-nas.tail20bf1.ts.net/photos/<event>/<guest>/<file>"}
  GET  /photos/<path>   serves the uploaded file
  GET  /health          200 ok (used by Funnel + watchdog)

Bind: 127.0.0.1:9879  (Tailscale Funnel proxies from ugreen-nas.tail20bf1.ts.net)

Run:  /usr/bin/python3 /home/openclaw/bin/photo_upload_server.py
Watchdog: /home/openclaw/bin/ts-autostart.sh supervises via PID file
"""
import json
import os
import re
import secrets
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ---- Config (overridable via env) ----
BIND = os.environ.get("PHOTO_BIND", "127.0.0.1")
PORT = int(os.environ.get("PHOTO_PORT", "9879"))
# Where uploaded photos are stored on disk.
STORAGE_ROOT = Path(os.environ.get("PHOTO_ROOT", "/volume1/flight-scanner/wedding-photos"))
# Public origin (Tailscale Funnel hostname) — used to build returned URLs.
PUBLIC_ORIGIN = os.environ.get(
    "PHOTO_PUBLIC_ORIGIN", "https://ugreen-nas.tail20bf1.ts.net"
)
# Cap each upload at 20 MB to keep phone-videos-of-the-aisle from blowing the disk.
MAX_BYTES = int(os.environ.get("PHOTO_MAX_BYTES", str(20 * 1024 * 1024)))
# Allowed mime types
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
# Filename component guard — eventId and guestId should be short alphanumeric, but
# accept anything that matches a safe pattern; reject ../, \x00, etc.
SAFE_ID = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")

# Allow unit-testing the parser on a dev machine where /volume1 may not exist.
# The production server runs on the NAS where /volume1 is writable.
try:
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
except (OSError, PermissionError):
    pass


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


class PhotoHandler(BaseHTTPRequestHandler):
    # Silence the default per-request stderr access log; we log manually.
    def log_message(self, format, *args):  # noqa: A002 — match base class signature
        log(f"{self.command} {self.path}  {' '.join(args)}")

    # -------- helpers --------
    def _send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, code, body, content_type, max_age=86400):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", f"public, max-age={max_age}")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, code, msg):
        self._send_json(code, {"error": msg})

    # -------- routing --------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type, X-Guest-Token"
        )
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health" or self.path == "/upload/health":
            return self._send_json(200, {"ok": True, "root": str(STORAGE_ROOT)})

        # Tailscale Funnel strips the --set-path prefix before forwarding.
        # Both /photos/<event>/<guest>/<file> and the stripped /<event>/<guest>/<file>
        # reach this handler. Treat either as a photo request.
        path = self.path
        if path.startswith("/photos/"):
            rel = path[len("/photos/"):]
        elif path.startswith("/upload/"):
            return self._send_error(404, f"unknown GET route {self.path}")
        else:
            # Funnel-stripped variant: /<event>/<guest>/<file>
            rel = path.lstrip("/")
        return self._serve_photo(rel)

    def do_POST(self):
        # Funnel strips the --set-path prefix for POSTs too, so accept both.
        if self.path not in ("/upload", "/"):
            return self._send_error(404, f"unknown POST route {self.path}")
        return self._handle_upload()

    # -------- implementations --------
    def _serve_photo(self, rel):
        # Path normalization — strip query string if present
        rel = rel.split("?", 1)[0].split("#", 1)[0]
        # Strip leading slashes, reject traversal
        rel = rel.lstrip("/")
        if ".." in rel or rel.startswith("/"):
            return self._send_error(400, "bad path")
        target = (STORAGE_ROOT / rel).resolve()
        try:
            target.relative_to(STORAGE_ROOT.resolve())
        except ValueError:
            return self._send_error(400, "escapes storage root")
        if not target.is_file():
            return self._send_error(404, "not found")
        # Pick a content type from the extension
        ext = target.suffix.lower()
        ctype = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".heic": "image/heic",
            ".heif": "image/heif",
        }.get(ext, "application/octet-stream")
        try:
            body = target.read_bytes()
        except OSError as e:
            return self._send_error(500, f"read error: {e}")
        # 1-year cache: phone uploads are immutable; key includes timestamp + nonce.
        self._send_bytes(200, body, ctype, max_age=31536000)

    def _handle_upload(self):
        ctype = self.headers.get("Content-Type", "")
        if not ctype.startswith("multipart/form-data"):
            return self._send_error(400, "expected multipart/form-data")
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return self._send_error(400, "empty body")
        if length > MAX_BYTES:
            return self._send_error(413, f"too large (max {MAX_BYTES} bytes)")

        raw = self.rfile.read(length)
        try:
            fields, files = parse_multipart(ctype.encode("ascii"), raw)
        except ValueError as e:
            return self._send_error(400, f"bad multipart: {e}")

        # Required fields
        try:
            event_id = fields["eventId"]
            guest_id = fields["guestId"]
        except KeyError:
            return self._send_error(400, "missing eventId or guestId")
        uploader_name = fields.get("uploaderName", "Anonymous")

        # Validate id shape (defense in depth — the URL params already filter)
        if not (SAFE_ID.match(event_id) and SAFE_ID.match(guest_id)):
            return self._send_error(400, "bad eventId/guestId")

        # File part
        if "file" not in files:
            return self._send_error(400, "missing file part")
        f = files["file"]
        if f["content_type"] not in ALLOWED_TYPES:
            return self._send_error(
                415, f"unsupported type {f['content_type']}"
            )
        if not f["data"]:
            return self._send_error(400, "empty file")

        # Pick extension from original filename, fall back to content-type
        orig = f.get("filename", "")
        ext = Path(orig).suffix.lower() if orig else ""
        if not ext:
            ext = {
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/webp": ".webp",
                "image/heic": ".heic",
                "image/heif": ".heif",
            }.get(f["content_type"], ".bin")

        # Final disk layout: /volume1/wedding-app/photos/<event>/<guest>/<ts>_<nonce>.<ext>
        ts = int(time.time() * 1000)
        nonce = secrets.token_urlsafe(4)
        filename = f"{ts}_{nonce}{ext}"
        dest_dir = STORAGE_ROOT / event_id / guest_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / filename

        # Atomic write: tmp then rename, so partial writes don't leak
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        try:
            tmp.write_bytes(f["data"])
            os.replace(tmp, dest)
        except OSError as e:
            log(f"write error: {e}")
            return self._send_error(500, "disk write failed")

        url = f"{PUBLIC_ORIGIN}/photos/{event_id}/{guest_id}/{filename}"
        log(f"saved {len(f['data'])} bytes -> {dest} ({uploader_name})")
        return self._send_json(200, {"url": url, "bytes": len(f["data"])})


# ---- Minimal multipart/form-data parser (stdlib-only) ----
def parse_multipart(content_type_header: bytes, body: bytes):
    """
    Returns (fields: dict[str,str], files: dict[str,{filename,content_type,data}]).

    Supports one Content-Type per part. Streams the body linearly. Memory-efficient
    enough for the 20 MB upload cap.
    """
    # Extract boundary
    m = re.search(rb'boundary=("([^"]+)"|([A-Za-z0-9_+\-./]+))', content_type_header)
    if not m:
        raise ValueError("no boundary")
    boundary = m.group(2) or m.group(3)
    delim = b"--" + boundary
    close = b"--" + boundary + b"--"

    fields = {}
    files = {}

    pos = 0
    # Walk parts
    while True:
        a = body.find(delim, pos)
        if a < 0:
            break
        # Skip past delimiter + CRLF (or LF)
        start = a + len(delim)
        if body[start:start + 2] == b"--":
            # closing boundary
            break
        if body[start:start + 2] == b"\r\n":
            start += 2
        elif body[start:start + 1] == b"\n":
            start += 1
        else:
            # malformed
            raise ValueError("expected CRLF after boundary")

        # Find next boundary
        b = body.find(delim, start)
        if b < 0:
            break
        part = body[start:b]
        # Strip trailing CRLF before delimiter
        if part.endswith(b"\r\n"):
            part = part[:-2]
        elif part.endswith(b"\n"):
            part = part[:-1]

        # Split headers / body
        sep = part.find(b"\r\n\r\n")
        if sep < 0:
            sep = part.find(b"\n\n")
            hdrs_raw = part[:sep]
            data = part[sep + 2:]
        else:
            hdrs_raw = part[:sep]
            data = part[sep + 4:]

        # Parse Content-Disposition
        cd = re.search(rb'name="([^"]+)"(?:;\s*filename="([^"]*)")?', hdrs_raw)
        if not cd:
            raise ValueError("missing Content-Disposition")
        name = cd.group(1).decode("utf-8", "replace")
        filename = cd.group(2).decode("utf-8", "replace") if cd.group(2) else None

        ct_m = re.search(rb'Content-Type:\s*([^\r\n;]+)', hdrs_raw, re.IGNORECASE)
        content_type = (
            ct_m.group(1).decode("utf-8", "strip").strip() if ct_m else "text/plain"
        )

        if filename is not None:
            files[name] = {
                "filename": filename,
                "content_type": content_type,
                "data": data,
            }
        else:
            fields[name] = data.decode("utf-8", "replace")

        pos = b

    return fields, files


def main():
    server = ThreadingHTTPServer((BIND, PORT), PhotoHandler)
    log(
        f"photo upload server listening on http://{BIND}:{PORT}  "
        f"root={STORAGE_ROOT}  public={PUBLIC_ORIGIN}"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
