'use client';

import { useId, useState } from 'react';

import { useTranslation } from './LocaleProvider';
import { selectErrorHelp } from './error-help';
import type { ErrorCode } from '@/types';

/**
 * The question mark beside a setback.
 *
 * A disclosure rather than a hover tooltip, deliberately. Hover is not an
 * interaction a touch screen has, and `title=""` cannot be styled, cannot be
 * read at leisure, and is announced inconsistently by screen readers. A button
 * that toggles a paragraph works everywhere, is reachable by keyboard by
 * construction, and the paragraph stays put while it is read.
 *
 * It renders nothing at all unless `selectErrorHelp` finds something worth
 * saying, so a successful change never carries a question mark that opens onto
 * a repetition of the sentence above it.
 */
export function ErrorHelp({ errorCode, shownText }: { errorCode?: ErrorCode; shownText: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const help = selectErrorHelp(errorCode, shownText, t);
  if (!help) return null;

  return (
    <div className="message__help">
      <button
        type="button"
        className="message__help-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        // The mark itself is decorative; the button's name is the question it
        // answers, so a screen reader announces something better than "?".
        aria-label={t.messages.why}
        title={t.messages.why}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span aria-hidden="true">?</span>
      </button>
      <p id={panelId} className="message__help-text" hidden={!open} dir="auto">
        {help}
      </p>
    </div>
  );
}
