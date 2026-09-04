import type { Metadata } from 'next';

import { LocaleProvider } from '@/components/LocaleProvider';
import { BRAND } from '@/lib/brand';
import { directionOf } from '@/lib/i18n';
import { readLocale } from '@/lib/i18n/server';
import './globals.css';

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
};

/**
 * The document itself carries the language: `lang` for assistive tech and
 * hyphenation, `dir` so Hebrew lays out right-to-left without any component
 * knowing. Everything beneath reads the same locale from the provider.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await readLocale();

  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
