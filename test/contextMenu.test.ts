import { describe, expect, it, vi } from 'vitest';
import { branchNameProblem, localNameForRemote } from '../src/git/refNames';
import { buildContextMenuItems, describeTagInfo, type ContextMenuItem } from '../webview/src/graph/contextMenu';
import type { CommitView } from '../webview/src/graph/model';

// Records which action was triggered with which argument.
const recordingActions = () => {
  const calls: Array<[string, ...string[]]> = [];
  const record = (name: string) => (...args: string[]) => {
    calls.push([name, ...args]);
  };
  return {
    calls,
    actions: {
      checkoutBranch: vi.fn(record('checkoutBranch')),
      checkoutRemoteBranch: vi.fn(record('checkoutRemoteBranch')),
      checkoutDetached: vi.fn(record('checkoutDetached')),
      createBranch: vi.fn(record('createBranch')),
      showInTerminal: vi.fn(record('showInTerminal')),
      copyToClipboard: vi.fn(record('copyToClipboard')),
      commitAction: vi.fn(record('commitAction')),
      tagAction: vi.fn(record('tagAction')),
      branchAction: vi.fn(record('branchAction')),
      stashAction: vi.fn(record('stashAction')),
      worktreeAction: vi.fn(record('worktreeAction')),
    },
  };
};

const commit: CommitView = {
  hash: 'a'.repeat(40), shortHash: 'aaaaaaa', parents: [], lane: 0, segments: [], refs: [],
  authorName: 'x', authorDate: '', subject: 'Fix layout',
};

const labels = (items: ContextMenuItem[]): string[] =>
  items.map((item) => ('separator' in item ? '---' : item.label));

const run = (items: ContextMenuItem[], label: string): void => {
  const item = items.find((entry) => !('separator' in entry) && entry.label === label);
  if (!item || 'separator' in item) {
    throw new Error(`no entry ${label}`);
  }
  item.run();
};

describe('Context menu (buildContextMenuItems)', () => {
  it('commit row: groups create | bring to HEAD | move the branch | copy', () => {
    const { actions, calls } = recordingActions();
    const items = buildContextMenuItems(commit, undefined, actions);
    expect(labels(items)).toEqual([
      'Add Tag…',
      'Create Branch…',
      'Add Worktree…',
      '---',
      'Check Out (Detached)…',
      'Cherry-Pick onto Current Branch…',
      'Revert…',
      '---',
      'Merge into Current Branch…',
      'Rebase Current Branch onto This Commit…',
      'Reset Current Branch to This Commit…',
      '---',
      'Copy Hash',
      'Copy Subject',
      'Show in Terminal',
    ]);
    labels(items).filter((label) => label !== '---').forEach((label) => run(items, label));
    expect(calls).toEqual([
      ['commitAction', 'addTag', commit.hash],
      ['createBranch', commit.hash],
      ['commitAction', 'addWorktree', commit.hash],
      ['checkoutDetached', commit.hash],
      ['commitAction', 'cherryPick', commit.hash],
      ['commitAction', 'revert', commit.hash],
      ['commitAction', 'merge', commit.hash],
      ['commitAction', 'rebase', commit.hash],
      ['commitAction', 'reset', commit.hash],
      ['copyToClipboard', commit.hash, 'Commit hash'],
      ['copyToClipboard', 'Fix layout', 'Commit subject'],
      ['showInTerminal', commit.hash],
    ]);
  });

  it('HEAD commit: nothing that targets HEAD itself', () => {
    const { actions } = recordingActions();
    const head = { ...commit, refs: [{ name: 'main', type: 'local' as const, isCurrent: true }] };
    expect(labels(buildContextMenuItems(head, undefined, actions))).toEqual([
      'Add Tag…',
      'Create Branch…',
      'Add Worktree…',
      '---',
      'Revert…',
      '---',
      'Copy Hash',
      'Copy Subject',
      'Show in Terminal',
    ]);
  });

  it('branch, remote and tag chips get their own checkout entry on top', () => {
    const { actions, calls } = recordingActions();
    const local = buildContextMenuItems(commit, { name: 'feature', type: 'local', isCurrent: false }, actions);
    const remote = buildContextMenuItems(commit, { name: 'origin/fix', type: 'remote', isCurrent: false }, actions);
    const tag = buildContextMenuItems(commit, { name: 'v1.0', type: 'tag', isCurrent: false }, actions);
    expect(labels(local).slice(0, 3)).toEqual(['Check Out Branch "feature"', 'Delete Branch "feature"…', '---']);
    expect(labels(remote).slice(0, 3)).toEqual([
      'Check Out "origin/fix" as Local Branch',
      'Delete Remote Branch "origin/fix"…',
      '---',
    ]);
    expect(labels(tag)[0]).toBe('Check Out Tag "v1.0" (Detached)…');
    run(local, 'Check Out Branch "feature"');
    run(remote, 'Check Out "origin/fix" as Local Branch');
    run(tag, 'Check Out Tag "v1.0" (Detached)…');
    // Tag chips can also be pushed and deleted.
    expect(labels(tag).slice(1, 4)).toEqual(['Push Tag "v1.0"…', 'Delete Tag "v1.0"…', '---']);
    run(tag, 'Push Tag "v1.0"…');
    run(tag, 'Delete Tag "v1.0"…');
    run(local, 'Delete Branch "feature"…');
    run(remote, 'Delete Remote Branch "origin/fix"…');
    expect(calls).toEqual([
      ['checkoutBranch', 'feature'],
      ['checkoutRemoteBranch', 'origin/fix'],
      ['checkoutDetached', 'v1.0'],
      ['tagAction', 'push', 'v1.0'],
      ['tagAction', 'delete', 'v1.0'],
      ['branchAction', 'delete', 'feature'],
      ['branchAction', 'deleteRemote', 'origin/fix'],
    ]);
  });

  it('tag info: lines, and push only when the tag is not on the remote yet', () => {
    const base = { requestId: 'r', name: 'v1.0', remote: 'origin' };
    const annotated = describeTagInfo({
      ...base, annotated: true, tagger: 'Roman', date: '2026-11-03T10:00:00+01:00', message: 'Release 1.0', remoteState: 'same',
    });
    expect(annotated.lines).toEqual(['Tag v1.0', 'Annotated · Roman, 2026-11-03', '"Release 1.0"']);
    expect(annotated.remoteLine).toBe('✓ On origin');
    expect(annotated.pushBlocked).toBe(true);
    const local = describeTagInfo({ ...base, annotated: false, remoteState: 'absent' });
    expect(local.lines).toEqual(['Tag v1.0', 'Lightweight']);
    expect(local.remoteLine).toBe('↑ Only local, not on origin');
    expect(local.pushBlocked).toBe(false);
    expect(describeTagInfo({ ...base, remoteState: 'different', remoteCommit: 'abc1234' }).remoteLine).toContain('abc1234');
    expect(describeTagInfo({ ...base, remoteState: 'unreachable' }).pushBlocked).toBe(false);
  });

  it('chip with local and remote branch: each can be deleted on its own', () => {
    const { actions, calls } = recordingActions();
    const paired = buildContextMenuItems(commit, { name: 'wip', type: 'local', remoteName: 'origin/wip', isCurrent: false }, actions);
    expect(labels(paired).slice(0, 4)).toEqual([
      'Check Out Branch "wip"',
      'Delete Branch "wip"…',
      'Delete Remote Branch "origin/wip"…',
      '---',
    ]);
    run(paired, 'Delete Remote Branch "origin/wip"…');
    expect(calls).toEqual([['branchAction', 'deleteRemote', 'origin/wip']]);
  });

  it('stash chip: apply, pop, drop with the stash commit', () => {
    const { actions, calls } = recordingActions();
    const items = buildContextMenuItems(commit, { name: 'stash@{1}', type: 'stash', isCurrent: false, stashHash: 'f00d' }, actions);
    expect(labels(items).slice(0, 4)).toEqual([
      'Apply Stash "stash@{1}"…',
      'Pop Stash "stash@{1}"…',
      'Drop Stash "stash@{1}"…',
      '---',
    ]);
    run(items, 'Pop Stash "stash@{1}"…');
    expect(calls).toEqual([['stashAction', 'pop', 'stash@{1}', 'f00d']]);
  });

  it('current branch and HEAD chip: only the commit entries', () => {
    const { actions } = recordingActions();
    const current = buildContextMenuItems(commit, { name: 'main', type: 'local', isCurrent: true }, actions);
    const head = buildContextMenuItems(commit, { name: 'HEAD', type: 'head', isCurrent: false }, actions);
    expect(labels(current)[0]).toBe('Add Tag…');
    expect(labels(head)[0]).toBe('Add Tag…');
  });

  it('worktrees: the row and chip of another worktree offer the worktree actions', () => {
    const { actions, calls } = recordingActions();
    const folder = 'S:/wt/feature-x';
    const row = buildContextMenuItems(
      { ...commit, hash: `__uncommitted__:${folder}`, isUncommitted: true, worktreePath: folder, worktreeName: 'feature-x' },
      undefined,
      actions,
    );
    expect(labels(row)).toEqual([
      'Switch to Worktree "feature-x"',
      'Open Worktree in New Window',
      'Copy Worktree Path',
      'Remove Worktree "feature-x"…',
    ]);
    labels(row).forEach((label) => run(row, label));
    expect(calls).toEqual([
      ['worktreeAction', 'switch', folder],
      ['worktreeAction', 'openWindow', folder],
      ['worktreeAction', 'copyPath', folder],
      ['worktreeAction', 'remove', folder],
    ]);

    // A branch checked out there: worktree actions instead of the checkout git would refuse.
    const chip = buildContextMenuItems(
      commit,
      { name: 'feature', type: 'local', isCurrent: false, worktreePath: folder, worktreeName: 'feature-x' },
      actions,
    );
    expect(labels(chip).slice(0, 5)).toEqual([
      'Switch to Worktree "feature-x"',
      'Open Worktree in New Window',
      'Copy Worktree Path',
      'Remove Worktree "feature-x"…',
      '---',
    ]);
    expect(labels(chip)).not.toContain('Check Out Branch "feature"');
  });

  it('Uncommitted Changes: no menu', () => {
    const { actions } = recordingActions();
    expect(buildContextMenuItems({ ...commit, hash: '__uncommitted__', isUncommitted: true }, undefined, actions)).toEqual([]);
  });
});

describe('Branch names (refNames)', () => {
  it('local name for a remote branch', () => {
    expect(localNameForRemote('origin/main')).toBe('main');
    expect(localNameForRemote('origin/feature/x')).toBe('feature/x');
    expect(localNameForRemote('origin')).toBeUndefined();
    expect(localNameForRemote('origin/')).toBeUndefined();
    expect(localNameForRemote('/x')).toBeUndefined();
  });

  it('quick check of branch names', () => {
    expect(branchNameProblem('feature/new')).toBeUndefined();
    expect(branchNameProblem('  ')).toBe('Enter a branch name.');
    expect(branchNameProblem('-f')).toContain('must not start with "-"');
    expect(branchNameProblem('mit leerzeichen')).toContain('spaces');
  });
});
