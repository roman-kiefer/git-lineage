export type WebviewReadyMessage = {
  type: 'ready';
};

export type WebviewRefreshMessage = {
  type: 'refresh';
};

export type WebviewUpdateFiltersMessage = {
  type: 'updateFilters';
  payload: {
    selectedBranch: string;
    showRemoteBranches: boolean;
  };
};

export type WebviewLoadMoreMessage = {
  type: 'loadMore';
  payload: {
    cursor?: string;
  };
};

export type WebviewSelectCommitMessage = {
  type: 'selectCommit';
  payload: {
    hash: string;
  };
};

export type WebviewOpenDiffMessage = {
  type: 'openDiff';
  payload: {
    hash: string;
    path: string;
  };
};

export type WebviewOpenFileMessage = {
  type: 'openFile';
  payload: {
    hash: string;
    path: string;
  };
};

export type WebviewSelectRepoMessage = {
  type: 'selectRepo';
  payload: {
    repoRoot: string;
  };
};

// Show another worktree of the repository (worktree selector).
export type WebviewSelectWorktreeMessage = {
  type: 'selectWorktree';
  payload: { path: string };
};

// Copy text via the VS Code clipboard API; label is used for the status message.
export type WebviewCopyToClipboardMessage = {
  type: 'copyToClipboard';
  payload: {
    text: string;
    label: string;
  };
};

// Answer to a form of the controller (see src/core/forms.ts): entered values or cancel.
export type WebviewFormSubmitMessage = {
  type: 'formSubmit';
  payload: { id: string; values: Record<string, string | boolean> };
};

export type WebviewFormCancelMessage = {
  type: 'formCancel';
  payload: { id: string };
};

// Answer of the rebase view: one action per commit (newest first, as shown) or cancel.
export type WebviewRebaseSubmitMessage = {
  type: 'rebaseSubmit';
  payload: {
    id: string;
    steps: Array<{ hash: string; action: string; message?: string }>;
    ignoreDate: boolean;
  };
};

export type WebviewRebaseCancelMessage = {
  type: 'rebaseCancel';
  payload: { id: string };
};

// Buttons of the banner of a stopped merge/cherry-pick/revert/rebase; open one conflicted file.
export type WebviewOperationActionMessage = {
  type: 'operationAction';
  payload: { action: 'continue' | 'skip' | 'abort' };
};

export type WebviewOpenConflictMessage = {
  type: 'openConflict';
  payload: { path: string };
};

// Context menu actions (webview -> extension). The extension asks for confirmation where needed.
export type WebviewCheckoutBranchMessage = {
  type: 'checkoutBranch';
  payload: { name: string };
};

// Remote-tracking branch, e.g. "origin/feature": checks out the local branch of the same name
// (created with tracking if it does not exist yet).
export type WebviewCheckoutRemoteBranchMessage = {
  type: 'checkoutRemoteBranch';
  payload: { remoteRef: string };
};

// Detached HEAD at a commit hash or tag name.
export type WebviewCheckoutDetachedMessage = {
  type: 'checkoutDetached';
  payload: { target: string };
};

export type WebviewCreateBranchMessage = {
  type: 'createBranch';
  payload: { hash: string };
};

// Commit actions of the context menu that change the repository; the extension asks first.
export type CommitAction =
  | 'addTag'
  | 'addWorktree'
  | 'cherryPick'
  | 'revert'
  | 'merge'
  | 'rebase'
  | 'rebaseInteractive'
  | 'reset';

export type WebviewCommitActionMessage = {
  type: 'commitAction';
  payload: { action: CommitAction; hash: string };
};

// Actions on a tag chip: push it to a remote or delete it (locally, optionally on a remote).
export type WebviewTagActionMessage = {
  type: 'tagAction';
  payload: { action: 'push' | 'delete'; name: string };
};

// Actions on a stash chip. hash = the stash commit the chip showed: the extension checks that
// the selector still names that stash (the numbers shift when stashes are added or dropped).
export type WebviewStashActionMessage = {
  type: 'stashAction';
  payload: { action: 'apply' | 'pop' | 'drop'; selector: string; hash: string };
};

// Delete a branch from its chip: the local branch (optionally also on its remote) or a remote
// branch such as "origin/feature". The extension checks the name and asks in a form.
export type WebviewBranchActionMessage = {
  type: 'branchAction';
  payload: { action: 'delete' | 'deleteRemote'; name: string };
};

// Info line of a tag's context menu: the extension answers with "tagInfo" (local details first,
// then the live state on the remote), matched by requestId.
export type WebviewTagInfoMessage = {
  type: 'tagInfo';
  payload: { requestId: string; name: string };
};

// Actions on a worktree (its uncommitted row or a chip marked with it). The path must be one
// of the repository's worktrees; the extension checks that.
export type WorktreeAction = 'switch' | 'openWindow' | 'copyPath' | 'remove';

export type WebviewWorktreeActionMessage = {
  type: 'worktreeAction';
  payload: { action: WorktreeAction; path: string };
};

export type WebviewShowInTerminalMessage = {
  type: 'showInTerminal';
  payload: { hash: string };
};

// Extension -> webview: a command failed; message is user-readable.
export type WebviewErrorMessage = {
  type: 'error';
  payload: {
    message: string;
  };
};

// Extension -> webview: short status line update.
export type WebviewStatusMessage = {
  type: 'status';
  payload: {
    message: string;
  };
};

export type WebviewInitMessage = {
  type: 'init';
  payload: {
    message: string;
    repoRoot?: string;
    repositories: string[];
    branches: WebviewBranchOption[];
    selectedBranch: string;
    showRemoteBranches: boolean;
    selectedSortMode: 'date';
    dateFormat: string;
    // OS regional format (e.g. de-DE), used for local/relative dates.
    dateLocale: string;
    commits: WebviewCommitSummary[];
    nextCursor?: string;
    hasMore: boolean;
    maxLanes: number;
  };
};

export type WebviewCommitsMessage = {
  type: 'commits';
  payload: {
    message: string;
    repoRoot?: string;
    repositories: string[];
    branches: WebviewBranchOption[];
    selectedBranch: string;
    showRemoteBranches: boolean;
    selectedSortMode: 'date';
    dateFormat: string;
    // OS regional format (e.g. de-DE), used for local/relative dates.
    dateLocale: string;
    commits: WebviewCommitSummary[];
    nextCursor?: string;
    hasMore: boolean;
    append?: boolean;
    maxLanes: number;
  };
};

export type WebviewCommitDetailsMessage = {
  type: 'commitDetails';
  payload: {
    message: string;
    details?: WebviewCommitDetails;
  };
};

export type WebviewCommitSummary = {
  hash: string;
  shortHash: string;
  lane: number;
  segments: { fromLane: number; toLane: number }[];
  entrySegments?: { fromLane: number; toLane: number }[];
  graphPrefix?: string;
  graphFlowPrefix?: string;
  graphConnectorPrefixes?: string[];
  refs: WebviewRef[];
  incomingLanes?: number[];
  outgoingLanes?: number[];
  authorName: string;
  authorDate: string;
  subject: string;
  isVirtual?: boolean;
  // "Uncommitted Changes" row on top (parent = HEAD).
  isUncommitted?: boolean;
};

export type WebviewRef = {
  name: string;
  type: 'local' | 'remote' | 'tag' | 'head' | 'stash' | 'other';
  isCurrent?: boolean;
};

export type WebviewBranchOption = {
  value: string;
  label: string;
  type: 'local' | 'remote' | 'all';
};

export type WebviewCommitDetails = {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  body: string;
  files: { status: string; path: string; additions?: number; deletions?: number }[];
};

export type WebviewMessage =
  | WebviewCheckoutBranchMessage
  | WebviewCheckoutRemoteBranchMessage
  | WebviewCheckoutDetachedMessage
  | WebviewCreateBranchMessage
  | WebviewShowInTerminalMessage
  | WebviewCommitActionMessage
  | WebviewTagActionMessage
  | WebviewTagInfoMessage
  | WebviewBranchActionMessage
  | WebviewStashActionMessage
  | WebviewWorktreeActionMessage
  | WebviewReadyMessage
  | WebviewRefreshMessage
  | WebviewUpdateFiltersMessage
  | WebviewLoadMoreMessage
  | WebviewSelectCommitMessage
  | WebviewOpenDiffMessage
  | WebviewOpenFileMessage
  | WebviewSelectRepoMessage
  | WebviewSelectWorktreeMessage
  | WebviewCopyToClipboardMessage
  | WebviewFormSubmitMessage
  | WebviewFormCancelMessage
  | WebviewRebaseSubmitMessage
  | WebviewRebaseCancelMessage
  | WebviewOperationActionMessage
  | WebviewOpenConflictMessage
  | WebviewInitMessage
  | WebviewCommitsMessage
  | WebviewCommitDetailsMessage
  | WebviewErrorMessage
  | WebviewStatusMessage;
