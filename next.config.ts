import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['dockerode', 'simple-git', 'argon2', 'nodemailer'],
};

export default nextConfig;
