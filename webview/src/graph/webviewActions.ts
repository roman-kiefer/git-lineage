// Repository-changing commit actions (same names as in src/webview/webviewMessages.ts).
export type CommitAction =
  | 'addTag'
  | 'addWorktree'
  | 'cherryPick'
  | 'revert'
  | 'merge'
  | 'rebase'
  | 'rebaseInteractive'
  | 'reset';

// Actions on a worktree (same names as in src/webview/webviewMessages.ts).
export type WorktreeAction = 'switch' | 'openWindow' | 'copyPath' | 'remove';

type OutgoingWebviewMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'refresh';
    }
  | {
      type: 'updateFilters';
      payload: {
        selectedBranch: string;
        showRemoteBranches: boolean;
      };
    }
  | {
      type: 'loadMore';
      payload: {
        cursor?: string;
      };
    }
  | {
      type: 'selectCommit';
      payload: {
        hash: string;
      };
    }
  | {
      type: 'openFile';
      payload: {
        hash: string;
        path: string;
      };
    }
  | {
      type: 'openDiff';
      payload: {
        hash: string;
        path: string;
      };
    }
  | {
      type: 'selectRepo';
      payload: {
        repoRoot: string;
      };
    }
  | { type: 'checkoutBranch'; payload: { name: string } }
  | { type: 'checkoutRemoteBranch'; payload: { remoteRef: string } }
  | { type: 'checkoutDetached'; payload: { target: string } }
  | { type: 'createBranch'; payload: { hash: string } }
  | { type: 'showInTerminal'; payload: { hash: string } }
  | { type: 'commitAction'; payload: { action: CommitAction; hash: string } }
  | { type: 'tagAction'; payload: { action: 'push' | 'delete'; name: string } }
  | { type: 'tagInfo'; payload: { requestId: string; name: string } }
  | { type: 'branchAction'; payload: { action: 'delete' | 'deleteRemote'; name: string } }
  | { type: 'stashAction'; payload: { action: 'apply' | 'pop' | 'drop'; selector: string; hash: string } }
  | { type: 'selectWorktree'; payload: { path: string } }
  | { type: 'worktreeAction'; payload: { action: WorktreeAction; path: string } }
  | { type: 'formSubmit'; payload: { id: string; values: Record<string, string | boolean> } }
  | { type: 'formCancel'; payload: { id: string } }
  | {
      type: 'rebaseSubmit';
      payload: { id: string; steps: Array<{ hash: string; action: string; message?: string }>; ignoreDate: boolean };
    }
  | { type: 'rebaseCancel'; payload: { id: string } }
  | { type: 'operationAction'; payload: { action: 'continue' | 'skip' | 'abort' } }
  | { type: 'openConflict'; payload: { path: string } }
  | {
      type: 'copyToClipboard';
      payload: {
        text: string;
        label: string;
      };
    };

type VsCodePostMessageApi = {
  postMessage: (message: OutgoingWebviewMessage) => void;
};

export type WebviewActions = {
  ready: () => void;
  refresh: () => void;
  updateFilters: (selectedBranch: string, showRemoteBranches: boolean) => void;
  loadMore: (cursor?: string) => void;
  selectCommit: (hash: string) => void;
  openFile: (hash: string, path: string) => void;
  openDiff: (hash: string, path: string) => void;
  // Switch the shown repository (multi-root workspaces).
  selectRepo: (repoRoot: string) => void;
  // Copy text through the extension (VS Code clipboard API).
  copyToClipboard: (text: string, label: string) => void;
  // Context menu actions; the extension confirms detached checkouts and asks for branch names.
  checkoutBranch: (name: string) => void;
  checkoutRemoteBranch: (remoteRef: string) => void;
  checkoutDetached: (target: string) => void;
  createBranch: (hash: string) => void;
  showInTerminal: (hash: string) => void;
  // Tag, cherry-pick, revert, merge, rebase, reset; the extension confirms each one.
  commitAction: (action: CommitAction, hash: string) => void;
  // Push or delete a tag (tag chip); the extension asks for the remote and confirms.
  tagAction: (action: 'push' | 'delete', name: string) => void;
  // Apply, pop or drop a stash (stash chip); the extension asks in a form.
  stashAction: (action: 'apply' | 'pop' | 'drop', selector: string, hash: string) => void;
  // Delete a local branch (form, optionally also its upstream) or a remote branch.
  branchAction: (action: 'delete' | 'deleteRemote', name: string) => void;
  // Details of a tag for the info line of its menu; answered by "tagInfo" messages.
  tagInfo: (requestId: string, name: string) => void;
  // Show another worktree of the repository.
  selectWorktree: (path: string) => void;
  // Switch to, open, copy the path of or remove a worktree.
  worktreeAction: (action: WorktreeAction, path: string) => void;
  // Answers to a form of the extension (formDialog.ts).
  formSubmit: (id: string, values: Record<string, string | boolean>) => void;
  formCancel: (id: string) => void;
  // Answers of the rebase view (rebaseDialog.ts).
  rebaseSubmit: (id: string, steps: Array<{ hash: string; action: string; message?: string }>, ignoreDate: boolean) => void;
  rebaseCancel: (id: string) => void;
  // Banner of a stopped merge/cherry-pick/revert/rebase (operationBanner.ts).
  operationAction: (action: 'continue' | 'skip' | 'abort') => void;
  openConflict: (path: string) => void;
};

export const createWebviewActions = (vscode: VsCodePostMessageApi): WebviewActions => {
  const send = (message: OutgoingWebviewMessage): void => {
    vscode.postMessage(message);
  };

  return {
    ready: () => {
      send({ type: 'ready' });
    },
    refresh: () => {
      send({ type: 'refresh' });
    },
    updateFilters: (selectedBranch: string, showRemoteBranches: boolean) => {
      send({
        type: 'updateFilters',
        payload: {
          selectedBranch,
          showRemoteBranches,
        },
      });
    },
    loadMore: (cursor?: string) => {
      send({ type: 'loadMore', payload: { cursor } });
    },
    selectCommit: (hash: string) => {
      send({ type: 'selectCommit', payload: { hash } });
    },
    openFile: (hash: string, path: string) => {
      send({ type: 'openFile', payload: { hash, path } });
    },
    openDiff: (hash: string, path: string) => {
      send({ type: 'openDiff', payload: { hash, path } });
    },
    selectRepo: (repoRoot: string) => {
      send({ type: 'selectRepo', payload: { repoRoot } });
    },
    copyToClipboard: (text: string, label: string) => {
      send({ type: 'copyToClipboard', payload: { text, label } });
    },
    checkoutBranch: (name: string) => {
      send({ type: 'checkoutBranch', payload: { name } });
    },
    checkoutRemoteBranch: (remoteRef: string) => {
      send({ type: 'checkoutRemoteBranch', payload: { remoteRef } });
    },
    checkoutDetached: (target: string) => {
      send({ type: 'checkoutDetached', payload: { target } });
    },
    createBranch: (hash: string) => {
      send({ type: 'createBranch', payload: { hash } });
    },
    showInTerminal: (hash: string) => {
      send({ type: 'showInTerminal', payload: { hash } });
    },
    commitAction: (action: CommitAction, hash: string) => {
      send({ type: 'commitAction', payload: { action, hash } });
    },
    tagAction: (action: 'push' | 'delete', name: string) => {
      send({ type: 'tagAction', payload: { action, name } });
    },
    stashAction: (action, selector, hash) => {
      send({ type: 'stashAction', payload: { action, selector, hash } });
    },
    branchAction: (action: 'delete' | 'deleteRemote', name: string) => {
      send({ type: 'branchAction', payload: { action, name } });
    },
    tagInfo: (requestId: string, name: string) => {
      send({ type: 'tagInfo', payload: { requestId, name } });
    },
    selectWorktree: (path: string) => {
      send({ type: 'selectWorktree', payload: { path } });
    },
    worktreeAction: (action: WorktreeAction, path: string) => {
      send({ type: 'worktreeAction', payload: { action, path } });
    },
    formSubmit: (id: string, values: Record<string, string | boolean>) => {
      send({ type: 'formSubmit', payload: { id, values } });
    },
    formCancel: (id: string) => {
      send({ type: 'formCancel', payload: { id } });
    },
    rebaseSubmit: (id, steps, ignoreDate) => {
      send({ type: 'rebaseSubmit', payload: { id, steps, ignoreDate } });
    },
    rebaseCancel: (id: string) => {
      send({ type: 'rebaseCancel', payload: { id } });
    },
    operationAction: (action) => {
      send({ type: 'operationAction', payload: { action } });
    },
    openConflict: (path: string) => {
      send({ type: 'openConflict', payload: { path } });
    },
  };
};
