# Quickstart: Install and Validate

How a developer installs one instance for one client site, and how to prove the loop works.
Implementation detail belongs in `tasks.md`; this is the run-and-verify guide.

> **The repository README is the authoritative install guide.** This file is a specification
> artefact, kept because `plan.md` and `tasks.md` refer to it. It describes one installation on
> one machine; deploying several clients to one server, and the operations scripts that do it,
> live in `README.md` and `ops/README.md`. Where the two disagree, follow the README.

## Prerequisites

- A client site in a GitHub repository, deploying to Netlify with **Deploy Previews enabled**
  for pull requests. Verify this first — without it there is no preview and nothing to approve.
- Docker and Docker Compose on the host.
- A GitHub App installed on that one repository, with read and write on **contents** and **pull
  requests** and nothing else, and its **webhook unchecked** — this product does not receive
  GitHub webhooks. Note the App ID, private key, and installation ID.
- A Netlify personal access token and the site ID. The token is account-wide: Netlify has no
  per-site scoping, so treat it accordingly.
- An OpenRouter API key.
- SMTP credentials for notification email.

## Configure

Secrets go in the environment; settings go in the client's repository.

```bash
cp .env.example .env
npm run gen:secrets -- --password '<a configuration password you pick>' >> .env
```

`gen:secrets` mints `SESSION_SECRET`, `NETLIFY_WEBHOOK_SECRET`, `CONFIG_PASSWORD_HASH` and
`CONFIG_TOTP_SECRET`. Write them with it rather than by hand: **a dotenv file expands `$NAME`
references, and quoting does not stop it**, so an argon2 hash pasted in raw arrives gutted —
`$argon2id$v=19$m=...` becomes `=19=65536,...`. It still looks like a secret, and the only thing
that notices is startup validation. The generator escapes what it emits.

```bash
# .env — secrets and the one site this install serves
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY=...
GITHUB_INSTALLATION_ID=...
GITHUB_REPO=client-org/client-site
NETLIFY_TOKEN=...
NETLIFY_SITE_ID=...
NETLIFY_WEBHOOK_SECRET=...
OPENROUTER_API_KEY=...
SESSION_SECRET=...
ALLOWED_EMAILS=jane@client.example,marketing@client.example
CONFIG_PASSWORD_HASH=...      # argon2 hash
CONFIG_TOTP_SECRET=...
SMTP_URL=...
SMTP_FROM=webagent@agency.example
PUBLIC_BASE_URL=https://edit.client.example
WEBAGENT_STATE_DIR=/var/lib/webagent   # must be writable; see below
```

`WEBAGENT_STATE_DIR` holds the git mirror and the throwaway working trees. Its default is
`/var/lib/webagent`, which a development host cannot write to, and the failure surfaces
mid-request rather than at startup. Under Docker Compose it must be the **same absolute path**
on the host and in the container, because the host's Docker daemon resolves the agent
container's bind mounts.

Then check it before starting anything:

```bash
npm run check:env
```

It names every variable that is missing, malformed, or present but empty, and prints no
values.

In the **client's repository**, commit:

```yaml
# .webagent/config.yml   — operational settings only; sign-ins are deployment configuration
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
```

```yaml
# .webagent/policy.yml
allow: ["src/components/**", "src/content/**", "public/images/**"]
maxFilesChanged: 15
```

**Optional.** Add a Netlify outgoing webhook for deploy started, succeeded, and failed, pointing
at `$PUBLIC_BASE_URL/api/webhooks/netlify`, using `NETLIFY_WEBHOOK_SECRET`. The loop does not
need it: the orchestrator also polls Netlify for the deploy, so a preview arrives with or without
it — the webhook only makes it arrive a few seconds sooner. Skip it while `PUBLIC_BASE_URL` is
not yet reachable from the internet.

Confirm **Deploy Previews** are enabled on the Netlify site before going further. Without them
the request runs, the gate passes, the branch pushes, and then the wait for a preview simply
times out — the failure looks like a fault in this product rather than a missing setting.

## Run

The agent image is built separately and deliberately is not a Compose service — it is a
throwaway container started per request, not a long-running process — so building it is a step
of its own. Skipping it produces a server that starts cleanly and fails on the first client
request.

```bash
docker build -t webagent/agent:latest agent/
docker compose up --build
```

Startup validates configuration and **refuses to serve** on a bad setting, naming it (FR-003b).
Expect explicit failure here for a wrong repository, a missing installation, or an unreachable
Netlify site — not a silent start.

## Validate

### 1. Sign-in is restricted to the allow-list

```bash
curl -X POST localhost:3000/api/auth/request -d '{"email":"stranger@example.com"}'
```

Expect `202` and **no email sent**. The response never reveals whether an address is permitted.
Repeat with a permitted address and expect the email.

### 2. Request to preview (User Story 1, SC-002, SC-003)

Sign in, send "change the homepage headline to *Built for speed*".

Expect: acknowledgement under 10 seconds; visible stage change under 60; a preview link within
4 minutes at the median; the change visible at the preview URL; and the public site unchanged.
Confirm the pull request carries a comment with a `webagent:v1` block.

### 3. History survives a restart (FR-009)

While a request runs, `docker compose restart`. Reopen the conversation.

Expect: history rendered from pull request comments, the interrupted request shown as failed,
and the lock reference broken on the next request rather than blocking forever.

### 4. The policy gate holds (User Story 3, SC-005)

Add `deny: ["src/lib/**"]` to `policy.yml`. Ask for a change that requires editing `src/lib`.

Expect: no branch pushed, no commit anywhere in the repository, and a client-facing message
naming the protected area. **Then the load-bearing test**: ask the agent to modify
`.webagent/policy.yml` itself. Expect refusal regardless of what the policy allows (FR-003e).

### 5. Publish and undo (User Story 2, SC-007)

Approve a ready preview. Expect the public site to show the change and the conversation to be
marked published with no approval control remaining.

Press Undo. Expect the public site back to its prior content within 3 minutes, and the revert
present in the repository — not just a rolled-back deploy.

Then confirm both acts left a trace a developer can audit (FR-031). The conversation's own
history is the client's view; this is the other one:

```bash
gh pr view 1 --json merged,mergedAt
gh api repos/:owner/:repo/commits?sha=main --jq '.[0:3][] | .sha[0:8] + "  " + (.commit.message | split("\n")[0])'
```

Expect the pull request marked merged, and the default branch carrying a revert commit above the
merge commit. A confirmed run looks like this:

```text
6ba34b30  Revert changes introduced by fda335aa...
fda335aa  Merge pull request #1 from <owner>/webagent/c-2
```

Two commits, in that order, is the whole point: undo is a commit that reverses a commit, so the
history says what happened and when. A hosting rollback would leave the repository claiming the
change is still live.

### 6. Single-flight is enforced server-side (FR-007b)

With a request running, post a second message directly:

```bash
curl -X POST localhost:3000/api/conversations/1/messages -d '{"message":"also make it bigger"}'
```

Expect `409`, not a second container. This is the check the disabled input cannot make.

### 7. Failure stays in the conversation (User Story 5)

Ask for a change that breaks the build. Expect a plain-language message that the build failed,
the conversation still usable, the public site untouched, and the build error present in the
agent's context on the next message.

## Test suites

```bash
npm test              # unit: policy gate, record round-trip, state machine, config validation
npm run test:int      # route handlers against recorded GitHub and Netlify fixtures
npm run test:e2e      # request-to-preview, approve-and-undo
```

The policy gate is a pure function and needs neither Docker nor network; if a gate test requires
either, the boundary has leaked and the design has regressed.
