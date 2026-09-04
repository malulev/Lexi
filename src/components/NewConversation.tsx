'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Composer, type ComposerPayload } from './Composer';
import { useTranslation } from './LocaleProvider';
import { postChange } from './send-change';
import { localizeRefusal } from './server-message';
import { WorkingIndicator } from './WorkingIndicator';
import type { ModelTier } from '@/types';

/**
 * Opening a new conversation from the list.
 *
 * The installation runs one request at a time, so this can be refused with the
 * same `request_in_flight` message the composer shows inside a conversation —
 * the sentence comes from the one vocabulary either way.
 */
export function NewConversation({
  defaultModelTier,
  models,
}: {
  defaultModelTier?: ModelTier;
  models?: Record<ModelTier, string>;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [openingSince, setOpeningSince] = useState<number | null>(null);

  async function send(payload: ComposerPayload): Promise<void> {
    setRefusal(null);
    setOpeningSince(Date.now());

    const response = await postChange('/api/conversations', {
      message: payload.text,
      modelTier: payload.modelTier,
      files: payload.files,
    });

    if (response.ok) {
      const { number } = (await response.json()) as { number: number };
      router.push(`/c/${number}`);
      return;
    }

    setOpeningSince(null);
    const body = await response.json().catch(() => null);
    const message = localizeRefusal(body, t);

    setRefusal(message);
    throw new Error(message);
  }

  return (
    <>
      {openingSince !== null ? (
        <div className="home__opening">
          <WorkingIndicator
            kind="change"
            stage="starting"
            startedAt={openingSince}
            lastActivityAt={null}
          />
        </div>
      ) : null}
      <Composer
        onSend={send}
        availability={{ disabled: false, reason: null }}
        placeholder={t.composer.examplePlaceholder}
        rows={3}
        prominent
        {...(defaultModelTier ? { defaultModelTier } : {})}
        {...(models ? { models } : {})}
      />
      {refusal ? (
        <p className="home__status home__status--setback" role="alert">
          {refusal}
        </p>
      ) : null}
    </>
  );
}
