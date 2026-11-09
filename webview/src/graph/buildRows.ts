import type { CommitView } from './model';

// Build the final render rows from incoming commits.
// We currently render only real commit rows (no connector pseudo rows).
export const buildRows = (commits: CommitView[]): CommitView[] =>
  commits.map((commit) => ({
    ...commit,
    graphConnectorPrefixes: [],
  }));
