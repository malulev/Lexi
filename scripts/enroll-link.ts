import { enrollmentUrl } from '../src/lib/auth/enroll';
import { loadEnvFromFiles } from './repo-env';

/**
 * Prints the one link that shows the authenticator secret. Send it to the
 * client; it works for 24 hours, and running this again mints a new one.
 * The link is printed, the secret never is.
 */
console.log(enrollmentUrl(loadEnvFromFiles()));
