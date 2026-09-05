#!/usr/bin/env bash
set -euo pipefail

# One line per client, and the one number that is nobody else's job to know.
#
# Under this topology every client has its own rootless daemon, so there is no
# single place to ask "what is running on this box". `docker ps` as root sees
# the registry and nothing else — every application and every agent container
# lives on a daemon root is not talking to. This script is that missing view:
# it asks each client's daemon in turn and adds the answers up.
#
# The agent count matters more than it looks. The application counts running
# agent containers on ITS daemon to decide whether a request may start
# (src/lib/runner/slots.ts), and it calls that count host-wide, because it was
# written for a host where every installation shared one daemon. Here it is per
# client. Twenty clients at MAX_CONCURRENT_RUNS=2 is a host ceiling of forty
# concurrent agents and roughly 40 GB of RAM, and nothing in the application
# will ever tell you that. The TOTAL line below is where you find out.
#
# Read-only. It starts nothing, stops nothing and writes nothing.

usage() {
  cat <<'USAGE'
Usage: ops/status.sh [<slug>] [--logs] [--tail <lines>]

Reports, for every client installation under /srv/prosel (or just <slug>):
whether its rootless daemon is up, whether its app container is running,
whether its loopback port answers HTTP, how many agent containers are running
on its daemon, and which image tag is deployed. Ends with the host-wide agent
total. Run as root.

Arguments:
  <slug>          Report on this client only.

Options:
  --logs          Also print the app container's recent log for each client
                  reported. Startup validation refuses to serve on a bad
                  setting and names it, so this is where a failed roll explains
                  itself.
  --tail <lines>  Log lines per client with --logs (default 50).
  -h, --help      Show this message.
USAGE
}

CLIENT_ROOT=/srv/prosel
ONLY_CLIENT=""
SHOW_LOGS=0
TAIL_LINES=50
TOTAL_AGENTS=0

die() {
  echo "status: $*" >&2
  exit 1
}

parse_args() {
  local positional=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --logs)
        SHOW_LOGS=1
        shift
        ;;
      --tail)
        [ $# -ge 2 ] || die "--tail needs a number of lines"
        TAIL_LINES="$2"
        shift 2
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      -*)
        usage >&2
        die "unknown option: $1"
        ;;
      *)
        positional+=("$1")
        shift
        ;;
    esac
  done

  if [ "${#positional[@]}" -gt 1 ]; then
    usage >&2
    die "expected at most one slug, got ${#positional[@]}: ${positional[*]}"
  fi
  [ "${#positional[@]}" -eq 1 ] && ONLY_CLIENT="${positional[0]}"

  case "$TAIL_LINES" in
    '' | *[!0-9]*) die "--tail must be a whole number, got: ${TAIL_LINES}" ;;
  esac
  if [ -n "$ONLY_CLIENT" ] && [ ! -d "${CLIENT_ROOT}/${ONLY_CLIENT}" ]; then
    die "no client at ${CLIENT_ROOT}/${ONLY_CLIENT}"
  fi
  return 0
}

require_root() {
  # Not vanity: reading each client's daemon means becoming each client, and
  # /srv/prosel/<slug> is 0700 for exactly the reason that nobody else can.
  [ "$(id -u)" -eq 0 ] || die "must run as root (it reads every client's 0700 directory and daemon). Try: sudo $0"
}

# See provision-client.sh: the same environment, for the same reason.
run_as_client() {
  local slug="$1"
  shift
  local uid
  uid="$(id -u "$slug")"
  runuser -u "$slug" -- env \
    HOME="$(getent passwd "$slug" | cut -d: -f6)" \
    XDG_RUNTIME_DIR="/run/user/${uid}" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${uid}/bus" \
    DOCKER_HOST="unix:///run/user/${uid}/docker.sock" \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    "$@"
}

read_env_value() {
  local env_file="$1" name="$2"
  [ -f "$env_file" ] || return 0
  grep -E "^${name}=" "$env_file" 2>/dev/null | tail -n 1 | cut -d= -f2- || true
}

report_client() {
  local slug="$1"
  local dir="${CLIENT_ROOT}/${slug}"
  local env_file="${dir}/.env"
  local daemon="down" app="-" http="-" agents="-" image="-"
  local port limit cid running code count

  if ! id -u "$slug" >/dev/null 2>&1; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$slug" "no-user" "-" "-" "-" "-"
    return 0
  fi

  if run_as_client "$slug" docker info >/dev/null 2>&1; then
    daemon="up"
  fi

  if [ "$daemon" = "up" ]; then
    cid="$(run_as_client "$slug" docker compose -f "${dir}/docker-compose.yml" --project-directory "$dir" ps -q app 2>/dev/null | head -n 1 || true)"
    if [ -n "$cid" ]; then
      running="$(run_as_client "$slug" docker inspect --format '{{.State.Running}}' "$cid" 2>/dev/null || echo false)"
      if [ "$running" = "true" ]; then app="running"; else app="stopped"; fi
      image="$(run_as_client "$slug" docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || echo '?')"
    else
      app="absent"
    fi

    # The exact label the application filters on; see AGENT_LABEL in
    # src/lib/runner/slots.ts. If that constant ever changes, this line is
    # wrong silently rather than loudly, which is worth knowing.
    count="$(run_as_client "$slug" docker ps --filter 'label=webagent.agent=true' --quiet 2>/dev/null | grep -c . || true)"
    [ -n "$count" ] || count=0

    limit="$(read_env_value "$env_file" MAX_CONCURRENT_RUNS)"
    [ -n "$limit" ] || limit="2(default)"
    agents="${count}/${limit}"
  fi

  port="$(read_env_value "$env_file" PORT_HOST)"
  if [ -n "$port" ]; then
    # Any status is an answer. `/` legitimately redirects or refuses an
    # unauthenticated caller, so only "000" — no HTTP at all — means dead.
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/" || true)"
    if [ -z "$code" ] || [ "$code" = "000" ]; then
      http=":${port} NO-ANSWER"
    else
      http=":${port} ${code}"
    fi
  else
    http="no PORT_HOST"
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$slug" "$daemon" "$app" "$http" "$agents" "$image"
}

print_logs() {
  local slug="$1"
  local dir="${CLIENT_ROOT}/${slug}"
  echo
  echo "--- ${slug}: last ${TAIL_LINES} log lines ---"
  run_as_client "$slug" docker compose \
    -f "${dir}/docker-compose.yml" --project-directory "$dir" \
    logs --tail "$TAIL_LINES" app 2>&1 || echo "(no log; the container may never have started)"
}

main() {
  parse_args "$@"
  require_root
  [ -d "$CLIENT_ROOT" ] || die "${CLIENT_ROOT} does not exist. Run ops/bootstrap-host.sh first."

  local dir slug row agents_field rows=() clients=()
  for dir in "$CLIENT_ROOT"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename -- "$dir")"
    [ -n "$ONLY_CLIENT" ] && [ "$slug" != "$ONLY_CLIENT" ] && continue
    clients+=("$slug")
    # Captured in a subshell, so report_client cannot add to a running total
    # itself — the AGENTS column is parsed back out below instead. Worth the
    # small indirection: the alternative is a temporary file for one integer.
    row="$(report_client "$slug")"
    rows+=("$row")
    agents_field="$(printf '%s' "$row" | cut -f5)"
    case "$agents_field" in
      [0-9]*/*) TOTAL_AGENTS=$((TOTAL_AGENTS + ${agents_field%%/*})) ;;
    esac
  done

  if [ "${#clients[@]}" -eq 0 ]; then
    echo "status: no clients under ${CLIENT_ROOT}. Provision one: ops/provision-client.sh <slug> <hostname> <port>"
    exit 0
  fi

  {
    printf 'CLIENT\tDAEMON\tAPP\tHTTP\tAGENTS\tIMAGE\n'
    printf '%s\n' "${rows[@]}"
  } | column -t -s $'\t' 2>/dev/null || printf '%s\n' "${rows[@]}"

  echo
  echo "TOTAL agent containers running across ${#clients[@]} client daemon(s): ${TOTAL_AGENTS}"
  echo "Each is roughly 1 GB of RAM. The per-client AGENTS limits above are per daemon, so the host ceiling is their sum."

  if [ "$SHOW_LOGS" -eq 1 ]; then
    for slug in "${clients[@]}"; do print_logs "$slug"; done
  fi
}

main "$@"
