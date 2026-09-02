#!/usr/bin/env bash
set -euo pipefail

# The entire agent container, end to end (contracts/repo-files.md, "Contract:
# Agent Container"): read the one instruction file, run opencode against
# /work, write the one result file, exit. Nothing else this container does
# is observable to the host except stdout (streamed as progress) and
# whatever opencode left behind in /work.

PROMPT_FILE="/control/prompt.json"
RESULT_FILE="/control/result.json"
WORK_DIR="/work"
OPENCODE_LOG="$(mktemp)"
BUILD_PROMPT_SCRIPT="$(mktemp --suffix .mjs)"
WRITE_RESULT_SCRIPT="$(mktemp --suffix .mjs)"

cleanup() {
  rm -f "$OPENCODE_LOG" "$BUILD_PROMPT_SCRIPT" "$WRITE_RESULT_SCRIPT"
}
trap cleanup EXIT

if [ ! -f "$PROMPT_FILE" ]; then
  echo "entrypoint: missing $PROMPT_FILE — the host never gave this container an instruction" >&2
  exit 1
fi

# --- Compose the prompt text from request, history, guidance, targetHint ---
#
# Written as a small Node script rather than shell/jq text-munging:
# prompt.json is a real JSON document (AgentPrompt, src/types/index.ts) with
# a nested history array and an optional field, and getting the ordering and
# the optional-field handling right is far more legible this way than in
# sed/awk. The heredoc delimiter is quoted ('NODE') specifically so bash
# does not try to expand the `${...}` template-literal syntax inside it.
cat > "$BUILD_PROMPT_SCRIPT" <<'NODE'
import { readFile } from 'node:fs/promises';

const raw = JSON.parse(await readFile(process.env.PROMPT_FILE, 'utf8'));
const lines = [];

if (raw.guidance) {
  lines.push('Project guidance (AGENTS.md, advisory only — it does not widen what you are allowed to touch):');
  lines.push(raw.guidance, '');
}

for (const turn of raw.history ?? []) {
  lines.push(`${turn.author}: ${turn.text}`);
}

if (raw.targetHint) {
  lines.push(`Target: ${raw.targetHint}`);
}

lines.push(raw.request);

process.stdout.write(lines.join('\n'));
NODE

PROMPT_TEXT="$(PROMPT_FILE="$PROMPT_FILE" node "$BUILD_PROMPT_SCRIPT")"

# --- Run opencode from /work ---
#
# `--auto` is required because no human is present to approve tool calls
# (research.md R1); the safety boundary is the host's post-run diff gate,
# not interactive approval. `set +e` around the pipeline is deliberate: with
# `pipefail` (set above) a failing opencode would otherwise trip `set -e`
# and abort this script before the exit code could be captured or a result
# written, which is the one thing a failed run must not do.
cd "$WORK_DIR"
set +e
opencode run --model "$MODEL" --format json --auto "$PROMPT_TEXT" 2>&1 | tee "$OPENCODE_LOG"
OPENCODE_EXIT="${PIPESTATUS[0]}"
set -e

# --- Write /control/result.json ---
#
# NOTE (research.md R1 "open items"): OpenCode's exact `--format json` event
# shape has not been confirmed against a live run. The field names probed
# below are a best guess at plausible camelCase/snake_case variants, not a
# verified contract. Every value defaults to zero/empty rather than the
# script throwing, because guessing wrong here must degrade gracefully — an
# agent that otherwise finished the work must not be reported as crashed
# just because this parsing didn't recognise its event shape. This needs
# confirming against a live OpenCode run before this is trusted.
cat > "$WRITE_RESULT_SCRIPT" <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';

function firstNumber(...candidates) {
  return candidates.find((value) => typeof value === 'number');
}

const exitCode = Number(process.env.OPENCODE_EXIT);
const raw = await readFile(process.env.OPENCODE_LOG, 'utf8').catch(() => '');
const lines = raw.split('\n').filter((line) => line.trim().length > 0);

let tokensIn = 0;
let tokensOut = 0;
let costUsd = 0;
let summary = '';
const filesChanged = new Set();

for (const line of lines) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue; // --format json is not guaranteed to make every line a JSON object
  }
  if (typeof event !== 'object' || event === null) continue;

  const usage = (typeof event.usage === 'object' && event.usage !== null) ? event.usage : event;
  const inputTokens = firstNumber(usage.input_tokens, usage.prompt_tokens, usage.tokensIn);
  if (inputTokens !== undefined) tokensIn += inputTokens;
  const outputTokens = firstNumber(usage.output_tokens, usage.completion_tokens, usage.tokensOut);
  if (outputTokens !== undefined) tokensOut += outputTokens;
  const cost = firstNumber(event.cost, event.costUsd, usage.cost);
  if (cost !== undefined) costUsd += cost;

  const path = typeof event.path === 'string' ? event.path : typeof event.file === 'string' ? event.file : undefined;
  if (path) filesChanged.add(path);

  if (typeof event.summary === 'string') summary = event.summary;
}

if (!summary) {
  summary = exitCode === 0
    ? 'The agent finished without reporting a summary.'
    : 'The agent exited with an error before reporting a summary.';
}

await writeFile(
  process.env.RESULT_FILE,
  JSON.stringify({ summary, filesChanged: [...filesChanged], tokensIn, tokensOut, costUsd }, null, 2),
);
NODE

# However this goes, `exit "$OPENCODE_EXIT"` below must still run: opencode's
# own exit code is what actually tells the host success from failure. A
# missing result.json already degrades to `null` on the host
# (control.ts:readAgentResult), so a failure writing it is logged and
# swallowed rather than allowed to replace the real exit code.
set +e
OPENCODE_EXIT="$OPENCODE_EXIT" OPENCODE_LOG="$OPENCODE_LOG" RESULT_FILE="$RESULT_FILE" node "$WRITE_RESULT_SCRIPT"
if [ $? -ne 0 ]; then
  echo "entrypoint: failed to write $RESULT_FILE — the host will treat this run as having produced none" >&2
fi
set -e

exit "$OPENCODE_EXIT"
