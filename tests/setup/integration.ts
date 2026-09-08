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
// A base32 secret long enough for TOTP; a fixture that would be rejected as
// unusable describes an installation that could not start.
process.env.TOTP_SECRET ??= 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
process.env.SMTP_URL ??= 'smtp://localhost:1025';
process.env.SMTP_FROM ??= 'webagent@client.example';
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3000';
