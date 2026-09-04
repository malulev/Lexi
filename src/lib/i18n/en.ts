import {
  ATTACHMENT_REFUSALS,
  BRINGING_UP_TO_DATE,
  CLIENT_MESSAGES,
  INTERRUPTED_MESSAGE,
  PUBLICATION_IN_PROGRESS,
} from '@/lib/jobs/messages';
import { MODEL_TIER_LABELS } from '@/lib/models';
import type { Dictionary } from './types';

/**
 * English: the source language.
 *
 * The error vocabulary, the tier labels and the rest come from the modules
 * that own them, so the sentence a route writes into a record and the one
 * the interface shows for the same code can never differ. The stage and
 * working-line tables live here and are re-exported by the components that
 * used to own them, keeping `tests/unit/components/*` and the Principle I
 * audits pointed at one table.
 *
 * This module imports only pure modules (`messages`, `models`), never a
 * component — the components import *it*, and a cycle here would evaluate
 * to `undefined` at the worst moment.
 */
export const en: Dictionary = {
  shell: {
    language: 'Language',
    signOut: 'Sign out',
    allChanges: 'All changes',
    siteLinkTitle: 'The website this editor changes',
    mainNav: 'Main',
  },
  home: {
    editing: 'Editing',
    title: 'What would you like to change?',
    lede: 'Describe it the way you would to a colleague. You will get a preview to look at before anything goes live.',
    yourChanges: 'Your changes',
    unreachable:
      'Can’t reach your website’s hosting right now. Your changes are safe; try again in a moment.',
    nothingYet: 'Nothing yet. Describe a change above and it will appear here.',
    updatedJustNow: 'Updated just now',
    updatedMinutes: 'Updated {n} min ago',
    updatedHour: 'Updated 1 hour ago',
    updatedHours: 'Updated {n} hours ago',
    updatedDay: 'Updated 1 day ago',
    updatedDays: 'Updated {n} days ago',
    updatedOn: 'Updated {date}',
  },
  conversation: {
    show: 'Show',
    conversationTab: 'Conversation',
    previewTab: 'Preview',
    conversationAria: 'Conversation',
  },
  status: {
    open: 'Draft',
    published: 'Published',
    closed: 'Closed',
  },
  messages: {
    nothingYet: 'Nothing here yet.',
    describeFirst: 'Describe the first change below.',
    previewReady: 'A preview is ready.',
    madeWith: 'Made with {model}',
    costOf: 'cost {cost}',
  },
  preview: {
    ariaLabel: 'Preview',
    title: 'Preview',
    updating: 'Updating…',
    private: 'Private',
    widthAria: 'Preview width',
    desktop: 'Desktop',
    mobile: 'Mobile',
    reload: 'Reload',
    reloadTitle: 'Load the preview again',
    openNewTab: 'Open in new tab',
    visitWebsite: 'Visit your website',
    frameTitle: 'Your website preview',
    onItsWay: 'Your preview is on its way',
    keepOpen:
      'You can keep this page open or come back later — you will get an email when it is ready.',
    noPreview: 'No preview this time',
    willAppear: 'Your preview will appear here',
    describeAndSee: 'Describe a change and you will see it before it goes live.',
  },
  stages: {
    change: {
      starting: 'Getting started',
      running: 'Making the change',
      gating: "Checking it's allowed",
      pushing: 'Saving your change',
      building: 'Building your preview',
      succeeded: 'Ready to look at',
      blocked: 'Stopped — not allowed',
      failed: 'Something went wrong',
      abandoned: 'Stopped without finishing',
    },
    publish: {
      starting: 'Getting started',
      running: 'Publishing',
      gating: "Checking it's safe to publish",
      pushing: 'Publishing your change',
      building: 'Building your website',
      succeeded: 'Live on your website',
      blocked: 'Stopped — not allowed',
      failed: 'Something went wrong',
      abandoned: 'Stopped without finishing',
    },
    undo: {
      starting: 'Getting started',
      running: 'Undoing',
      gating: "Checking it's safe to undo",
      pushing: 'Taking the change back',
      building: 'Rebuilding your website',
      succeeded: 'Back to how it was',
      blocked: 'Stopped — not allowed',
      failed: 'Something went wrong',
      abandoned: 'Stopped without finishing',
    },
  },
  trailTitles: {
    change: 'Progress on this request',
    publish: 'Progress on publishing',
    undo: 'Progress on undoing',
  },
  working: {
    lines: {
      change: {
        starting: ['Rolling up sleeves', 'Finding your website', 'Putting the kettle on'],
        running: [
          'Reading your website, top to bottom',
          'Choosing words carefully',
          'Trying a few ideas and keeping the best one',
          'Nudging things into place',
          'Measuring twice',
          'Squinting at the details',
          'Checking it reads well out loud',
          'Consulting the style guide',
        ],
        gating: ['Making sure nothing off-limits was touched', 'Counting the changes'],
        pushing: ['Tucking your change away safely'],
        building: [
          'Your hosting is building the preview',
          'Warming up the pixels',
          'Brewing the preview — this is the slow part',
          'Nearly there',
        ],
      },
      publish: {
        starting: ['Getting ready to go live'],
        gating: ['Making sure the coast is clear'],
        pushing: ['Sending your change to the live site'],
        building: [
          'Your hosting is rebuilding the site',
          'Polishing the live pages',
          'Nearly there',
        ],
      },
      undo: {
        starting: ['Finding the way back'],
        gating: ['Making sure it is safe to go back'],
        pushing: ['Putting things back the way they were'],
        building: ['Rebuilding the site as it was', 'Nearly there'],
      },
    },
    usual: {
      change: 'usually 2–4 minutes',
      publish: 'usually 1–3 minutes',
      undo: 'usually 1–3 minutes',
    },
    fallback: 'Working on it',
    pulse: 'working right now',
  },
  publish: {
    aria: 'Publishing',
    approve: 'Approve & Deploy',
    publishQuestion: 'Publish this change to your live website?',
    confirmPublish: 'Yes, publish it',
    publishNote: 'Happy with the preview? Publishing puts this change on your live website.',
    undo: 'Undo this deploy',
    undoQuestion: 'Put your website back to how it was before this change?',
    confirmUndo: 'Yes, undo it',
    undoNote: 'This change is live. You can put your website back the way it was.',
    undoneNote: 'This change was published and then undone.',
    finishedNote: 'This conversation is finished.',
    oneMoment: 'One moment…',
    notYet: 'Not yet',
  },
  composer: {
    alreadyPublished:
      'This conversation is already published. Start a new one to make another change.',
    closed: 'This conversation is closed. Start a new one to make another change.',
    placeholder: 'Describe a change to your website…',
    followUpPlaceholder: 'Describe another change',
    examplePlaceholder: 'Make the homepage headline shorter and the button dark blue',
    describeAria: 'Describe a change',
    attachedAria: 'Attached files',
    remove: 'Remove {name}',
    attachAria: 'Attach files',
    attachTitle: 'Attach images or PDF files, up to {size} each',
    attach: 'Attach',
    enterHint: 'Enter to send · Shift+Enter for a new line',
    sending: 'Sending…',
    send: 'Send',
    effort: 'Effort',
    spendAria: 'How much to spend on this change',
    showDetails: 'Show details',
    hideDetails: 'Hide details',
    modelLabel: 'Runs {model}',
    exampleTask: 'Replacing a logo',
    exampleAbout: 'about {cost}',
    exampleFree: 'free',
    exampleUnderCent: 'under a cent',
    exampleUnknown: 'no estimate for this model',
  },
  tiers: MODEL_TIER_LABELS,
  errors: CLIENT_MESSAGES,
  attachmentRefusals: ATTACHMENT_REFUSALS,
  interrupted: INTERRUPTED_MESSAGE,
  publicationInProgress: PUBLICATION_IN_PROGRESS,
  bringingUpToDate: BRINGING_UP_TO_DATE,
  login: {
    headline: 'Say what you want changed.',
    headlineEm: 'See it before it goes live.',
    lede: 'Tell {name} what to change about your website, in your own words. You get a private preview to look at, and nothing reaches your live site until you press publish.',
    checkEmail: 'Check your email',
    linkOnItsWay:
      'If {email} is allowed to edit this website, a sign-in link is on its way. It works for the next 15 minutes.',
    useDifferent: 'Use a different address',
    signIn: 'Sign in',
    noPassword: 'No password. A link in your inbox signs you in.',
    yourEmail: 'Your email address',
    emailPlaceholder: 'you@yourcompany.com',
    sending: 'Sending…',
    emailMe: 'Email me a sign-in link',
    couldNotReach: 'Could not reach {name} just now. Please try again in a moment.',
    demoClient: 'Make the homepage headline shorter and the button dark blue.',
    demoAgent:
      'Done. The headline is four words now and the button is navy. Your preview is ready.',
  },
};
