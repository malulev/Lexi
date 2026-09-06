#!/usr/bin/env bash
set -euo pipefail

# Prepares one VPS to host many client installations. Run once, as root, on a
# fresh Ubuntu 22.04/24.04 box; safe to run again afterwards.
#
# What it establishes, and why each piece is here rather than in
# provision-client.sh:
#
#   - Docker itself, plus the three packages rootless mode needs. Those are
#     installed HERE because they are host-wide apt state: installing them
#     twenty times, once per client, would be twenty identical no-ops with
#     twenty chances to fail halfway.
#   - /srv/lexi, the parent of every client's directory. Mode 0755 and
#     root-owned on purpose: each client subdirectory underneath is 0700 and
#     owned by that client, so the parent only needs to be traversable.
#   - A registry on 127.0.0.1:5000. Twenty clients must not each run
#     `npm ci && npm run build` on a shared 2 vCPU box, so release.sh builds
#     each image once on the root daemon and every client pulls it from here.
#     Bound to loopback: Docker treats 127.0.0.1 registries as insecure by
#     default, which is exactly why there is no TLS to configure and exactly
#     why it must never be reachable from off-box.
#
# It does NOT create clients, mint secrets, or start any application.

usage() {
  cat <<'USAGE'
Usage: ops/bootstrap-host.sh [--registry-port <port>]

Prepares a fresh VPS to host Lexi client installations. Run as root, once.
Idempotent: re-running repairs a partial run and changes nothing else.

Options:
  --registry-port <port>  Loopback port for the image registry (default 5000).
  -h, --help              Show this message.

After this, create a client with:
  ops/provision-client.sh <slug> <hostname> <port>
USAGE
}

REGISTRY_PORT=5000
REGISTRY_NAME=lexi-registry
REGISTRY_VOLUME=lexi-registry-data
CLIENT_ROOT=/srv/lexi

# Compose v2.17 is the floor because docker-compose.yml builds the app image
# from `dockerfile_inline`, which does not exist before it. An older Compose
# does not warn — it fails to parse the service, which reads as a broken file.
COMPOSE_MIN_MAJOR=2
COMPOSE_MIN_MINOR=17

die() {
  echo "bootstrap-host: $*" >&2
  exit 1
}

note() {
  echo "bootstrap-host: $*"
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --registry-port)
        [ $# -ge 2 ] || die "--registry-port needs a value"
        REGISTRY_PORT="$2"
        shift 2
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        die "unknown argument: $1"
        ;;
    esac
  done

  case "$REGISTRY_PORT" in
    '' | *[!0-9]*) die "--registry-port must be a whole number, got: ${REGISTRY_PORT}" ;;
  esac
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "must run as root (creating users and installing packages). Try: sudo $0"
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    note "docker already installed, skipping the convenience script"
  else
    note "installing docker via get.docker.com"
    command -v curl >/dev/null 2>&1 || die "curl is missing and is needed to fetch the Docker installer. Install it: apt-get install -y curl"
    curl -fsSL https://get.docker.com | sh
  fi

  systemctl enable --now docker >/dev/null 2>&1 ||
    die "the root Docker daemon did not start. Check: systemctl status docker"
}

# uidmap supplies newuidmap/newgidmap, without which a rootless daemon cannot
# map container UID 0 to the client user's subordinate range and fails with a
# message about /etc/subuid that does not say "install uidmap".
# dbus-user-session is what makes `systemctl --user` work for a user with no
# login session, which is precisely the case for a lingering service account.
# docker-ce-rootless-extras carries dockerd-rootless-setuptool.sh itself.
install_rootless_prerequisites() {
  local missing=()
  local pkg
  for pkg in uidmap dbus-user-session docker-ce-rootless-extras; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done

  if [ ${#missing[@]} -eq 0 ]; then
    note "rootless prerequisites already present"
    return
  fi

  note "installing rootless prerequisites: ${missing[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}" ||
    die "could not install: ${missing[*]}. On a non-Debian host install the equivalents by hand, then re-run."
}

# Compared numerically rather than with a string test, because "2.9" sorts
# after "2.17" lexically and would pass a check that should fail.
verify_compose_version() {
  local raw major minor
  raw="$(docker compose version --short 2>/dev/null || true)"
  [ -n "$raw" ] ||
    die "'docker compose version' produced nothing. The Compose v2 plugin is missing; install docker-compose-plugin."

  # Some builds print "v2.17.0" and some "2.29.7"; the leading v would make
  # every arithmetic comparison below a syntax error rather than a version test.
  raw="${raw#v}"

  major="${raw%%.*}"
  minor="${raw#*.}"
  minor="${minor%%.*}"
  # A version with no dot at all leaves major and minor identical; treat the
  # minor as 0 rather than comparing the major against itself.
  [ "$minor" = "$raw" ] && minor=0

  case "${major}${minor}" in
    '' | *[!0-9]*) die "could not read a version number from 'docker compose version --short': ${raw}" ;;
  esac

  if [ "$major" -lt "$COMPOSE_MIN_MAJOR" ] ||
    { [ "$major" -eq "$COMPOSE_MIN_MAJOR" ] && [ "$minor" -lt "$COMPOSE_MIN_MINOR" ]; }; then
    die "Docker Compose ${raw} is too old. docker-compose.yml uses dockerfile_inline, which needs v${COMPOSE_MIN_MAJOR}.${COMPOSE_MIN_MINOR} or newer. Upgrade docker-compose-plugin and re-run."
  fi

  note "docker compose ${raw} (need >= ${COMPOSE_MIN_MAJOR}.${COMPOSE_MIN_MINOR})"
}

create_client_root() {
  mkdir -p "$CLIENT_ROOT"
  # Traversable, not readable-into: every client directory beneath is 0700 and
  # owned by its own user, and that is where the isolation actually lives.
  chown root:root "$CLIENT_ROOT"
  chmod 0755 "$CLIENT_ROOT"
  note "${CLIENT_ROOT} ready"
}

start_registry() {
  if docker volume inspect "$REGISTRY_VOLUME" >/dev/null 2>&1; then
    note "registry volume ${REGISTRY_VOLUME} exists"
  else
    docker volume create "$REGISTRY_VOLUME" >/dev/null
    note "created registry volume ${REGISTRY_VOLUME}"
  fi

  # Re-created rather than reconfigured when it already exists: a container's
  # port binding and restart policy cannot be changed in place, so a second run
  # after --registry-port changed would otherwise silently keep the old port.
  # The volume outlives this, so nothing pushed is lost.
  if docker container inspect "$REGISTRY_NAME" >/dev/null 2>&1; then
    note "replacing existing ${REGISTRY_NAME} container (the volume is kept)"
    docker rm -f "$REGISTRY_NAME" >/dev/null
  fi

  docker run -d \
    --name "$REGISTRY_NAME" \
    --restart always \
    -p "127.0.0.1:${REGISTRY_PORT}:5000" \
    -v "${REGISTRY_VOLUME}:/var/lib/registry" \
    registry:2 >/dev/null ||
    die "could not start the registry container. Check: docker logs ${REGISTRY_NAME}"

  note "registry listening on 127.0.0.1:${REGISTRY_PORT} (insecure by default, which is why it must stay on loopback)"
}

verify_registry() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null "http://127.0.0.1:${REGISTRY_PORT}/v2/" 2>/dev/null; then
      note "registry answered /v2/ after ${attempt} attempt(s)"
      return 0
    fi
    sleep 1
  done
  die "the registry did not answer http://127.0.0.1:${REGISTRY_PORT}/v2/ within 10s. Check: docker logs ${REGISTRY_NAME}"
}

main() {
  parse_args "$@"
  require_root
  install_docker
  install_rootless_prerequisites
  verify_compose_version
  create_client_root
  start_registry
  verify_registry

  cat <<EOF

bootstrap-host: done. This host is ready for clients.

Next:
  ops/provision-client.sh <slug> <hostname> <port>

Note the registry port if you changed it (${REGISTRY_PORT}); release.sh and
provision-client.sh both default to 5000 and take --registry-port to match.
EOF
}

main "$@"
