import type { NetlifyClient } from '@/lib/netlify';

/**
 * The client's own website address, read once per process.
 *
 * It appears on every page — the header says which website this installation
 * edits — and it never changes while the process runs, so one call to the
 * hosting provider is enough. A failed read is not remembered: the next page
 * asks again rather than showing nothing for the life of the process.
 */
const cache = new WeakMap<NetlifyClient, string>();

export async function readSiteUrl(netlify: NetlifyClient): Promise<string | null> {
  const known = cache.get(netlify);
  if (known) return known;

  try {
    const site = await netlify.getSite();
    if (!site) return null;
    cache.set(netlify, site.publicUrl);
    return site.publicUrl;
  } catch (cause) {
    console.error('[webagent] could not read the site address for the header', cause);
    return null;
  }
}

/** `https://client.example/` as a person says it: `client.example`. */
export function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}
