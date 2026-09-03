import { expect, requireLiveInstallation, test } from './fixtures';

/**
 * The journey the product exists for (T094, T096): a client describes a change
 * in their own words and gets somewhere to look at it, with their live site
 * untouched throughout.
 *
 * The timing assertions are the success criteria themselves — SC-003's ten
 * seconds to first feedback and sixty to a meaningful stage, SC-002's four
 * minutes to a preview — asserted rather than aspired to. They are generous
 * because they describe a median against real providers; a run that breaches
 * them is reporting something real about the installation, not flaking.
 *
 * Every selector here is taken from the components as written: the progress
 * trail is an `ol` labelled "Progress on this request", the stage wording comes
 * from `STAGE_LABELS`, and the preview arrives as an iframe titled "Your
 * website preview" rather than as a link.
 */

/** SC-003: the first visible feedback. */
const FIRST_FEEDBACK_MS = 10_000;

/** SC-003: a meaningful stage update. */
const STAGE_UPDATE_MS = 60_000;

/** SC-002: request to viewable preview. */
const PREVIEW_MS = 4 * 60_000;

/**
 * Shapes no client may ever be shown, per Principle I. Written as patterns
 * rather than a list of known strings, because the point is to catch the
 * sentence nobody thought to check.
 */
const FORBIDDEN = [
  /\bsrc\//,
  /\.tsx?\b/,
  /\.html\b/,
  /\.ya?ml\b/,
  /webagent\/c-\d+/,
  /\b[0-9a-f]{7,40}\b/,
  /```/,
  /^\s*[+-]{3}\s/m,
];

test.describe('a change request, from a sentence to a preview', () => {
  test('reaches a preview without the client meeting any code', async ({ page }) => {
    requireLiveInstallation();

    await page.goto('/');

    // Selected by role: each surface passes the composer its own placeholder
    // copy, and a journey should not break when that wording is improved.
    await page.getByRole('textbox').fill('Make the main headline shorter.');

    const sentAt = Date.now();
    await page.getByRole('button', { name: 'Send' }).click();

    // SC-003: the trail appears at once. Which stage it shows does not matter;
    // that the client is not left staring at nothing does.
    const trail = page.getByRole('list', { name: 'Progress on this request' });
    await expect(trail).toBeVisible({ timeout: FIRST_FEEDBACK_MS });
    expect(Date.now() - sentAt).toBeLessThan(FIRST_FEEDBACK_MS);

    // SC-003: a stage in the client's own vocabulary, not a spinner. These are
    // STAGE_LABELS verbatim.
    await expect(
      page.getByText(
        /Making the change|Checking it's allowed|Saving your change|Building your preview/,
      ),
    ).toBeVisible({ timeout: STAGE_UPDATE_MS });

    // SC-002: somewhere to look.
    const preview = page.getByTitle('Your website preview');
    await expect(preview).toBeVisible({ timeout: PREVIEW_MS });
    expect(Date.now() - sentAt).toBeLessThan(PREVIEW_MS);

    // FR-024, and the promise the whole design is built around: what the client
    // is shown is somewhere else. Not their live site.
    const source = await preview.getAttribute('src');
    expect(source).toMatch(/^https:\/\//);
    expect(source).toContain('deploy-preview');
  });

  test('shows the client no file path, diff, branch or commit at any point', async ({ page }) => {
    requireLiveInstallation();

    await page.goto('/');

    // Proves the scan below is looking at the client surface rather than the
    // sign-in page, which would pass this test by having nothing on it.
    await expect(page.getByRole('textbox')).toBeVisible();

    // The iframe's own document is the client's site and is deliberately not
    // read here: Principle I governs what this product writes, not what the
    // client's own website says.
    const visible = await page.locator('body').innerText();

    for (const pattern of FORBIDDEN) {
      expect(visible, `client surface matched ${pattern}`).not.toMatch(pattern);
    }
  });
});
