import type { NextConfig } from 'next';

/**
 * Sent on every response. The editor holds a signed-in session that can change
 * a live website, so it must not be framable: `frame-ancestors 'none'` and the
 * older `X-Frame-Options` together stop a third-party page from embedding it
 * and tricking a client into clicking Publish or Undo (F4). The rest are the
 * standard hardening set — no MIME sniffing, a conservative referrer, and HSTS
 * for the HTTPS the reverse proxy terminates. `frame-ancestors` governs who
 * may frame this app; it does not affect the app framing the client's own
 * preview.
 */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ['dockerode', 'simple-git', 'argon2', 'nodemailer'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  // Emits `.next/standalone`: the server plus only the modules the traced
  // graph actually reaches. The deployed image copies that instead of a built
  // tree and a full `node_modules`, which is the difference between ~250 MB
  // and ~2 GB per image — and on a host where every client runs its own
  // rootless daemon, and therefore its own image store, that multiplies by the
  // number of clients rather than being shared.
  output: 'standalone',
};

export default nextConfig;
