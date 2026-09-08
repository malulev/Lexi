import QRCode from 'qrcode';

import { otpauthUri, verifyEnrollToken } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { dictionaryFor } from '@/lib/i18n';
import { readLocale } from '@/lib/i18n/server';
import { getInstallation } from '@/lib/installation';
import { EnrollCard } from './EnrollCard';

export const dynamic = 'force-dynamic';

/**
 * The one page that shows the authenticator secret, and only behind a token
 * the operator minted (`npm run enroll:link`). A magic link cannot open it:
 * the two are signed with different subkeys (src/lib/auth/enroll.ts).
 */
export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { env } = getInstallation();
  const { token } = await searchParams;
  const t = dictionaryFor(await readLocale());

  if (!verifyEnrollToken(token, env)) {
    return <EnrollCard expiredText={t.login.enrollExpired} />;
  }

  const account = new URL(env.publicBaseUrl).hostname;
  const svg = await QRCode.toString(otpauthUri(env, BRAND.name, account), {
    type: 'svg',
    margin: 1,
    width: 240,
  });

  return (
    <EnrollCard
      title={t.login.enrollTitle}
      hint={t.login.enrollHint}
      keyLabel={t.login.enrollKey}
      secret={env.totpSecret}
      qrSvg={svg}
      doneText={t.login.enrollDone}
    />
  );
}
