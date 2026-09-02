/**
 * The last thing standing between a language model's prose and a client's eyes.
 *
 * Principle I forbids diffs, file paths, branch names, and build output on any
 * client surface, and Principle III says that prohibition must be enforced by a
 * machine rather than trusted to a model. The agent's summary is unbounded
 * model output, so a prompt asking it not to mention files is exactly the
 * model-enforcement Principle III rules out. A live run made the point: the
 * agent reported `Changed "AI, embedded" to "Built for speed" in
 * `/work/index.html:54`.` — a container path, on its way to a client.
 *
 * The approach is redaction rather than refusal, because a summary is worth
 * keeping: a client reading "I changed the headline" learns something a fixed
 * sentence cannot tell them. But redaction alone would be a filter trusted to
 * be complete, so it is followed by a check, and anything still suspect after
 * redacting is dropped for the closed-vocabulary sentence instead. The filter
 * may be imperfect; the guarantee may not be.
 */

/** What a client is told when nothing in the summary can be safely shown. */
const NEUTRAL_SUMMARY = 'I made the change you asked for.';

/** Stands in for a redacted path, so the sentence still reads as a sentence. */
const REDACTED = 'that part of the site';

/**
 * Longer than this and it is not a summary any more. A model that starts
 * narrating its work, or pastes output, gets truncated well before a client
 * has to scroll through it.
 */
const MAX_SUMMARY_CHARS = 400;

const FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INDENTED_CODE = /^(?: {4}|\t).*$/gm;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const URL = /\bhttps?:\/\/\S+/gi;

/**
 * A path-shaped token: two segments joined by a slash, or a bare filename with
 * a recognisable extension. Deliberately broad — it catches `src/index.html`,
 * `/work/index.html:54`, `webagent/c-2` and `styles.css` alike, and a false
 * positive costs a vaguer sentence while a false negative costs the principle.
 */
const LINE_REFERENCE = '(?::\\d+(?::\\d+)?)?';
const PATH_LIKE = new RegExp(
  `(?:\`[^\`]*\`|[^\\s\`"'()\\[\\]{}]*\\/[^\\s\`"'()\\[\\]{}]+${LINE_REFERENCE}|\\b[\\w.-]+\\.[a-zA-Z]{1,5}${LINE_REFERENCE}\\b)`,
  'g',
);

/** Seven or more hex characters standing alone: a commit SHA, abbreviated or not. */
const SHA_LIKE = /\b[0-9a-f]{7,40}\b/gi;

/** A `file.ext` inside the token, or a slash, or a line reference like `:54`. */
function looksLikePath(token: string): boolean {
  const inner = token.replace(/`/g, '');
  if (inner.includes('/') || inner.includes('\\')) return true;
  if (/\.[a-zA-Z]{1,5}(?::\d+)?$/.test(inner)) return true;
  return false;
}

/** Ordinary prose the broad pattern would otherwise redact — sentence-ending words, mostly. */
const INNOCENT = /^(?:[A-Za-z]+\.(?:$|\s)|e\.g\.|i\.e\.|etc\.)$/;

function redactPathLike(text: string): string {
  return text.replace(PATH_LIKE, (token) => {
    if (INNOCENT.test(token)) return token;
    return looksLikePath(token) ? REDACTED : token;
  });
}

/** Whatever the redaction missed. If this finds anything, the summary is not used. */
function stillLooksUnsafe(text: string): boolean {
  if (/[/\\]/.test(text)) return true;
  // A line reference the redaction left stranded — `that part of the site:54`
  // tells a client nothing and is still a code detail.
  if (new RegExp(`${REDACTED}:\\d`).test(text)) return true;
  if (SHA_LIKE.test(text)) return true;
  if (URL.test(text)) return true;
  if (/```|~~~|<[a-zA-Z]/.test(text)) return true;
  if (/^[+-]{1,3}\s/m.test(text)) return true; // a diff's own line prefixes
  return false;
}

function collapse(text: string): string {
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function truncate(text: string): string {
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  const cut = text.slice(0, MAX_SUMMARY_CHARS);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return (lastStop > MAX_SUMMARY_CHARS / 2 ? cut.slice(0, lastStop + 1) : cut).trim();
}

/**
 * A client-safe sentence drawn from the agent's summary, or the neutral one.
 *
 * Total: any input produces something a client can read. `SHA_LIKE` and `URL`
 * carry the global flag, so `lastIndex` is reset before each use — a stateful
 * regular expression that silently skips every other call is not something to
 * leave underneath a safety check.
 */
export function toClientProse(summary: string): string {
  SHA_LIKE.lastIndex = 0;
  URL.lastIndex = 0;

  const withoutCode = summary
    .replace(FENCED_CODE, ' ')
    .replace(INDENTED_CODE, ' ')
    .replace(HTML_TAG, ' ')
    .replace(URL, ' ')
    .replace(SHA_LIKE, ' ');

  const redacted = collapse(redactPathLike(withoutCode));
  if (!redacted) return NEUTRAL_SUMMARY;

  SHA_LIKE.lastIndex = 0;
  URL.lastIndex = 0;
  if (stillLooksUnsafe(redacted)) return NEUTRAL_SUMMARY;

  const trimmed = truncate(redacted);
  return trimmed || NEUTRAL_SUMMARY;
}
