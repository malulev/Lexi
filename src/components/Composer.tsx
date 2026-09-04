'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';

import { addFiles, emptySelection, removeFile, type AttachmentSelection } from './attachment-state';
import { useTranslation } from './LocaleProvider';
import { ModelPicker } from './ModelPicker';
import { readRememberedTier, rememberTier } from './send-change';
import { ATTACHMENT_ACCEPT, ATTACHMENT_LIMITS, describeSize } from '@/lib/attachments';
import { en } from '@/lib/i18n/en';
import { formatMessage, type Dictionary } from '@/lib/i18n';
import type { ConversationStatus, ModelTier } from '@/types';

export interface ComposerAvailability {
  disabled: boolean;
  reason: string | null;
  /** The reason is "wait", not "no": something is happening right now. */
  busy?: boolean;
}

/**
 * Whether the client may type a new request right now, and — per FR-007a —
 * the plain-language reason when they may not. A message a client sends
 * anyway while one is running is refused server-side with `409
 * request_in_flight` (FR-007b); the reason shown here is that exact
 * sentence, not a new one invented for the interface, so the two can never
 * drift apart. A conversation that has moved past "Draft" cannot take a
 * follow-up (data-model.md: `published → open` is impossible), so those
 * statuses get their own plain reason instead of a confusing failed send.
 */
export function selectComposerAvailability(
  input: {
    requestInFlight: boolean;
    conversationStatus?: ConversationStatus;
    /** What to say while something runs, when it is not a change being applied. */
    busyReason?: string;
  },
  t: Dictionary = en,
): ComposerAvailability {
  if (input.requestInFlight) {
    return { disabled: true, reason: input.busyReason ?? t.errors.request_in_flight, busy: true };
  }
  if (input.conversationStatus === 'published') {
    return { disabled: true, reason: t.composer.alreadyPublished };
  }
  if (input.conversationStatus === 'closed') {
    return { disabled: true, reason: t.composer.closed };
  }
  return { disabled: false, reason: null };
}

/** What a client sends: their words, how much to spend, and anything attached. */
export interface ComposerPayload {
  text: string;
  modelTier: ModelTier;
  files: File[];
}

/** Where the picker opens: what the client last chose, else what the installation runs by default. */
export function selectInitialTier(defaultTier: ModelTier, remembered: ModelTier | null): ModelTier {
  return selectComposerTier({ showPicker: true, defaultTier, remembered });
}

/**
 * The tier a composer sends. With the picker shown, the client's last choice
 * wins over the default. With it hidden — inside a conversation — the default
 * is the conversation's own tier and nothing remembered may override it: a
 * follow-up costs what the conversation was started at.
 */
export function selectComposerTier(input: {
  showPicker: boolean;
  defaultTier: ModelTier;
  remembered: ModelTier | null;
}): ModelTier {
  if (!input.showPicker) return input.defaultTier;
  return input.remembered ?? input.defaultTier;
}

interface ComposerProps {
  onSend: (payload: ComposerPayload) => Promise<void>;
  availability: ComposerAvailability;
  placeholder?: string;
  rows?: number;
  /** The large, hero-sized composer on the list page. */
  prominent?: boolean;
  /** The tier the installation runs when a client expresses no preference. */
  defaultModelTier?: ModelTier;
  /** The model each tier runs here, for the picker's details view. */
  models?: Record<ModelTier, string>;
  /** Hidden inside a conversation, where the tier is already decided. */
  showModelPicker?: boolean;
}

/** The one way a client speaks to the product: a text box, a budget, a paperclip, and a send button. */
export function Composer({
  onSend,
  availability,
  placeholder,
  rows = 2,
  prominent = false,
  defaultModelTier = 'medium',
  models,
  showModelPicker = true,
}: ComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [tier, setTier] = useState<ModelTier>(() =>
    selectComposerTier({
      showPicker: showModelPicker,
      defaultTier: defaultModelTier,
      remembered: showModelPicker ? readRememberedTier() : null,
    }),
  );
  const [selection, setSelection] = useState<AttachmentSelection>(emptySelection());
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const disabled = availability.disabled || sending;

  function chooseTier(next: ModelTier) {
    setTier(next);
    rememberTier(next);
  }

  function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    setSelection((current) => addFiles(current, picked));
    // Let the same file be picked again after it was removed.
    event.target.value = '';
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend({ text: trimmed, modelTier: tier, files: selection.files });
      setText('');
      setSelection(emptySelection());
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t.errors.internal_error);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void submit();
  }

  return (
    <form className={`composer${prominent ? ' composer--prominent' : ''}`} onSubmit={handleSubmit}>
      {availability.reason ? (
        <p
          className={`composer__reason${availability.busy ? ' composer__reason--busy' : ''}`}
          role="status"
        >
          {availability.reason}
        </p>
      ) : null}
      {sendError ? (
        <p className="composer__error" role="alert">
          {sendError}
        </p>
      ) : null}
      <div className="composer__field">
        <textarea
          className="composer__input"
          dir="auto"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? t.composer.placeholder}
          disabled={disabled}
          rows={rows}
          aria-label={t.composer.describeAria}
        />

        {selection.files.length > 0 ? (
          <ul className="attachments" aria-label={t.composer.attachedAria}>
            {selection.files.map((file, index) => (
              <li key={`${file.name}-${file.size}`} className="attachments__item">
                <span className="attachments__name" title={file.name}>
                  {file.name}
                </span>
                <span className="attachments__size">{describeSize(file.size)}</span>
                <button
                  type="button"
                  className="attachments__remove"
                  aria-label={formatMessage(t.composer.remove, { name: file.name })}
                  disabled={disabled}
                  onClick={() => setSelection((current) => removeFile(current, index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {selection.refusal ? (
          <p className="composer__error composer__error--inline" role="alert">
            {t.attachmentRefusals[selection.refusal]}
          </p>
        ) : null}

        <div className="composer__bar">
          <div className="composer__tools">
            <input
              ref={fileInput}
              type="file"
              className="composer__file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              disabled={disabled}
              onChange={pickFiles}
              aria-label={t.composer.attachAria}
              tabIndex={-1}
            />
            <button
              type="button"
              className="composer__attach"
              disabled={disabled || selection.files.length >= ATTACHMENT_LIMITS.maxFiles}
              onClick={() => fileInput.current?.click()}
              title={formatMessage(t.composer.attachTitle, {
                size: describeSize(ATTACHMENT_LIMITS.maxFileBytes),
              })}
            >
              <span aria-hidden="true">📎</span> {t.composer.attach}
            </button>
            <span className="composer__hint" aria-hidden="true">
              {t.composer.enterHint}
            </span>
          </div>
          <button
            type="submit"
            className="composer__send"
            disabled={disabled || text.trim().length === 0}
          >
            {sending ? t.composer.sending : t.composer.send}
          </button>
        </div>

        {showModelPicker ? (
          <ModelPicker
            value={tier}
            onChange={chooseTier}
            disabled={disabled}
            name={prominent ? 'tier-new' : 'tier'}
            {...(models ? { models } : {})}
          />
        ) : null}
      </div>
    </form>
  );
}
