'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useTranslation } from './LocaleProvider';
import { localizeRefusal } from './server-message';
import type { PublishState } from '@/lib/conversations';
import type { Dictionary } from '@/lib/i18n';
import { en } from '@/lib/i18n/en';

/**
 * The one button in this product that changes a client's website, and the one
 * that changes it back.
 *
 * Two properties are carried here rather than assumed. Approval is offered
 * only against a preview that succeeded and disappears the moment the change
 * is live (FR-027), which is why the offer is derived from the conversation's
 * own state instead of being a permanently-present button that sometimes
 * fails. And neither act is a single click: the button asks, and a second,
 * differently-worded press does it (constitution II). The server refuses the
 * same cases independently — this is the courtesy, not the control.
 */

export type PublishOffer =
  | {
      action: 'publish' | 'undo';
      label: string;
      question: string;
      confirmLabel: string;
      note: string;
    }
  | { action: 'none'; note: string | null };

export function selectPublishOffer(state: PublishState, t: Dictionary = en): PublishOffer {
  switch (state) {
    case 'ready':
      return {
        action: 'publish',
        label: t.publish.approve,
        question: t.publish.publishQuestion,
        confirmLabel: t.publish.confirmPublish,
        note: t.publish.publishNote,
      };
    case 'published':
      return {
        action: 'undo',
        label: t.publish.undo,
        question: t.publish.undoQuestion,
        confirmLabel: t.publish.confirmUndo,
        note: t.publish.undoNote,
      };
    case 'undone':
      return { action: 'none', note: t.publish.undoneNote };
    case 'unavailable':
      return { action: 'none', note: t.publish.finishedNote };
    default:
      // Nothing to say: the client is waiting for a preview and the
      // conversation already shows that.
      return { action: 'none', note: null };
  }
}

interface PublishControlsProps {
  conversationNumber: number;
  /** Named in the confirmation, so nobody publishes the wrong conversation from a similar-looking page. */
  title?: string;
  state: PublishState;
  /** A change is being applied right now, so publishing would race it. */
  requestInFlight: boolean;
  /** What to say while the buttons rest; defaults to the change-in-flight sentence. */
  busyNote?: string;
}

export function PublishControls({
  conversationNumber,
  title,
  state,
  requestInFlight,
  busyNote,
}: PublishControlsProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const offer = selectPublishOffer(state, t);

  async function act(action: 'publish' | 'undo'): Promise<void> {
    setWorking(true);
    setRefusal(null);
    try {
      const endpoint = action === 'publish' ? 'approve' : 'undo';
      const response = await fetch(`/api/conversations/${conversationNumber}/${endpoint}`, {
        method: 'POST',
      });
      if (response.ok) {
        setConfirming(false);
        router.refresh();
        return;
      }
      const body = await response.json().catch(() => null);
      setRefusal(localizeRefusal(body, t));
    } catch {
      setRefusal(t.errors.internal_error);
    } finally {
      setWorking(false);
    }
  }

  if (offer.action === 'none') {
    return offer.note ? (
      <p className="publish publish--note" role="status">
        {offer.note}
      </p>
    ) : null;
  }

  return (
    <section className={`publish publish--${offer.action}`} aria-label={t.publish.aria}>
      {refusal ? (
        <p className="publish__refusal" role="alert">
          {refusal}
        </p>
      ) : null}

      {confirming ? (
        <div className="publish__confirm">
          {title ? <p className="publish__what">“{title}”</p> : null}
          <p className="publish__question">{offer.question}</p>
          <div className="publish__row">
            <button
              type="button"
              className="publish__go"
              disabled={working}
              onClick={() => void act(offer.action)}
            >
              {working ? t.publish.oneMoment : offer.confirmLabel}
            </button>
            <button
              type="button"
              className="publish__cancel"
              disabled={working}
              onClick={() => setConfirming(false)}
            >
              {t.publish.notYet}
            </button>
          </div>
        </div>
      ) : (
        <div className="publish__row">
          <button
            type="button"
            className="publish__open"
            disabled={requestInFlight}
            onClick={() => setConfirming(true)}
          >
            {offer.label}
          </button>
          <p className="publish__note" role="status">
            {requestInFlight ? (busyNote ?? t.errors.request_in_flight) : offer.note}
          </p>
        </div>
      )}
    </section>
  );
}
