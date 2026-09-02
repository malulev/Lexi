import { describe, expect, it } from 'vitest';
import { CLIENT_MESSAGES, clientMessage, errorBody, ERROR_STATUS } from '@/lib/jobs/messages';
import type { ErrorCode } from '@/types';

/**
 * Principle I is a property of the message table, so it is asserted over the
 * whole table rather than message by message. A new code added without a
 * client-safe message fails here.
 */
describe('the client-facing vocabulary', () => {
  const messages = Object.entries(CLIENT_MESSAGES) as Array<[ErrorCode, string]>;

  it('covers every code with a message and a status', () => {
    for (const [code] of messages) {
      expect(clientMessage(code), code).toBeTruthy();
      expect(ERROR_STATUS[code], code).toBeGreaterThan(0);
    }
    expect(Object.keys(ERROR_STATUS).sort()).toEqual(Object.keys(CLIENT_MESSAGES).sort());
  });

  it('names no file path, extension, or directory', () => {
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(/\.(ts|tsx|js|jsx|json|yml|yaml|md|css)\b/);
      expect(message, code).not.toMatch(/(^|\s)[\w.-]*\//);
      expect(message, code).not.toMatch(/\.webagent|node_modules|src\b/);
    }
  });

  it('uses no git or build vocabulary', () => {
    const forbidden =
      /\b(commit|branch|merge|rebase|diff|repository|repo|pull request|PR|SHA|stack trace|exception|npm|webpack|stderr|exit code)\b/i;
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(forbidden);
    }
  });

  it('reads as a sentence a non-technical person can act on', () => {
    for (const [code, message] of messages) {
      expect(message, code).toMatch(/[.!?]$/);
      expect(message.length, code).toBeLessThan(120);
      expect(message[0], code).toEqual(message[0]?.toUpperCase());
    }
  });

  it('returns a uniform body so no route invents its own error shape', () => {
    expect(errorBody('request_in_flight')).toEqual({
      error: 'request_in_flight',
      message: CLIENT_MESSAGES.request_in_flight,
    });
  });

  it('answers a second in-flight request with 409, which is what the disabled input cannot enforce', () => {
    expect(ERROR_STATUS.request_in_flight).toBe(409);
    expect(ERROR_STATUS.out_of_date).toBe(409);
  });
});
