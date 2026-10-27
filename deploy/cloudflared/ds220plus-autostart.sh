#!/bin/bash
# Cloudflared autostart + watchdog for comparetiger.com tunnel.
# Created 2026-08-11 by Hermes.
# Updated 2026-08-12 by Hermes - Synology DSM has no `pgrep` binary,
# so replaced pgrep -f with ps + grep. Added health check (process
# must have a recent "Registered tunnel connection" in log).
#
# Updated 2026-10-27 by Hermes - fixed the health check.
#
# THE BUG THIS FIXES:
# The old health check required the log file to have been modified in the
# last 5 minutes AND to contain "Registered tunnel connection" in its
# last 50 lines. But a HEALTHY, IDLE cloudflared writes NOTHING to its
# log - it only logs on connect/disconnect and on requests. So:
#
#   1. The launchd/Mac watchdog runs this every 15 minutes.
#   2. `find "$LOG" -mmin -5` is false because an idle tunnel is silent.
#   3. The check returns "unhealthy".
#   4. The script kills a perfectly healthy connector and restarts it.
#   5. Every restart floods the log with ~25 precheck lines, pushing
#      "Registered tunnel connection" out of the `tail -50` window.
#   6. Next cycle: still reports FAILED.
#
# Net effect: the comparetiger.com tunnel was being torn down and
# re-registered every 15 minutes, forever, and the watchdog always
# logged "FAILED to start" even when the tunnel was serving traffic.
#
# THE FIX: use cloudflared's own metrics endpoint as the liveness probe.
# It exposes /metrics on the --metrics port; the gauge
# `cloudflared_tunnel_ha_connections` is the number of live connections
# to the Cloudflare edge. That is a direct, authoritative signal:
#   - 0 means the connector is not registered (genuinely broken)
#   - > 0 means it IS registered (genuinely healthy)
# It does not depend on log write frequency at all.
#
# We also keep the process check, because a process can exist while
# being stuck (e.g. deadlocked on a broken network). Both must pass.

LOCK=/home/openclaw/.cloudflared/.watchdog.lock
LOG=/home/openclaw/.cloudflared/watchdog.log
CFD=/usr/local/bin/cloudflared
CFG=/home/openclaw/.cloudflared/config.yml
TUNNEL_NAME=comparetiger-tunnel
# Hermes 2026-10-27: cloudflared --metrics port. 2000 was free on this
# box; the UGREEN NAS uses 2000 for its own tunnel and 2001 for talmii.
METRICS_PORT=2000
METRICS_URL="http://127.0.0.1:${METRICS_PORT}/metrics"

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

# Helper: returns 0 if cloudflared is alive AND registered with the CF edge.
cloudflared_healthy() {
    # 1. Process exists? (DSM has no pgrep -f, so use ps + grep)
    ps -ef | grep -v grep | grep -q "[c]loudflared.*tunnel run ${TUNNEL_NAME}" || return 1
    # 2. Registered with the Cloudflare edge?
    #    cloudflared_tunnel_ha_connections is the count of live edge
    #    connections. Must be > 0. This is the authoritative liveness
    #    signal and does NOT depend on how recently the log was written.
    local conns
    conns=$(curl -s --max-time 5 "$METRICS_URL" 2>/dev/null \
            | grep -m1 '^cloudflared_tunnel_ha_connections ' \
            | awk '{print $2}')
    [ -n "$conns" ] && [ "$conns" -gt 0 ] 2>/dev/null || return 1
    return 0
}

# Clean stale lock from a previous crashed run
rm -f "$LOCK" 2>/dev/null

# Run under flock so only one watchdog can act at a time
exec 9>"$LOCK"
if ! flock -n 9; then
    log "Another watchdog run is in progress, exiting"
    exit 0
fi

# Wait for DNS/network on boot
sleep 5

if cloudflared_healthy; then
    log "cloudflared already healthy"
    exit 0
fi

# If process exists but not healthy, kill it before restart
if ps -ef | grep -v grep | grep -q "[c]loudflared.*tunnel run ${TUNNEL_NAME}"; then
    log "cloudflared running but unhealthy, killing"
    pkill -f "cloudflared.*tunnel run ${TUNNEL_NAME}" 2>/dev/null
    sleep 3
fi

log "Starting cloudflared tunnel run ${TUNNEL_NAME}"

# Use setsid to detach from any controlling terminal
# Hermes 2026-10-27: added --metrics ${METRICS_PORT} so the health
# check above has a metrics endpoint to probe.
/usr/bin/setsid -f "$CFD" --no-autoupdate \
    --metrics "localhost:${METRICS_PORT}" \
    --config "$CFG" \
    tunnel run "$TUNNEL_NAME" \
    >> "$LOG" 2>&1 < /dev/null

# Hermes 2026-10-27: wait up to 30s for the connector to actually
# register with the CF edge (metrics gauge > 0). The old fixed
# `sleep 8` was not always enough on a cold start, and it produced a
# misleading "FAILED to start" even when the tunnel came up at 9s.
for i in $(seq 1 15); do
    sleep 2
    if cloudflared_healthy; then
        PID=$(ps -ef | grep -v grep | grep "cloudflared.*tunnel run ${TUNNEL_NAME}" | awk '{print $2}' | head -1)
        log "Started OK (PID $PID, registered after $((i * 2))s)"
        exit 0
    fi
done

log "FAILED to start (check $LOG)"
exit 1
