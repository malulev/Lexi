import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  issueMagicLinkToken,
  issueSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyMagicLinkToken,
} from '@/lib/auth';
import { getInstallation } from '@/lib/installation';

export const runtime = 'nodejs';

const requestSchema = z.object({ email: z.string().trim().min(3).max(320) });

export async function POST(
  request: Request,
  context: { params: Promise<{ route: string[] }> },
): Promise<NextResponse> {
  const { route } = await context.params;
  const action = route.join('/');

  if (action === 'request') return requestLink(request);
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
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ status: 'accepted' }, { status: 202 });

  const installation = getInstallation();
  const token = issueMagicLinkToken(parsed.data.email, installation.env);

  if (token) {
    const link = `${installation.env.publicBaseUrl}/api/auth/callback?token=${encodeURIComponent(token)}`;
    try {
      await installation.mailer.send({
        to: parsed.data.email,
        subject: 'Your sign-in link',
        text: `Open this link to sign in and edit your website:\n\n${link}\n\nThe link works for the next 15 minutes.`,
      });
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

  const response = NextResponse.redirect(new URL('/', installation.env.publicBaseUrl));
  response.cookies.set(
    SESSION_COOKIE,
    issueSession(verified.email, installation.env),
    sessionCookieOptions(installation.env),
  );
  return response;
}

function logout(): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, '', {
    ...sessionCookieOptions(getInstallation().env),
    maxAge: 0,
  });
  return response;
}
