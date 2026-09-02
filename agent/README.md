# Agent container

This image runs one coding-agent job and nothing else. The host mounts a
working tree at `/work` and a control directory at `/control`, starts the
container, and destroys it when the job ends — see
`specs/001-conversational-site-editing/contracts/repo-files.md`
("Contract: Agent Container") for the full input/output contract.

`entrypoint.sh` reads `/control/prompt.json`, runs
`opencode run --model "$MODEL" --format json --auto "<prompt>"` against
`/work`, writes `/control/result.json`, and exits with opencode's own exit
code.

## No git

The image does not install git, and never will. The container edits files
under `/work` and exits — it does not commit, does not branch, and does not
push. Committing and pushing are the host's job, and only after the host has
gated the resulting change against the site's policy
(`specs/001-conversational-site-editing/research.md`, R2). Leaving git out of
the image is what makes "the agent cannot commit" true by construction
rather than by instruction: there is no git binary here for a prompt-injected
or over-eager agent process to invoke in the first place.

## No credentials

The only environment variables the container receives are
`OPENROUTER_API_KEY` (to reach the model provider) and `MODEL`. It never
receives a GitHub token, a Netlify token, a session secret, or a git remote.
This is FR-015, and it is enforced structurally, not by convention: the
Docker runner (`src/lib/runner/docker.ts`) builds the container's environment
from one explicit two-item literal, so nothing else it might have access to
in the host process can leak in by accident.

Egress could additionally be restricted to the model provider's host where
the deployment environment allows it — that would be defence in depth. The
absence of credentials above is the actual boundary: a container with no key
capable of writing to the repository or hosting cannot push, whatever else
it can reach on the network.
