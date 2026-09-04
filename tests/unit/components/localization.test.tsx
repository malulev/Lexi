import { describe, expect, it } from 'vitest';

import { selectComposerAvailability } from '@/components/Composer';
import { describeConversationStatus, messageText } from '@/components/MessageList';
import { describeCostEstimate } from '@/components/ModelPicker';
import { buildTrailSteps, describeStage } from '@/components/ProgressTrail';
import { selectPublishOffer } from '@/components/PublishControls';
import { localizeRefusal } from '@/components/server-message';
import { pickLine } from '@/components/WorkingIndicator';
import { DICTIONARIES } from '@/lib/i18n';
import { CLIENT_MESSAGES, PUBLISH_REFUSALS } from '@/lib/jobs/messages';
import { describeUpdatedAt } from '@/lib/time';

/**
 * The pure halves of the client components, spoken in another language.
 *
 * Each of these functions defaults to English so the existing audits hold,
 * and takes a dictionary so the page's language flows through: the same
 * stage, status or offer, the sentence a Hebrew or French reader gets.
 */
const { he, fr, nl, en } = DICTIONARIES;

describe('component vocabulary in another language', () => {
  it('names stages, statuses and offers from the given dictionary', () => {
    expect(describeStage('pushing', 'publish', he)).toBe(he.stages.publish.pushing);
    expect(describeStage('pushing', 'publish', he)).not.toBe(describeStage('pushing', 'publish'));
    expect(
      buildTrailSteps(['starting', 'running'], 'change', fr).map((step) => step.label),
    ).toEqual([
      fr.stages.change.starting,
      fr.stages.change.running,
      fr.stages.change.gating,
      fr.stages.change.pushing,
      fr.stages.change.building,
      fr.stages.change.succeeded,
    ]);
    expect(describeConversationStatus('open', nl)).toBe(nl.status.open);
    expect(selectPublishOffer('ready', he)).toMatchObject({
      action: 'publish',
      label: he.publish.approve,
    });
    expect(
      selectComposerAvailability({ requestInFlight: false, conversationStatus: 'closed' }, fr)
        .reason,
    ).toBe(fr.composer.closed);
  });

  it('falls back to the dictionary’s error sentence when a message has no prose', () => {
    const message = {
      id: 1,
      author: 'agent' as const,
      at: '2026-09-03T10:00:00Z',
      text: '',
      errorCode: 'build_failed' as const,
    };
    expect(messageText(message, he)).toBe(he.errors.build_failed);
    expect(messageText(message)).toBe(CLIENT_MESSAGES.build_failed);
  });

  it('rotates the working lines of the given language', () => {
    expect(pickLine('change', 'running', 0, he.working.lines)).toBe(
      he.working.lines.change.running?.[0],
    );
    expect(pickLine('change', 'succeeded', 0, he.working.lines)).toBeNull();
  });
});

describe('describeUpdatedAt in another language', () => {
  const NOW = Date.parse('2026-09-03T12:00:00Z');

  it('uses the language’s sentences and date order', () => {
    expect(describeUpdatedAt('2026-09-03T11:59:50Z', NOW, 'fr')).toBe(fr.home.updatedJustNow);
    expect(describeUpdatedAt('2026-09-03T11:35:00Z', NOW, 'nl')).toBe(
      nl.home.updatedMinutes.replace('{n}', '25'),
    );
    expect(describeUpdatedAt('2026-09-03T11:00:00Z', NOW, 'he')).toBe(he.home.updatedHour);
    expect(describeUpdatedAt('2026-08-10T12:00:00Z', NOW, 'fr')).toContain('août');
    expect(describeUpdatedAt('2026-08-10T12:00:00Z', NOW)).toBe('Updated 10 Aug');
  });
});

describe('localizeRefusal', () => {
  it('translates a code’s default sentence, and shows a narrowed one as sent', () => {
    expect(
      localizeRefusal(
        { error: 'request_in_flight', message: CLIENT_MESSAGES.request_in_flight },
        he,
      ),
    ).toBe(he.errors.request_in_flight);
    expect(
      localizeRefusal({ error: 'nothing_to_publish', message: PUBLISH_REFUSALS.published }, he),
    ).toBe(PUBLISH_REFUSALS.published);
  });

  it('never invents a sentence for a body it cannot read', () => {
    expect(localizeRefusal(null, fr)).toBe(fr.errors.internal_error);
    expect(localizeRefusal({ error: 'bad_request' }, fr)).toBe(fr.errors.internal_error);
    expect(localizeRefusal({ message: 'Only this.' }, fr)).toBe('Only this.');
    expect(localizeRefusal({ error: 'internal_error' }, en)).toBe(CLIENT_MESSAGES.internal_error);
  });
});

describe('describeCostEstimate', () => {
  const money = (usd: number) => `$${usd.toFixed(2)}`;

  it('says free, under a cent, about a sum, or that it does not know', () => {
    expect(describeCostEstimate({ kind: 'free' }, en, money)).toBe('free');
    expect(describeCostEstimate({ kind: 'under_cent' }, en, money)).toBe('under a cent');
    expect(describeCostEstimate({ kind: 'about', usd: 0.2 }, en, money)).toBe('about $0.20');
    expect(describeCostEstimate({ kind: 'unknown' }, en, money)).toBe(en.composer.exampleUnknown);
    expect(describeCostEstimate({ kind: 'about', usd: 1 }, he, money)).toBe(
      he.composer.exampleAbout.replace('{cost}', '$1.00'),
    );
  });
});
