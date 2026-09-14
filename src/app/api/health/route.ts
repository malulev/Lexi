import { NextResponse } from 'next/server';

/**
 * Liveness: this process is running and answering.
 *
 * It exists because "any status code other than 000 on `/`" — what
 * `ops/status.sh` and `ops/release.sh` both settled for until now — is not a
 * health check. `/` legitimately redirects an unauthenticated caller, so it
 * answers 307 just as readily when the installation is wedged. A route that
 * means one thing is what makes `curl -f` correct.
 *
 * No I/O, no configuration read, no upstream call: whether this installation
 * can reach GitHub is a different question, asked at /api/ready. Keeping them
 * apart is what lets a monitor say "the app is up but its credentials are
 * broken" instead of one undifferentiated red.
 *
 * Unauthenticated, and discloses only that it is answering, plus the deployed
 * commit — which `ops/release.sh` writes into each installation's environment.
 * That is what makes version drift across a fleet checkable from outside the
 * box, and it is not a secret: the repository is public and AGPL.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({
    status: 'ok',
    sha: process.env.APP_SHA ?? 'unknown',
  });
}
