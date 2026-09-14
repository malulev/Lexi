import { NextResponse } from 'next/server';

import { checkReadiness } from '@/lib/config/readiness';
import { requireClient } from '@/lib/http/guard';

/**
 * Readiness: can this installation still do the job it exists for?
 *
 * Re-runs the four probes `src/lib/config/startup.ts` runs at boot — the App
 * token mints, the repository answers, the hosting site exists, the
 * authenticator seed is usable — behind the cache in `lib/config/readiness`,
 * so an endpoint anyone may call cannot be turned into a way to hammer GitHub.
 *
 * ## What an unauthenticated caller is told
 *
 * Whether it is ready, when that was established, and — when it is not — the
 * *names* of the settings at fault. Never the fault messages: those
 * interpolate the installation id and the hosting site id, which are account
 * identifiers rather than secrets, but an endpoint with no caller identity is
 * the wrong place to volunteer them. The setting names are already public in
 * `.env.example`.
 *
 * A signed-in caller gets the messages, because they are the half a person
 * debugging actually needs. Authorization is `requireClient`, the one place
 * this product decides who may see anything.
 *
 * ## Status codes
 *
 * 200 ready, 503 degraded. A blackbox probe can then alert on the code alone
 * without parsing a body — which is what `ops/probe.sh` does.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const readiness = await checkReadiness();

  // `requireClient` reports rather than throws, and its "no" is a truthy
  // object. Discriminate on `ok`: anything looser hands the fault messages to
  // exactly the caller they are withheld from.
  const authorized = await requireClient()
    .then((result) => result.ok)
    .catch(() => false);

  const body = {
    status: readiness.ok ? 'ready' : 'degraded',
    checkedAt: readiness.checkedAt,
    ageMs: readiness.ageMs,
    ...(readiness.ok ? {} : { faults: readiness.faultSettings }),
    ...(authorized && !readiness.ok ? { detail: readiness.faults } : {}),
  };

  return NextResponse.json(body, { status: readiness.ok ? 200 : 503 });
}
