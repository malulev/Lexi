# The throwaway container one job runs in (contracts/repo-files.md,
# "Contract: Agent Container"). It is handed a working tree at /work and a
# control directory at /control, holds no credential able to write to the
# repository or hosting, and never runs git — see README.md for why that
# absence, not a policy, is the actual security boundary.
#
# node and opencode-ai are pinned to explicit versions rather than floating
# tags, so a base-image or agent-runtime change is something a reviewer sees
# in a diff, not something that silently changes what every future request
# runs against.

# Debian-based (not Alpine): opencode-ai resolves its platform binary via
# npm optionalDependencies keyed on glibc-vs-musl at postinstall time, and
# glibc is the better-tested target for that resolution.
FROM node:22.11.0-slim

# Verified against the npm registry at authoring time: `opencode-ai@1.18.26`
# installs a binary named `opencode`, declares no dependencies of its own,
# and needs no git (deps: none) — consistent with this image installing
# neither.
RUN npm install --global opencode-ai@1.18.26 \
    && npm cache clean --force

# Deliberately absent: no `apt-get install git`. The container edits files
# under /work and exits; it does not commit, does not branch, and the host
# (outside this image) is the only thing that ever runs git against this
# working tree (R2, plan.md "What each module owns"). Not installing git
# here means there is no git binary for a compromised or over-eager agent
# process to invoke in the first place — the guarantee is structural, not a
# prompt instruction.

# A fixed, unprivileged UID. The agent process only ever needs to read and
# write the two bind mounts below; nothing it does requires root.
#
# Operational note: the host directories bind-mounted at /work and /control
# must be writable by this UID (10001) for the container to do anything
# useful — see README.md.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin agent

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER agent
WORKDIR /work

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
