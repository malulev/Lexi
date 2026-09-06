#!/usr/bin/env bash
set -euo pipefail

# Builds both images once and rolls every client forward onto them, one at a
# time. Run as root on the client host, from a checkout of this repository.
#
# Build once, deploy many. Twenty clients each running `npm ci && npm run
# build` on a shared 2 vCPU box is twenty times the work for one identical
# artefact, and it makes "are they all on the same code?" unanswerable. So the
# images are built on the ROOT daemon — the only one with the repository in
# front of it — tagged by git short SHA, and pushed to the loopback registry
# bootstrap-host.sh started.
#
# The tag is the git short SHA and not `latest` because every other line of
# this file exists to answer "what is actually deployed where", and `latest`
# is a name that answers it differently on every daemon that holds it.
#
# One client at a time, and a failure on one is reported and stepped over
# rather than aborting the rest. A run that stops halfway through twenty
# clients leaves an operator with two versions in production and no list of
# which is which; the summary at the end is that list.

usage() {
  cat <<'USAGE'
Usage: ops/release.sh [git-ref] [--client <slug>] [--registry-port <port>] [--timeout <seconds>]

Builds lexi/app and webagent/agent at the given git ref (default HEAD),
pushes both to the host registry, and rolls each client in /srv/lexi/*
forward one at a time. Run as root.

Arguments:
  [git-ref]               Anything `git rev-parse` accepts. Default HEAD.
                          Only its short SHA is used, as the image tag; the
                          images are built from the WORKING TREE, so check out
                          the ref you mean first.

Options:
  --client <slug>         Roll only this client. Still builds and pushes.
  --registry-port <port>  Host registry port (default 5000).
  --timeout <seconds>     How long to wait for a rolled client to answer on
                          its loopback port (default 120).
  -h, --help              Show this message.

Examples:
  ops/release.sh                     # build HEAD, roll every client
  ops/release.sh --client acme       # build HEAD, roll only acme
USAGE
}

CLIENT_ROOT=/srv/lexi
REGISTRY_PORT=5000
HEALTH_TIMEOUT=120
ONLY_CLIENT=""
GIT_REF="HEAD"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname -- "$SCRIPT_DIR")"

SHA=""
APP_TAG=""
AGENT_TAG=""

# slug<TAB>outcome<TAB>running image, one per rolled client. Printed verbatim
# at the end, because the summary is the point of the script.
SUMMARY=()
FAILURES=0

die() {
  echo "release: $*" >&2
  exit 1
}

note() {
  echo "release: $*"
}

parse_args() {
  local positional=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --client)
        [ $# -ge 2 ] || die "--client needs a slug"
        ONLY_CLIENT="$2"
        shift 2
        ;;
      --registry-port)
        [ $# -ge 2 ] || die "--registry-port needs a value"
        REGISTRY_PORT="$2"
        shift 2
        ;;
      --timeout)
        [ $# -ge 2 ] || die "--timeout needs a value in seconds"
        HEALTH_TIMEOUT="$2"
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
    die "expected at most one git ref, got ${#positional[@]}: ${positional[*]}"
  fi
  [ "${#positional[@]}" -eq 1 ] && GIT_REF="${positional[0]}"

  case "$REGISTRY_PORT" in
    '' | *[!0-9]*) die "--registry-port must be a whole number, got: ${REGISTRY_PORT}" ;;
  esac
  case "$HEALTH_TIMEOUT" in
    '' | *[!0-9]*) die "--timeout must be a whole number of seconds, got: ${HEALTH_TIMEOUT}" ;;
  esac
  if [ -n "$ONLY_CLIENT" ]; then
    [[ "$ONLY_CLIENT" =~ ^[a-z][a-z0-9-]{1,30}$ ]] ||
      die "--client '${ONLY_CLIENT}' is not a valid slug"
    [ -d "${CLIENT_ROOT}/${ONLY_CLIENT}" ] ||
      die "no client at ${CLIENT_ROOT}/${ONLY_CLIENT}. Provision it first: ops/provision-client.sh ${ONLY_CLIENT} <hostname> <port>"
  fi
  return 0
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "must run as root (it acts as every client user). Try: sudo $0 ..."
}

resolve_sha() {
  command -v git >/dev/null 2>&1 || die "git is not installed, and the image tag is a git short SHA"
  [ -d "${REPO_ROOT}/.git" ] || die "${REPO_ROOT} is not a git checkout; the image tag comes from its history"

  SHA="$(git -C "$REPO_ROOT" rev-parse --short "$GIT_REF" 2>/dev/null || true)"
  [ -n "$SHA" ] || die "git could not resolve '${GIT_REF}' in ${REPO_ROOT}"

  APP_TAG="127.0.0.1:${REGISTRY_PORT}/lexi/app:${SHA}"
  AGENT_TAG="127.0.0.1:${REGISTRY_PORT}/webagent/agent:${SHA}"

  # Said out loud because the images are built from the working tree, not from
  # the ref: a dirty tree produces an image whose tag names a commit it is not.
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
    note "WARNING: the working tree at ${REPO_ROOT} has uncommitted changes. The images will contain them, tagged ${SHA}."
  fi
  note "releasing ${SHA}"
}

require_registry() {
  curl -fsS -o /dev/null "http://127.0.0.1:${REGISTRY_PORT}/v2/" 2>/dev/null ||
    die "no registry answering http://127.0.0.1:${REGISTRY_PORT}/v2/. Run ops/bootstrap-host.sh, or pass --registry-port."
}

# `docker compose build` refuses to parse a service whose env_file is absent,
# even though nothing about a build reads it. On a client host the checkout is
# a build source and has no .env of its own, and creating one empty is honest:
# every value the build needs already has a default in docker-compose.yml.
#
# Empty is still the right content. `.dockerignore` excludes `.env` and
# `node_modules` from the build context, so neither can be baked into a client
# image by accident — but a populated `.env` in a build checkout is a secret
# sitting on disk for no reason, and the exclusion is one edit away from not
# covering it.
ensure_build_env_file() {
  [ -f "${REPO_ROOT}/.env" ] && return 0
  install -m 0600 /dev/null "${REPO_ROOT}/.env"
  printf '%s\n' \
    '# Empty on purpose. This checkout builds images; it does not run one.' \
    '# Each client keeps its own .env at /srv/lexi/<slug>/.env.' \
    >"${REPO_ROOT}/.env"
  note "created an empty ${REPO_ROOT}/.env so 'docker compose build' can parse the file"
  return 0
}

build_images() {
  ensure_build_env_file

  # Built through Compose rather than `docker build` so the app's Dockerfile
  # stays in exactly one place: docker-compose.yml's dockerfile_inline. With
  # APP_IMAGE set, Compose tags what it builds as that name.
  note "building ${APP_TAG}"
  APP_IMAGE="$APP_TAG" docker compose \
    -f "${REPO_ROOT}/docker-compose.yml" --project-directory "$REPO_ROOT" build app ||
    die "the app image failed to build. The output above names the step."

  note "building ${AGENT_TAG}"
  docker build -t "$AGENT_TAG" "${REPO_ROOT}/agent" ||
    die "the agent image failed to build."

  # Unqualified aliases too, so `docker images` on this host reads as the
  # repository's own names and not only as registry paths.
  docker tag "$APP_TAG" "lexi/app:${SHA}"
  docker tag "$AGENT_TAG" "webagent/agent:${SHA}"
}

push_images() {
  note "pushing to 127.0.0.1:${REGISTRY_PORT} (plain HTTP; Docker treats loopback registries as insecure by default, which is why there is no TLS here and why it must stay on loopback)"
  docker push "$APP_TAG" >/dev/null || die "could not push ${APP_TAG}"
  docker push "$AGENT_TAG" >/dev/null || die "could not push ${AGENT_TAG}"
  note "pushed both images"
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

# A pull is tried first and a `docker save | docker load` is the fallback,
# because whether a rootless daemon can reach the host's loopback is a property
# of the RootlessKit network driver and not something to assume: rootless
# dockerd runs in its own network namespace, and Docker's default setup starts
# it with host-loopback access disabled, so 127.0.0.1:5000 there is the
# daemon's own loopback rather than the host's. The registry still earns its
# place — the image is built once and stored once either way — and the fallback
# costs a decompression per client, not a rebuild per client. Both paths end
# with the identical reference on the client daemon, so APP_IMAGE does not have
# to know which one ran.
deliver_image() {
  local slug="$1" tag="$2"

  if run_as_client "$slug" docker image inspect "$tag" >/dev/null 2>&1; then
    return 0
  fi
  if run_as_client "$slug" docker pull --quiet "$tag" >/dev/null 2>&1; then
    return 0
  fi

  echo "  ${slug}: registry not reachable from the rootless daemon; transferring ${tag} directly"
  docker save "$tag" | run_as_client "$slug" docker load >/dev/null
}

# Rewritten through a temporary file in the same directory rather than `sed -i`
# so the file's owner and 0600 mode are chosen deliberately instead of being
# whatever the last writer happened to leave. The file holds every secret this
# client has; it must never exist world-readable, even for an instant.
set_env_value() {
  local env_file="$1" name="$2" value="$3" slug="$4"
  local tmp
  tmp="$(mktemp "$(dirname -- "$env_file")/.env.XXXXXX")"
  chown "${slug}:${slug}" "$tmp"
  chmod 0600 "$tmp"

  if grep -qE "^${name}=" "$env_file"; then
    sed "s|^${name}=.*|${name}=${value}|" "$env_file" >"$tmp"
  else
    cat "$env_file" >"$tmp"
    printf '%s=%s\n' "$name" "$value" >>"$tmp"
  fi
  mv -- "$tmp" "$env_file"
  chown "${slug}:${slug}" "$env_file"
  chmod 0600 "$env_file"
}

# Empty rather than failing when the name is absent: pipefail would otherwise
# turn "PORT_HOST is not set" into a silent non-zero return from the caller,
# and the message is the whole value of checking.
read_env_value() {
  local env_file="$1" name="$2"
  grep -E "^${name}=" "$env_file" 2>/dev/null | tail -n 1 | cut -d= -f2- || true
}

# Any HTTP status counts as alive. `/` legitimately answers 302 or 401 to an
# unauthenticated caller, so a `curl -f` health check would call a perfectly
# healthy installation dead.
wait_for_http() {
  local port="$1" deadline code
  deadline=$(($(date +%s) + HEALTH_TIMEOUT))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/" || true)"
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

running_image() {
  local slug="$1" dir="$2" cid
  cid="$(run_as_client "$slug" docker compose -f "${dir}/docker-compose.yml" --project-directory "$dir" ps -q app 2>/dev/null | head -n 1 || true)"
  [ -n "$cid" ] || {
    echo "(not running)"
    return 0
  }
  run_as_client "$slug" docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || echo "(unknown)"
}

roll_client() {
  local slug="$1"
  local dir="${CLIENT_ROOT}/${slug}"
  local env_file="${dir}/.env" port

  echo
  note "rolling ${slug}"

  [ -f "$env_file" ] || {
    echo "  ${slug}: no .env at ${env_file}; provision it first" >&2
    return 1
  }
  port="$(read_env_value "$env_file" PORT_HOST)"
  [ -n "$port" ] || {
    echo "  ${slug}: PORT_HOST is not set in ${env_file}" >&2
    return 1
  }

  deliver_image "$slug" "$APP_TAG" || {
    echo "  ${slug}: could not deliver ${APP_TAG} to its daemon" >&2
    return 1
  }
  deliver_image "$slug" "$AGENT_TAG" || {
    echo "  ${slug}: could not deliver ${AGENT_TAG} to its daemon" >&2
    return 1
  }

  # Written into .env, not exported for the one command: Compose interpolates
  # .env, and a client restarted by systemd or by hand after a reboot must come
  # back on the tag it was rolled to and not on whatever it was provisioned with.
  set_env_value "$env_file" APP_IMAGE "$APP_TAG" "$slug"
  set_env_value "$env_file" AGENT_IMAGE "$AGENT_TAG" "$slug"

  run_as_client "$slug" docker compose -f "${dir}/docker-compose.yml" --project-directory "$dir" up -d || {
    echo "  ${slug}: 'docker compose up -d' failed" >&2
    return 1
  }

  if ! wait_for_http "$port"; then
    echo "  ${slug}: no HTTP answer on 127.0.0.1:${port} within ${HEALTH_TIMEOUT}s." >&2
    echo "  ${slug}: startup validation refuses to serve on a bad setting and says which. Read: ops/status.sh ${slug} --logs" >&2
    return 1
  fi

  note "${slug} answering on 127.0.0.1:${port}"
  return 0
}

roll_all() {
  local dir slug outcome image
  local rolled=0

  for dir in "$CLIENT_ROOT"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename -- "$dir")"
    [ -n "$ONLY_CLIENT" ] && [ "$slug" != "$ONLY_CLIENT" ] && continue
    if ! id -u "$slug" >/dev/null 2>&1; then
      SUMMARY+=("${slug}"$'\t'"SKIPPED"$'\t'"no such Linux user")
      continue
    fi

    rolled=$((rolled + 1))
    if roll_client "$slug"; then
      outcome="ok"
    else
      outcome="FAILED"
      FAILURES=$((FAILURES + 1))
    fi
    image="$(running_image "$slug" "${CLIENT_ROOT}/${slug}")"
    SUMMARY+=("${slug}"$'\t'"${outcome}"$'\t'"${image}")
  done

  [ "$rolled" -gt 0 ] || die "no clients rolled. ${CLIENT_ROOT} is empty — provision one first."
}

print_summary() {
  local line
  echo
  echo "release: ${SHA} — what is running where"
  echo
  {
    printf 'CLIENT\tRESULT\tRUNNING IMAGE\n'
    for line in "${SUMMARY[@]}"; do printf '%s\n' "$line"; done
  } | column -t -s $'\t' 2>/dev/null || printf '%s\n' "${SUMMARY[@]}"
  echo

  if [ "$FAILURES" -gt 0 ]; then
    echo "release: ${FAILURES} client(s) failed and are still on their previous image. The rest are on ${SHA}." >&2
    exit 1
  fi
  echo "release: every client rolled is on ${SHA}."
}

main() {
  parse_args "$@"
  require_root
  resolve_sha
  require_registry
  build_images
  push_images
  roll_all
  print_summary
}

main "$@"
