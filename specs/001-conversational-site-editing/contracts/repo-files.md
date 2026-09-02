# Contract: Repository Files

The installation reads these from the site's own repository. They are the developer-facing
contract; changing their shape breaks installations.

## `.webagent/config.yml`

```yaml
allowedEmails:
  - jane@client.example
  - marketing@client.example
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
```

Every field required. Unknown fields are rejected rather than ignored, so a typo in
`allowedEmails` fails loudly instead of locking the client out silently.

**On invalid content**: the previous valid settings stay in force, the fault is reported to the
last known `alertContact`, and the interface shows a configuration warning to configuration
holders only. Access control never falls back to permissive.

## `.webagent/policy.yml`

```yaml
allow:
  - "src/components/**"
  - "src/content/**"
  - "public/images/**"
deny:
  - "src/lib/payments/**"
maxFilesChanged: 15
maxDiffLines: 800
forbidNewDependencies: true
```

All fields optional; defaults in [../data-model.md](../data-model.md).

**Evaluation order**, and the order matters:

1. Unconditional denies — `.webagent/**`, `AGENTS.md`, `**/.env*`, `.github/**`, `netlify.toml`,
   dependency manifests and lockfiles. A site cannot allow these.
2. Site `deny`.
3. Site `allow`. A path matching nothing in `allow` is denied.
4. Size limits: `maxFilesChanged`, `maxDiffLines`.
5. `forbidNewDependencies`: any change to a manifest or lockfile — already denied by rule 1, so
   this exists to catch vendored dependency directories.

**Result**: `{ ok: true }` or `{ ok: false, violation, path?, actual?, limit? }`. The violation
must name the offending path so the client-facing message can say which area is protected.

## `AGENTS.md`

Free-text guidance at the repository root, read by the agent as instructions. Brand rules, tone,
component conventions. **Advisory only** — it never widens what the gate permits, and the agent
may not edit it.

---

# Contract: Agent Container

## Inputs

| Channel | Contents |
|---|---|
| Mount `/work` | Working tree at the conversation's branch. **No git remote configured.** |
| `/work/.webagent-prompt.json` | `{ request, history[], guidance, targetHint? }` |
| Environment | `OPENROUTER_API_KEY`, `MODEL` |

The container receives no GitHub token, no Netlify token, and no git remote. Pushing is not
forbidden; it is impossible.

## Behaviour

Runs `opencode run --model "$MODEL" --format json --auto "<prompt>"`, commits to the current
branch locally, exits 0. Exits non-zero on failure. Killed at `maxRequestMinutes`.

## Outputs

| Channel | Contents |
|---|---|
| stdout | OpenCode JSON events, one per line — streamed as progress |
| `/work` | Local commits, inspected by the worker after exit |
| `/work/.webagent-result.json` | `{ summary, filesChanged[], tokensIn, tokensOut, costUsd }` |

`.webagent-prompt.json` and `.webagent-result.json` are removed before the diff is gated; they
must never appear in a commit.

## Non-negotiable properties

- No credential capable of writing to the repository or hosting (FR-015).
- Outbound network restricted to the model provider where the environment permits; the absence
  of credentials is the enforced boundary, network restriction is defence in depth.
- Destroyed after every request, successful or not.
