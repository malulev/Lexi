/**
 * Public surface of the config module: turning `.webagent/config.yml` into a
 * validated `Settings` (`parseSettings`), reading the full repository-declared
 * configuration (`createConfigLoader`), and holding it with last-known-good
 * retention so a bad refresh never falls open on access control
 * (`createConfigCache`, FR-003f).
 */

export { parseSettings } from './settings';
export { createConfigLoader } from './loader';
export { createConfigCache } from './cache';
export type { ConfigCache, SettingsFault } from './cache';
