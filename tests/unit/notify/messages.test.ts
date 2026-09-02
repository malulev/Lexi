import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TEMPLATES, notificationContent } from '@/lib/notify/messages';
import type { NotificationEvent } from '@/types';

/**
 * Principle I applies to a notification email exactly as it applies to
 * `src/lib/jobs/messages.ts`'s error vocabulary, so this audits the whole
 * table the same way `tests/unit/messages.test.ts` audits that one: no file
 * path, no diff, no build log, no branch name, no git vocabulary, no pull
 * request number.
 *
 * `NotificationEvent` values are duplicated here rather than imported as a
 * runtime array, matching how `src/lib/record/record.ts` already duplicates
 * the same enum for its own schema — there is no exported runtime list to
 * import instead.
 */

const ALL_EVENTS: NotificationEvent[] = [
  'preview_ready',
  'request_blocked',
  'request_failed',
  'published',
  'undone',
];

const CONTEXT = {
  conversationTitle: 'Homepage hero refresh',
  link: 'https://client.example.com/c/42',
};

describe('the notification vocabulary', () => {
  it('covers every notification event with a template', () => {
    expect(Object.keys(NOTIFICATION_TEMPLATES).sort()).toEqual([...ALL_EVENTS].sort());
  });

  it('produces a non-empty subject and body for every event', () => {
    for (const event of ALL_EVENTS) {
      const { subject, text } = notificationContent(event, CONTEXT);
      expect(subject, event).toBeTruthy();
      expect(text, event).toBeTruthy();
    }
  });

  it('names the conversation by its title, never only by a bare number', () => {
    for (const event of ALL_EVENTS) {
      const { subject, text } = notificationContent(event, CONTEXT);
      expect(subject, event).toContain(CONTEXT.conversationTitle);
      expect(text, event).toContain(CONTEXT.conversationTitle);
    }
  });

  it('carries the conversation link, with its number appearing only inside that link', () => {
    for (const event of ALL_EVENTS) {
      const { subject, text } = notificationContent(event, CONTEXT);
      expect(text, event).toContain(CONTEXT.link);

      const textOutsideLink = text.split(CONTEXT.link).join('');
      const subjectOutsideLink = subject.split(CONTEXT.link).join('');
      expect(textOutsideLink, event).not.toMatch(/\b42\b/);
      expect(subjectOutsideLink, event).not.toMatch(/\b42\b/);
    }
  });

  it('names no file path, extension, or directory', () => {
    for (const event of ALL_EVENTS) {
      const { subject, text } = notificationContent(event, CONTEXT);
      for (const value of [subject, text]) {
        expect(value, event).not.toMatch(/\.(ts|tsx|js|jsx|json|yml|yaml|md|css)\b/);
        expect(value, event).not.toMatch(/\.webagent|node_modules|src\b/);
      }
    }
  });

  it('uses no git or build vocabulary', () => {
    const forbidden =
      /\b(commit|branch|merge|rebase|diff|repository|repo|pull request|PR|SHA|stack trace|exception|npm|webpack|stderr|exit code)\b/i;
    for (const event of ALL_EVENTS) {
      const { subject, text } = notificationContent(event, CONTEXT);
      expect(subject, event).not.toMatch(forbidden);
      expect(text, event).not.toMatch(forbidden);
    }
  });

  it('never surfaces a raw hosting-provider preview URL, only the product link', () => {
    // NotificationContext carries no `previewUrl` field at all — enforced
    // structurally by the type in email.ts, not merely by convention here.
    // A Netlify deploy-preview URL names the build system exactly as a
    // branch name or commit SHA would, so it must never reach this table.
    for (const event of ALL_EVENTS) {
      const { subject, text } = notificationContent(event, CONTEXT);
      expect(subject, event).not.toMatch(/netlify\.app/);
      expect(text, event).not.toMatch(/netlify\.app/);
    }
  });

  it('reads as a sentence a non-technical person can act on', () => {
    for (const event of ALL_EVENTS) {
      const { subject, text } = notificationContent(event, CONTEXT);
      // Every message ends with the conversation link by design, so the
      // sentence structure is checked on the prose that precedes it.
      const prose = text.slice(0, text.indexOf(CONTEXT.link));
      expect(prose, event).toMatch(/[.!?:]\s*$/);
      expect(subject.length, event).toBeLessThan(120);
      expect(subject[0], event).toEqual(subject[0]?.toUpperCase());
    }
  });
});
