#!/bin/bash
# Auto-start tailscaled for the openclaw user (no root, userspace mode).
# Place this in cron @reboot for the openclaw user. It runs as a persistent
# supervisor: keeps tailscaled alive AND keeps the Funnel config applied.
#
# Why a loop instead of `systemd --user`? On this NAS, the user manager isn't
# reliable — we saw a case where tailscaled was killed and systemd didn't
# restart it. A simple bash watchdog is bulletproof for this use case.
#
# When cron @reboot fires, this script:
#   1. Starts tailscaled if not running
#   2. Waits for the daemon to be ready
#   3. Re-applies the Funnel config (idempotent)
#   4. Loops forever, restarting tailscaled if it dies, re-applying Funnel
#      config after each restart
#
# Also supervises:
#   - fli-data-server.py (port 9877, reverse-proxies /talmii/* to talmii-server)
#   - talmii-server.py     (port 9878, NAS-backed TALMII API + static)
#   - cloudflared          (CF Tunnel connector → 127.0.0.1:9877 for talmii.com)
#
# To stop everything: `pkill -f ts-autostart.sh` then `pkill tailscaled`
export PATH=/home/openclaw/bin:$PATH
LOG=/tmp/tailscaled.log
WATCHDOG_LOG=/tmp/ts-autostart.watchdog.log
STATE=/home/openclaw/.cache/tailscale/state.json
SOCKET_DIR=/tmp/tailscale
TS_BIN="/home/openclaw/bin/tailscaled"
TS_CLI="/home/openclaw/bin/ts-cli"
FUNNEL_PROXY="http://127.0.0.1:9877"
FUNNEL_PORT=443
FLI_DATA_SERVER="/home/openclaw/bin/fli-data-server.py"
FLI_DATA_PORT=9877
FLI_DATA_CMD="/usr/bin/python3 $FLI_DATA_SERVER"
TALMII_SERVER="/home/openclaw/bin/talmii_server.py"
TALMII_PORT=9878
TALMII_CMD="/usr/bin/python3 $TALMII_SERVER"
CLOUDFLARED_BIN="/home/openclaw/bin/cloudflared"
# 2026-08-05 — was a literal placeholder "..."oken" (4 dots + "oken")
# left over from an earlier version of this script. The actual
# token file in /home/openclaw/.cloudflared/ is named after the
# Cloudflare tunnel UUID, e.g.
#   1a40aafa-6a7e-433d-9ba5-884bf2885c3d.json
# Hard-coding the exact filename would break if the tunnel ever
# rotates; better to glob the only *.json file in that dir (the
# tunnel credentials are the only JSON in /home/openclaw/.cloudflared/
# in this deployment — cert.pem and config.yml are the other files).
CLOUDFLARED_TOKEN_FILE="$(ls /home/openclaw/.cloudflared/*.json 2>/dev/null | head -1)"
CLOUDFLARED_LOG="/tmp/cloudflared.log"
# Hermes 2026-10-27 — second CF tunnel on this host: talmii-nas.
#
# talmii.com / www.talmii.com were serving CF error 530 because this
# tunnel had NO connector at all — the credentials file was missing from
# the NAS. Restored 2026-10-27 by fetching the tunnel token from the CF
# API and starting a connector.
#
# It uses REMOTE-MANAGED config (ingress lives in Cloudflare, not in a
# local config.yml), so it is started with --token-file and no
# --config. IMPORTANT CLI NOTE for cloudflared 2026.10.4:
#   - `tunnel --token X`        → INVALID, "flag provided but not defined: -token"
#   - `tunnel --token-file X`   → INVALID, same error (that flag belongs
#                                to the `run` subcommand)
#   - `tunnel run --token-file X` → CORRECT
# The token file IS a credentials file; cloudflared accepts it via
# --token-file.
TALMII_TUNNEL_NAME="talmii-nas"
TALMII_TUNNEL_TOKEN_FILE="/home/openclaw/.cloudflared/741256d8-dcbc-45ec-b80c-c42be7bed1db.token"
TALMII_TUNNEL_LOG="/tmp/cloudflared-talmii.log"
# Separate metrics port so the two connectors can be probed independently.
TALMII_TUNNEL_METRICS_PORT=2001
# CF Tunnel connects outbound to CF edge; routes talmii.com / www.talmii.com
# traffic to http://127.0.0.1:9877 (the local fli-data-server).

# Photo upload server (Save The Day guest photo upload, replaces Firebase Storage).
# Receives multipart uploads at Funnel path /upload, serves files back at /photos.
PHOTO_UPLOAD_SERVER="/home/openclaw/bin/photo_upload_server.py"
PHOTO_UPLOAD_PORT=9879
PHOTO_UPLOAD_CMD="/usr/bin/python3 $PHOTO_UPLOAD_SERVER"
PHOTO_UPLOAD_LOG="/tmp/photo-upload.log"
PHOTO_UPLOAD_PID="/tmp/photo-upload.pid"

# TRMNL ePaper display server (Seeedstudio 7.5" DIY kit, containerized).
# Funnel-exposes /api/* so the device can reach setup/display/log over HTTPS.
TRMNL_CONTAINER="trmnl-bloomberg"
TRMNL_INTERNAL_PORT=8081
# Public hostname Funnel exposes (HTTPS); must match VITE_NAS_UPLOAD_URL in the
# frontend's .env.local. Keep this in sync if the tailnet hostname ever changes.
PHOTO_FUNNEL_HOST="https://ugreen-nas.tail20bf1.ts.net"

mkdir -p "$SOCKET_DIR" /home/openclaw/.local/share/tailscale

# Symlink so the CLI finds the socket at its default location.
ln -sf "$SOCKET_DIR/tailscaled.sock" /home/openclaw/.local/share/tailscale/tailscaled.sock

start_tailscaled() {
  if pgrep -f "tailscaled --tun=userspace" > /dev/null; then
    return 0
  fi
  nohup "$TS_BIN" \
    --tun=userspace-networking \
    --socket="$SOCKET_DIR/tailscaled.sock" \
    --state="$STATE" \
    --port 41641 \
    >> "$LOG" 2>&1 &
  local pid=$!
  echo "$(date -Iseconds) Started tailscaled, pid $pid" >> "$WATCHDOG_LOG"
  return 0
}

wait_for_daemon() {
  for i in $(seq 1 30); do
    if "$TS_CLI" status >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

apply_funnel() {
  # Re-apply both serve (local) and funnel (public) rules.
  # Idempotent — re-issuing an identical rule is a no-op on Tailscale's side.
  "$TS_CLI" serve   --bg --https="$FUNNEL_PORT" --set-path=/ "$FUNNEL_PROXY" >/dev/null 2>&1
  "$TS_CLI" funnel  --bg --https="$FUNNEL_PORT" --set-path=/ "$FUNNEL_PROXY" >/dev/null 2>&1
  # Wedding app photo upload (separate path on the same Funnel hostname).
  "$TS_CLI" funnel  --bg --set-path=/upload "http://127.0.0.1:$PHOTO_UPLOAD_PORT" >/dev/null 2>&1
  "$TS_CLI" funnel  --bg --set-path=/photos "http://127.0.0.1:$PHOTO_UPLOAD_PORT" >/dev/null 2>&1
  # TRMNL ePaper display (containerized) — /api/* is the BYOS protocol path.
  # Funnel strips /api before forwarding, so origin sees /setup /display /log.
  "$TS_CLI" funnel  --bg --set-path=/api "http://127.0.0.1:$TRMNL_INTERNAL_PORT" >/dev/null 2>&1
  echo "$(date -Iseconds) Funnel config applied" >> "$WATCHDOG_LOG"
}

start_fli_data_server() {
  if pgrep -f "fli-data-server.py" > /dev/null; then
    return 0
  fi
  nohup $FLI_DATA_CMD >> /tmp/fli-data-server.log 2>&1 &
  local pid=$!
  echo "$(date -Iseconds) Started fli-data-server, pid $pid" >> "$WATCHDOG_LOG"
  return 0
}

wait_for_fli_data_server() {
  for i in $(seq 1 20); do  # 10s
    if curl -s -o /dev/null http://127.0.0.1:$FLI_DATA_PORT/health 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_talmii_server() {
  if pgrep -f "talmii_server.py" > /dev/null; then
    return 0
  fi
  # Hermes 2026-06-25: load TALMII_ADMIN_TOKEN from a separate file with
  # restrictive perms. If the file is missing, server starts but admin
  # endpoints will return 503 'admin token not configured' (no insecure
  # fallback). To set:
  #   echo -n 'NEW_TOKEN' > /home/openclaw/.config/talmii/admin_token
  #   chmod 600 /home/openclaw/.config/talmii/admin_token
  if [ -r /home/openclaw/.config/talmii/admin_token ]; then
    export TALMII_ADMIN_TOKEN="$(cat /home/openclaw/.config/talmii/admin_token)"
  fi
  nohup $TALMII_CMD >> /tmp/talmii-server.log 2>&1 &
  local pid=$!
  echo "$(date -Iseconds) Started talmii-server, pid $pid" >> "$WATCHDOG_LOG"
  return 0
}

wait_for_talmii_server() {
  for i in $(seq 1 20); do  # 10s
    if curl -s -o /dev/null http://127.0.0.1:$TALMII_PORT/api/health 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_cloudflared() {
  if pgrep -f "cloudflared tunnel.*run" > /dev/null; then
    return 0
  fi
  if [ ! -r "$CLOUDFLARED_TOKEN_FILE" ]; then
    echo "$(date -Iseconds) cloudflared token not found at $CLOUDFLARED_TOKEN_FILE" >> "$WATCHDOG_LOG"
    return 1
  fi
  # 2026-08-05 — switched from --token $(cat <json>) to
  # --config <config.yml>. The previous code read the tunnel
  # credentials JSON as a string and passed it to --token,
  # which expects just the tunnel UUID. The JSON blob caused
  # cloudflared to fail to register with the CF edge. Using
  # --config picks up both credentials-file AND ingress rules
  # from the same file.
  nohup "$CLOUDFLARED_BIN" tunnel --no-autoupdate --metrics localhost:2000 \
    --config /home/openclaw/.cloudflared/config.yml \
    run >> "$CLOUDFLARED_LOG" 2>&1 &
  local pid=$!
  echo "$(date -Iseconds) Started cloudflared (config-based), pid $pid" >> "$WATCHDOG_LOG"
  return 0
}

wait_for_cloudflared() {
  # Cloudflared exposes /metrics on localhost:2000 once the connector has
  # registered with the CF edge. That's our liveness probe.
  for i in $(seq 1 20); do  # 10s
    if curl -s -o /dev/null http://127.0.0.1:2000/metrics 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# Hermes 2026-10-27 — talmii-nas connector (second CF tunnel on this host).
#
# Hermes 2026-10-27 — the health probe uses the ha_connections GAUGE, not
# just "is /metrics reachable". /metrics answers as soon as the process
# binds the port, which happens BEFORE the connector has registered with
# the CF edge. A gauge of 0 means "process up but not registered" — that
# is NOT healthy. Same class of bug as the log-mtime watchdog.
start_talmii_tunnel() {
  if pgrep -f "cloudflared.*tunnel run --token-file ${TALMII_TUNNEL_TOKEN_FILE}" > /dev/null; then
    return 0
  fi
  if [ ! -r "$TALMII_TUNNEL_TOKEN_FILE" ]; then
    echo "$(date -Iseconds) talmii tunnel token not found at $TALMII_TUNNEL_TOKEN_FILE" >> "$WATCHDOG_LOG"
    return 1
  fi
  # Hermes 2026-10-27: `tunnel run --token-file` is the only spelling that
  # works in cloudflared 2026.10.4. Do NOT add `run $TALMII_TUNNEL_NAME`
  # after --token-file: the token already names the tunnel.
  setsid nohup "$CLOUDFLARED_BIN" --no-autoupdate \
    --metrics "localhost:${TALMII_TUNNEL_METRICS_PORT}" \
    tunnel run --token-file "$TALMII_TUNNEL_TOKEN_FILE" \
    >> "$TALMII_TUNNEL_LOG" 2>&1 < /dev/null &
  local pid=$!
  echo "$(date -Iseconds) Started talmii tunnel connector, pid $pid" >> "$WATCHDOG_LOG"
  return 0
}

wait_for_talmii_tunnel() {
  # Wait for ha_connections > 0, i.e. actually registered with the edge.
  for i in $(seq 1 40); do  # 20s
    local conns
    conns=$(curl -s --max-time 3 \
            "http://127.0.0.1:${TALMII_TUNNEL_METRICS_PORT}/metrics" 2>/dev/null \
            | grep -m1 '^cloudflared_tunnel_ha_connections ' \
            | awk '{print $2}')
    if [ -n "$conns" ] && [ "$conns" -gt 0 ] 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_photo_upload_server() {
  if pgrep -f "photo_upload_server.py" > /dev/null; then
    return 0
  fi
  nohup $PHOTO_UPLOAD_CMD >> "$PHOTO_UPLOAD_LOG" 2>&1 &
  local pid=$!
  echo "$pid" > "$PHOTO_UPLOAD_PID"
  echo "$(date -Iseconds) Started photo-upload-server, pid $pid" >> "$WATCHDOG_LOG"
  return 0
}

wait_for_photo_upload_server() {
  for i in $(seq 1 20); do  # 10s
    if curl -s -o /dev/null "http://127.0.0.1:$PHOTO_UPLOAD_PORT/health" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# If we're already a child of the cron @reboot, our parent is cron. Double-fork
# to fully detach so this script survives cron exit (cron typically waits for
# the script to finish, and we never want to finish).
if [ -z "$TS_WATCHDOG_DETACHED" ]; then
  export TS_WATCHDOG_DETACHED=1
  setsid bash "$0" </dev/null >>"$WATCHDOG_LOG" 2>&1 &
  echo "Detached watchdog PID $!"
  exit 0
fi

# Main loop: keep tailscaled + fli-data-server + talmii-server alive, re-apply
# Funnel after each restart.
while true; do
  start_tailscaled
  start_fli_data_server
  start_talmii_server
  start_cloudflared
  start_talmii_tunnel
  start_photo_upload_server
  if wait_for_daemon; then
    if wait_for_fli_data_server; then
      if wait_for_talmii_server; then
        if wait_for_cloudflared; then
          if wait_for_talmii_tunnel; then
            if wait_for_photo_upload_server; then
              apply_funnel
            else
              echo "$(date -Iseconds) WARNING: photo-upload-server did not become ready after 10s" >> "$WATCHDOG_LOG"
            fi
          else
            echo "$(date -Iseconds) WARNING: talmii tunnel did not register with CF edge after 20s" >> "$WATCHDOG_LOG"
          fi
        else
          echo "$(date -Iseconds) WARNING: cloudflared did not become ready after 10s" >> "$WATCHDOG_LOG"
        fi
      else
        echo "$(date -Iseconds) WARNING: talmii-server did not become ready after 10s" >> "$WATCHDOG_LOG"
      fi
    else
      echo "$(date -Iseconds) WARNING: fli-data-server did not become ready after 10s" >> "$WATCHDOG_LOG"
    fi
  else
    echo "$(date -Iseconds) WARNING: tailscaled did not become ready after 15s" >> "$WATCHDOG_LOG"
  fi

  # Sleep with a short interval so we react quickly to either service dying.
  # poll alive every 5s, full restart cycle on death.
  for i in $(seq 1 12); do  # ~60s of healthy uptime = "we're good"
    sleep 5
    if ! pgrep -f "tailscaled --tun=userspace" > /dev/null; then
      echo "$(date -Iseconds) tailscaled died, restarting" >> "$WATCHDOG_LOG"
      break
    fi
    if ! pgrep -f "fli-data-server.py" > /dev/null; then
      echo "$(date -Iseconds) fli-data-server died, restarting" >> "$WATCHDOG_LOG"
      break
    fi
    if ! pgrep -f "talmii_server.py" > /dev/null; then
      echo "$(date -Iseconds) talmii-server died, restarting" >> "$WATCHDOG_LOG"
      break
    fi
    if ! pgrep -f "cloudflared tunnel.*run" > /dev/null; then
      echo "$(date -Iseconds) cloudflared died, restarting" >> "$WATCHDOG_LOG"
      break
    fi
    # Hermes 2026-10-27: also watch the talmii-nas connector. Its pgrep
    # pattern must include --token-file because that is how it is launched.
    if ! pgrep -f "cloudflared.*tunnel run --token-file ${TALMII_TUNNEL_TOKEN_FILE}" > /dev/null; then
      echo "$(date -Iseconds) talmii tunnel connector died, restarting" >> "$WATCHDOG_LOG"
      break
    fi
    if ! pgrep -f "photo_upload_server.py" > /dev/null; then
      echo "$(date -Iseconds) photo-upload-server died, restarting" >> "$WATCHDOG_LOG"
      break
    fi
  done
done
