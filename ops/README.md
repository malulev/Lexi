# ops — many clients, one VPS

The root README installs one client on one machine by hand. This directory does that 5–25
times on the same box without the clients being able to reach each other.

**One Linux user per client, each running its own rootless dockerd.** That is the whole idea.
The application mounts a Docker socket, and a socket is the authority of whoever owns the
daemon behind it. Point every installation at the root daemon and one client's remote code
execution is root on the box and every other client's secrets. Point client A at a daemon owned
by user A and the same compromise buys user A: A's `.env`, A's state, and nothing of B's.

```
/srv/lexi/<slug>/          0700 <slug>:<slug>
  .env                       0600 <slug>:<slug>    secrets, hand-filled
  docker-compose.yml         0600 <slug>:<slug>    copied from the repository
  state/                     0700 <slug>:<slug>    WEBAGENT_STATE_DIR
```

Both images are built **once**, on the host's root daemon, tagged by git short SHA, and stored
in a registry container on `127.0.0.1:5000`. Twenty clients each running `npm ci && npm run
build` on a shared 2 vCPU box is twenty times the work for one identical artefact. The registry
is on loopback because Docker treats loopback registries as insecure-by-default — which is
exactly why there is no TLS to configure, and exactly why it must never be reachable off-box.

A root-owned reverse proxy (Caddy) terminates TLS and forwards to each client's own
loopback-only port.

## The scripts

| Script | Run as | When |
|---|---|---|
| `bootstrap-host.sh` | root | Once per VPS. Docker, the rootless prerequisites, `/srv/lexi`, the registry, a Compose ≥ 2.17 check. |
| `provision-client.sh <slug> <hostname> <port>` | root | Once per client. The user, its rootless daemon, the 0700 tree, a `.env` skeleton. Starts nothing. |
| `release.sh [git-ref]` | root | Every deploy. Builds and pushes both images, then rolls each client forward one at a time. `--client <slug>` for one. |
| `status.sh [<slug>]` | root | Any time. One line per client, plus the host-wide agent total. `--logs` to see why one is unhappy. |
| `launch-client.sh <slug> <hostname> [port]` | root | The four steps above for one new client, in order, with the hand steps between them: opens `.env` in an editor, mints the secrets, runs `check:env`, waits for DNS, adds the Caddy block, checks HTTPS. Re-run after a failure; it resumes. |

All four are idempotent. All four refuse rather than guess.

Order: `bootstrap-host.sh` → `provision-client.sh` → fill in `.env` by hand → `release.sh`.
Or, for one client end to end: `bootstrap-host.sh` once, then `launch-client.sh` per client.

`provision-client.sh` deliberately mints no secrets and starts no stack. Secrets come from
`npm run gen:secrets`, appended to the client's `.env` by a person; a stack started before its
`.env` was filled in would only fail startup validation in a way that reads like a bug.

## From a fresh Ubuntu 24.04 VPS to one client serving traffic

```bash
# --- once per host, as root -------------------------------------------------
apt-get update && apt-get install -y git curl
mkdir -p /opt/lexi && git clone <this repository> /opt/lexi/src
cd /opt/lexi/src
ops/bootstrap-host.sh

apt-get install -y caddy          # or your proxy of choice

# --- once per client --------------------------------------------------------
ops/provision-client.sh acme edit.acme.example 3001

# Fill in the GitHub App, Netlify, OpenRouter, SMTP and ALLOWED_EMAILS values:
sudoedit /srv/lexi/acme/.env

# Mint the three secrets and append them AS the client user, so the file stays
# 0600 and no value is ever echoed to your terminal. The toolchain runs in a
# throwaway copy of the checkout so the host needs no Node installed, and so
# that /opt/lexi/src stays a clean build source.
docker run --rm -v /opt/lexi/src:/src:ro -w /build node:22-slim \
  sh -c 'cp -a /src/. /build && npm ci --silent \
         && npm run --silent gen:secrets' \
  | sudo -u acme tee -a /srv/lexi/acme/.env >/dev/null

# Later, once the stack is up: mint the client's enrollment link and send it
# to them. It shows the authenticator QR once and works for 24 hours. The
# secret itself is never printed.
docker run --rm -v /opt/lexi/src:/src:ro -v /srv/lexi/acme/.env:/secret/.env:ro -w /build node:22-slim \
  sh -c 'cp -a /src/. /build && cp /secret/.env /build/.env && npm ci --silent && npm run --silent enroll:link'

# Confirm it parses. It prints variable names and never values:
docker run --rm -v /opt/lexi/src:/src:ro -v /srv/lexi/acme/.env:/secret/.env:ro \
  -w /build node:22-slim \
  sh -c 'cp -a /src/. /build && cp /secret/.env /build/.env \
         && npm ci --silent && npm run --silent check:env'

# --- build and roll ---------------------------------------------------------
ops/release.sh --client acme

# --- hostname and TLS -------------------------------------------------------
# First, at the DNS provider: an A record for edit.acme.example -> this VPS's
# public IP (and AAAA for IPv6). Caddy cannot issue a certificate until it resolves.
cat >>/etc/caddy/Caddyfile <<'CADDY'
edit.acme.example {
    reverse_proxy 127.0.0.1:3001
}
CADDY
systemctl reload caddy
ufw allow 22,80,443/tcp && ufw --force enable

ops/status.sh
```

The second client is the last three blocks again with a new slug, hostname and port. Deploying
new code to all of them afterwards is one command: `ops/release.sh`.

## The two things not to get wrong

### 1. `state/` must stay 0700

`WEBAGENT_STATE_DIR` holds a full git checkout of the client's repository, one per running
request. The application makes each of those working trees **world-writable**, because the agent
container runs as a mapped subordinate UID that is nobody the host has heard of. That is
deliberate and it is not the hole — the hole would be a parent directory anyone can traverse.
The `0700` on `/srv/lexi/<slug>/` and on `state/` is the containment. Never relax it "so the
agent can write": the agent reaches its tree through a bind mount, which the daemon resolves
once, as `<slug>`, so the container process never traverses the parent at all.

`provision-client.sh` re-applies both modes on every run. If you change them by hand, re-run it
with `--force`.

### 2. `MAX_CONCURRENT_RUNS` is now per client, not host-wide

The application counts running agent containers on **its own** daemon to decide whether a
request may start (`src/lib/runner/slots.ts`), and its comments — and the root README — call
that count host-wide. That was true when every installation shared one daemon. Under this
topology each client has its own, so:

**the host total is the sum across clients, and nothing in the application will ever tell you
that.**

Budget roughly **1 GB of RAM per concurrent run**, on top of one app container per client.
Twenty clients at `MAX_CONCURRENT_RUNS=2` is a ceiling of forty concurrent agents and about
40 GB — on a box that was probably sized for a tenth of it. Pick the per-client number from the
host's RAM divided by the number of clients, not from the root README's rule of thumb, and
check the real figure with `ops/status.sh`, whose `TOTAL` line is the only place it is
reported.

## Notes

- **Image delivery.** `release.sh` pushes to the loopback registry and then tries `docker pull`
  as each client. A rootless daemon runs in its own network namespace with host-loopback access
  disabled by default, so that pull may not reach `127.0.0.1:5000`; when it does not, the script
  transfers the image with `docker save | docker load` and says so. Either path ends with the
  identical image reference on the client's daemon, so nothing downstream has to know which ran.
  The registry earns its place regardless: the image is built once and stored once.
- **`PORT` must never appear in a client `.env`.** That file is both interpolated by Compose and
  passed into the container, where Next reads `PORT` as its listen port — set it there and the
  published mapping stops matching. Use `PORT_HOST`, which `provision-client.sh` fills in.
- **Backups.** Each client's `.env`, which holds the authenticator secret. That is the entire list; `state/` is a
  cache that rebuilds itself, and everything else lives in GitHub and Netlify.
- **A client's daemon after a reboot.** `loginctl enable-linger` plus `systemctl --user enable
  docker` is what brings it back with nobody logged in. `provision-client.sh` does both; if a
  client is `daemon: down` in `status.sh` after a reboot, that pair is what to check.
