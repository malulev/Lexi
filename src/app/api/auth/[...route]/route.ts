import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  issueMagicLinkToken,
  issuePending,
  issueSession,
  PENDING_COOKIE,
  pendingCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyMagicLinkToken,
  verifyPending,
  verifyTotpCode,
} from '@/lib/auth';
import { clientAddress, createRateLimiter } from '@/lib/http/rate-limit';
import { getInstallation } from '@/lib/installation';
import { signInEmail } from '@/lib/notify/sign-in';

export const runtime = 'nodejs';

const requestSchema = z.object({ email: z.string().trim().min(3).max(320) });
const codeSchema = z.object({ code: z.string().trim().min(1).max(12) });

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Held on `globalThis` for the same reason the job bus is: the framework
 * bundles routes separately, and a module constant would give every bundle its
 * own limiter, so the count would never accumulate. One limiter per process is
 * what makes the window mean anything.
 *
 * Two limits, because they defend different things. The per-address limit caps
 * how many links any one inbox can be sent — the actual email-bombing control,
 * and unforgeable. The per-caller limit is the coarser net over a single
 * source hammering many addresses; a caller can spoof the header it reads, so
 * it is deliberately the looser of the two.
 */
const LIMITER_KEY = Symbol.for('webagent.signInLimiter');
const globalWithLimiter = globalThis as typeof globalThis & {
  [LIMITER_KEY]?: {
    byEmail: ReturnType<typeof createRateLimiter>;
    byAddress: ReturnType<typeof createRateLimiter>;
    codesByAddress: ReturnType<typeof createRateLimiter>;
  };
};

const signInLimiter = (globalWithLimiter[LIMITER_KEY] ??= {
  byEmail: createRateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES_MS }),
  byAddress: createRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
  // A six-digit code has a million values and a window of a few minutes;
  // ten guesses per address per window keeps that arithmetic honest.
  codesByAddress: createRateLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES_MS }),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ route: string[] }> },
): Promise<NextResponse> {
  const { route } = await context.params;
  const action = route.join('/');

  if (action === 'request') return requestLink(request);
  if (action === 'code') return verifyCode(request);
  if (action === 'logout') return logout();
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ route: string[] }> },
): Promise<NextResponse> {
  const { route } = await context.params;
  if (route.join('/') !== 'callback') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return completeSignIn(request);
}

/**
 * Answers `202` whether or not the address may sign in.
 *
 * The response is identical in both cases on purpose: an endpoint that answers
 * differently for a permitted address is an endpoint that enumerates a client's
 * staff for anyone who asks. The difference is that no email is sent.
 */
async function requestLink(request: Request): Promise<NextResponse> {
  const accepted = NextResponse.json({ status: 'accepted' }, { status: 202 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return accepted;

  // Over the limit is answered exactly like everything else — 202, no email —
  // so a throttle is as invisible to a caller as a non-permitted address is.
  // Both keys are consulted, and both record the attempt, so neither the
  // address nor the source can exceed its own budget.
  const email = parsed.data.email.trim().toLowerCase();
  const withinAddress = signInLimiter.byAddress.allow(clientAddress(request));
  const withinEmail = signInLimiter.byEmail.allow(`email:${email}`);
  if (!withinAddress || !withinEmail) return accepted;

  const installation = getInstallation();
  const token = issueMagicLinkToken(parsed.data.email, installation.env);

  if (token) {
    const link = `${installation.env.publicBaseUrl}/api/auth/callback?token=${encodeURIComponent(token)}`;
    try {
      await installation.mailer.send({ to: parsed.data.email, ...signInEmail(link) });
    } catch (cause) {
      // A send that fails is logged, not surfaced: the answer must not vary.
      console.error('[webagent] could not send a sign-in link', cause);
    }
  }

  return NextResponse.json({ status: 'accepted' }, { status: 202 });
}

async function completeSignIn(request: Request): Promise<NextResponse> {
  const installation = getInstallation();
  const token = new URL(request.url).searchParams.get('token');
  const verified = token ? verifyMagicLinkToken(token, installation.env) : null;

  if (!verified) {
    return NextResponse.redirect(new URL('/login?error=expired', installation.env.publicBaseUrl));
  }

  // Half a sign-in. The session is issued only by `verifyCode`, after the
  // authenticator code; a browser that never enters one holds nothing usable.
  // Any session it already had is cleared, so a fresh link cannot be used to
  // keep an old session alive past the code step.
  const response = NextResponse.redirect(new URL('/login/code', installation.env.publicBaseUrl));
  response.cookies.set(
    PENDING_COOKIE,
    issuePending(verified.email, installation.env),
    pendingCookieOptions(installation.env),
  );
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(installation.env), maxAge: 0 });
  return response;
}

/** The route reads its own cookies: `next/headers` is for pages and layouts. */
function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const at = trimmed.indexOf('=');
    if (at === -1) continue;
    if (trimmed.slice(0, at) === name) return decodeURIComponent(trimmed.slice(at + 1));
  }
  return undefined;
}

async function verifyCode(request: Request): Promise<NextResponse> {
  const { env } = getInstallation();
  const pending = verifyPending(readCookie(request, PENDING_COOKIE), env);
  if (!pending) return NextResponse.json({ error: 'expired' }, { status: 401 });

  // Counted before the code is looked at, so guessing costs the same whether
  // the guess was close or not. Which half failed goes to the log, never to
  // the caller.
  if (!signInLimiter.codesByAddress.allow(clientAddress(request))) {
    console.warn('[webagent] sign-in code refused (rate limited)');
    return NextResponse.json({ error: 'refused' }, { status: 401 });
  }

  const parsed = codeSchema.safeParse(await request.json().catch(() => null));
  const accepted = parsed.success && (await verifyTotpCode(parsed.data.code, env));
  if (!accepted) {
    console.warn('[webagent] sign-in code refused (wrong code)');
    return NextResponse.json({ error: 'refused' }, { status: 401 });
  }

  const response = NextResponse.json({ status: 'ok' });
  response.cookies.set(SESSION_COOKIE, issueSession(pending.email, env), sessionCookieOptions(env));
  response.cookies.set(PENDING_COOKIE, '', { ...pendingCookieOptions(env), maxAge: 0 });
  return response;
}

/**
 * Answers a form post, so the reply is a redirect: a browser that submitted
 * the sign-out form should land on the sign-in page, not on an empty screen.
 */
function logout(): NextResponse {
  const response = NextResponse.redirect(
    new URL('/login', getInstallation().env.publicBaseUrl),
    303,
  );
  const env = getInstallation().env;
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(env), maxAge: 0 });
  response.cookies.set(PENDING_COOKIE, '', { ...pendingCookieOptions(env), maxAge: 0 });
  return response;
}
