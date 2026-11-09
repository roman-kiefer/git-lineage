export type CommitRef = {
  name: string;
  // 'worktree': detached HEAD of another worktree.
  type: 'local' | 'remote' | 'tag' | 'head' | 'stash' | 'worktree' | 'other';
  isCurrent?: boolean;
  // Branch checked out in another worktree (or the worktree chip itself): folder name and path.
  worktree?: string;
  worktreePath?: string;
  // Main worktree (the normal checkout): no marker, only menu actions and tooltip.
  worktreeIsMain?: boolean;
  // Local branch: its upstream and how far it is ahead/behind (as of the last fetch).
  upstream?: string;
  ahead?: number;
  behind?: number;
  upstreamGone?: boolean;
  // Stash chips: message (tooltip) and stash commit (sent with the menu actions).
  message?: string;
  stashHash?: string;
};

export type CommitView = {
  hash: string;
  shortHash: string;
  parents?: string[];
  lane: number;
  segments: { fromLane: number; toLane: number }[];
  entrySegments?: { fromLane: number; toLane: number }[];
  graphPrefix?: string;
  graphFlowPrefix?: string;
  graphConnectorPrefixes?: string[];
  refs: CommitRef[];
  authorName: string;
  authorDate: string;
  subject: string;
  incomingLanes?: number[];
  outgoingLanes?: number[];
  isVirtual?: boolean;
  isConnectorRow?: boolean;
  // "Uncommitted Changes" row on top (parent = HEAD); drawn with a hollow dot.
  isUncommitted?: boolean;
  // Uncommitted rows: the worktree they belong to (other worktrees sit above their HEAD).
  worktreePath?: string;
  worktreeName?: string;
};

// Entry of the worktree selector (sent by the extension when there is more than one worktree).
export type WorktreeView = {
  path: string;
  name: string;
  branch?: string;
  isCurrent: boolean;
  isMain: boolean;
  isPrunable: boolean;
  changeCount: number;
};

export type LaneEdge = { fromLane: number; toLane: number };
