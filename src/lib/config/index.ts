/**
 * Public surface of the config module: turning `.webagent/config.yml` into a
 * validated `Settings` (`parseSettings`), reading the full repository-declared
 * configuration (`createConfigLoader`), and holding it with last-known-good
 * retention so a bad refresh never falls open on access control
 * (`createConfigCache`, FR-003f), and refusing to serve at all when the
 * deployment's own settings are not usable (`assertStartupValid`, FR-003b).
 */

export { parseSettings } from './settings';
export { createConfigLoader } from './loader';
export { createConfigCache } from './cache';
export type { ConfigCache, SettingsFault } from './cache';
export { validateStartup, assertStartupValid, describeStartupFaults } from './startup';
export type { StartupFault, StartupReport, StartupDeps } from './startup';
