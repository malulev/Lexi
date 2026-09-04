/**
 * Filling the moving parts of a sentence.
 *
 * `{name}` in a dictionary string stands for a value the caller supplies.
 * A placeholder with no value stays as written rather than vanishing, so a
 * missing argument is visible in the interface and in a test instead of
 * silently producing "Remove ".
 */
export type FormatParams = Record<string, string | number>;

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

export function formatMessage(template: string, params: FormatParams = {}): string {
  return template.replace(PLACEHOLDER, (whole, key: string) =>
    key in params ? String(params[key]) : whole,
  );
}

/** The placeholder names a template uses, in order of first appearance. */
export function placeholdersOf(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1] as string;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The same split into pieces, so a caller can wrap one part in markup —
 * "If <strong>you@example.com</strong> is allowed…" — without the sentence
 * being assembled by hand in three languages.
 */
export function splitMessage(template: string): Array<{ kind: 'text' | 'param'; value: string }> {
  const parts: Array<{ kind: 'text' | 'param'; value: string }> = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: 'text', value: template.slice(last, start) });
    parts.push({ kind: 'param', value: match[1] as string });
    last = start + match[0].length;
  }
  if (last < template.length) parts.push({ kind: 'text', value: template.slice(last) });
  return parts;
}
