import { describe, log } from '@/lib/log';
import type { Mailer } from './email';

/**
 * Mail addressed to the developer who runs this installation, not to the
 * client who uses it.
 *
 * The distinction is the whole reason this is a separate function from
 * `notifyOnce`. Client-facing messages come from a closed vocabulary and are
 * forbidden paths, SHAs, branch names and figures (Principle I); an operator
 * message is *for* those details, because its reader is the person who has to
 * go and fix something.
 *
 * Until now the only message that ever reached `alertContact` was the
 * cost-ceiling alert, written inline in `jobs/run.ts`. Everything else — a
 * startup refusal, a configuration that stopped parsing — reached nobody at
 * all. This is that path, made reusable.
 *
 * ## It can never fail its caller
 *
 * Every caller is already handling something that went wrong. A mail server
 * that is also down must not turn a reported fault into an unreported crash,
 * so a send failure is logged and swallowed. That is also why an alert here
 * is never the *only* signal: the same fact is emitted as a structured event,
 * and the monitoring built on those events does not depend on SMTP working.
 */

export interface OperatorAlert {
  subject: string;
  /** Joined with blank lines. Figures and setting names are welcome here. */
  lines: string[];
}

export interface OperatorAlertDeps {
  mailer?: Mailer;
  /** From the site's `.webagent/config.yml`. No contact, no alert. */
  alertContact?: string;
}

export async function alertOperator(
  deps: OperatorAlertDeps,
  alert: OperatorAlert,
): Promise<boolean> {
  if (!deps.mailer || !deps.alertContact) return false;

  try {
    await deps.mailer.send({
      to: deps.alertContact,
      subject: alert.subject,
      text: alert.lines.join('\n\n'),
    });
    return true;
  } catch (cause) {
    // Worth counting: SMTP being down is also how the client-facing emails
    // stop arriving, and this is the line that says so.
    log.error('notify.failed', { kind: 'operator_alert', error: describe(cause) });
    return false;
  }
}
