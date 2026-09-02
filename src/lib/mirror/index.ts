/** Public surface of the mirror module: R8's bare-mirror cache, per-job
 * working trees, and the working-tree change set that feeds the policy
 * gate and the host's own commit step. */
export { createMirror, type CreateMirrorOptions } from './mirror';
export { commitPermittedPaths, deriveChangeSet } from './changeset';
export type { ChangeSet, DeriveChangeSet, Mirror, WorkingTree } from './types';
