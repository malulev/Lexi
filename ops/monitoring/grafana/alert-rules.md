# Alert rules

Queries, thresholds and the reason each one sits in the tier it does. Entered
in Grafana Cloud (Alerting → Alert rules), or pushed through its provisioning
API — they are written here as queries rather than as a provisioning YAML
because that file's shape is tied to a Grafana version, and a config that
cannot be imported verbatim is worse than a query you can paste.

`{job="lexi"}` selects the application logs; `slug` is the client.

**Every tier-A rule carries `unless lexi_maintenance == 1`.** `ops/release.sh`
touches `/var/lib/lexi/maintenance` while it rolls, and without that clause a
deploy pages you — which is how alert systems get muted, and a muted rule is
worse than no rule because it looks like coverage.

---

## Tier A — interrupt me

| # | Rule | Query | For | Why this tier |
|---|---|---|---|---|
| A1 | Client app down | `lexi_client_health_ok == 0` | 3m | A client typing into a dead editor gets nothing. 3m tolerates a normal roll. |
| A2 | Outside-in down | Synthetic Monitoring HTTP check on `https://<host>/api/health` | 3m | A1 cannot see DNS, Caddy or the certificate. This is the only rule that tests what the client actually experiences. |
| A3 | Dead-man missed | the heartbeat service's own alert, period 15m, grace 15m | — | Fires when the box, the network or Alloy is gone — i.e. when no other rule *can* fire. |
| A4 | Disk critical | `node_filesystem_avail_bytes{project="lexi",mountpoint="/"} / node_filesystem_size_bytes{project="lexi",mountpoint="/"} < 0.10` | 10m | The filesystem is shared by every client. A full disk corrupts git mirrors mid-clone and is not fixed by a restart. |
| A4b | Disk trending full | `predict_linear(node_filesystem_avail_bytes{project="lexi",mountpoint="/"}[6h], 4*3600) < 0` | 30m | Catches the log or mirror that is growing steadily, while there is still time. |
| A5 | RAM vs summed ceiling | `node_memory_MemAvailable_bytes{project="lexi"} < lexi_agents_limit_total * 1073741824 * 0.5` | 15m | The question nothing in the product can express. `for: 15m` because `slots.ts` is a check-then-act race and a momentary overshoot is expected. |
| A5b | RAM hard floor | `node_memory_MemAvailable_bytes{project="lexi"} < 300e6` | 5m | The immediate form of A5. No swap on this box: this is an OOM countdown. |
| A6 | Lock leak | `count_over_time({job="lexi", event="request.lock_leak"}[10m]) > 0` | instant | That client accepts no further request until the lock goes stale. Total outage of the core function behind a healthy-looking app. |
| A6b | Started, never ended | `sum(count_over_time({job="lexi", event="request.started"}[1h])) - sum(count_over_time({job="lexi", event="request.ended"}[1h])) > 1` | 30m | Catches a process that died before it could log A6. Imprecise by construction; the long window is the mitigation. |
| A7 | Startup refusal loop | `count_over_time({job="lexi", event="startup.refused"}[15m]) >= 3` | instant | `process.exit(1)` plus `restart: unless-stopped` is an infinite loop that looks like "app down" but has a one-line fix. **Put `faultSettings` in the subject.** |
| A8 | Slot counting broken | `count_over_time({job="lexi", event="slots.count_failed"}[15m]) > 0` | instant | The cap has silently stopped existing — the precondition for A5 ten minutes later. Catching the cause beats catching the symptom. |
| A9 | TLS expiring | `probe_ssl_earliest_cert_expiry - time() < 7*86400` | 1h | Caddy renews at 30 days. Under 7 means renewal has been failing for three weeks. |
| A10 | Runaway spend | `sum by (slug) (sum_over_time({job="lexi", event="request.ended"} | json | unwrap costUsd [1d])) > 10 * <costCeilingUsd>` | instant | Ten requests at 90% of the per-request ceiling. A 10× day is a loop or a bug, not a busy day. |
| A11 | Client refused outright | `count_over_time({job="lexi", event="request.ended"} | json | errorCode="too_busy" [15m]) > 0` | instant | A client asked and was turned away by capacity. The visible face of A5. |
| A12 | Auth burst | `count_over_time({job="lexi", event="auth.refused"}[10m]) > 50` | instant | Credential stuffing against the six-digit code. |
| A13 | Readiness degraded | `lexi_client_ready_ok == 0` | 10m | The app serves but cannot reach GitHub or Netlify — an expired credential, invisible until now. |

## Tier B — daily digest, one email

| # | What | Query |
|---|---|---|
| B1 | Spend per client per day | `sum by (slug) (sum_over_time({job="lexi", event="request.ended"} | json | unwrap costUsd [1d]))` |
| B2 | Outcome mix | `sum by (slug, outcome, errorCode) (count_over_time({job="lexi", event="request.ended"} | json [1d]))` |
| B3 | Duration p50/p95 | `quantile_over_time(0.95, {job="lexi", event="request.ended"} | json | unwrap durationMs [1d]) by (slug)` |
| B4 | Where the time went | same, unwrapping `runningMs`, `buildingMs`, `preparingMs` |
| B5 | Queue pressure | `quantile_over_time(0.9, {job="lexi", event="slot.waited"} | json | unwrap waitedMs [1d])` |
| B6 | Publish rate | `count(… event="publication.ended" … kind="publish")` ÷ `count(… outcome="succeeded" … hasPreview=true)` |
| B7 | Undo count | `count_over_time({job="lexi", event="publication.ended"} | json | kind="undo" [1d])` |
| B8 | Version drift | `count(count by (sha) (lexi_client_info)) > 1` sustained 24h |
| B9 | Disk at 75% + per-client bytes | `lexi_client_state_bytes` |
| B10 | Notification failures | `count_over_time({job="lexi", event="notify.failed"}[1d])` |
| B11 | Stale locks broken | `count_over_time({job="lexi", event="lock.broken_stale"}[1d])` |
| B12 | Alloy self | RSS, dropped samples, active series against the free-tier cap |

B12 is not housekeeping: at the cap Grafana **drops data**, and quiet looks
exactly like "nothing is happening". You want to learn you are approaching it
before the graphs go silent.

## Recording rules

Tier-A alerts on log-derived data should run against recorded series, not
against a raw log scan — cheaper, faster, and retained far longer.

```
lexi:requests:count1d{slug,outcome}
lexi:request_cost_usd:sum1d{slug}
lexi:request_duration_seconds:p90_1h{slug}
lexi:slot_wait_seconds:p90_1d{slug}
```
