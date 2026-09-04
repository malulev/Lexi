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
# How many agent containers may run at once on this host's Docker daemon.
# Counted across every installation that uses the daemon. A request that
# arrives while the limit is reached waits its turn (the client sees
# "Waiting for a free turn"), and gives up after fifteen minutes.
# Default 2. Rule of thumb: one per 1 GB of RAM left after the app containers.
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

### Run

```bash
docker build -t webagent/agent:latest agent/
docker compose up --build
```

Read the comment at the top of `docker-compose.yml` before you do. It mounts the Docker socket,
which is equivalent to root on the host, and it records the hardening path.

Startup validates the configuration and **refuses to serve** on a bad setting, naming it and
what to check: an unreachable repository, an installation that does not answer, an unreachable
Netlify site, and a configuration credential no one could ever present. Expect explicit failure
here rather than a silent start (FR-003b).

### Several sites on one host

One installation serves one website, and nothing here changes that. Several installations
can share one machine, though: one directory, one `.env`, one Compose project per site, all
pointed at the same Docker daemon and fronted by a reverse proxy with a hostname each.

The daemon is the shared resource, so it is also the shared limit. Every agent container is
labelled, and a request counts the running ones before starting its own; while the count is at
`MAX_CONCURRENT_RUNS` the request waits, and the client sees "Waiting for a free turn". After
fifteen minutes it gives up with its own sentence and nothing is published. Set the same value
in every `.env` on the host; the count is host-wide whichever installation makes it.

---

## Running it for development

The application also runs outside Docker, which is the faster loop while working on it:

```bash
export WEBAGENT_STATE_DIR="$PWD/.webagent-state"   # see below
npm run dev
```

**`WEBAGENT_STATE_DIR` must be set.** It defaults to `/var/lib/webagent`, which is not writable
on a development machine, and the failure — the git mirror cannot be created — surfaces in the
middle of the first request rather than at startup. Point it at a directory you own.

Under Compose the same variable has a second constraint: the path must be **identical inside
the container and on the host**, which is why `docker-compose.yml` bind-mounts it to itself
rather than using a named volume. The application asks the host's Docker daemon to mount a
working tree into the agent container, and that daemon resolves the path on the host.

To skip the email round-trip while testing the loop:

```bash
npm run dev:session -- --out /tmp/jar.txt          # a signed cookie for the first ALLOWED_EMAILS address
curl -b /tmp/jar.txt localhost:3000/api/conversations
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

## Where this differs from `quickstart.md`

`specs/001-conversational-site-editing/quickstart.md` was written before the first real
installation. Where the two disagree, this file is the one that has been run. Corrections:

- **`WEBAGENT_STATE_DIR` is missing from the quickstart entirely.** It must be set on a
  development machine; the default is unwritable there, and the failure appears mid-request.
- **The Netlify outgoing webhook is described as a required step.** It is optional — the
  orchestrator polls — and it is impossible without a public address, which a first
  installation usually does not have.
- **The GitHub App permissions are worth stating exactly**: Contents and Pull requests, read
  and write, with the webhook unchecked. Nothing more is needed, and the quickstart's "read and
  write on contents and pull requests" is easy to over-read as a starting point.
- **The Netlify token is account-wide.** The quickstart does not say so, and the difference
  matters when the account holds sites other than the client's.
- **Deploy Previews is listed as a prerequisite but not as a failure mode.** Without it the
  loop does not error; it waits, indefinitely, which is much harder to diagnose than a failure.
- **The helper scripts do not appear there**: `check:env`, `gen:secrets`, and `dev:session`
  were written during the first real installation and are what make it repeatable.

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
