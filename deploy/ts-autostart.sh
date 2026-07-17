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
CLOUDFLARED_TOKEN_FILE="/home/openclaw/.cloudflared/...oken"
CLOUDFLARED_LOG="/tmp/cloudflared.log"
# CF Tunnel connects outbound to CF edge; routes talmii.com / www.talmii.com
# traffic to http://127.0.0.1:9877 (the local fli-data-server).

# Photo upload server (Save The Day guest photo upload, replaces Firebase Storage).
# Receives multipart uploads at Funnel path /upload, serves files back at /photos.
PHOTO_UPLOAD_SERVER="/home/openclaw/bin/photo_upload_server.py"
PHOTO_UPLOAD_PORT=9879
PHOTO_UPLOAD_CMD="/usr/bin/python3 $PHOTO_UPLOAD_SERVER"
PHOTO_UPLOAD_LOG="/tmp/photo-upload.log"
PHOTO_UPLOAD_PID="/tmp/photo-upload.pid"
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
  local TOKEN
  TOKEN=$(cat "$CLOUDFLARED_TOKEN_FILE")
  nohup "$CLOUDFLARED_BIN" tunnel --no-autoupdate --metrics localhost:2000 \
    run --token "$TOKEN" >> "$CLOUDFLARED_LOG" 2>&1 &
  local pid=$!
  echo "$(date -Iseconds) Started cloudflared, pid $pid" >> "$WATCHDOG_LOG"
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
  start_photo_upload_server
  if wait_for_daemon; then
    if wait_for_fli_data_server; then
      if wait_for_talmii_server; then
        if wait_for_cloudflared; then
          if wait_for_photo_upload_server; then
            apply_funnel
          else
            echo "$(date -Iseconds) WARNING: photo-upload-server did not become ready after 10s" >> "$WATCHDOG_LOG"
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
    if ! pgrep -f "photo_upload_server.py" > /dev/null; then
      echo "$(date -Iseconds) photo-upload-server died, restarting" >> "$WATCHDOG_LOG"
      break
    fi
  done
done
