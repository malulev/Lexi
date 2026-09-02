# Quickstart: Install and Validate

How a developer installs one instance for one client site, and how to prove the loop works.
Implementation detail belongs in `tasks.md`; this is the run-and-verify guide.

## Prerequisites

- A client site in a GitHub repository, deploying to Netlify with **Deploy Previews enabled**
  for pull requests. Verify this first — without it there is no preview and nothing to approve.
- Docker and Docker Compose on the host.
- A GitHub App installed on that one repository, with read and write on contents and pull
  requests. Note the App ID, private key, and installation ID.
- A Netlify personal access token and the site ID.
- An OpenRouter API key.
- SMTP credentials for notification email.

## Configure

Secrets go in the environment; settings go in the client's repository.

```bash
cp .env.example .env
```

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
PUBLIC_BASE_URL=https://edit.client.example
```

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

Add a Netlify outgoing webhook for deploy started, succeeded, and failed, pointing at
`$PUBLIC_BASE_URL/api/webhooks/netlify`.

## Run

```bash
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
