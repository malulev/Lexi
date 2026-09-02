# What I need from you to run a real end-to-end test

Everything below the line marked **You supply** is the whole ask. The rest I
generate, write, or run myself.

Use a **throwaway repository and a throwaway Netlify site**, not a client's live
one. The test pushes branches, opens pull requests, and writes comments, and one
of the things it proves is that a blocked change is discarded — which is only
worth proving somewhere you don't mind the attempt.

---

## You supply

### 1. A test site (5 min)

Any repository that builds on Netlify. A one-page static site is enough — an
`index.html` is a perfectly good test subject.

- Push it to a GitHub repository.
- Link that repository to a Netlify site.
- In Netlify: **Site configuration → Build & deploy → Deploy Previews → enabled
  for pull requests.** Without this there is no preview and nothing to approve,
  so this is the one setting worth double-checking.

Give me: `owner/name` of the repository.

### 2. A GitHub App (5 min)

github.com/settings/apps → **New GitHub App**.

- Repository permissions: **Contents = Read and write**, **Pull requests = Read
  and write**. Nothing else.
- Uncheck **Webhook → Active** (not needed).
- Create it, then **Generate a private key** — this downloads a `.pem`.
- **Install** the App on your test repository only.

Give me:
- **App ID** — on the App's settings page
- **Private key** — the downloaded `.pem` file, or its contents
- **Installation ID** — the number at the end of the URL after installing:
  `github.com/settings/installations/<INSTALLATION_ID>`

### 3. Netlify (2 min)

- **Personal access token**: app.netlify.com → User settings → Applications →
  **New access token**
- **Site ID**: your site → Site configuration → General → **Site ID**

Give me both.

### 4. An OpenRouter key (1 min)

openrouter.ai/keys → create a key. **Put a low credit limit on it** — this test
runs a real model against a real repository and spends real money. A dollar or
two is plenty for a few requests.

Give me the key.

### 5. Docker running

```bash
docker info      # must succeed
```

That's it. Start Docker Desktop if that command fails.

---

## How the secrets get in

`.claude/settings.json` denies this session any read of `.env`, `.env.*`, `*.pem`
and `*.key`. That is deliberate: nothing in this test needs me to see a
credential, so I am not given the chance to put one in a transcript.

The consequence is that **you** write `.env.local`, not me. I generate the four
throwaway values and hand you the lines; you paste them in alongside your own
four credentials.

Two caveats worth stating plainly:

- The deny covers the file-reading tools completely. Shell command patterns are
  matched on their prefix, so the block there is a guardrail against accident,
  not a sandbox against a determined process. Treat it as: I will not read your
  key, not as: I could not.
- The app I start does load `.env.local` into its own process. The credentials
  are live during the test — that is the point — they are just never in my
  context.

## What I do with it

- Generate `SESSION_SECRET`, `CONFIG_PASSWORD_HASH`, `CONFIG_TOTP_SECRET`, and
  `NETLIFY_WEBHOOK_SECRET`, and give you the lines to paste — none of these need
  to be meaningful for this test.
- Commit `.webagent/config.yml` and `.webagent/policy.yml` to your test
  repository.
- Build the agent image: `docker build -t webagent/agent:latest agent/`.
- Start the app, sign in, and drive the loop.

You do: create `.env.local` from `.env.example`, paste in the four credentials
and the four generated values. Tell me when it exists — I verify it parses
without reading it (`npm run check:env` reports which variables are missing or
malformed, never their values).

## What the test will show you

1. **Request to preview.** I send "change the headline to *Built for speed*" and
   we watch the stages arrive. A pull request opens, Netlify builds a preview,
   and the preview link appears — with your production URL unchanged.
2. **The gate holds.** I ask the agent to edit `.webagent/policy.yml`. It is
   refused whatever the policy says, and **nothing is committed anywhere** — no
   branch, no commit to discard.
3. **One request at a time.** A second message while one runs is refused with
   `409` by the server, not merely greyed out in the browser.
4. **History survives a restart.** I restart the app mid-request and reopen the
   conversation; it rebuilds from the pull request's comments, because that is
   the only place it ever lived.

## Two things I expect to have to fix

Both are recorded as unverified in
`specs/001-conversational-site-editing/notes/netlify-payload-fields.md` and in
`agent/entrypoint.sh`, and this test is what settles them:

- **OpenCode's JSON output shape.** The token, cost, and summary field names
  were guessed from documentation. If they're wrong, the request still succeeds
  but reports a cost of zero — I'll read one real run and correct the parser.
- **Netlify's deploy field names.** Correlation prefers the pull request number
  and falls back to the commit reference. If the first field name is wrong, the
  fallback quietly carries it, so I'll check a real payload rather than assume
  the absence of a visible failure means it worked.

## No tunnel needed

The quickstart mentions a Netlify outgoing webhook. **Skip it.** The app also
polls Netlify for the deploy, so the loop completes without any inbound URL —
which means no ngrok, no public hostname, nothing to expose. The webhook only
makes the preview appear a few seconds sooner, and it can be tested separately
later.

## Afterwards

Delete the GitHub App, revoke the Netlify and OpenRouter keys, and delete the
test repository and site. Nothing here is meant to outlive the test.
