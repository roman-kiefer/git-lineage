// 'worktree': detached HEAD of another worktree (branches checked out elsewhere carry `worktree`).
export type RefType = 'local' | 'remote' | 'tag' | 'head' | 'stash' | 'worktree' | 'other';

export type Ref = {
  name: string;
  type: RefType;
  isCurrent?: boolean;
  upstream?: string;
  // Checked out in a worktree: its folder name; the path only for other worktrees (menu actions).
  worktree?: string;
  worktreePath?: string;
  // The worktree is the main one (the normal checkout): no marker on the chip.
  worktreeIsMain?: boolean;
  // Local branch with an upstream: commits ahead of / behind it (as of the last fetch), or the
  // upstream was deleted on the remote ("gone").
  ahead?: number;
  behind?: number;
  upstreamGone?: boolean;
  // Stash chips: the stash's message and its commit (actions check it is still the same stash).
  message?: string;
  stashHash?: string;
};

export type CommitNode = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  body?: string;
  refs: Ref[];
  laneId?: number;
};

export type CommitSummary = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorDate: string;
  subject: string;
  refs: Ref[];
  graphPrefix?: string;
  graphFlowPrefix?: string;
  graphConnectorPrefixes?: string[];
};

export type CommitFileChange = {
  status: string;
  path: string;
  // Added and removed lines (git --numstat); missing for binary files or when unknown.
  additions?: number;
  deletions?: number;
};

export type LineCounts = { additions: number; deletions: number };

export type CommitDetails = {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  body: string;
  files: CommitFileChange[];
};
