// Integration tests run route handlers against recorded fixtures.
// The environment is a complete, syntactically valid installation; no call
// leaves the process.
process.env.TZ = 'UTC';
process.env.GITHUB_APP_ID ??= '123456';
process.env.GITHUB_APP_PRIVATE_KEY ??= '-----BEGIN RSA PRIVATE KEY-----\nfixture\n-----END RSA PRIVATE KEY-----';
process.env.GITHUB_INSTALLATION_ID ??= '7891011';
process.env.GITHUB_REPO ??= 'client-org/client-site';
process.env.NETLIFY_TOKEN ??= 'nfp_fixture_token';
process.env.NETLIFY_SITE_ID ??= 'site_fixture';
process.env.NETLIFY_WEBHOOK_SECRET ??= 'webhook_fixture_secret';
process.env.OPENROUTER_API_KEY ??= 'sk-or-fixture';
process.env.SESSION_SECRET ??= 'fixture-session-secret-at-least-32-chars';
process.env.ALLOWED_EMAILS ??= 'jane@client.example,marketing@client.example';
// A real argon2id hash of 'fixture-configuration-password' and a base32
// secret long enough for TOTP. A fixture that would be rejected as unusable
// describes an installation that could not start, which is not what these
// tests mean by one.
process.env.CONFIG_PASSWORD_HASH ??=
  '$argon2id$v=19$m=65536,p=4,t=3$WkovnjhviO6+KrGuW0pGPw$aH1PI7KuDMSl14U1diMYqKyzdK6Uz9Vpxne+abvnzPk';
process.env.CONFIG_TOTP_SECRET ??= 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
process.env.SMTP_URL ??= 'smtp://localhost:1025';
process.env.SMTP_FROM ??= 'webagent@client.example';
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3000';
