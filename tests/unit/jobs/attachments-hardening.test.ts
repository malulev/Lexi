import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { isSafeSvg, placeAttachments, stashUploads, verifyPlaced } from '@/lib/jobs/attachments';

/**
 * Two properties an attachment must have before it earns the allow-list
 * exemption: it is a picture and nothing else, and it is still exactly what
 * the client sent once the agent has had the tree.
 */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const encode = (text: string) => new TextEncoder().encode(text);

const roots: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'webagent-attach-hardening-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('isSafeSvg', () => {
  it('accepts a drawing', () => {
    expect(
      isSafeSvg(
        encode('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/><a href="#top"/></svg>'),
      ),
    ).toBe(true);
  });

  it.each([
    '<svg><script>fetch("https://evil.example")</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)></body></foreignObject></svg>',
    '<svg><image href="https://evil.example/track.png"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
  ])('refuses %s', (svg) => {
    expect(isSafeSvg(encode(svg))).toBe(false);
  });

  it('is applied when uploads are stashed, with its own sentence', async () => {
    const file = new File(
      [
        encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>').slice()
          .buffer as ArrayBuffer,
      ],
      'logo.svg',
      {
        type: 'image/svg+xml',
      },
    );
    const outcome = await stashUploads([file], await scratch());
    expect(outcome).toEqual({ ok: false, refusal: 'unsafe_svg' });
  });
});

describe('verifyPlaced', () => {
  async function placedPhoto() {
    const stash = await scratch();
    const tree = await scratch();
    const file = new File([PNG.slice().buffer as ArrayBuffer], 'photo.png', { type: 'image/png' });
    const stashed = await stashUploads([file], stash);
    if (!stashed.ok) throw new Error(stashed.refusal);
    const placed = await placeAttachments(tree, undefined, stashed.attachments);
    return { tree, placed };
  }

  it('names an attachment the agent left alone', async () => {
    const { tree, placed } = await placedPhoto();
    expect(placed).toEqual([
      { path: 'public/uploads/photo.png', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
    expect(await verifyPlaced(tree, placed)).toEqual(['public/uploads/photo.png']);
  });

  it('drops one the agent rewrote, removed, or replaced with a link', async () => {
    const rewritten = await placedPhoto();
    await writeFile(join(rewritten.tree, 'public/uploads/photo.png'), '<svg onload="alert(1)"/>');
    expect(await verifyPlaced(rewritten.tree, rewritten.placed)).toEqual([]);

    const removed = await placedPhoto();
    await rm(join(removed.tree, 'public/uploads/photo.png'));
    expect(await verifyPlaced(removed.tree, removed.placed)).toEqual([]);

    const linked = await placedPhoto();
    await rm(join(linked.tree, 'public/uploads/photo.png'));
    await symlink('../../.webagent/policy.yml', join(linked.tree, 'public/uploads/photo.png'));
    expect(await verifyPlaced(linked.tree, linked.placed)).toEqual([]);
  });
});
