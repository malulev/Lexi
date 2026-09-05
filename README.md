# Prosel

*Say what you want changed. See it before it goes live.*

A client describes a change to their website in plain language. An agent makes it on a branch,
a preview is built, and the client presses one button to publish. No diffs, no branch names, no
build logs — and nothing reaches the live site without a person approving it.

The product's name, tagline and mark live in `src/lib/brand.ts` and `src/components/Brand.tsx`;
every client surface reads them from there.

**One installation serves one website.** There is no site selector and no tenant column: you
install this once per client site, the way you would install a self-hosted CMS. Isolation
between clients is structural, because a second client's data is never present.

---

## Before you start

Get these four things in place first. The one worth double-checking is the first.

### 1. A site on Netlify with Deploy Previews enabled

The client's site must be a GitHub repository linked to a Netlify site, with
**Site configuration → Build & deploy → Deploy Previews → enabled for pull requests**.

Without it the loop silently waits forever: the agent's change is pushed, the pull request
opens, and no preview is ever built for it, so nothing is ever ready to approve. Nothing in the
product reports this as an error, because from its point of view the build simply has not
finished yet. Verify it before anything else.

### 2. A GitHub App, installed on that one repository

github.com/settings/apps → **New GitHub App**.

- Repository permissions: **Contents — read and write**, **Pull requests — read and write**.
  Nothing else. The App needs no organisation permissions and no account permissions.
- **Uncheck Webhook → Active.** This installation does not receive GitHub webhooks.
- Generate a private key; a `.pem` downloads.
- Install the App on the client's repository **only**.

You need three values: the **App ID** from the App's settings page, the **private key** file,
and the **installation ID** — the number at the end of the URL you land on after installing,
`github.com/settings/installations/<installation id>`. The installation ID is not the App ID,
and mixing them up is the single most common setup mistake.

### 3. A Netlify personal access token and the site ID

app.netlify.com → User settings → Applications → **New access token**, and the site ID from
Site configuration → General.

Be clear-eyed about what that token is: **Netlify personal access tokens are account-wide.**
There is no per-site scoping, so the token this installation holds can reach every site in the
account it belongs to. If that matters, put the client's site in its own Netlify account or
team and mint the token there.

### 4. An OpenRouter key, SMTP credentials, and Docker

- An OpenRouter API key, **with a spending limit set on it**. Every request runs a real model.
- SMTP credentials for the sign-in emails and notifications.
- Docker, and Docker Compose v2.17 or newer (`docker compose version`).

---

## Install

```bash
git clone <this repository>
cd website-ai-auto-builder
npm ci
```

### Configure

Secrets and the identity of the one site go in the environment. Operational settings go in the
client's repository. Nothing crosses that line: a secret committed to the site's repository is
rejected rather than honoured (FR-003d), and so is any attempt to grant sign-in access from
there (FR-003c1).

```bash
cp .env.example .env
npm run gen:secrets -- --password 'a console password you pick' >> .env
```

`gen:secrets` mints the four values nobody should choose by hand — `SESSION_SECRET`,
`NETLIFY_WEBHOOK_SECRET`, `CONFIG_PASSWORD_HASH` (an argon2 hash of the password you passed;
the password itself is never stored) and `CONFIG_TOTP_SECRET`. It writes to stdout and nothing
else, so append it to the file rather than copying values through a terminal you can scroll
back through.

Write them with the generator rather than by hand, because **a dotenv file expands `$NAME`
references and quoting does not stop it**: an argon2 hash pasted in raw arrives gutted —
`$argon2id$v=19$m=...` becomes `=19=65536,...`. It still looks like a secret, and the only thing
that notices is startup validation. The generator escapes what it emits.

Add the `CONFIG_TOTP_SECRET` to an authenticator app now, while you have it: it is the second
factor on the configuration surface, and there is no recovery path if it is lost. Re-run
`gen:secrets` and redeploy is the recovery path.

Then fill in the rest by hand — the GitHub App values, the Netlify token and site id, the
OpenRouter key, `SMTP_URL` and `SMTP_FROM`, `PUBLIC_BASE_URL`, and:

```bash
# Who may sign in. Deployment configuration, never repository configuration:
# write access to the client's repository must not confer access to the
# editing interface (FR-003c1).
ALLOWED_EMAILS=jane@client.example,marketing@client.example
```

One more variable is optional and matters only when several installations share one host:

```bash
# How many agent containers may run at once on the Docker daemon this
# installation talks to. A request that arrives while the limit is reached
# waits its turn (the client sees "Waiting for a free turn"), and gives up
# after fifteen minutes. Default 2, roughly 1 GB of RAM each.
#
# Under the multi-client topology below every client has its OWN rootless
# daemon, so this is a per-client cap and the host total is the sum.
MAX_CONCURRENT_RUNS=2
```

The private key can be pasted with literal `\n` sequences or wrapped in double quotes across
several lines; both survive. Losing the `-----BEGIN`/`-----END` lines does not.

```bash
npm run check:env
```

`check:env` reads `.env` and `.env.local` the way Next.js does, reports every variable that is
missing, malformed, or present but empty, warns when a name in `.env.local` is silently
shadowing one in `.env` — and never prints a value.

### Commit the settings to the client's repository

```yaml
# .webagent/config.yml — operational settings only
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-5   # runs when a request names no tier
maxRequestMinutes: 10
# Optional. Clients choose an effort tier in the composer, not a model; each
# tier has a built-in model and any of them can be re-pointed here.
models:
  free: openrouter/cohere/north-mini-code:free
  # low: openrouter/deepseek/deepseek-v4-flash-0731
  # medium: openrouter/anthropic/claude-sonnet-5
  # high: openrouter/anthropic/claude-opus-5
  # extra: openrouter/anthropic/claude-fable-5.1
# Optional. Where files a client attaches land in the site. Default public/uploads.
uploadDir: public/uploads
```

The composer offers five effort tiers — Free, Basic, Standard, Advanced, Expert — ordered by
cost. The picker opens on the tier whose model matches `model`, and the configuration page lists
what each tier runs. Attachments (images and PDF files, up to 10 MB each, 25 MB and five files per
message) are committed into `uploadDir` with the change they came with, so the policy gates them
like any other file. "Show details" under the picker (advanced mode) reveals the model each tier
runs and an estimated cost for a small example task such as replacing a logo, and each finished
change then shows the model and cost it actually used. The interface speaks English, Hebrew, Dutch
and French: a switcher in the header remembers the choice in a `webagent.locale` cookie, and the
agent's own summaries stay in whatever language the agent wrote them.

The policy gate is deliberately strict about what an agent can never touch, whatever the site's
`allow` list says: its own rules and guidance, anything the hosting runs (`netlify/**`,
`_redirects`, `_headers`, `api/**`, `functions/**`), build-time configuration, git configuration,
manifests and lockfiles. Symbolic links are refused outright, and by default a change may not add
markup that loads or runs code from another origin (`forbidExternalCode: true`). Attached files
pass the allow list only while they are byte-for-byte what the client sent; an attached SVG with
scripting in it is refused at upload.

```yaml
# .webagent/policy.yml — what the agent may change
allow:
  - 'src/components/**'
  - 'src/content/**'
  - 'public/images/**'
deny:
  - 'src/lib/payments/**'
maxFilesChanged: 15
maxDiffLines: 800
forbidNewDependencies: true
```

Optionally an `AGENTS.md` at the repository root: brand rules, tone, component conventions.
It is advisory — it never widens what the policy permits, and the agent may not edit it.

Both files are strict. An unknown key fails loudly rather than being ignored, `allowedEmails`
is rejected with a message telling you where sign-ins actually live, and any key that reads
like a credential is rejected as a committed secret. `.webagent/**` and `AGENTS.md` are on the
list of paths no site policy can permit the agent to touch, whatever `allow` says.

---

## Running it locally

Two ways to run it, and the difference is worth knowing. `npm run dev` is the fast loop for
working on the product. `docker compose up` is what a server runs, and the only way to test the
Compose wiring itself.

Both need a Docker daemon, including the development server: every request starts a throwaway
agent container on whatever daemon is local, so the image has to exist before the first request.

```bash
docker build -t webagent/agent:latest agent/   # once, and again after any change under agent/
```

### The development server

```bash
export WEBAGENT_STATE_DIR="$PWD/.webagent-state"   # must be set; see below
npm run check:env
npm run dev
```

`http://localhost:3000`, with `PUBLIC_BASE_URL=http://localhost:3000` in `.env` so the sign-in
links point back at the machine you are on. Nothing here needs a public address: the
orchestrator polls Netlify for the deploy, so the whole request-to-preview loop completes with
no inbound URL, no tunnel and no webhook.

**`WEBAGENT_STATE_DIR` must be set.** It defaults to `/var/lib/webagent`, which is not writable
on a development machine, and the failure — the git mirror cannot be created — surfaces in the
middle of the first request rather than at startup. Point it at a directory you own.

To skip the email round-trip while testing the loop:

```bash
npm run dev:session -- --out /tmp/jar.txt          # a signed cookie for the first ALLOWED_EMAILS address
curl -b /tmp/jar.txt localhost:3000/api/conversations
```

Startup validation runs here too, and **refuses to serve** on a bad setting rather than starting
degraded: an unreachable repository, an installation that does not answer, an unreachable
Netlify site, a configuration credential no one could ever present (FR-003b). A `dev` that exits
naming a variable has told you something true.

### The same thing under Compose

```bash
docker compose up --build
```

Read the comment at the top of `docker-compose.yml` before you do. It mounts the Docker socket,
which is equivalent to root on the host, and it records the hardening path.

Under Compose `WEBAGENT_STATE_DIR` has a second constraint: the path must be **identical inside
the container and on the host**, which is why the file bind-mounts it to itself rather than
using a named volume. The application asks the host's daemon to mount a working tree into the
agent container, and that daemon resolves the path on the host, not inside the app container. A
named volume, or two different paths, produces an agent mounted on an empty directory and a
request that changes nothing.

### Before you push anything

```bash
npm run lint && npm run typecheck && npm test && npm run test:int
```

### The helper scripts, in one place

| Command | What it does |
|---|---|
| `npm run check:env` | Reports which variables are missing, malformed, or empty. Prints no values. |
| `npm run gen:secrets -- --password '<yours>'` | Mints the session secret, webhook secret, argon2 password hash, and TOTP secret. |
| `npm run dev:session -- --out <path>` | Writes a curl cookie jar holding a valid session, bypassing the sign-in email. |
| `npm test` | Unit tests: policy gate, record round-trip, state machine, configuration. |
| `npm run test:int` | Route handlers and startup validation against fakes and recorded fixtures. |
| `npm run test:e2e` | Request-to-preview and approve-and-undo. |

---

## Deploying on a VPS

One box serves many clients, but **not by sharing anything**. Each client gets its own Linux
user running its own rootless Docker daemon, its own `/srv/prosel/<slug>` at mode 0700, and its
own Compose project. That per-user daemon is the whole boundary: the socket this application
mounts is root on whoever owns it, so a compromise reaches one unprivileged client user rather
than the host — and the next client's secrets, mirror and history stay unreadable because the
kernel says so.

A socket proxy is not an alternative. It filters paths, not request bodies, and the runner needs
`POST /containers/create`, whose body carries the bind mounts.

`ops/` automates all of it; `ops/README.md` is the operator's reference. Sizing: ~1 GB of RAM per
concurrent agent run plus ~250 MB per idle installation, so 4 GB carries a handful of clients and
16 GB carries 20–25. For disk, allow ~10 GB per client for the mirror and working trees, plus
about 1.2 GB of images — each client's rootless daemon keeps its own image store, so the app and
agent images are paid per client rather than shared. (That is why the app image is a standalone
multi-stage build: the obvious single-stage one is 2 GB, which is 40 GB across twenty clients.)

### Once per host

```bash
apt-get update && apt-get install -y git curl caddy
git clone <this repository> /opt/prosel/src && cd /opt/prosel/src
ops/bootstrap-host.sh            # Docker, rootless prerequisites, /srv/prosel, local registry
ufw allow 22,80,443/tcp && ufw --force enable
```

### Once per client

```bash
ops/provision-client.sh acme edit.acme.example 3001   # user, rootless daemon, 0700 tree, .env skeleton
sudoedit /srv/prosel/acme/.env                        # GitHub App, Netlify, OpenRouter, SMTP, ALLOWED_EMAILS
```

`provision-client.sh` prints the remaining steps verbatim, including how to run `gen:secrets` and
`check:env` in a throwaway container so the host needs no Node toolchain. Add the printed
`CONFIG_TOTP_SECRET` to an authenticator before you move on; there is no recovery path for it.

Then publish it:

```bash
ops/release.sh --client acme     # build once, deliver, start, wait for it to answer
cat >>/etc/caddy/Caddyfile <<'CADDY'
edit.acme.example {
    reverse_proxy 127.0.0.1:3001
}
CADDY
systemctl reload caddy
ops/status.sh                    # daemon, container, HTTP, running agents, deployed tag
```

Startup validation refuses to serve on a bad setting rather than starting degraded, naming the
variable to fix (FR-003b) — so a client that comes up and answers is a client whose repository,
App installation, hosting site and configuration credential all check out.

### Releasing new code

```bash
cd /opt/prosel/src && git pull && ops/release.sh
```

Both images are built **once** on the host's root daemon, tagged with the git short SHA, and
delivered to each client's daemon; twenty installations do not each run `npm ci && npm run
build`. Clients roll one at a time, a failure on one is stepped over rather than aborting the
rest, and the summary reports the image each client is actually running. Restarting mid-request
is safe: the request is reconstructed from its pull request and its lock is broken as stale
(FR-009).

### Four things not to get wrong

- **`/srv/prosel/<slug>` and its `state/` stay 0700.** They are the containment. The application
  makes each per-request working tree writable by the agent container's foreign uid
  (`src/lib/runner/permissions.ts`), which is safe precisely because nothing outside that
  installation can traverse the directory holding it.
- **`MAX_CONCURRENT_RUNS` is per client here, not host-wide.** The application counts agent
  containers on its own daemon (`src/lib/runner/slots.ts`), and each client now has a different
  one, so the host total is the sum across installations. Budget it, roughly 1 GB per run.
- **Set `PORT_HOST`, never `PORT`.** `.env` is both interpolated by Compose and passed into the
  container, where Next reads `PORT` as its listen port — setting it moves both halves of the
  mapping and the mapping stops matching. Give each client a distinct `PORT_HOST`, bound to
  loopback, with the reverse proxy in front.
- **Never run `docker compose build` in a client directory.** The client holds a compose file,
  a `.env` and state — no source. Releases build in `/opt/prosel/src`, on the root daemon, via
  `ops/release.sh`.

### What to back up

Each client's `.env`, and its TOTP secret in an authenticator. That is the whole list. The state
directory is a cache that rebuilds itself from a fresh clone, and published state, pending
changes, conversation history and the audit trail live in GitHub and Netlify — there is no
datastore here to lose.

---

## The Netlify outgoing webhook is optional

Netlify → Site configuration → Notifications → outgoing webhook, for **deploy started**,
**deploy succeeded** and **deploy failed**, pointing at
`$PUBLIC_BASE_URL/api/webhooks/netlify`, signed with the `NETLIFY_WEBHOOK_SECRET` from
`gen:secrets`.

Set it up if this installation has a public address. **Skip it if it does not.** The
orchestrator also polls Netlify for the deploy, so the whole loop completes with no inbound URL
at all — no tunnel, no ngrok, nothing to expose. The webhook only makes the preview appear a
few seconds sooner.

---

## Configuration surface

`/settings`, behind a password and a time-based code — a credential distinct from and stronger
than a client sign-in, because it is the credential that could point this installation at a
different website (FR-003a). It shows the deployment configuration in force, the settings and
policy read from the site's repository, and any fault in them.

It is **read-only**. Changing a setting means committing to the client's repository, which is
the point: an operational change is then a reviewable, versioned edit with an author, not an
unattributed mutation in a web form. When the settings file is invalid, the last valid settings
stay in force, the fault is reported to the alert contact, and this page shows it — access
control never falls open on a broken file (FR-003f).

---

## Proving it works

1. **Sign-in is restricted.** `POST /api/auth/request` with an address not in `ALLOWED_EMAILS`
   returns `202` and sends no email. The response never reveals which addresses are permitted.
2. **Request to preview.** Sign in, ask for "change the homepage headline to *Built for
   speed*". Expect an acknowledgement in seconds, a visible stage change inside a minute, and a
   preview link within about four — with the live site unchanged.
3. **The gate holds.** Ask the agent to edit `.webagent/policy.yml`. It is refused whatever the
   policy says, and nothing is committed anywhere — there is no branch to discard, because no
   commit was ever made.
4. **One request at a time.** A second message while one is running is refused by the server
   with `409`, not merely greyed out in the browser.
5. **History survives a restart.** Restart mid-request and reopen the conversation: it is
   rebuilt from the pull request's comments, because that is the only place it ever lived.
6. **Publish and undo.** Approve, see it live; press Undo, see the revert in the repository —
   not just a rolled-back deploy.

---

## Running the live end-to-end suite

`npm run test:e2e` is not part of the normal check loop. Its six tests drive a **real**
installation against a real repository, a real model and real build minutes: each run opens a
pull request and spends money. They skip loudly unless you opt in, which is why a green
`test:e2e` on an unconfigured machine means "skipped six", not "passed six".

Point an installation at a throwaway site first, then:

```bash
npm run dev                                        # terminal one
npm run dev:session -- --out /tmp/e2e-jar.txt      # terminal two
WEBAGENT_E2E=1 \
  WEBAGENT_E2E_COOKIE="$(awk '/webagent_session/ {print $7}' /tmp/e2e-jar.txt)" \
  WEBAGENT_E2E_LIVE_URL=https://the-throwaway-site.example \
  npm run test:e2e
```

`WEBAGENT_E2E_LIVE_URL` is only needed by the approve-and-undo journey, and it is supplied
rather than derived on purpose: deriving it from the preview URL would assert our own guess back
at us.

## Auditing a publish afterwards

The conversation is the client's view of what happened. This is the other one, and the point of
it is that undo is a commit rather than a hosting rollback:

```bash
gh pr view <number> --json merged,mergedAt
gh api repos/:owner/:repo/commits?sha=main \
  --jq '.[0:3][] | .sha[0:8] + "  " + (.commit.message | split("\n")[0])'
```

Expect the pull request merged, and above the merge commit a revert commit that names it. A
hosting rollback would leave the repository claiming the change is still live.

Two things remain unverified against a live run and are recorded as such in
`specs/001-conversational-site-editing/notes/netlify-payload-fields.md`: OpenCode's JSON output
field names for token and cost accounting, and Netlify's deploy field names used to correlate a
deploy back to a conversation.

---

## What it will not do

Deferred by explicit decision, not oversight: visual element picking, self-serve onboarding,
multi-model routing, billing, and any application database. Published state, pending changes,
conversation history and the audit trail live in GitHub and Netlify, which are the system of
record. Nothing is mirrored into a datastore, because there is no datastore.

See `.specify/memory/constitution.md` for the principles this is held to, and
`specs/001-conversational-site-editing/` for the specification, the plan, and the contracts.
