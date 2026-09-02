'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Composer } from './Composer';

/**
 * Opening a new conversation from the list.
 *
 * The installation runs one request at a time, so this can be refused with the
 * same `request_in_flight` message the composer shows inside a conversation —
 * the sentence comes from the one vocabulary either way.
 */
export function NewConversation() {
  const router = useRouter();
  const [refusal, setRefusal] = useState<string | null>(null);

  async function send(text: string): Promise<void> {
    setRefusal(null);

    const response = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });

    if (response.ok) {
      const { number } = (await response.json()) as { number: number };
      router.push(`/c/${number}`);
      return;
    }

    const body = await response.json().catch(() => null);
    const message =
      body && typeof body.message === 'string'
        ? body.message
        : 'Something went wrong on my side. Nothing was published.';

    setRefusal(message);
    throw new Error(message);
  }

  return (
    <>
      <Composer
        onSend={send}
        availability={{ disabled: false, reason: null }}
        placeholder="Make the homepage headline shorter and the button dark blue"
      />
      {refusal ? <p className="conv-list__status conv-list__status--setback">{refusal}</p> : null}
    </>
  );
}
