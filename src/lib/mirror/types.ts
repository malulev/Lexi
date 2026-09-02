import type { ChangedFile } from '@/types';

/**
 * The bare mirror is a cache, never a source of truth (R8). Deleting it costs
 * time, not correctness, so every operation here tolerates its absence.
 */

export interface WorkingTree {
  /** Host path of the working tree, mounted into the container at `/work`. */
  dir: string;
  branch: string;
  /** The commit the tree started from, before the agent touched anything. */
  baseSha: string;
  /** Removes the tree. Called on every path, including a blocked change. */
  dispose(): Promise<void>;
}

export interface Mirror {
  /** Creates or updates the bare mirror, rebuilding it when corrupt. */
  sync(): Promise<void>;
  /**
   * A fresh working tree at `branch`, created from `baseBranch` when the
   * branch does not yet exist.
   */
  checkout(branch: string, baseBranch: string): Promise<WorkingTree>;
}

export interface ChangeSet {
  files: ChangedFile[];
  totalDiffLines: number;
}

/** Derives the change set from a working tree's status: adds, edits, deletes. */
export type DeriveChangeSet = (tree: WorkingTree) => Promise<ChangeSet>;
