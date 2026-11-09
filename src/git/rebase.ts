import * as fs from 'fs';
import * as path from 'path';

// Interactive rebase without an editor: the rebase view sends one action per commit; the todo
// list git would open in an editor is written from it (see GitService.interactiveRebase).

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export const rebaseActions: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

// One commit of the todo list, oldest first (git's order). message: new message for reword.
export type RebaseStep = { hash: string; action: RebaseAction; message?: string };

// A commit offered in the rebase view.
export type RebaseCommit = { hash: string; shortHash: string; subject: string; message: string; authorName: string };

// What is wrong with the steps (shown in the view), or undefined when git can run them.
export const rebaseStepsProblem = (steps: RebaseStep[]): string | undefined => {
  if (steps.length === 0) {
    return 'There are no commits to rebase.';
  }
  const kept = steps.filter((step) => step.action !== 'drop');
  if (kept.length === 0) {
    return 'Keep at least one commit (all are dropped).';
  }
  // Squash/fixup melt into the commit before it in the todo list (the older one).
  const first = kept[0];
  if (first.action === 'squash' || first.action === 'fixup') {
    return 'The oldest kept commit cannot be squashed: there is no older commit to add it to.';
  }
  const emptyReword = steps.find((step) => step.action === 'reword' && !(step.message ?? '').trim());
  if (emptyReword) {
    return `Enter a message for ${emptyReword.hash.slice(0, 8)}.`;
  }
  return undefined;
};

// Quote a path for git's shell (sh, also on Windows): single quotes, forward slashes.
export const shellPath = (file: string): string => {
  if (file.includes("'")) {
    throw new Error(`Path not usable for git: ${file}`);
  }
  return `'${file.replace(/\\/g, '/')}'`;
};

// Todo list text. Reword is a pick followed by an amend with the prepared message file, so no
// editor is needed; messageFile(index) names that file.
export const buildTodo = (steps: RebaseStep[], messageFile: (index: number) => string): string =>
  steps
    .map((step, index) => {
      if (step.action === 'reword') {
        return `pick ${step.hash}\nexec git commit --amend --quiet -F ${shellPath(messageFile(index))}`;
      }
      return `${step.action} ${step.hash}`;
    })
    .join('\n') + '\n';

// A merge, cherry-pick, revert or rebase that stopped (conflicts or "edit") and waits.
export type OperationState = {
  kind: 'rebase' | 'merge' | 'cherry-pick' | 'revert';
  // Rebase only: step reached (1-based) and number of steps.
  step?: number;
  total?: number;
  // Commit the operation stopped at (rebase/cherry-pick/revert), short form.
  stoppedAt?: string;
  // Branch being rebased.
  branch?: string;
  conflicts: string[];
};

const readTrimmed = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return undefined;
  }
};

// Operation in progress, read from the git directory of the worktree (conflicts are added by
// the caller). undefined when nothing waits.
export const readOperationState = (gitDir: string): Omit<OperationState, 'conflicts'> | undefined => {
  for (const folder of ['rebase-merge', 'rebase-apply']) {
    const dir = path.join(gitDir, folder);
    if (fs.existsSync(dir)) {
      const step = Number(readTrimmed(path.join(dir, folder === 'rebase-merge' ? 'msgnum' : 'next')));
      const total = Number(readTrimmed(path.join(dir, folder === 'rebase-merge' ? 'end' : 'last')));
      const stopped = readTrimmed(path.join(dir, 'stopped-sha'));
      const head = readTrimmed(path.join(dir, 'head-name'));
      return {
        kind: 'rebase',
        step: Number.isFinite(step) && step > 0 ? step : undefined,
        total: Number.isFinite(total) && total > 0 ? total : undefined,
        stoppedAt: stopped ? stopped.slice(0, 8) : undefined,
        branch: head?.replace(/^refs\/heads\//, ''),
      };
    }
  }
  const stoppedAt = (file: string): string | undefined => readTrimmed(path.join(gitDir, file))?.slice(0, 8);
  if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
    return { kind: 'cherry-pick', stoppedAt: stoppedAt('CHERRY_PICK_HEAD') };
  }
  if (fs.existsSync(path.join(gitDir, 'REVERT_HEAD'))) {
    return { kind: 'revert', stoppedAt: stoppedAt('REVERT_HEAD') };
  }
  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
    return { kind: 'merge', stoppedAt: stoppedAt('MERGE_HEAD') };
  }
  return undefined;
};

// Conflict markers still in a file (then "Continue" must not mark it as resolved).
export const hasConflictMarkers = (text: string): boolean => /^(<{7}|>{7})( |$)/m.test(text);
