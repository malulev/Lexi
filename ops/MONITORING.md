# Monitoring a Lexi host

What this host reports about itself, how to turn it on, and in what order.

The order matters more than the tooling. Each phase is useful on its own, and
the first one is worth more per minute spent than everything after it.

---

## Phase 1 — the dead-man's switch (15 minutes, no memory, $0)

Takes this host from *no coverage* to *someone learns within 20 minutes if it
dies*. Do this even if you do nothing else.

1. Create a check at a heartbeat service (healthchecks.io free, or similar):
   period **15 minutes**, grace **15 minutes**. Copy its ping URL.
2. On the host, as root. `ops/bootstrap-host.sh` already runs the installer on
   a fresh host, so on one of those only the last two lines are needed:

   ```bash
   /opt/prosel/src/ops/install-monitoring.sh   # idempotent; skip if bootstrap ran it
   $EDITOR /etc/lexi/monitoring.env            # paste HEARTBEAT_URL
   systemctl restart lexi-probe.timer
   ```

3. Prove it: `systemctl stop lexi-probe.timer`, wait for the grace to expire,
   confirm the email arrives, then **`systemctl start lexi-probe.timer`**.
   **An alert never tested is an alert that does not exist.**

   The test only means something once `HEARTBEAT_URL` is filled in *and* the
   check has already received at least one ping — an empty URL makes `probe.sh`
   skip the ping entirely, so there is nothing to go silent. Only the 60-second
   run pings; `lexi-probe-full.timer` deliberately does not, so stopping the one
   timer is enough.

The ping is conditional — `ops/probe.sh` only pings when `ops/status.sh
--quiet` says every client is healthy. A timer that pings unconditionally
proves only that the timer runs.

## Phase 2 — metrics and logs (Grafana Cloud free tier)

1. Sign up. From Connections, take the Prometheus push URL and user id, the
   Loki push URL and user id, and one access policy token with `metrics:write`
   and `logs:write`.
2. Fill them into `/etc/lexi/monitoring.env`. Names only ever appear in
   output; no value is printed by any script here.
3. Install Alloy, then re-run the installer:

   ```bash
   # Grafana's install script, from their docs — pinned by your own package
   # manager, not by this file.
   /opt/prosel/src/ops/install-monitoring.sh --with-alloy
   ```

4. Confirm: `systemctl status alloy`, then look for `lexi_agents_limit_total`
   in Grafana's metrics explorer.

## Phase 3 — alerts

`ops/monitoring/grafana/alert-rules.md` has every rule, its query, its window
and why it is in the tier it is. Enter tier A first; the digest can wait.

Add Synthetic Monitoring checks against `https://<client-host>/api/health` for
each client — that is the only check that sees DNS, Caddy and the certificate.

---

## What each piece reports

| Source | Gives you |
|---|---|
| `ops/status.sh --prom` → textfile | per-client app/daemon/health/readiness, agents running vs limit, **summed ceiling across clients**, image and commit, maintenance flag |
| `prometheus.exporter.unix` | CPU, memory, load, disk, filesystem, per-unit systemd state |
| container logs → Loki | every `request.ended`: outcome, errorCode, duration and per-stage durations, cost, tokens, files changed |
| journald → Loki | Caddy access logs (per-client HTTP status and latency, free), dockerd, sshd, each client's rootless daemon |
| heartbeat service | the one signal that survives the box being gone |

## Where to look

[ROLLOUT.md](ROLLOUT.md#where-to-look) has the full list with copy-paste
queries. The short version:

- **On the box, no accounts:** `cd /tmp && ops/status.sh` for fleet state,
  `ops/status.sh <slug> --logs` for one client's JSON log,
  `journalctl -u caddy` for HTTP access logs, and
  `/var/lib/node_exporter/textfile/lexi.prom` for what the collector reads.
- **Per request:** the durable record is a comment on the pull request in the
  client's repository — outcome, cost, tokens, per-stage timestamps, and the
  agent's last output lines, which exist nowhere else by design.
- **In Grafana:** Explore → Loki for `{job="lexi"}`, Explore → Prometheus for
  `lexi_*` and `node_*`, Alerting → Alert rules for what is firing.
- **Dashboard:** build the eleven panels listed in ROLLOUT.md, and import the
  prebuilt Node Exporter Full dashboard (ID `1860`) for the host view.

## The numbers a person should look at

- **Success ratio** per client over 24h — the one number that says "is this working".
- **Spend per client per day** — the aggregate the per-request ceiling cannot see.
- **Publish rate** — previews the client chose *not* to ship. The product-quality metric.
- **Undo count** — they published, then rejected it. Worse than a preview never published.
- **Memory available vs `lexi_agents_limit_total`** — this host is oversubscribed by design; this is how you find out before the kernel decides.

## Constraints worth knowing before you extend it

- **Label discipline.** Only `job`, `slug`, `unit`, `level`, `event`, `stream`
  may be labels. `requestId`, `conversationNumber`, `commitSha` are unbounded
  and stay as JSON fields, which in Loki cost nothing at query time. One
  mistake here burns the free-tier series allowance in a day.
- **Agent output never leaves the box.** The container log glob matches agent
  containers too — raw model output over a client's private tree. `config.alloy`
  drops any line without an `event` field, which is what excludes it. Do not
  relax that filter.
- **`errorDetail` is not in `request.ended`** for the same reason. The durable
  record in the pull request keeps it, where the client controls access.
- **Alloy is capped** at `MemoryMax=200M` by a systemd drop-in. The summed agent
  ceiling across clients can exceed free memory by design, so the cap makes
  Alloy the process the kernel kills rather than Caddy or a client's app.
  `ops/bootstrap-host.sh` also creates a swapfile, which turns an overshoot into
  slowness instead of a kill — check `swapon --show` on an older host.
- **Secrets** live in `/etc/lexi/monitoring.env`, 0600 root — never in a client
  `.env`, because a client user can read their own and these tokens are
  host-wide authority.

## Honest gaps

- `costUsd` is **self-reported by the agent** into `/control/result.json` and
  defaults to 0 when absent. Nothing here can detect spend the agent
  under-reports. The ground truth is OpenRouter's own API; a monthly
  reconciliation is not yet built.
- `lexi_client_agents_running` is a poll, and `slots.ts` documents its own
  check-then-act race, so a momentary count above the limit is expected
  behaviour rather than a fault. That is why A5 carries a 15-minute window.
- Grafana Cloud's free allowances and retention change. Verify them against
  current published limits rather than against any number written here.
