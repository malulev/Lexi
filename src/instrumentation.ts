/**
 * The one thing this process does before it will answer anything.
 *
 * Next calls `register` once, on the server, at startup. FR-003b asks for a
 * refusal rather than a degraded start: an installation whose repository is
 * unreachable, whose App is not installed, or whose hosting site does not
 * exist can accept a client's request and can never complete it, and finding
 * that out four minutes later — after a container has run and tokens have been
 * spent — tells the client something went wrong on our side when what actually
 * happened is that nobody finished the installation.
 *
 * Failing here is deliberately loud and deliberately early. The message names
 * every faulty setting at once, because an operator fixing one variable per
 * restart is an operator being made to bisect their own configuration.
 */
export async function register(): Promise<void> {
  // Imported inside the function so that merely loading this module never
  // reaches for `process.env`; the build must not need a live installation.
  const { assertStartupValid } = await import('@/lib/config/startup');
  await assertStartupValid();
}
