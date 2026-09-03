'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import type { PublishState } from '@/lib/conversations';

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
  | { action: 'publish' | 'undo'; label: string; question: string; confirmLabel: string }
  | { action: 'none'; note: string | null };

export function selectPublishOffer(state: PublishState): PublishOffer {
  switch (state) {
    case 'ready':
      return {
        action: 'publish',
        label: 'Approve & Deploy',
        question: 'Publish this change to your live website?',
        confirmLabel: 'Yes, publish it',
      };
    case 'published':
      return {
        action: 'undo',
        label: 'Undo this deploy',
        question: 'Put your website back to how it was before this change?',
        confirmLabel: 'Yes, undo it',
      };
    case 'undone':
      return { action: 'none', note: 'This change was published and then undone.' };
    case 'unavailable':
      return { action: 'none', note: 'This conversation is finished.' };
    default:
      // Nothing to say: the client is waiting for a preview and the
      // conversation already shows that.
      return { action: 'none', note: null };
  }
}

interface PublishControlsProps {
  conversationNumber: number;
  state: PublishState;
  /** A change is being applied right now, so publishing would race it. */
  requestInFlight: boolean;
}

export function PublishControls({
  conversationNumber,
  state,
  requestInFlight,
}: PublishControlsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const offer = selectPublishOffer(state);

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
      setRefusal(
        body && typeof body.message === 'string' ? body.message : CLIENT_MESSAGES.internal_error,
      );
    } catch {
      setRefusal(CLIENT_MESSAGES.internal_error);
    } finally {
      setWorking(false);
    }
  }

  if (offer.action === 'none') {
    return offer.note ? (
      <p className="publish publish__note" role="status">
        {offer.note}
      </p>
    ) : null;
  }

  return (
    <section className={`publish publish--${offer.action}`}>
      {refusal ? (
        <p className="publish__refusal" role="alert">
          {refusal}
        </p>
      ) : null}

      {confirming ? (
        <div className="publish__confirm">
          <p className="publish__question">{offer.question}</p>
          <div className="publish__row">
            <button
              type="button"
              className="publish__go"
              disabled={working}
              onClick={() => void act(offer.action)}
            >
              {working ? 'One moment…' : offer.confirmLabel}
            </button>
            <button
              type="button"
              className="publish__cancel"
              disabled={working}
              onClick={() => setConfirming(false)}
            >
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="publish__open"
          disabled={requestInFlight}
          onClick={() => setConfirming(true)}
        >
          {offer.label}
        </button>
      )}

      {requestInFlight && !confirming ? (
        <p className="publish__note" role="status">
          {CLIENT_MESSAGES.request_in_flight}
        </p>
      ) : null}
    </section>
  );
}
