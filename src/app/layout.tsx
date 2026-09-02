import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Site Editor',
  description: 'Describe a change to your website and see it before it goes live.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
