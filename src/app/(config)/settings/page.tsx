import { UNCONDITIONAL_DENIES } from '@/lib/policy/parse';
import { getInstallation } from '@/lib/installation';
import type { RepoConfig } from '@/types';

/**
 * The configuration surface (FR-003c, FR-003f).
 *
 * Read-only, and deliberately so. Settings and policy live in the site's own
 * repository, which is what makes changing them a reviewable, versioned edit;
 * a form here that wrote them back would replace a pull request with an
 * unattributed mutation. So this page shows what is in force, where it came
 * from, and what is wrong with it — and the way to change any of it is to
 * commit to the repository it names.
 *
 * This is not a client surface. Repository and hosting vocabulary is correct
 * here (constitution Principle I governs the client's screens); the person
 * reading this page is the one who set those values.
 */

export const dynamic = 'force-dynamic';

interface SettingsView {
  config: RepoConfig | null;
  fault: { at: string; message: string } | null;
}

async function readConfiguration(): Promise<SettingsView> {
  const { config } = getInstallation();
  // The first read of a process's life happens here if nothing has needed
  // configuration yet. A failure is expected to be *shown*, not thrown: a
  // configuration page that goes blank when configuration is broken is the
  // page failing at the one moment it exists for.
  await config.ensureLoaded().catch(() => undefined);
  return { config: config.current(), fault: config.fault() };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="config-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PathList({ paths, empty = 'None.' }: { paths: string[]; empty?: string }) {
  if (paths.length === 0) return <p className="config-empty">{empty}</p>;
  return (
    <ul className="config-paths">
      {paths.map((path) => (
        <li key={path}>
          <code>{path}</code>
        </li>
      ))}
    </ul>
  );
}

export default async function ConfigSettingsPage() {
  const { env } = getInstallation();
  const { config, fault } = await readConfiguration();

  return (
    <div className="config-page">
      <h1>This installation</h1>
      <p className="config-lede">
        One installation serves one website. Nothing on this page can point it at another — that
        takes a redeployment.
      </p>

      <section className="config-section">
        <h2>Deployment configuration</h2>
        <p className="config-note">
          Supplied where this installation is deployed. Secrets are never read from the site
          repository, and permitted sign-ins never are either.
        </p>
        <dl className="config-list">
          <Row label="Repository" value={`${env.githubRepoOwner}/${env.githubRepoName}`} />
          <Row label="GitHub App installation" value={String(env.githubInstallationId)} />
          <Row label="Netlify site" value={env.netlifySiteId} />
          <Row label="This installation's address" value={env.publicBaseUrl} />
          <Row label="Permitted sign-ins" value={env.allowedEmails.join(', ')} />
        </dl>
      </section>

      {fault ? (
        <section className="config-section config-section--fault">
          <h2>Settings fault</h2>
          <p>
            The settings in the repository could not be read on the last attempt, at {fault.at}.
            {config
              ? ' The last valid settings below stay in force until the fault is fixed.'
              : ' No valid settings have ever loaded, so requests will not run.'}
          </p>
          <pre className="config-fault">{fault.message}</pre>
        </section>
      ) : null}

      <section className="config-section">
        <h2>Settings, from .webagent/config.yml</h2>
        {config ? (
          <dl className="config-list">
            <Row label="Alert contact" value={config.settings.alertContact} />
            <Row label="Cost ceiling" value={`$${config.settings.costCeilingUsd.toFixed(2)} per request`} />
            <Row label="Model" value={config.settings.model} />
            <Row label="Maximum request duration" value={`${config.settings.maxRequestMinutes} minutes`} />
          </dl>
        ) : (
          <p className="config-empty">Nothing has loaded yet.</p>
        )}
      </section>

      <section className="config-section">
        <h2>Effective policy</h2>
        <p className="config-note">
          What the agent may change. Declared in <code>.webagent/policy.yml</code>, in the site
          repository, and evaluated in the order below.
        </p>

        <h3>Never changeable, whatever the policy says</h3>
        <PathList paths={UNCONDITIONAL_DENIES} />

        <h3>Denied by this site</h3>
        <PathList paths={config?.policy.deny ?? []} empty="Nothing beyond the list above." />

        <h3>Allowed by this site</h3>
        <PathList
          paths={config?.policy.allow ?? []}
          empty="Nothing — a policy that allows nothing blocks every change."
        />

        {config ? (
          <dl className="config-list">
            <Row label="Most files in one change" value={String(config.policy.maxFilesChanged)} />
            <Row label="Most changed lines in one change" value={String(config.policy.maxDiffLines)} />
            <Row
              label="New dependencies"
              value={config.policy.forbidNewDependencies ? 'Forbidden' : 'Permitted'}
            />
          </dl>
        ) : null}
      </section>

      <section className="config-section">
        <h2>Agent guidance</h2>
        <p className="config-note">
          <code>AGENTS.md</code> at the repository root. Advisory: it never widens what the policy
          permits, and the agent may not edit it.
        </p>
        {config?.guidance ? (
          <pre className="config-guidance">{config.guidance}</pre>
        ) : (
          <p className="config-empty">No AGENTS.md in the repository.</p>
        )}
      </section>
    </div>
  );
}
