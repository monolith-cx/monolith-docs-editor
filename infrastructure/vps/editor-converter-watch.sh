#!/usr/bin/env bash
# The editor's converter watchdog (EDIT-6.3, ADR F17). Run by cron on the VPS every 5 minutes,
# with no redirect (cron mails whatever the script prints, and it prints only alerts):
#
#   */5 * * * * root /srv/monolith/bin/editor-converter-watch.sh
#
# DocumentServer's converter can wedge (a partial or slow source download held it until a restart,
# ADR F17); a wedged converter also blocks every editor open and every save. The service prevents the
# known triggers; this covers unknown ones. Each run:
#   1. calls the API's converter probe (GET /health/converter, loopback only) inside the API container;
#   2. on 200 clears the failure count; on 429 (a probe already running) does nothing; on anything
#      that is not an answer from the probe (the API container down, exec failing) reports and stops
#      without touching DocumentServer: that is the host health check's business, not a wedge;
#   3. on 503 counts a failure; after WATCH_FAILURES consecutive failures it waits for open editors
#      to close, at most WATCH_DRAIN_MINUTES from the first failure that reached the threshold, then
#      restarts DocumentServer in place (`docker compose restart`: the same container, no recreate),
#      waits for its health check and for font generation to finish (ADR F15), and probes again.
# It acts on the editor's two services only. Every step goes to WATCH_LOG; alerts (the converter
# wedged, a restart and its outcome, no answer from the probe, state it cannot keep) are also printed,
# so cron mails them to root, the channel /srv/monolith/bin/health-check.sh uses (it needs the box's
# local mail to be deliverable). A healthy run prints nothing.
#
# Exit codes: 0 healthy, or nothing to do (another run holds the lock, a probe already running);
# 1 a failure counted below the threshold, or waiting for open editors to close; 2 no answer from the
# probe; 3 the restart failed or DocumentServer was not ready after it; 4 restarted DocumentServer;
# 5 cannot keep its state or log.
#
# Settings (environment; defaults are the VPS dev project):
#   WATCH_COMPOSE         the compose command for the project, word-split
#                         (default: docker compose -p monolith-dev -f /srv/monolith/dev/docker-compose.yml)
#   WATCH_API_SERVICE     the API service (default: editor-api-dev)
#   WATCH_DS_SERVICE      DocumentServer's service (default: editor-documentserver-dev)
#   WATCH_STATE_DIR       where the failure count and the drain clock are kept (default: /var/lib/editor-converter-watch)
#   WATCH_LOG             the log file (default: /srv/monolith/backup/editor-converter-watch.log)
#   WATCH_FAILURES        consecutive failed probes before acting (default: 2)
#   WATCH_DRAIN_MINUTES   how long to wait for open editors to close before restarting anyway (default: 15)
#   WATCH_READY_SECONDS   how long to wait for DocumentServer to be ready after the restart (default: 600)
#   WATCH_CALL_SECONDS    the most any one docker call may take before it is abandoned (default: 120;
#                         the restart gets 300), so a hung call cannot hold the lock for ever
set -uo pipefail

COMPOSE=${WATCH_COMPOSE:-docker compose -p monolith-dev -f /srv/monolith/dev/docker-compose.yml}
API=${WATCH_API_SERVICE:-editor-api-dev}
DS=${WATCH_DS_SERVICE:-editor-documentserver-dev}
STATE=${WATCH_STATE_DIR:-/var/lib/editor-converter-watch}
LOG=${WATCH_LOG:-/srv/monolith/backup/editor-converter-watch.log}
FAILURES=${WATCH_FAILURES:-2}
DRAIN_MINUTES=${WATCH_DRAIN_MINUTES:-15}
READY_SECONDS=${WATCH_READY_SECONDS:-600}
CALL_SECONDS=${WATCH_CALL_SECONDS:-120}

line() { printf '%s editor-converter-watch %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
# A step: the log only.
log() { line "$@" >>"$LOG"; }
# An alert: the log, and stdout for cron's mail.
alert() { line "$@" | tee -a "$LOG"; }
# What a run cannot keep or know: printed (cron mails it), and logged if the log can take it.
fatal() { line "$@"; line "$@" >>"$LOG" 2>/dev/null; exit 5; }
# Every docker call is bounded (WATCH_CALL_SECONDS).
# shellcheck disable=SC2086 # WATCH_COMPOSE is a command line on purpose
compose() { timeout "$CALL_SECONDS" $COMPOSE "$@"; }

mkdir -p "$STATE" 2>/dev/null || fatal "cannot create the state directory $STATE"
touch "$LOG" 2>/dev/null || fatal "cannot write the log $LOG"
# Braces: the redirect hides only this command's error; stderr stays open for the rest of the run.
{ exec 9>"$STATE/lock"; } 2>/dev/null || fatal "cannot open the lock file in $STATE"
if ! flock -n 9; then
  started=$(cat "$STATE/running-since" 2>/dev/null || echo 0)
  held=$((($(date +%s) - started) / 60))
  if ((started > 0 && held >= 30)); then
    alert "a run has held the lock for ${held}m; a docker call may be stuck"
  else
    log "another run holds the lock; skipping"
  fi
  exit 0
fi
date +%s >"$STATE/running-since" 2>/dev/null || true
trap 'rm -f "$STATE/running-since"' EXIT

# The probe's HTTP status, printed by node inside the API container ("none" when there is no answer).
probe() {
  compose exec -T "$API" node -e "fetch('http://127.0.0.1:3020/health/converter',{signal:AbortSignal.timeout(30000)}).then((r)=>process.stdout.write(String(r.status)),()=>process.stdout.write('none'))" 2>/dev/null || printf 'none'
}

# Open editor connections, from DocumentServer's statistics (served only to 127.0.0.1 inside its
# container, ADR F7): quota.edit.connectionsCount plus quota.view.connectionsCount are live counts
# (battery E6c read 6 with six editors open; connectionsStat holds only hourly and longer aggregates).
# Prints a number, or "unknown"; unknown is treated as "editors may be open", so the restart waits
# the whole drain window.
open_editors() {
  local info
  info=$(compose exec -T "$DS" curl -fsS --max-time 10 http://127.0.0.1/info/info.json 2>/dev/null) || { printf 'unknown'; return; }
  # Parsed by node inside the API container: the host needs nothing but Docker.
  printf '%s' "$info" | compose exec -T "$API" node -e "
    let s='';process.stdin.on('data',(d)=>s+=d).on('end',()=>{
      try{const q=JSON.parse(s).quota||{};const e=q.edit&&q.edit.connectionsCount;const v=q.view&&q.view.connectionsCount;
        process.stdout.write(typeof e==='number'&&typeof v==='number'?String(e+v):'unknown');}catch{process.stdout.write('unknown');}});" 2>/dev/null || printf 'unknown'
}

ready() {
  local deadline=$((SECONDS + READY_SECONDS)) id health
  id=$(compose ps -q "$DS" 2>/dev/null)
  while ((SECONDS < deadline)); do
    health=$(timeout 30 docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || true)
    if [[ "$health" == healthy ]] && ! compose exec -T "$DS" pgrep -f '[d]ocumentserver-generate-allfonts' >/dev/null 2>&1; then
      return 0
    fi
    sleep 10
  done
  return 1
}

status=$(probe)
case "$status" in
  200)
    if [[ -s "$STATE/failures" ]]; then log "probe ok; clearing $(cat "$STATE/failures") failure(s)"; fi
    rm -f "$STATE/failures" "$STATE/drain-since"
    exit 0
    ;;
  429)
    log "a probe is already running; nothing to do"
    exit 0
    ;;
  503) ;;
  *)
    # Not a wedge: whatever was counted before may not have been consecutive, so start again.
    rm -f "$STATE/failures" "$STATE/drain-since"
    alert "no answer from the probe (status $status): the API container may be down; DocumentServer left alone"
    exit 2
    ;;
esac

count=$(($(cat "$STATE/failures" 2>/dev/null || echo 0) + 1))
echo "$count" >"$STATE/failures" || fatal "cannot write $STATE/failures"
if ((count < FAILURES)); then
  log "converter probe failed ($count of $FAILURES before acting)"
  exit 1
fi

now=$(date +%s)
[[ -s "$STATE/drain-since" ]] || echo "$now" >"$STATE/drain-since" || fatal "cannot write $STATE/drain-since"
since=$(cat "$STATE/drain-since")
editors=$(open_editors)
waited=$(((now - since) / 60))
if [[ "$editors" != 0 ]] && ((waited < DRAIN_MINUTES)); then
  alert "converter wedged ($count failed probes); waiting for open editors to close (open: $editors, waited ${waited}m of ${DRAIN_MINUTES}m)"
  exit 1
fi

alert "converter wedged ($count failed probes); restarting $DS (open editors: $editors, waited ${waited}m)"
# A failed restart or a DocumentServer not ready afterwards keeps the failure count, so the next run
# (5 minutes later) tries again; each attempt is an alert.
# shellcheck disable=SC2086 # WATCH_COMPOSE is a command line on purpose
if ! out=$(timeout 300 $COMPOSE restart "$DS" 2>&1); then
  alert "restart of $DS failed: $(printf '%s' "$out" | tail -n 1 | cut -c1-200)"
  exit 3
fi
if ! ready; then
  alert "$DS not ready within ${READY_SECONDS}s after the restart"
  exit 3
fi
after=$(probe)
rm -f "$STATE/failures" "$STATE/drain-since"
if [[ "$after" == 200 ]]; then
  alert "restarted $DS; converter probe ok"
else
  alert "restarted $DS; converter probe still failing (status $after)"
fi
exit 4
