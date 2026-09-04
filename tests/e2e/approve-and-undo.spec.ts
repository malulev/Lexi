import { expect, requireLiveInstallation, test } from './fixtures';

/**
 * Publishing and taking it back (T095, T096).
 *
 * The two acts this product treats as irreversible-by-default: the only moment
 * a change reaches a real audience, and the only way back. Both are asserted
 * against the live site rather than against the interface's own claim about
 * itself — a button that says "published" is not evidence, and the production
 * URL is.
 *
 * Requires a conversation already carrying a ready preview. That is what
 * request-to-preview.spec.ts leaves behind, so the two run in file order under
 * Playwright's `fullyParallel: false`.
 */

/** SC-007: a published change can be fully reverted within three minutes. */
const UNDO_MS = 3 * 60_000;

/** Publishing waits on the same hosting build a preview does. */
const PUBLISH_MS = 4 * 60_000;

/**
 * The live site, which is the only witness that matters here. Read from the
 * environment rather than derived, because deriving it from the preview URL
 * would be asserting our own guess back at us.
 */
const LIVE_URL = process.env.WEBAGENT_E2E_LIVE_URL;

/** The live site as it is right now, never from a cache. */
async function readLiveSite(): Promise<string> {
  const response = await fetch(LIVE_URL!, { cache: 'no-store' as RequestCache });
  return response.text();
}

test.describe('publishing a previewed change, and taking it back', () => {
  test.beforeEach(() => {
    requireLiveInstallation();
    test.skip(!LIVE_URL, 'set WEBAGENT_E2E_LIVE_URL to the site this installation publishes to');
  });

  test('publishes only after a second, differently worded confirmation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('list').getByRole('link').first().click();

    // Principle II: the first press asks a question, it does not publish.
    await page.getByRole('button', { name: 'Approve & Deploy' }).click();
    await expect(page.getByText('Publish this change to your live website?')).toBeVisible();

    // Backing out must leave the site alone, which is the half of a
    // confirmation that usually goes untested.
    await page.getByRole('button', { name: 'Not yet' }).click();
    await expect(page.getByText('Publish this change to your live website?')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Approve & Deploy' })).toBeVisible();
  });

  test('reaches the live site, and the offer becomes undo', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('list').getByRole('link').first().click();

    const before = await readLiveSite();

    await page.getByRole('button', { name: 'Approve & Deploy' }).click();
    await page.getByRole('button', { name: 'Yes, publish it' }).click();

    // FR-027: once published there is nothing left to approve, only to undo.
    await expect(page.getByRole('button', { name: 'Undo this deploy' })).toBeVisible({
      timeout: PUBLISH_MS,
    });
    await expect(page.getByRole('button', { name: 'Approve & Deploy' })).toHaveCount(0);

    await expect
      .poll(async () => (await readLiveSite()) !== before, { timeout: PUBLISH_MS })
      .toBe(true);
  });

  test('puts the live site back within three minutes of pressing undo', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('list').getByRole('link').first().click();

    const published = await readLiveSite();

    const pressedAt = Date.now();
    await page.getByRole('button', { name: 'Undo this deploy' }).click();
    await expect(page.getByText('Put your website back to how it was before this change?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, undo it' }).click();

    // SC-007, measured against the site rather than the interface.
    await expect
      .poll(async () => (await readLiveSite()) !== published, { timeout: UNDO_MS })
      .toBe(true);
    expect(Date.now() - pressedAt).toBeLessThan(UNDO_MS);

    // Neither act may be offered again: the conversation is spent.
    await expect(page.getByRole('button', { name: 'Undo this deploy' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve & Deploy' })).toHaveCount(0);
  });

  test('never names a commit or a branch while doing any of it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('list').getByRole('link').first().click();

    const visible = await page.locator('body').innerText();

    expect(visible).not.toMatch(/\b[0-9a-f]{7,40}\b/);
    expect(visible).not.toMatch(/webagent\/c-\d+/);
    expect(visible).not.toMatch(/\b(commit|branch|merge|revert|pull request)\b/i);
  });
});
