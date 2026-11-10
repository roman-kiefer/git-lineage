import * as path from 'path';

// One entry of "git worktree list --porcelain".
export type WorktreeInfo = {
  // Absolute folder of the worktree (normalized with path.resolve).
  path: string;
  // Commit checked out there (missing for a bare repository).
  head?: string;
  // Short branch name, undefined when detached.
  branch?: string;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
  // Folder is gone; "git worktree prune" would remove the entry.
  isPrunable: boolean;
  // The first entry is the main worktree (the one with the real .git folder).
  isMain: boolean;
};

// Parse the porcelain output: blocks separated by blank lines, one attribute per line.
export const parseWorktreeList = (raw: string): WorktreeInfo[] => {
  const worktrees: WorktreeInfo[] = [];
  raw
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .forEach((block) => {
      const entry: WorktreeInfo = {
        path: '',
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
        isMain: worktrees.length === 0,
      };
      block.split('\n').forEach((line) => {
        const space = line.indexOf(' ');
        const key = space < 0 ? line : line.slice(0, space);
        const value = space < 0 ? '' : line.slice(space + 1);
        if (key === 'worktree') {
          entry.path = path.resolve(value);
        } else if (key === 'HEAD') {
          entry.head = value;
        } else if (key === 'branch') {
          entry.branch = value.replace(/^refs\/heads\//, '');
        } else if (key === 'bare') {
          entry.isBare = true;
        } else if (key === 'detached') {
          entry.isDetached = true;
        } else if (key === 'locked') {
          entry.isLocked = true;
        } else if (key === 'prunable') {
          entry.isPrunable = true;
        }
      });
      if (entry.path) {
        worktrees.push(entry);
      }
    });
  return worktrees;
};

// Same folder? (Windows paths are case-insensitive, separators may differ.)
export const samePath = (a: string | undefined, b: string | undefined): boolean => {
  if (!a || !b) {
    return false;
  }
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
};

// Short display name of a worktree: its folder name.
export const worktreeName = (worktreePath: string): string =>
  path.basename(worktreePath) || worktreePath;

// Display names for all worktrees of a repository: the folder name, and where folder names
// clash (e.g. tools that put every worktree in ".../<id>/<repo>") as many parent folders as
// needed to tell them apart, e.g. "5b98/repo" and "3e75/repo".
export const uniqueWorktreeNames = (paths: string[]): string[] => {
  const parts = paths.map((value) => path.resolve(value).split(/[\\/]+/).filter(Boolean));
  const depth = parts.map(() => 1);
  const label = (index: number): string => parts[index].slice(-depth[index]).join('/') || paths[index];
  for (;;) {
    const names = parts.map((_, index) => label(index));
    const keys = names.map((name) => name.toLowerCase());
    const clashes = keys.map(
      (key, index) => depth[index] < parts[index].length && keys.some((other, j) => j !== index && other === key),
    );
    if (!clashes.some(Boolean)) {
      return names;
    }
    clashes.forEach((clash, index) => {
      if (clash) {
        depth[index] += 1;
      }
    });
  }
};

// Default folder for a new worktree: next to the main worktree in "<repo>.worktrees/<name>".
export const defaultWorktreePath = (mainWorktree: string, name: string): string => {
  const safe = name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree';
  return path.join(path.dirname(mainWorktree), `${path.basename(mainWorktree)}.worktrees`, safe);
};
