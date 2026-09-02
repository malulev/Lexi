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
# Confirmed against a live `opencode run --format json` stream (cohere/
# north-mini-code via OpenRouter, 2026-09-02), not inferred from documentation.
# Every line is one JSON object sharing an envelope:
#
#   { "type": ..., "timestamp": ..., "sessionID": ..., "part": { ... } }
#
# All the payload is under `part`; nothing useful sits at the top level. Only
# `cost` remains unverified — it was 0 for every step because the model was
# free, so the field's path is confirmed but its behaviour on a paid model is
# not. Values still default to zero/empty rather than throwing: an agent that
# finished the work must never be reported as crashed because this parsing did
# not recognise an event.
cat > "$WRITE_RESULT_SCRIPT" <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';

const WORK_PREFIX = '/work/';

/** The container path an edit reports, as the repository sees it. */
function toRepoRelative(filePath) {
  return filePath.startsWith(WORK_PREFIX) ? filePath.slice(WORK_PREFIX.length) : filePath;
}

/**
 * A tool call that changed a file, as opposed to one that only looked at one.
 *
 * `read` and `glob` carry a `filePath` too, so counting every path seen would
 * report files the agent merely opened as files it changed. The presence of a
 * `filediff` is what distinguishes an edit that landed.
 */
function editedPathOf(part) {
  if (part?.type !== 'tool') return undefined;
  const filediff = part.state?.metadata?.filediff;
  if (!filediff || typeof filediff.file !== 'string') return undefined;
  if (part.state?.status !== 'completed') return undefined;
  return toRepoRelative(filediff.file);
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
    continue; // --format json does not guarantee every line is a JSON object
  }
  if (typeof event !== 'object' || event === null) continue;

  const part = event.part;
  if (typeof part !== 'object' || part === null) continue;

  // Each step reports its own request's usage, and `input` re-counts the whole
  // context every turn. Summing is deliberate: that is what the provider bills,
  // whereas the final step alone would only describe the last context size.
  if (event.type === 'step_finish') {
    if (typeof part.tokens?.input === 'number') tokensIn += part.tokens.input;
    if (typeof part.tokens?.output === 'number') tokensOut += part.tokens.output;
    if (typeof part.cost === 'number') costUsd += part.cost;
  }

  if (event.type === 'tool_use') {
    const edited = editedPathOf(part);
    if (edited) filesChanged.add(edited);
  }

  // The last assistant message is the summary; there is no `summary` field
  // anywhere in the stream. A chatty model emits several, and the last one is
  // the one that describes the finished work.
  if (event.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
    summary = part.text.trim();
  }
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
