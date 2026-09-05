import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['dockerode', 'simple-git', 'argon2', 'nodemailer'],
  // Emits `.next/standalone`: the server plus only the modules the traced
  // graph actually reaches. The deployed image copies that instead of a built
  // tree and a full `node_modules`, which is the difference between ~250 MB
  // and ~2 GB per image — and on a host where every client runs its own
  // rootless daemon, and therefore its own image store, that multiplies by the
  // number of clients rather than being shared.
  output: 'standalone',
};

export default nextConfig;
