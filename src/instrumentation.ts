/**
 * The one thing this process does before it will answer anything.
 *
 * FR-003b asks for a refusal rather than a degraded start: an installation
 * whose repository is unreachable, whose App is not installed, or whose hosting
 * site does not exist can accept a client's request and can never complete it.
 * Finding that out four minutes later — after a container has run and tokens
 * have been spent — tells the client something went wrong on our side, when
 * what actually happened is that nobody finished the installation.
 *
 * The shape of this file matters more than it looks. Next compiles this hook
 * for every runtime it targets, and the validation reaches Node's own crypto
 * and, through the installation, native bindings that cannot be bundled for a
 * browser. `process.env.NEXT_RUNTIME` is substituted per bundle at build time,
 * so putting the import *inside* the matching branch lets the other bundles
 * eliminate it as dead code. An early `return` guarding the same import does
 * not: the import survives, is traced, and every page answers 500.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
