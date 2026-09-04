import type { AttachmentRefusal } from '@/lib/jobs/messages';
import type { ConversationStatus, ErrorCode, ModelTier, RequestKind, Stage } from '@/types';

/**
 * Every sentence the client interface can say, as one shape.
 *
 * Each language fills this in completely — a key left out of `he.ts` is a
 * compile error, not an English fallback a Hebrew reader stumbles on. Text
 * with a moving part carries it as `{name}`; `formatMessage` fills it. The
 * placeholders a key uses are fixed by the English text and audited by
 * `tests/unit/i18n/dictionaries.test.ts` across all languages.
 *
 * What is *not* here: the agent's own summaries (they are written in whatever
 * language the agent wrote them), sentences the server writes into the
 * durable record (those are English, and read back as such), and the
 * developer's configuration pages (not a client surface).
 */

export interface TierWords {
  name: string;
  cost: string;
  hint: string;
}

export interface Dictionary {
  shell: {
    /** The switcher's accessible name. */
    language: string;
    signOut: string;
    allChanges: string;
    siteLinkTitle: string;
    mainNav: string;
  };
  home: {
    editing: string;
    title: string;
    lede: string;
    yourChanges: string;
    unreachable: string;
    nothingYet: string;
    updatedJustNow: string;
    /** `{n}` minutes. */
    updatedMinutes: string;
    updatedHour: string;
    /** `{n}` hours. */
    updatedHours: string;
    updatedDay: string;
    /** `{n}` days. */
    updatedDays: string;
    /** `{date}`, already formatted for the language. */
    updatedOn: string;
  };
  conversation: {
    show: string;
    conversationTab: string;
    previewTab: string;
    conversationAria: string;
  };
  status: Record<ConversationStatus, string>;
  messages: {
    nothingYet: string;
    describeFirst: string;
    previewReady: string;
    /** `{model}` — shown only in advanced mode. */
    madeWith: string;
    /** `{cost}` — shown only in advanced mode. */
    costOf: string;
  };
  preview: {
    ariaLabel: string;
    title: string;
    updating: string;
    private: string;
    widthAria: string;
    desktop: string;
    mobile: string;
    reload: string;
    reloadTitle: string;
    openNewTab: string;
    visitWebsite: string;
    frameTitle: string;
    onItsWay: string;
    keepOpen: string;
    noPreview: string;
    willAppear: string;
    describeAndSee: string;
  };
  stages: Record<RequestKind, Record<Stage, string>>;
  trailTitles: Record<RequestKind, string>;
  working: {
    lines: Record<RequestKind, Partial<Record<Stage, readonly string[]>>>;
    usual: Record<RequestKind, string>;
    fallback: string;
    pulse: string;
  };
  publish: {
    aria: string;
    approve: string;
    publishQuestion: string;
    confirmPublish: string;
    publishNote: string;
    undo: string;
    undoQuestion: string;
    confirmUndo: string;
    undoNote: string;
    undoneNote: string;
    finishedNote: string;
    oneMoment: string;
    notYet: string;
  };
  composer: {
    alreadyPublished: string;
    closed: string;
    placeholder: string;
    followUpPlaceholder: string;
    examplePlaceholder: string;
    describeAria: string;
    attachedAria: string;
    /** `{name}` of the file. */
    remove: string;
    attachAria: string;
    /** `{size}`, already formatted. */
    attachTitle: string;
    attach: string;
    enterHint: string;
    sending: string;
    send: string;
    effort: string;
    spendAria: string;
    showDetails: string;
    hideDetails: string;
    /** `{model}` — the model a tier runs, in advanced mode. */
    modelLabel: string;
    /** The example task the estimate is for. */
    exampleTask: string;
    /** `{cost}`, already formatted as money. */
    exampleAbout: string;
    exampleFree: string;
    exampleUnderCent: string;
    exampleUnknown: string;
  };
  tiers: Record<ModelTier, TierWords>;
  errors: Record<ErrorCode, string>;
  attachmentRefusals: Record<AttachmentRefusal, string>;
  interrupted: string;
  publicationInProgress: string;
  bringingUpToDate: string;
  login: {
    headline: string;
    headlineEm: string;
    /** `{name}` of the product. */
    lede: string;
    checkEmail: string;
    /** `{email}` the person typed. */
    linkOnItsWay: string;
    useDifferent: string;
    signIn: string;
    noPassword: string;
    yourEmail: string;
    emailPlaceholder: string;
    sending: string;
    emailMe: string;
    /** `{name}` of the product. */
    couldNotReach: string;
    demoClient: string;
    demoAgent: string;
  };
}
