// Folder name of a path (its last part); the full path is shown as tooltip.
export const folderName = (fullPath: string): string => fullPath.split(/[\\/]/).filter(Boolean).pop() ?? fullPath;

export type ViewHelpers = {
  // kind 'error' highlights the status line until the next normal message.
  setStatusText: (text: string, kind?: 'info' | 'error') => void;
  setRepoText: (repoRoot: string | undefined, force: boolean) => void;
  setGraphDebugEnabled: (enabled: boolean) => void;
};

export const createViewHelpers = (): ViewHelpers => {
  const status = document.getElementById('status');
  const repo = document.getElementById('repo');
  const repoPath = document.getElementById('repo-path');
  const repoCopy = document.getElementById('repo-copy');
  const appElement = document.querySelector('.app') as HTMLDivElement | null;

  const setStatusText = (text: string, kind: 'info' | 'error' = 'info'): void => {
    if (status) {
      status.textContent = text;
      status.classList.toggle('status--error', kind === 'error');
    }
  };

  const setRepoText = (repoRoot: string | undefined, force: boolean): void => {
    if (!repo) {
      return;
    }
    if (!force && repoRoot === undefined) {
      return;
    }
    // Folder name in the toolbar, full path as tooltip and for the copy button (data-path).
    repo.dataset.path = repoRoot ?? '';
    repo.title = repoRoot ?? '';
    if (repoPath) {
      repoPath.textContent = repoRoot ? folderName(repoRoot) : 'No repo';
    }
    if (repoCopy) {
      repoCopy.hidden = !repoRoot;
    }
  };

  const setGraphDebugEnabled = (enabled: boolean): void => {
    if (!appElement) {
      return;
    }
    appElement.classList.toggle('app--graph-debug', enabled);
  };

  return {
    setStatusText,
    setRepoText,
    setGraphDebugEnabled,
  };
};
