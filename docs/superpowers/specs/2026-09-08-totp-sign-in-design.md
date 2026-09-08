# TOTP at sign-in, no configuration surface

Date: 2026-09-08. Status: approved in conversation.

## Goal

A client signing in proves two things: control of an allowed email address (the existing magic
link) and possession of the installation's authenticator secret (a six-digit TOTP code entered
right after the link). The read-only `/settings` page and the console password that guarded it
are removed.

## Decisions

- One shared TOTP secret per installation, in the deployment `.env`. Every allowed address uses
  the same authenticator entry.
- The code is asked for on every sign-in, immediately after the email link. The session that
  results is the existing 7-day session, unchanged.
- Enrollment is by an operator-issued link that shows a QR. The code page never shows the secret.
- No database. A code is valid for its 30-second window with 30 seconds of drift, not single use.
  Same documented trade-off as the magic link.

## Flow

1. `POST /api/auth/request` unchanged.
2. `GET /api/auth/callback?token=` verifies the magic link, sets `webagent_pending` (signed with
   subkey `pending-session`, payload `{ email, expiresAt }`, 10 minutes, httpOnly, sameSite lax),
   clears any session cookie, redirects to `/login/code`.
3. `GET /login/code` renders a six-digit input. With no valid pending cookie it redirects to
   `/login?error=expired`.
4. `POST /api/auth/code` body `{ code }`. Reads the pending cookie. Invalid or expired pending
   cookie: `401 { error: 'expired' }`. Wrong code: `401 { error: 'refused' }`, logged with the
   reason. Valid code: clears pending, sets `webagent_session` as today, answers
   `200 { status: 'ok' }`; the page navigates to `/`. Attempts rate limited per client address,
   10 per 15 minutes, answered like a wrong code.
5. `POST /api/auth/logout` clears both cookies.

## Enrollment

- `npm run enroll:link` prints `PUBLIC_BASE_URL/login/enroll?token=...`. Token: payload
  `{ iat, nonce }`, signed with subkey `totp-enroll`, valid 24 hours.
- `GET /login/enroll?token=` verifies the token and renders: the QR of
  `otpauth://totp/<brand>:<site host>?secret=<TOTP_SECRET>&issuer=<brand>`, the key as text, and a
  link to `/login`. Bad or expired token renders the same expired state as a bad magic link.
- `ops/launch-client.sh` prints the enrollment link at the end of a run by running `enroll:link`
  in the node container. `ops/README.md` says to send it to the client.
- Dependency: `qrcode` for server-side SVG. `argon2` removed.

## Removals and renames

- Delete `src/app/(config)/` and its CSS. Delete the password and config-session parts of
  `src/lib/auth/config-credential.ts`; TOTP verification and `isUsableTotpSecret` move to
  `src/lib/auth/totp.ts`.
- Env: `CONFIG_PASSWORD_HASH` removed. `TOTP_SECRET` replaces `CONFIG_TOTP_SECRET`; the old name is
  read as a fallback and reported by `check:env` as deprecated. `Env.configPasswordHash` removed,
  `Env.configTotpSecret` renamed `totpSecret`.
- Startup validation: drop the hash check, keep the secret usability check.
- `scripts/gen-secrets.ts`: no `--password`; emits `SESSION_SECRET`, `NETLIFY_WEBHOOK_SECRET`,
  `TOTP_SECRET`.
- `ops/launch-client.sh`: no password prompt; `.env` presence check uses `TOTP_SECRET`; final
  output includes the enrollment link. `ops/provision-client.sh` skeleton comments updated.
- Docs: README, `docs/QUICKSTART.md`, `docs/NEW-CLIENT.md`, `ops/README.md`, `.env.example`,
  `specs/001-conversational-site-editing/contracts/http-api.md` auth table.
- i18n: new `login.code*` and `login.enroll*` strings in en, fr, nl, he.

## Security notes

- The pending cookie is a different cookie with a different signing subkey, so no existing
  session check can accept it.
- Code attempts never reveal whether the address is permitted; the pending cookie already proves
  the address was.
- The enrollment token is signed with a subkey the magic link does not use, so a magic link cannot
  be replayed as an enrollment link.

## Testing

- Unit: pending cookie issue/verify/expiry; TOTP verify with drift; enrollment token
  issue/verify/expiry; `gen:secrets` output has exactly the three names; env accepts `TOTP_SECRET`
  and falls back to `CONFIG_TOTP_SECRET`.
- Integration: callback sets pending and not session; code route refuses a wrong code, upgrades on
  a right one, refuses without pending; enroll page with good and bad token; startup refuses an
  unusable secret and no longer mentions a hash.
- Manual: sign in on the VPS with an authenticator after release.
