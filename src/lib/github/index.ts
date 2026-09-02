/**
 * Public surface of the GitHub module. Most callers import the specific
 * file they need (`./types`, `./client`) directly, since that is what keeps
 * a consumer's own module graph — and its lint rules restricting network
 * access, such as `src/lib/policy/**` — honest about what it depends on.
 * This barrel exists for the common case of wanting the whole surface at
 * once, e.g. wiring the installation together in `src/lib/installation.ts`.
 */

export * from './types';
export { createTokenMinter, type TokenMinter } from './auth';
export { createRepoClient } from './client';
export { createFakeRepoClient, type FakeState, type FakeRepoClientSeed } from './fake';
