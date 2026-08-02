#!/usr/bin/env python3
"""
Photo upload server for Save The Day.

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
import hmac
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# 2026-08-02 — Photo watermark (Option 1, default-on).
# Pillow is stdlib-adjacent on Debian/Ubuntu (python3-pil) and
# pre-installed on the UGREEN NAS. Lazy-import inside
# _apply_watermark() so a missing Pillow doesn't take down the
# upload server entirely — a broken watermark is preferable to
# a broken upload pipeline. PIL availability is checked at
# request time, not at module load.
try:
    from PIL import Image, ImageDraw, ImageFont  # noqa: F401
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

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
# 2026-08-02 — File types we ACTUALLY watermark. HEIC/HEIF are
# left as-is because Pillow's HEIC support requires libheif and
# the wheels aren't always available on the UGREEN NAS. Falling
# back to "skip HEIC, watermark everything else" is a graceful
# degradation. Couples who care about HEIC watermarks can
# convert before upload (most phones write JPEG + HEIC).
WATERMARK_TYPES = {"image/jpeg", "image/png", "image/webp"}
# Default-on watermark toggle. When the Vercel /api/photo-upload
# proxy forwards `X-Watermark-Disabled: true`, the watermark
# step is skipped. Anything else (missing header, "false",
# "no") → watermark on. This is the source of truth for the
# "watermark-removed" unlock — the proxy verifies the owner's
# HMAC-signed prefs token and only sets the header when the
# unlock exists.
WATERMARK_TEXT = os.environ.get(
    "PHOTO_WATERMARK_TEXT",
    "Save The Day · savetheday.io",
)
# Footer path for the brand font. DejaVu is pre-installed on
# the NAS (verified 2026-08-02 via `fc-list`). Falling back to
# Pillow's load_default() if missing so the watermark always
# renders, even on barebones installs.
WATERMARK_FONT_PATH = os.environ.get(
    "PHOTO_WATERMARK_FONT",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)
# Filename component guard — eventId and guestId should be short alphanumeric, but
# accept anything that matches a safe pattern; reject ../, \x00, etc.
SAFE_ID = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
# 2026-07-27 — HMAC verification. The shared secret is mirrored at
# /home/openclaw/.config/photo-upload/server_secret on the NAS itself
# (NOT in the public client bundle). The Vercel /api/photo-upload
# proxy mints X-Upload-Token headers on the user's behalf; this
# server validates them.
#
# Secret source priority (first non-empty wins):
#   1. PHOTO_HMAC_SECRET (legacy systemd EnvironmentFile=)
#   2. PHOTO_UPLOAD_SECRET / NAS_UPLOAD_SECRET (legacy aliases)
#   3. /home/openclaw/.config/photo-upload/server_secret — read
#      directly from disk so the watchdog's nohup invocation
#      doesn't need EnvironmentFile plumbing. This is the path
#      we hit in prod since the watchdog only exports PATH
#      and a handful of unrelated vars.
#   4. Empty string → fail closed (every upload returns 401
#      with reason "auth not configured").
def _load_hmac_secret():
    env = (
        os.environ.get("PHOTO_HMAC_SECRET")
        or os.environ.get("PHOTO_UPLOAD_SECRET")
        or os.environ.get("NAS_UPLOAD_SECRET")
    )
    if env:
        return env
    # File-path override — read once at startup. The file is
    # readable only by openclaw (mode 600), so this matches the
    # process's actual permission scope.
    secret_path = Path(
        os.environ.get(
            "PHOTO_HMAC_SECRET_FILE",
            "/home/openclaw/.config/photo-upload/server_secret",
        )
    )
    if secret_path.exists() and secret_path.is_file():
        try:
            return secret_path.read_text().strip()
        except (PermissionError, OSError) as exc:
            log(f"could not read {secret_path}: {exc}")
    return ""

PHOTO_HMAC_SECRET = _load_hmac_secret()
TOKEN_TTL_MS = int(os.environ.get("PHOTO_TOKEN_TTL_MS", str(5 * 60 * 1000)))  # 5 min default

# Allow unit-testing the parser on a dev machine where /volume1 may not exist.
# The production server runs on the NAS where /volume1 is writable.
try:
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
except (OSError, PermissionError):
    pass


# 2026-08-02 — Default-on watermark. Applied to every upload
# that lands on disk UNLESS the Vercel proxy forwards
# `X-Watermark-Disabled: true` (set only when the owner has the
# `watermark-removed` unlock AND the HMAC-signed prefs token
# verifies at the proxy). Returns True on success, False on
# any failure (logged). The caller treats False as "ship the
# original" — a broken watermark MUST NOT take down the upload.
def _apply_watermark(path, content_type):
    """Render a corner watermark onto the photo at `path`.

    Failure mode: returns False and logs the error. Caller
    continues with the original file (default-on watermark
    means the user gets a clean photo IF the watermark code
    breaks, which is the safer failure mode than failing
    the upload entirely).
    """
    if not _PIL_AVAILABLE:
        log("watermark: PIL not available, skipping")
        return False
    if content_type not in WATERMARK_TYPES:
        log(f"watermark: skipping {content_type} (not in WATERMARK_TYPES)")
        return False
    try:
        # Lazy import so the module-level _PIL_AVAILABLE check
        # gates it cleanly.
        from PIL import Image, ImageDraw, ImageFont

        # Open the freshly-saved file. Pillow is lazy about
        # decoding the pixels (until we draw on it), so even
        # 8 MP phone photos open in <100 ms.
        with Image.open(str(path)) as im:
            # Auto-orient based on EXIF (most phones set this).
            # If no EXIF or it's already correct, this is a no-op.
            im.load()
            im = ImageOps_compat_autorotate(im)

            # Render the watermark in the BOTTOM-RIGHT corner
            # with a semi-transparent dark band so it reads on
            # both light and dark photos.
            draw = ImageDraw.Draw(im, "RGBA")
            w, h = im.size
            # Font size scales with image width — keeps the
            # watermark readable on phone portraits (3-4 MP
            # ~ 2000px wide) and large DSLRs (6000+ px).
            font_size = max(14, int(min(w, h) * 0.025))
            try:
                font = ImageFont.truetype(WATERMARK_FONT_PATH, font_size)
            except (OSError, IOError):
                font = ImageFont.load_default()

            # Measure the text so we can position the band.
            # textbbox() is Pillow 8.0+; load_default fonts
            # still work but may report a 0,0 box.
            bbox = draw.textbbox((0, 0), WATERMARK_TEXT, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            # Padding around the text inside the band.
            pad = max(6, int(font_size * 0.4))
            band_w = tw + pad * 2
            band_h = th + pad * 2
            # Position: bottom-right with a small inset from
            # the photo edge.
            inset = max(10, int(min(w, h) * 0.015))
            band_x = w - band_w - inset
            band_y = h - band_h - inset

            # Draw a semi-opaque dark band, then the white text
            # on top. RGBA tuple: (R, G, B, A) — alpha=128 is
            # 50% transparent, lets the photo show through
            # dimly so the watermark doesn't dominate.
            draw.rectangle(
                [band_x, band_y, band_x + band_w, band_y + band_h],
                fill=(0, 0, 0, 128),
            )
            draw.text(
                (band_x + pad, band_y + pad - bbox[1]),
                WATERMARK_TEXT,
                fill=(255, 255, 255, 230),
                font=font,
            )

            # Save back to the same path. Pillow picks the
            # format from the file extension. JPEG quality
            # 92 matches what most phone cameras produce
            # natively, so the file size stays close to the
            # original (band+text adds <1% size overhead).
            save_kwargs = {}
            if content_type == "image/jpeg":
                save_kwargs["quality"] = 92
                save_kwargs["optimize"] = True
                # Preserve EXIF where present. The PIL image
                # keeps the EXIF blob in im.info['exif'] after
                # exif_transpose() runs (PIL 9+), so we just
                # forward it. If absent, we DON'T try to
                # regenerate — that's an Image.Exif() operation
                # requiring PIL 10+ and adds complexity for a
                # cosmetic preservation that the user can
                # restore from their phone gallery if they care.
                exif_bytes = im.info.get("exif", b"")
                if exif_bytes:
                    save_kwargs["exif"] = exif_bytes
            elif content_type == "image/png":
                save_kwargs["optimize"] = True
            elif content_type == "image/webp":
                save_kwargs["quality"] = 92

            # Atomic write: same tmp+rename dance as the
            # upload path so a partial write can't replace a
            # good photo with garbage. PIL infers the format
            # from the file extension, so we keep the original
            # extension on the tmp file (just append ".wm-tmp"
            # to the stem) and rename after the save succeeds.
            # The earlier ".tmp" suffix bug raised "unknown file
            # extension: .tmp" because PIL couldn't pick the
            # format — keeping the original extension fixes it.
            tmp = path.with_name(path.stem + ".wm-tmp" + path.suffix)
            im.save(str(tmp), **save_kwargs)
            os.replace(tmp, path)
        return True
    except Exception as e:
        log(f"watermark: failed for {path.name}: {type(e).__name__}: {e}")
        # Clean up any half-written tmp file.
        try:
            tmp = path.with_name(path.stem + ".wm-tmp" + path.suffix)
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        return False


def ImageOps_compat_autorotate(im):
    """EXIF-aware auto-rotate. Imported lazily so the import
    error surfaces only when we actually need to rotate.

    Returns the rotated image. If rotation isn't possible
    (no EXIF / no PIL.ImageOps), returns the original.
    """
    try:
        from PIL import ImageOps
        return ImageOps.exif_transpose(im)
    except Exception:
        return im


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def verify_hmac(secret, event_id, guest_id, expires_ms_str, provided_sig_hex):
    """Constant-time HMAC verification. Returns True on match.

    The token format matches the client's earlier mint:
      hex(HMAC_SHA256(secret, f"{event_id}|{guest_id}|{expires_ms}"))
    Expiration is enforced in `do_POST` (we compare expires_ms to
    current wall-clock), here we only check the signature.
    """
    if not secret:
        return False
    try:
        expires_ms_int = int(expires_ms_str)
    except (TypeError, ValueError):
        return False
    msg = f"{event_id}|{guest_id}|{expires_ms_int}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    if len(expected) != len(provided_sig_hex):
        return False
    # hmac.compare_digest requires equal-length byte strings; ours
    # are equal-length hex strings (guaranteed by the length check
    # above). If they differ in length the function raises
    # TypeError; the guard above prevents that.
    return hmac.compare_digest(expected, provided_sig_hex)


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
        # 2026-07-27 — HMAC verification, BEFORE any multipart parsing
        # or disk writes. Server is hard-fail-closed: if the secret
        # env var is missing, every request is denied. This blocks
        # anonymous writes from anyone who can hit the network
        # endpoint (the prior code had no auth check at all).
        token = self.headers.get("X-Upload-Token", "")
        expires = self.headers.get("X-Upload-Expires", "")
        if not PHOTO_HMAC_SECRET:
            return self._send_error(
                401,
                "auth not configured (server missing PHOTO_HMAC_SECRET)",
            )
        if not token or not expires:
            return self._send_error(401, "missing X-Upload-Token / X-Upload-Expires")
        try:
            if int(expires) < int(time.time() * 1000):
                return self._send_error(401, "upload token expired (TTL exceeded)")
        except (TypeError, ValueError):
            return self._send_error(401, "malformed X-Upload-Expires header")

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

        # Verify HMAC against the {eventId, guestId, expires} triple.
        # Verification happens AFTER the body parse + SAFE_ID check
        # so we never leak timing info about the secret contents:
        # the only side channels here are the regex on the IDs and
        # the constant-time comparison inside verify_hmac.
        if not verify_hmac(PHOTO_HMAC_SECRET, event_id, guest_id, expires, token):
            log(f"HMAC verify failed for event_id={event_id[:8]}… guest_id={guest_id[:8]}…")
            return self._send_error(401, "unauthorized (token mismatch)")

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

        # 2026-08-02 — Default-on watermark. The Vercel
        # /api/photo-upload proxy verifies the owner's
        # upload-preferences HMAC token and forwards
        # `X-Watermark-Disabled: true` only when the owner has
        # the `watermark-removed` unlock. Anything else →
        # watermark on. _apply_watermark() returns False on any
        # failure (PIL missing, corrupt JPEG, etc.) and we still
        # return 200 — a broken watermark must NOT take down the
        # upload. The log line is the only signal that something
        # went wrong.
        watermark_disabled = self.headers.get("X-Watermark-Disabled", "").lower() == "true"
        if watermark_disabled:
            log(f"watermark disabled (premium) for {filename}")
        else:
            wm_ok = _apply_watermark(dest, f["content_type"])
            if wm_ok:
                log(f"watermarked {filename}")
            else:
                # Don't fail the upload — just log so the operator
                # can investigate. The original file is shipped as-is.
                log(f"watermark skipped (see prior error) for {filename}")

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
