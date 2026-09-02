# Plan Inputs (decisions made during brainstorming, for /speckit.plan)

Not part of the specification. These are the technical directions already chosen with the
maintainer, to be fed into the planning phase rather than re-litigated there.

- **Dashboard + API**: Next.js App Router with Supabase (auth, Postgres with row-level
  security, realtime for progress streaming).
- **Agent harness**: OpenCode running against OpenRouter, executed inside a container.
- **Job execution**: a `JobRunner` interface with a Docker implementation as the only
  v1 backend; hosted by the maintainer, but the compose stack must stay self-hostable.
- **Queue**: the jobs table is the queue; a single worker loop with a Postgres advisory
  lock per site. No Redis in v1.
- **Repository access**: GitHub App with short-lived per-job installation tokens. Push
  happens in the worker, never inside the agent container.
- **Preview and publish**: the client's existing Netlify site with deploy previews per
  branch; Netlify webhooks report build status. Approve merges the pull request; undo
  reverts the merge commit and rebuilds production.
- **Change unit**: conversation = branch = pull request.
- **Guardrails**: `AGENTS.md` as the prompt layer, `.webagent/policy.yml` as the enforced
  diff gate, GitHub branch protection and CODEOWNERS as the last line.
- **Build verification**: none in the container; Netlify's preview build is the check, and
  its failure log feeds back into the conversation.
- **Performance levers identified**: bare-repo mirror cache per site, Netlify webhooks
  rather than polling, scoped repository context for the agent.
- **Known risk to address in planning**: mounting the Docker socket into the API is
  root-equivalent on the host. Acceptable on a dedicated box for pilots; note a hardening
  path (rootless Docker, sysbox, or gVisor).
