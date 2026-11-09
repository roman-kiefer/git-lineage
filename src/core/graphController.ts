import * as fs from 'fs';
import * as path from 'path';
import { GitError, GitService, type BranchTracking, type StashEntry, type TagDetails } from '../git/gitService';
import type { CommitFileChange, CommitSummary, Ref } from '../git/gitTypes';
import { branchNameProblem, localNameForRemote } from '../git/refNames';
import {
  rebaseActions,
  rebaseStepsProblem,
  type OperationState,
  type RebaseAction,
  type RebaseCommit,
  type RebaseStep,
} from '../git/rebase';
import { defaultWorktreePath, samePath, worktreeName, type WorktreeInfo } from '../git/worktrees';
import { getOsLocale } from '../utils/osLocale';
import type { CommitAction, WebviewMessage, WorktreeAction } from '../webview/webviewMessages';
import { formFlag, formText, type FormProblem, type FormSpec, type FormValues } from './forms';
import type { Disposable, GraphHost } from './graphHost';

// Host-independent logic behind the webview: loading and paging commits, the
// "Uncommitted Changes" row, commit details, context menu actions and auto refresh.
// The host (VS Code or the local server) only shows things and answers questions.

type BranchOption = {
  value: string;
  label: string;
  type: 'local' | 'remote' | 'all';
};

type DisplayCommit = CommitSummary & {
  isVirtual?: boolean;
  isUncommitted?: boolean;
  // Uncommitted rows: the worktree they belong to.
  worktreePath?: string;
  worktreeName?: string;
};

// Form shown in the webview, waiting for valid values or cancel.
type OpenForm = {
  validate(values: FormValues): Promise<FormProblem | undefined>;
  resolve(values: FormValues | undefined): void;
};

// Rebase view shown in the webview: the commits it offers (oldest first) and onto what.
type OpenRebase = { id: string; branch: string; base: string; commits: RebaseCommit[] };

// Most commits the rebase view offers (beyond that, use git rebase -i in a terminal).
const MAX_REBASE_COMMITS = 200;
// "origin/feature" -> remote "origin", branch "feature"; the longest configured remote name wins
// (remote names may contain "/"). undefined if no remote matches.
export const splitRemoteRef = (
  remoteRef: string,
  remotes: string[],
): { remote: string; branch: string } | undefined => {
  const remote = remotes
    .filter((name) => remoteRef.startsWith(`${name}/`) && remoteRef.length > name.length + 1)
    .sort((a, b) => b.length - a.length)[0];
  return remote ? { remote, branch: remoteRef.slice(remote.length + 1) } : undefined;
};

// How long after an own action an auto-refresh keeps showing that action's message.
const NOTICE_KEEP_MS = 5000;

// A worktree of the shown repository with its uncommitted changes.
type WorktreeState = WorktreeInfo & { name: string; isCurrent: boolean; changes: CommitFileChange[] };

// Hash of the "Uncommitted Changes" row (no real commit; diffs compare HEAD with the working tree).
// Rows of other worktrees use "__uncommitted__:<worktree folder>".
export const UNCOMMITTED_HASH = '__uncommitted__';
const OTHER_WORKTREE_PREFIX = `${UNCOMMITTED_HASH}:`;
// Other worktrees are not watched file by file; their status is checked this often.
export const WORKTREE_POLL_MS = 10_000;
// git status calls running at the same time when many worktrees are checked.
const WORKTREE_STATUS_CONCURRENCY = 6;

// Upper bound for commits reloaded at once (auto refresh keeps the loaded amount).
const MAX_RELOAD_COMMITS = 2000;
// Debounce for bursts of ref/HEAD file changes (e.g. during fetch or rebase).
export const AUTO_REFRESH_DEBOUNCE_MS = 750;

// Current local time as ISO string with offset, e.g. 2026-11-06T19:51:00+01:00.
const localIsoNow = (): string => {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (value: number): string => String(Math.abs(Math.trunc(value))).padStart(2, '0');
  const local = new Date(now.getTime() + offset * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
};

export class GraphController {
  private loadedCommits: CommitSummary[] = [];
  private selectedBranch = '__all__';
  private showRemoteBranches: boolean;
  private selectedSortMode: 'date' = 'date';
  private branchOptions: BranchOption[] = [{ value: '__all__', label: 'Show All', type: 'all' }];
  // Repositories offered in the repo selector and the currently shown one.
  private repositories: string[] = [];
  private repoRoot: string | undefined;
  // Repository chosen in the repo selector (repoRoot is this or one of its worktrees).
  private repositoryRoot: string | undefined;
  // Watcher of the shown repository and the repo it belongs to.
  private watcher: Disposable | undefined;
  private watchedRepoRoot: string | undefined;
  private autoRefreshTimer: NodeJS.Timeout | undefined;
  // Set when the repo changed while the webview was hidden.
  private autoRefreshPending = false;
  // Stashes of the repository (chips on the commit each one was made on).
  private stashes: StashEntry[] = [];
  // Upstream and ahead/behind of the local branches (chip badge "↑2 ↓1").
  private tracking = new Map<string, BranchTracking>();
  // Result of the last own action (or its error) and when it was shown. The repository change
  // the action made triggers an auto-refresh right after; that refresh repeats this message
  // instead of replacing it with "Updated after repository change.".
  private lastNotice?: { message: string; kind: 'info' | 'error'; at: number };
  // OS regional format (e.g. de-DE) for local/relative dates; read once before the first payload.
  private dateLocale = '';
  // Working tree changes and HEAD, for the "Uncommitted Changes" row on top.
  private workingTreeChanges: CommitFileChange[] = [];
  private headHash: string | undefined;
  // Debounced check of the working tree after saves.
  private workingTreeTimer: NodeJS.Timeout | undefined;
  // Worktrees of the shown repository (only filled when there is more than the main one).
  private worktrees: WorktreeState[] = [];
  private worktreePollTimer: NodeJS.Timeout | undefined;
  // Forms open in the webview, by id: how to check the values and whom to hand them to.
  private readonly openForms = new Map<string, OpenForm>();
  private nextFormId = 1;
  // Rebase view open in the webview (at most one).
  private openRebase: OpenRebase | undefined;
  // Merge/cherry-pick/revert/rebase that stopped and waits (banner in the webview).
  private operation: OperationState | undefined;

  constructor(
    private readonly host: GraphHost,
    private readonly gitService: GitService,
  ) {
    // Initial remote-branch filter comes from the settings.
    this.showRemoteBranches = host.config<boolean>('showRemoteBranches', true);
  }

  // Entry point for every webview message; failures end up in the webview's status line.
  receive(message: WebviewMessage): Promise<void> {
    return this.runSafely(() => this.handleMessage(message));
  }

  // Settings changed: re-create the watcher; a new date format redraws the list.
  onConfigurationChanged(change: { dateFormat: boolean }): void {
    this.watchedRepoRoot = undefined;
    void this.updateWatchers(this.repoRoot);
    if (change.dateFormat) {
      void this.runSafely(() => this.handleAutoRefresh('Date format changed.'));
    }
  }

  // The webview became visible again: catch up on changes made while it was hidden.
  onVisible(): void {
    if (this.autoRefreshPending) {
      this.autoRefreshPending = false;
      void this.runSafely(() => this.handleAutoRefresh());
    }
  }

  // The webview was closed: stop watching (a later "ready" starts again).
  onClosed(): void {
    this.disposeWatchers();
    // Nobody can answer open forms any more: they count as cancelled.
    this.openForms.forEach((form) => form.resolve(undefined));
    this.openForms.clear();
    this.openRebase = undefined;
  }

  // Dispatch one webview message to its handler.
  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.reload('init', undefined);
        return;
      case 'refresh':
        await this.reload('commits', 'Refreshed.');
        return;
      case 'updateFilters':
        this.showRemoteBranches = message.payload.showRemoteBranches;
        this.selectedBranch = message.payload.selectedBranch || '__all__';
        this.selectedSortMode = 'date';
        this.loadedCommits = [];
        await this.reload('commits', 'Filters applied.');
        return;
      case 'selectRepo':
        this.gitService.setSelectedRepoRoot(message.payload.repoRoot);
        await this.gitService.setSelectedWorktree(undefined);
        this.selectedBranch = '__all__';
        this.loadedCommits = [];
        await this.reload('commits', 'Repository switched.');
        return;
      case 'loadMore':
        await this.handleLoadMore(message.payload?.cursor);
        return;
      case 'selectCommit':
        await this.handleSelectCommit(message.payload.hash);
        return;
      case 'openDiff':
        await this.handleOpenDiff(message.payload.hash, message.payload.path);
        return;
      case 'openFile':
        await this.handleOpenFile(message.payload.hash, message.payload.path);
        return;
      case 'checkoutBranch':
        await this.handleCheckoutBranch(message.payload.name);
        return;
      case 'checkoutRemoteBranch':
        await this.handleCheckoutRemoteBranch(message.payload.remoteRef);
        return;
      case 'checkoutDetached':
        await this.handleCheckoutDetached(message.payload.target);
        return;
      case 'createBranch':
        await this.handleCreateBranch(message.payload.hash);
        return;
      case 'commitAction':
        await this.handleCommitAction(message.payload.action, message.payload.hash);
        return;
      case 'selectWorktree':
        await this.switchWorktree(message.payload.path);
        return;
      case 'worktreeAction':
        await this.handleWorktreeAction(message.payload.action, message.payload.path);
        return;
      case 'tagAction':
        await this.handleTagAction(message.payload.action, message.payload.name);
        return;
      case 'stashAction':
        await this.handleStashAction(message.payload.action, message.payload.selector, message.payload.hash);
        return;
      case 'branchAction':
        if (message.payload.action === 'delete') {
          await this.handleDeleteBranch(message.payload.name);
        } else {
          await this.handleDeleteRemoteBranch(message.payload.name);
        }
        return;
      case 'tagInfo':
        await this.handleTagInfo(message.payload.requestId, message.payload.name);
        return;
      case 'showInTerminal':
        await this.handleShowInTerminal(message.payload.hash);
        return;
      case 'copyToClipboard':
        await this.host.copy(message.payload.text);
        await this.postStatus(`${message.payload.label} copied to clipboard.`);
        return;
      case 'formSubmit':
        await this.handleFormSubmit(message.payload.id, message.payload.values ?? {});
        return;
      case 'formCancel':
        this.closeForm(message.payload.id, undefined);
        return;
      case 'rebaseSubmit':
        await this.handleRebaseSubmit(message.payload.id, message.payload.steps, message.payload.ignoreDate);
        return;
      case 'rebaseCancel':
        if (this.openRebase?.id === message.payload.id) {
          this.openRebase = undefined;
        }
        return;
      case 'operationAction':
        await this.handleOperationAction(message.payload.action);
        return;
      case 'openConflict': {
        // Only files git reports as conflicted (the path comes from the webview).
        const state = await this.gitService.operationState();
        if (this.repoRoot && state?.conflicts.includes(message.payload.path)) {
          await this.host.openFile(this.repoRoot, message.payload.path, undefined);
        }
        return;
      }
    }
  }

  // --- Context menu actions ---

  private async handleCheckoutBranch(name: string): Promise<void> {
    try {
      await this.gitService.checkoutBranch(name);
    } catch (error) {
      throw this.explainWorktreeConflict(error, name);
    }
    await this.afterAction(`Checked out ${name}.`);
  }

  // git refuses a branch that is checked out in another worktree; say where and what to do.
  private explainWorktreeConflict(error: unknown, branch: string): unknown {
    const message = error instanceof Error ? error.message : '';
    if (!/already (used by worktree|checked out)/i.test(message)) {
      return error;
    }
    const owner = this.worktrees.find((worktree) => worktree.branch === branch);
    return new GitError(
      `${branch} is checked out in worktree ${owner?.name ?? '(another folder)'}. `
        + 'Switch to that worktree instead (Worktree selector or context menu).',
    );
  }

  // Remote branch: use the local branch of the same name, create it (tracking) if missing.
  // When the local branch lags behind the remote branch, a form offers to fast-forward it
  // or to create a branch with another name at the remote branch instead.
  private async handleCheckoutRemoteBranch(remoteRef: string): Promise<void> {
    const localName = localNameForRemote(remoteRef);
    if (!localName) {
      throw new GitError(`${remoteRef} is not a remote branch.`);
    }
    if (!(await this.gitService.localBranchExists(localName))) {
      await this.gitService.checkoutTrackingBranch(localName, remoteRef);
      await this.afterAction(`Created ${localName} tracking ${remoteRef} and checked it out.`);
      return;
    }
    const behind = await this.gitService.countNotIn(remoteRef, localName);
    if (behind === 0) {
      await this.checkoutExistingBranch(localName, `Checked out existing local branch ${localName}.`);
      return;
    }
    const ahead = await this.gitService.countNotIn(localName, remoteRef);
    const values = await this.showForm(this.existingBranchForm(localName, remoteRef, ahead, behind), async (entered) =>
      formText(entered, 'mode') === 'new' ? this.newBranchNameProblem(formText(entered, 'name')) : undefined,
    );
    if (!values) {
      return;
    }
    const mode = formText(values, 'mode');
    if (mode === 'new') {
      const branch = formText(values, 'name').trim();
      await this.gitService.checkoutTrackingBranch(branch, remoteRef);
      await this.afterAction(`Created ${branch} tracking ${remoteRef} and checked it out.`);
    } else if (mode === 'fastForward' && ahead === 0) {
      await this.checkoutExistingBranch(localName, undefined);
      await this.gitService.fastForward(remoteRef);
      await this.afterAction(`Checked out ${localName} and fast-forwarded it to ${remoteRef}.`);
    } else {
      await this.checkoutExistingBranch(localName, `Checked out existing local branch ${localName} (${behind} behind ${remoteRef}).`);
    }
  }

  private existingBranchForm(localName: string, remoteRef: string, ahead: number, behind: number): FormSpec {
    const commits = (count: number): string => `${count} commit${count === 1 ? '' : 's'}`;
    const options = [{ value: 'local', label: `Check out local ${localName} as it is` }];
    if (ahead === 0) {
      options.unshift({ value: 'fastForward', label: `Check out ${localName} and fast-forward it to ${remoteRef}` });
    }
    options.push({ value: 'new', label: `Create a new branch at ${remoteRef}` });
    return {
      title: `A local branch ${localName} already exists.`,
      detail:
        ahead === 0
          ? `It is ${commits(behind)} behind ${remoteRef} (as of the last fetch).`
          : `It has diverged from ${remoteRef} (as of the last fetch): ${commits(ahead)} only local, ${commits(behind)} only on ${remoteRef}. `
            + 'Merge or rebase after the checkout to bring them together.',
      submitLabel: 'Check Out',
      fields: [
        {
          kind: 'select',
          id: 'mode',
          label: 'Action',
          value: options[0].value,
          options,
          info:
            'Fast-forward moves the local branch to the remote branch without a merge commit (git merge --ff-only); '
            + 'nothing is lost because the local branch has no commits of its own.',
        },
        {
          kind: 'text',
          id: 'name',
          label: 'Name',
          required: true,
          placeholder: 'e.g. feature/login',
          showWhen: { field: 'mode', value: 'new' },
          info: `Name of the new local branch; it tracks ${remoteRef}.`,
        },
      ],
    };
  }

  // Checks out an existing local branch; explains a branch checked out in another worktree.
  private async checkoutExistingBranch(name: string, notice: string | undefined): Promise<void> {
    try {
      await this.gitService.checkoutBranch(name);
    } catch (error) {
      throw this.explainWorktreeConflict(error, name);
    }
    if (notice) {
      await this.afterAction(notice);
    }
  }

  // Problem with the name for a new local branch (shown at the field), undefined if it is fine.
  private async newBranchNameProblem(value: string): Promise<FormProblem | undefined> {
    const problem = branchNameProblem(value);
    if (problem) {
      return { field: 'name', message: problem };
    }
    if (!(await this.gitService.isValidBranchName(value.trim()))) {
      return { field: 'name', message: 'Git does not accept this branch name.' };
    }
    if (await this.gitService.localBranchExists(value.trim())) {
      return { field: 'name', message: 'A branch with this name already exists.' };
    }
    return undefined;
  }

  // Detached HEAD is easy to lose work in, so it needs a confirmation.
  private async handleCheckoutDetached(target: string): Promise<void> {
    const label = /^[0-9a-f]{40}$/i.test(target) ? target.slice(0, 8) : target;
    if (this.host.config<boolean>('confirmDetachedCheckout', true)) {
      const values = await this.showForm(
        {
          title: `Check out ${label}? HEAD will be detached (not on a branch).`,
          detail: 'New commits made there belong to no branch until you create one.',
          submitLabel: 'Check Out',
          fields: [
            {
              kind: 'checkbox',
              id: 'always',
              label: 'Always accept',
              info: 'Do not ask again (setting gitLineage.confirmDetachedCheckout).',
            },
          ],
        },
        async () => undefined,
      );
      if (!values) {
        return;
      }
      if (formFlag(values, 'always')) {
        await this.host.updateConfig('confirmDetachedCheckout', false);
      }
    }
    await this.gitService.checkoutDetached(target);
    await this.afterAction(`Checked out ${label} (detached HEAD).`);
  }

  private async handleCreateBranch(hash: string): Promise<void> {
    // One form: name and whether to check the new branch out.
    const values = await this.showForm(
      {
        title: `Create branch at commit ${hash.slice(0, 8)}`,
        submitLabel: 'Create Branch',
        fields: [
          {
            kind: 'text',
            id: 'name',
            label: 'Name',
            required: true,
            placeholder: 'e.g. feature/login',
            info: 'Name of the new local branch; slashes group branches (feature/…). No spaces, "..", "~", "^", ":" or "\\".',
          },
          {
            kind: 'checkbox',
            id: 'checkout',
            label: 'Check out the new branch',
            info: 'Switch to the new branch right away (git switch). Unchecked, the branch is only created and you stay where you are.',
          },
        ],
      },
      async (entered) => this.newBranchNameProblem(formText(entered, 'name')),
    );
    if (!values) {
      return;
    }
    const branch = formText(values, 'name').trim();
    const checkout = formFlag(values, 'checkout');
    await this.gitService.createBranch(branch, hash, checkout);
    await this.afterAction(checkout ? `Created and checked out ${branch}.` : `Created branch ${branch}.`);
  }

  // Repository-changing commit actions; each asks first. The hash must be a full or short hex id.
  private async handleCommitAction(action: CommitAction, hash: string): Promise<void> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
      return;
    }
    const short = hash.slice(0, 8);
    switch (action) {
      case 'addTag':
        await this.handleAddTag(hash);
        return;
      case 'addWorktree':
        await this.handleAddWorktree(hash);
        return;
      case 'cherryPick': {
        const isMerge = (await this.gitService.parentCount(hash)) > 1;
        const values = await this.showForm(
          {
            title: `Cherry-pick commit ${short} onto ${await this.headLabel()}?`,
            detail: isMerge ? 'This is a merge commit; its changes relative to the first parent are applied.' : undefined,
            submitLabel: 'Cherry-Pick',
            fields: [
              {
                kind: 'checkbox',
                id: 'recordOrigin',
                label: 'Record origin',
                info: 'Add "(cherry picked from commit …)" to the commit message (git cherry-pick -x).',
              },
              {
                kind: 'checkbox',
                id: 'noCommit',
                label: 'No commit',
                info: 'Only apply the changes to the index and working tree; you commit yourself (--no-commit).',
              },
            ],
          },
          async () => undefined,
        );
        if (values) {
          const noCommit = formFlag(values, 'noCommit');
          const options = { recordOrigin: formFlag(values, 'recordOrigin'), noCommit };
          await this.runWithConflicts(
            'cherry-pick',
            () => this.gitService.cherryPick(hash, isMerge, options),
            noCommit ? `Applied the changes of ${short} (not committed).` : `Cherry-picked ${short}.`,
          );
        }
        return;
      }
      case 'revert': {
        const isMerge = (await this.gitService.parentCount(hash)) > 1;
        const values = await this.showForm(
          {
            title: `Revert commit ${short}?`,
            detail: `A new commit on ${await this.headLabel()} undoes its changes.`
              + (isMerge ? ' It is a merge commit: reverted relative to its first parent.' : ''),
            submitLabel: 'Revert',
            fields: [],
          },
          async () => undefined,
        );
        if (values) {
          await this.runWithConflicts('revert', () => this.gitService.revert(hash, isMerge), `Reverted ${short}.`);
        }
        return;
      }
      case 'merge': {
        const values = await this.showForm(
          {
            title: `Merge commit ${short} into ${await this.headLabel()}?`,
            submitLabel: 'Merge',
            fields: [
              {
                kind: 'checkbox',
                id: 'noFastForward',
                label: 'Create a merge commit even if fast-forward is possible',
                info: 'Without this, git only moves the branch forward when it has no own commits (fast-forward). Checked, a merge commit always records the merge (--no-ff).',
              },
              {
                kind: 'checkbox',
                id: 'squash',
                label: 'Squash commits',
                info: 'Put all changes into the index as one set, without a merge commit (--squash); you commit yourself.',
              },
              {
                kind: 'checkbox',
                id: 'noCommit',
                label: 'No commit',
                info: 'Merge, but stop before the merge commit (--no-commit).',
              },
            ],
          },
          async () => undefined,
        );
        if (values) {
          const options = {
            noFastForward: formFlag(values, 'noFastForward'),
            squash: formFlag(values, 'squash'),
            noCommit: formFlag(values, 'noCommit'),
          };
          const done = options.squash || options.noCommit ? `Merged ${short} (not committed).` : `Merged ${short}.`;
          await this.runWithConflicts('merge', () => this.gitService.merge(hash, options), done);
        }
        return;
      }
      case 'rebase':
        await this.handleRebase(hash);
        return;
      case 'rebaseInteractive': {
        const branch = await this.gitService.currentBranch();
        if (!branch) {
          throw new GitError('HEAD is detached: check out a branch to rebase it.');
        }
        await this.showRebaseView(branch, hash, false);
        return;
      }
      case 'reset':
        await this.handleReset(hash);
        return;
    }
  }

  // --- Worktrees ---

  // Show another worktree of the repository (all commands then run there).
  private async switchWorktree(folder: string): Promise<void> {
    const target = (await this.gitService.listWorktrees()).find((worktree) => samePath(worktree.path, folder));
    if (!target || target.isBare || target.isPrunable) {
      throw new GitError(`${folder} is not a usable worktree of this repository.`);
    }
    await this.gitService.setSelectedWorktree(target.path);
    this.loadedCommits = [];
    await this.reload('commits', `Switched to worktree ${worktreeName(target.path)}.`);
  }

  private async handleWorktreeAction(action: WorktreeAction, folder: string): Promise<void> {
    // The path comes from the webview: act only on a worktree git lists for this repository.
    const target = (await this.gitService.listWorktrees()).find((worktree) => samePath(worktree.path, folder));
    if (!target) {
      throw new GitError(`${folder} is not a worktree of this repository.`);
    }
    const name = worktreeName(target.path);
    switch (action) {
      case 'switch':
        await this.switchWorktree(target.path);
        return;
      case 'openWindow':
        await this.host.openFolder(target.path);
        return;
      case 'copyPath':
        await this.host.copy(target.path);
        await this.postStatus(`Path of worktree ${name} copied to clipboard.`);
        return;
      case 'remove':
        await this.handleRemoveWorktree(target);
        return;
    }
  }

  private async handleRemoveWorktree(target: WorktreeInfo): Promise<void> {
    const name = worktreeName(target.path);
    if (target.isMain) {
      throw new GitError('The main worktree cannot be removed.');
    }
    // The folder the graph was opened for (e.g. the Claude Code session's worktree) stays.
    if (samePath(target.path, this.repositoryRoot)) {
      throw new GitError(`Worktree ${name} is the folder this graph was opened for; it cannot be removed here.`);
    }
    const changes = await this.gitService.getWorkingTreeChangesAt(target.path).catch(() => [] as CommitFileChange[]);
    const branchText = target.branch ? `Branch ${target.branch} is kept.` : 'Its detached HEAD is left behind.';
    const values = await this.showForm(
      {
        title: `Remove worktree ${name}?`,
        detail: changes.length > 0
          ? `${target.path} - ${changes.length} uncommitted change(s) there are lost. ${branchText}`
          : `${target.path} - the folder is deleted. ${branchText}`,
        submitLabel: changes.length > 0 ? 'Remove and Discard Changes' : 'Remove',
        fields: [],
      },
      async () => undefined,
    );
    if (!values) {
      return;
    }
    await this.gitService.removeWorktree(target.path, changes.length > 0);
    if (samePath(target.path, this.repoRoot)) {
      // The shown worktree is gone: back to the repository itself.
      await this.gitService.setSelectedWorktree(undefined);
      this.loadedCommits = [];
    }
    await this.afterAction(`Removed worktree ${name}.`);
  }

  // New worktree at a commit: one form with branch (empty = detached), folder (empty = next to
  // the repository) and whether to show it right away.
  private async handleAddWorktree(hash: string): Promise<void> {
    const short = hash.slice(0, 8);
    const main = (await this.gitService.listWorktrees()).find((worktree) => worktree.isMain);
    const base = main?.path ?? this.repoRoot;
    if (!base) {
      return;
    }
    // Folder used when the field stays empty: <repo>.worktrees/<branch or short hash>.
    const folderFor = (entered: FormValues): string => {
      const typed = formText(entered, 'folder').trim();
      return typed ? path.resolve(typed) : defaultWorktreePath(base, formText(entered, 'branch').trim() || short);
    };
    const values = await this.showForm(
      {
        title: `Add worktree at commit ${short}`,
        submitLabel: 'Add Worktree',
        fields: [
          {
            kind: 'text',
            id: 'branch',
            label: 'New branch',
            placeholder: 'Empty: detached HEAD',
            info: 'A worktree is a second working folder of this repository with its own checkout. Name a new branch for it, or leave it empty to check out the commit without a branch.',
          },
          {
            kind: 'text',
            id: 'folder',
            label: 'Folder',
            placeholder: `Empty: ${defaultWorktreePath(base, '<branch>')}`,
            info: 'Full path of the new folder; it must not exist yet or be empty. Empty: a folder named after the branch next to the repository.',
          },
          {
            kind: 'checkbox',
            id: 'switch',
            label: 'Show the new worktree',
            value: true,
            info: 'Switch the graph to the new worktree right away (commands then run there).',
          },
        ],
      },
      async (entered) => {
        const branch = formText(entered, 'branch').trim();
        if (branch) {
          const problem = branchNameProblem(branch);
          if (problem) {
            return { field: 'branch', message: problem };
          }
          if (!(await this.gitService.isValidBranchName(branch))) {
            return { field: 'branch', message: 'Git does not accept this branch name.' };
          }
          if (await this.gitService.localBranchExists(branch)) {
            return { field: 'branch', message: 'A branch with this name already exists.' };
          }
        }
        const typed = formText(entered, 'folder').trim();
        if (typed && !path.isAbsolute(typed)) {
          return { field: 'folder', message: 'Please enter a full path.' };
        }
        const folder = folderFor(entered);
        try {
          if (fs.existsSync(folder) && fs.readdirSync(folder).length > 0) {
            return { field: 'folder', message: `${folder} exists and is not empty.` };
          }
        } catch {
          return { field: 'folder', message: `${folder} cannot be used as a folder.` };
        }
        return undefined;
      },
    );
    if (!values) {
      return;
    }
    const branch = formText(values, 'branch').trim() || undefined;
    const folder = folderFor(values);
    await this.gitService.addWorktree(folder, hash, branch);
    if (formFlag(values, 'switch')) {
      await this.gitService.setSelectedWorktree(folder);
      this.loadedCommits = [];
    }
    await this.afterAction(`Added worktree ${worktreeName(folder)}.`);
  }

  // Stash chip actions. The selector must still name the stash the chip showed (numbers shift
  // when stashes are added or dropped); apply/pop can restore the staged state, drop asks first.
  private async handleStashAction(action: 'apply' | 'pop' | 'drop', selector: string, hash: string): Promise<void> {
    const stash = (await this.gitService.getStashes()).find((entry) => entry.selector === selector);
    if (!stash || stash.hash !== hash) {
      throw new GitError(`${selector} has changed in the meantime. Refresh and try again.`);
    }
    if (action === 'drop') {
      const confirmed = await this.showForm(
        {
          title: `Drop ${selector}?`,
          detail: `"${stash.message}" is deleted. This cannot be undone from here.`,
          submitLabel: 'Drop Stash',
          fields: [],
        },
        async () => undefined,
      );
      if (confirmed) {
        await this.gitService.dropStash(selector);
        await this.afterAction(`Dropped ${selector}.`);
      }
      return;
    }
    const pop = action === 'pop';
    const values = await this.showForm(
      {
        title: `${pop ? 'Pop' : 'Apply'} ${selector}?`,
        detail: pop
          ? `"${stash.message}" is applied to the working tree and then removed from the stash list (it stays if there are conflicts).`
          : `"${stash.message}" is applied to the working tree; the stash stays in the list.`,
        submitLabel: pop ? 'Pop Stash' : 'Apply Stash',
        fields: [
          {
            kind: 'checkbox',
            id: 'index',
            label: 'Restore staged changes as staged',
            info: 'Without this, everything comes back as unstaged changes (git stash --index).',
          },
        ],
      },
      async () => undefined,
    );
    if (!values) {
      return;
    }
    try {
      await this.gitService.applyStash(selector, pop, formFlag(values, 'index'));
    } catch (error) {
      // Conflicts: the files are left with markers; say so instead of only the raw git text.
      const conflicts = await this.gitService.conflictedFiles().catch(() => [] as string[]);
      if (conflicts.length > 0) {
        await this.afterAction(
          `${selector} applied with conflicts in ${conflicts.join(', ')}. Resolve them${pop ? '; the stash was kept' : ''}.`,
        );
        return;
      }
      throw error;
    }
    await this.afterAction(pop ? `Popped ${selector}.` : `Applied ${selector}.`);
  }

  // Delete a local branch. Not the checked-out one, not one checked out in another worktree.
  // Not merged: only with an extra confirmation (its commits would only be reachable by hash).
  // Its upstream on the remote is checked live and can be deleted in the same step.
  private async handleDeleteBranch(name: string): Promise<void> {
    if (!name || name.startsWith('-') || !(await this.gitService.isValidBranchName(name))
      || !(await this.gitService.localBranchExists(name))) {
      throw new GitError(`Branch ${name} was not found.`);
    }
    const current = await this.gitService.currentBranch();
    if (name === current) {
      throw new GitError(`${name} is checked out. Check out another branch first.`);
    }
    const owner = this.worktrees.find((worktree) => worktree.branch === name);
    if (owner) {
      throw new GitError(`${name} is checked out in worktree ${owner.name}. Remove or switch that worktree first.`);
    }
    const ref = `refs/heads/${name}`;
    const upstream = await this.gitService.branchUpstream(name);
    // Contained in HEAD: nothing is lost. Only on its upstream: safe as long as the upstream stays
    // (git branch -d accepts that), but not when the upstream is deleted in the same step.
    const mergedHead = await this.gitService.isMergedInto(ref, 'HEAD');
    const mergedUpstream = !!upstream && (await this.gitService.isMergedInto(ref, `refs/remotes/${upstream}`));
    const target = current ?? 'HEAD';
    const fields: FormSpec['fields'] = [];
    const details: string[] = [];
    if (!mergedHead) {
      const count = await this.gitService.countNotIn(ref, 'HEAD');
      const commits = count === 1 ? '1 commit' : `${count} commits`;
      details.push(
        mergedUpstream
          ? `Not merged into ${target}; ${count === 1 ? 'its commit is' : `its ${count} commits are`} still on ${upstream}.`
          : `Not merged into ${target}: ${commits} would only be reachable by hash.`,
      );
      fields.push({
        kind: 'checkbox',
        id: 'force',
        label: `Delete although not merged into ${target}`,
        info: 'Deletes the branch anyway (git branch -D). Its commits stay in the repository for a while and can be found again via the reflog or their hash. Needed when the commits are on no other branch, also when the upstream is deleted too.',
      });
    }
    // Upstream on the remote, checked now (someone may have deleted it already).
    const remotes = await this.gitService.remotes();
    const split = upstream ? splitRemoteRef(upstream, remotes) : undefined;
    let remoteTarget: { remote: string; branch: string } | undefined;
    if (split) {
      const state = await this.gitService.remoteBranchCommit(split.remote, split.branch).then(
        (commit) => (commit ? 'present' : 'absent'),
        () => 'unreachable',
      );
      if (state === 'absent') {
        details.push(`${upstream} no longer exists on ${split.remote}.`);
      } else {
        remoteTarget = split;
        fields.push({
          kind: 'checkbox',
          id: 'remote',
          label: `Also delete ${upstream} on ${split.remote}`,
          info: 'Deletes the branch on the server as well (git push --delete), for everyone who uses it.',
        });
        if (state === 'unreachable') {
          details.push(`${split.remote} could not be reached to check ${upstream}.`);
        }
      }
    }
    const values = await this.showForm(
      {
        title: `Delete branch ${name}?`,
        detail: details.join(' ') || undefined,
        submitLabel: 'Delete Branch',
        fields,
      },
      async (entered) =>
        !mergedHead && !formFlag(entered, 'force')
          && (!mergedUpstream || (!!remoteTarget && formFlag(entered, 'remote')))
          ? { field: 'force', message: `The branch is not merged into ${target}. Confirm to delete it anyway.` }
          : undefined,
    );
    if (!values) {
      return;
    }
    if (remoteTarget && formFlag(values, 'remote')) {
      await this.postStatus(`Deleting ${upstream} on ${remoteTarget.remote}…`);
      await this.gitService.deleteRemoteBranch(remoteTarget.remote, remoteTarget.branch);
    }
    await this.gitService.deleteBranch(name, !mergedHead);
    await this.afterAction(
      remoteTarget && formFlag(values, 'remote') ? `Deleted branch ${name} and ${upstream}.` : `Deleted branch ${name}.`,
    );
  }

  // Delete a branch on its remote ("origin/feature"). If it is already gone there, only the
  // stale local remote-tracking ref is removed.
  private async handleDeleteRemoteBranch(remoteRef: string): Promise<void> {
    const split = splitRemoteRef(remoteRef, await this.gitService.remotes());
    if (!split || remoteRef.startsWith('-') || !(await this.gitService.remoteRefExists(remoteRef))) {
      throw new GitError(`${remoteRef} is not a remote branch.`);
    }
    const state = await this.gitService.remoteBranchCommit(split.remote, split.branch).then(
      (commit) => (commit ? 'present' : 'absent'),
      () => 'unreachable',
    );
    if (state === 'absent') {
      const confirmed = await this.showForm(
        {
          title: `Remove ${remoteRef}?`,
          detail: `The branch no longer exists on ${split.remote}. Only the outdated local reference is removed.`,
          submitLabel: 'Remove Reference',
          fields: [],
        },
        async () => undefined,
      );
      if (confirmed) {
        await this.gitService.deleteRemoteTrackingRef(remoteRef);
        await this.afterAction(`Removed outdated reference ${remoteRef}.`);
      }
      return;
    }
    const local = (await this.gitService.localBranchExists(split.branch)) ? ` Your local branch ${split.branch} stays.` : '';
    const values = await this.showForm(
      {
        title: `Delete ${split.branch} on ${split.remote}?`,
        detail: `Deletes the branch on the server for everyone (git push --delete).${local}`
          + (state === 'unreachable' ? ` ${split.remote} could not be reached to check it first.` : ''),
        submitLabel: 'Delete Remote Branch',
        fields: [],
      },
      async () => undefined,
    );
    if (!values) {
      return;
    }
    await this.postStatus(`Deleting ${split.branch} on ${split.remote}…`);
    await this.gitService.deleteRemoteBranch(split.remote, split.branch);
    await this.afterAction(`Deleted ${remoteRef}.`);
  }

  // Tag named by the webview: checked by git first (no option-like names), then its details.
  private async validTagDetails(name: string): Promise<TagDetails> {
    const details =
      name && !name.startsWith('-') && (await this.gitService.isValidTagName(name))
        ? await this.gitService.tagDetails(name)
        : undefined;
    if (!details) {
      throw new GitError(`Tag ${name} was not found.`);
    }
    return details;
  }

  // Live state of a tag on a remote compared with the local tag. Asked when needed and never
  // cached: someone else may have pushed or deleted the tag in the meantime.
  private async remoteTagState(
    remote: string,
    details: TagDetails,
  ): Promise<{ state: 'same' | 'absent' | 'different' | 'unreachable'; remoteCommit?: string }> {
    try {
      const remoteCommit = await this.gitService.remoteTagCommit(remote, details.name);
      if (!remoteCommit) {
        return { state: 'absent' };
      }
      return remoteCommit === details.commit ? { state: 'same' } : { state: 'different', remoteCommit };
    } catch {
      return { state: 'unreachable' };
    }
  }

  // Info line of a tag's context menu: the local details at once, then the state on the remote
  // in a second message (the network check can take a moment). Failures stay in the menu.
  private async handleTagInfo(requestId: string, name: string): Promise<void> {
    const details = await this.validTagDetails(name).catch(() => undefined);
    if (!details) {
      await this.host.post({ type: 'tagInfo', payload: { requestId, name, missing: true } });
      return;
    }
    const remote = await this.gitService.defaultRemote();
    const local = {
      requestId,
      name,
      annotated: details.annotated,
      tagger: details.tagger,
      date: details.date,
      message: details.message,
      remote,
    };
    await this.host.post({ type: 'tagInfo', payload: { ...local, remoteState: remote ? 'checking' : 'noRemote' } });
    if (!remote) {
      return;
    }
    const { state, remoteCommit } = await this.remoteTagState(remote, details);
    await this.host.post({
      type: 'tagInfo',
      payload: { ...local, remoteState: state, remoteCommit: remoteCommit?.slice(0, 7) },
    });
  }

  // Tag chip actions. The name comes from the webview, so it is checked by git first.
  // Push and delete check the remote again right before they run.
  private async handleTagAction(action: 'push' | 'delete', name: string): Promise<void> {
    const details = await this.validTagDetails(name);
    if (action === 'push') {
      const remote = await this.chooseRemote(`Push tag ${name}`, 'Push');
      if (!remote) {
        return;
      }
      const { state, remoteCommit } = await this.remoteTagState(remote, details);
      if (state === 'same') {
        await this.postStatus(`Tag ${name} is already on ${remote}.`);
        return;
      }
      if (state === 'different') {
        throw new GitError(
          `${remote} already has a tag ${name} on another commit (${remoteCommit!.slice(0, 7)}). Not pushed.`,
        );
      }
      // Absent, or the remote could not be checked: the push itself reports any problem.
      await this.pushTag(remote, name);
      return;
    }
    const remotes = await this.gitService.remotes();
    const fields: FormSpec['fields'] = [];
    let detail: string | undefined;
    if (remotes.length === 1) {
      // One remote: deleting there is offered only if the tag exists there (checked now).
      const [remote] = remotes;
      const { state, remoteCommit } = await this.remoteTagState(remote, details);
      if (state === 'absent') {
        detail = `The tag is not on ${remote}: only the local tag is deleted.`;
      } else {
        fields.push({
          kind: 'checkbox',
          id: 'remote',
          label: `Also delete on ${remote}`,
          info: 'Removes the tag from the remote as well (git push --delete). Copies others already fetched stay in their repositories.',
        });
        detail =
          state === 'same'
            ? `The tag is also on ${remote}.`
            : state === 'different'
              ? `${remote} has this tag on another commit (${remoteCommit!.slice(0, 7)}).`
              : `${remote} could not be reached to check the tag.`;
      }
    } else if (remotes.length > 1) {
      fields.push({
        kind: 'checkbox',
        id: 'remote',
        label: 'Also delete on a remote',
        info: 'Removes the tag from the remote as well (git push --delete). Copies others already fetched stay in their repositories.',
      });
    }
    if (remotes.length > 1) {
      fields.push({
        kind: 'select',
        id: 'remoteName',
        label: 'Remote',
        value: remotes[0],
        options: remotes.map((remote) => ({ value: remote, label: remote })),
        showWhen: { field: 'remote', value: true },
        info: 'Remote the tag is deleted on.',
      });
    }
    const values = await this.showForm(
      { title: `Delete tag ${name}?`, detail, submitLabel: 'Delete Tag', fields },
      async (entered) =>
        formFlag(entered, 'remote') && remotes.length > 1 && !remotes.includes(formText(entered, 'remoteName'))
          ? { field: 'remoteName', message: 'Please choose a remote.' }
          : undefined,
    );
    if (!values) {
      return;
    }
    if (formFlag(values, 'remote') && fields.some((field) => field.id === 'remote')) {
      const remote = remotes.length === 1 ? remotes[0] : formText(values, 'remoteName');
      await this.gitService.deleteRemoteTag(remote, name);
    }
    await this.gitService.deleteTag(name);
    await this.afterAction(`Deleted tag ${name}.`);
  }

  // The only remote, or the one picked in a form; undefined = cancel.
  private async chooseRemote(title: string, submitLabel: string): Promise<string | undefined> {
    const remotes = await this.gitService.remotes();
    if (remotes.length === 0) {
      throw new GitError('This repository has no remote.');
    }
    if (remotes.length === 1) {
      return remotes[0];
    }
    const values = await this.showForm(
      {
        title,
        submitLabel,
        fields: [{ kind: 'select', id: 'remote', label: 'Remote', value: remotes[0], options: remotes.map((remote) => ({ value: remote, label: remote })) }],
      },
      async (entered) => (remotes.includes(formText(entered, 'remote')) ? undefined : { field: 'remote', message: 'Please choose a remote.' }),
    );
    return values ? formText(values, 'remote') : undefined;
  }

  private async pushTag(remote: string, name: string): Promise<void> {
    await this.postStatus(`Pushing tag ${name} to ${remote}…`);
    await this.gitService.pushTag(remote, name);
    await this.afterAction(`Pushed tag ${name} to ${remote}.`);
  }

  // Add tag: one form with name, type (annotated/lightweight), message and "push to remote".
  private async handleAddTag(hash: string): Promise<void> {
    const short = hash.slice(0, 8);
    const remotes = await this.gitService.remotes();
    const spec: FormSpec = {
      title: `Add tag to commit ${short}`,
      submitLabel: 'Add Tag',
      fields: [
        {
          kind: 'text',
          id: 'name',
          label: 'Name',
          required: true,
          placeholder: 'e.g. v1.2.0',
          info: 'Name of the tag, usually a version. No spaces, "..", "~", "^", ":" or "\\".',
        },
        {
          kind: 'select',
          id: 'type',
          label: 'Type',
          value: 'annotated',
          options: [
            { value: 'annotated', label: 'Annotated' },
            { value: 'lightweight', label: 'Lightweight' },
          ],
          info: 'Annotated tags store a message, the tagger and the date. Lightweight tags are only a name for the commit.',
        },
        {
          kind: 'text',
          id: 'message',
          label: 'Message',
          placeholder: 'Optional',
          showWhen: { field: 'type', value: 'annotated' },
          info: 'Without a message the tag name is used as message.',
        },
      ],
    };
    if (remotes.length > 0) {
      spec.fields.push({
        kind: 'checkbox',
        id: 'push',
        label: remotes.length === 1 ? `Push to ${remotes[0]}` : 'Push to remote',
        info: 'Push the new tag to the remote right away (uses your git credentials).',
      });
    }
    if (remotes.length > 1) {
      spec.fields.push({
        kind: 'select',
        id: 'remote',
        label: 'Remote',
        value: remotes[0],
        options: remotes.map((remote) => ({ value: remote, label: remote })),
        showWhen: { field: 'push', value: true },
        info: 'Remote the tag is pushed to.',
      });
    }

    const values = await this.showForm(spec, async (entered) => {
      const name = formText(entered, 'name').trim();
      if (!name) {
        return { field: 'name', message: 'Please enter a name.' };
      }
      if (/\s/.test(name)) {
        return { field: 'name', message: 'Tag names cannot contain spaces.' };
      }
      if (!(await this.gitService.isValidTagName(name))) {
        return { field: 'name', message: 'Git does not accept this tag name.' };
      }
      if (await this.gitService.tagExists(name)) {
        return { field: 'name', message: 'A tag with this name already exists.' };
      }
      if (formFlag(entered, 'push') && remotes.length > 1 && !remotes.includes(formText(entered, 'remote'))) {
        return { field: 'remote', message: 'Please choose a remote.' };
      }
      return undefined;
    });
    if (!values) {
      return;
    }
    const tag = formText(values, 'name').trim();
    const annotated = formText(values, 'type') !== 'lightweight';
    const message = annotated ? formText(values, 'message').trim() || tag : undefined;
    const remote = formFlag(values, 'push') && remotes.length > 0
      ? (remotes.length === 1 ? remotes[0] : formText(values, 'remote'))
      : undefined;
    await this.gitService.createTag(tag, hash, message);
    await this.afterAction(`Added tag ${tag}.`);
    if (remote) {
      // The tag exists locally even if the push fails (the error says why).
      await this.pushTag(remote, tag);
    }
  }

  // Rebase the current branch onto a commit: one form, optionally interactive (in a terminal,
  // the todo list is edited in the user's git editor) and with the author date set to now.
  private async handleRebase(hash: string): Promise<void> {
    const short = hash.slice(0, 8);
    const branch = await this.gitService.currentBranch();
    if (!branch) {
      throw new GitError('HEAD is detached: check out a branch to rebase it.');
    }
    const values = await this.showForm(
      {
        title: `Rebase ${branch} (the current branch) onto commit ${short}?`,
        detail: 'The commits of the branch are rewritten. Do not rebase commits others already have.',
        submitLabel: 'Rebase',
        fields: [
          {
            kind: 'checkbox',
            id: 'interactive',
            label: 'Interactive: choose what happens to each commit',
            info: 'Opens the rebase view: reorder the commits and pick, reword, edit, squash, fixup or drop each one before the rebase starts.',
          },
          {
            kind: 'checkbox',
            id: 'ignoreDate',
            label: 'Ignore date',
            info: 'Set the author date of the rewritten commits to now (git rebase --ignore-date).',
          },
        ],
      },
      async () => undefined,
    );
    if (!values) {
      return;
    }
    const ignoreDate = formFlag(values, 'ignoreDate');
    if (formFlag(values, 'interactive')) {
      await this.showRebaseView(branch, hash, ignoreDate);
      return;
    }
    await this.runWithConflicts('rebase', () => this.gitService.rebase(hash, ignoreDate), `Rebased ${branch} onto ${short}.`);
  }

  // --- Interactive rebase (rebase view in the webview, see src/git/rebase.ts) ---

  private async showRebaseView(branch: string, base: string, ignoreDate: boolean): Promise<void> {
    const running = await this.gitService.operationState();
    if (running) {
      throw new GitError(`A ${running.kind} is in progress: continue or abort it first.`);
    }
    const commits = await this.gitService.rebaseCommits(base, MAX_REBASE_COMMITS);
    if (commits.length === 0) {
      throw new GitError(`${branch} has no commits after ${base.slice(0, 8)}: nothing to rebase.`);
    }
    if (commits.length > MAX_REBASE_COMMITS) {
      throw new GitError(`More than ${MAX_REBASE_COMMITS} commits to rebase: use git rebase -i in a terminal.`);
    }
    const id = `rebase-${this.nextFormId++}`;
    this.openRebase = { id, branch, base, commits };
    await this.host.post({
      type: 'showRebase',
      payload: {
        id,
        branch,
        base: base.slice(0, 8),
        ignoreDate,
        // Newest first, like the graph.
        commits: [...commits].reverse(),
      },
    });
  }

  private async handleRebaseSubmit(
    id: string,
    shown: Array<{ hash: string; action: string; message?: string }>,
    ignoreDate: boolean,
  ): Promise<void> {
    const open = this.openRebase;
    if (!open || open.id !== id) {
      return;
    }
    // The steps come from the webview: exactly the offered commits, each once, known actions.
    const offered = new Set(open.commits.map((commit) => commit.hash));
    const valid = shown.length === offered.size
      && new Set(shown.map((step) => step.hash)).size === shown.length
      && shown.every((step) => offered.has(step.hash) && rebaseActions.includes(step.action as RebaseAction));
    if (!valid) {
      await this.host.post({
        type: 'rebaseError',
        payload: { id, message: 'The list does not match the commits of the branch. Close the view and try again.' },
      });
      return;
    }
    // Shown newest first; git wants the oldest first.
    const steps: RebaseStep[] = [...shown].reverse().map((step) => ({
      hash: step.hash,
      action: step.action as RebaseAction,
      message: step.action === 'reword' ? step.message : undefined,
    }));
    const problem = rebaseStepsProblem(steps);
    if (problem) {
      await this.host.post({ type: 'rebaseError', payload: { id, message: problem } });
      return;
    }
    this.openRebase = undefined;
    await this.host.post({ type: 'rebaseClose', payload: { id } });
    try {
      await this.gitService.interactiveRebase(open.base, steps, ignoreDate);
    } catch (error) {
      // Stopped with conflicts: the banner takes over; anything else is a real error.
      if (!(await this.gitService.operationState())) {
        throw error;
      }
    }
    await this.afterAction(await this.describeRebaseResult(open.branch));
  }

  // Status text after a rebase step: done, stopped for editing or stopped by conflicts.
  private async describeRebaseResult(branch: string): Promise<string> {
    const state = await this.gitService.operationState();
    if (!state) {
      return `Rebased ${branch}.`;
    }
    if (state.conflicts.length > 0) {
      const files = state.conflicts.length === 1 ? '1 file' : `${state.conflicts.length} files`;
      return `Rebase stopped: conflicts in ${files}.`;
    }
    return `Rebase stopped at ${state.stoppedAt ?? 'a commit'} for editing: change it, then Continue.`;
  }

  // Banner buttons: continue, skip or abort the waiting operation.
  private async handleOperationAction(action: 'continue' | 'skip' | 'abort'): Promise<void> {
    const state = await this.gitService.operationState();
    if (!state) {
      await this.reload('commits', 'Nothing is in progress any more.');
      return;
    }
    if (action === 'abort') {
      await this.gitService.abortOperation();
      await this.afterAction(`Aborted the ${state.kind}.`);
      return;
    }
    try {
      if (action === 'skip') {
        await this.gitService.skipOperation();
      } else {
        await this.gitService.continueOperation();
      }
    } catch (error) {
      // Stopped at the next commit with conflicts: the banner shows it. Same place: report why.
      const next = await this.gitService.operationState();
      const moved = next !== undefined && next.conflicts.length > 0
        && (next.step !== state.step || next.stoppedAt !== state.stoppedAt);
      if (!moved) {
        await this.reload('commits', undefined, this.reloadLimit());
        throw error;
      }
    }
    if (state.kind === 'rebase') {
      await this.afterAction(await this.describeRebaseResult(state.branch ?? 'the branch'));
      return;
    }
    const next = await this.gitService.operationState();
    await this.afterAction(next ? `The ${state.kind} stopped again.` : `Finished the ${state.kind}.`);
  }

  // --- Forms (shown in the webview, see forms.ts) ---

  // Show a form; resolves with the values once validate accepts them, undefined on cancel.
  private showForm(spec: FormSpec, validate: OpenForm['validate']): Promise<FormValues | undefined> {
    const id = `form-${this.nextFormId++}`;
    return new Promise((resolve) => {
      this.openForms.set(id, { validate, resolve });
      void this.host.post({ type: 'showForm', payload: { id, ...spec } });
    });
  }

  // Values entered: a problem keeps the form open with a message, otherwise it closes.
  private async handleFormSubmit(id: string, values: FormValues): Promise<void> {
    const form = this.openForms.get(id);
    if (!form) {
      return;
    }
    const problem = await form.validate(values);
    if (problem) {
      await this.host.post({ type: 'formError', payload: { id, ...problem } });
      return;
    }
    await this.host.post({ type: 'formClose', payload: { id } });
    this.closeForm(id, values);
  }

  private closeForm(id: string, values: FormValues | undefined): void {
    const form = this.openForms.get(id);
    this.openForms.delete(id);
    form?.resolve(values);
  }

  // Reset: the mode is chosen in the dialog; hard asks once more because files are lost.
  private async handleReset(hash: string): Promise<void> {
    const short = hash.slice(0, 8);
    const target = await this.headLabel();
    const modes = ['soft', 'mixed', 'hard'] as const;
    const values = await this.showForm(
      {
        title: `Reset ${target} to commit ${short}?`,
        submitLabel: 'Reset',
        fields: [
          {
            kind: 'select',
            id: 'mode',
            label: 'Mode',
            value: 'mixed',
            info: 'Moves the current branch to this commit. Soft keeps your staged changes, Mixed keeps the changed files but unstages them, Hard discards every uncommitted change.',
            options: [
              { value: 'soft', label: 'Soft - keep index and files' },
              { value: 'mixed', label: 'Mixed - keep files, unstage changes' },
              { value: 'hard', label: 'Hard - discard all uncommitted changes' },
            ],
          },
        ],
      },
      async (entered) => (modes.includes(formText(entered, 'mode') as never) ? undefined : { field: 'mode', message: 'Please choose a mode.' }),
    );
    if (!values) {
      return;
    }
    const mode = formText(values, 'mode') as (typeof modes)[number];
    if (mode === 'hard') {
      const sure = await this.showForm(
        {
          title: `Discard all uncommitted changes and reset ${target} to ${short}?`,
          detail: 'Changed and staged files are overwritten. This cannot be undone.',
          submitLabel: 'Reset Hard',
          fields: [],
        },
        async () => undefined,
      );
      if (!sure) {
        return;
      }
    }
    await this.gitService.reset(hash, mode);
    await this.afterAction(`Reset ${target} to ${short} (${mode}).`);
  }

  // Run a merge-like command. If it stops on conflicts, the state is kept (the user resolves it
  // in the editor or terminal) and the message says how to continue or abort.
  private async runWithConflicts(command: string, run: () => Promise<void>, success: string): Promise<void> {
    try {
      await run();
    } catch (error) {
      const conflicts = await this.gitService.conflictedFiles().catch(() => [] as string[]);
      if (conflicts.length === 0) {
        throw error;
      }
      await this.afterAction(`${command} stopped with conflicts.`);
      const files = conflicts.length === 1 ? '1 file' : `${conflicts.length} files`;
      const list = `${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? ', …' : ''}`;
      throw new GitError(
        `${command} stopped: conflicts in ${files} (${list}). `
          + `Resolve them and run "git ${command} --continue", or "git ${command} --abort".`,
      );
    }
    await this.afterAction(success);
  }

  // "branch main" or "detached HEAD" for dialog texts.
  private async headLabel(): Promise<string> {
    const branch = await this.gitService.currentBranch();
    return branch ? `branch ${branch}` : 'detached HEAD';
  }

  // Terminal in the repository with "git show" for the commit (hash is checked to be hex).
  private async handleShowInTerminal(hash: string): Promise<void> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash) || !this.repoRoot) {
      return;
    }
    await this.host.openTerminal(this.repoRoot, `Git Lineage: ${hash.slice(0, 8)}`, `git show --stat ${hash}`);
  }

  // Reload after a git action (watchers would also fire, this is immediate).
  private async afterAction(message: string): Promise<void> {
    this.lastNotice = { message, kind: 'info', at: Date.now() };
    await this.reload('commits', message, this.reloadLimit());
  }

  // Run a handler and report any failure to the webview instead of failing silently.
  private async runSafely(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      const message = error instanceof GitError
        ? error.message
        : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
      this.lastNotice = { message, kind: 'error', at: Date.now() };
      await this.host.post({ type: 'error', payload: { message } });
    }
  }

  // Commits per page from settings, clamped to a reasonable range.
  private pageSize(): number {
    const value = this.host.config<number>('pageSize', 120);
    return Math.min(Math.max(Math.round(value), 20), 1000);
  }

  // Reload keeps roughly the amount of loaded commits.
  private reloadLimit(): number {
    return Math.min(Math.max(this.pageSize(), this.loadedCommits.length), MAX_RELOAD_COMMITS);
  }

  // Fields every list message carries (repo, filters).
  private basePayload(message: string) {
    return {
      message,
      repoRoot: this.repoRoot,
      repositories: this.repositories,
      branches: this.branchOptions,
      selectedBranch: this.selectedBranch,
      showRemoteBranches: this.showRemoteBranches,
      selectedSortMode: this.selectedSortMode,
      // Date column format (short | iso | local | relative), applied in the webview.
      dateFormat: this.host.config<string>('dateFormat', 'short'),
      // OS regional format; the webview itself only knows the host's UI language.
      dateLocale: this.dateLocale,
      // Stopped merge/cherry-pick/revert/rebase (banner with Continue/Skip/Abort), or null.
      operation: this.operation ?? null,
      // Repository of the repo selector (repoRoot may be one of its worktrees).
      repositoryRoot: this.repositoryRoot,
      // Worktree selector; empty when the repository has only its main worktree.
      worktrees: this.worktrees.length > 1
        ? this.worktrees.map((worktree) => ({
            path: worktree.path,
            name: worktree.name,
            branch: worktree.branch,
            isCurrent: worktree.isCurrent,
            isMain: worktree.isMain,
            isPrunable: worktree.isPrunable,
            changeCount: worktree.changes.length,
          }))
        : [],
    };
  }

  // Reload repositories, branches and the first commits, then post them as init/commits.
  private async reload(
    type: 'init' | 'commits',
    message: string | undefined,
    limit = this.pageSize(),
  ): Promise<void> {
    this.dateLocale = await getOsLocale();
    this.repositories = await this.gitService.getRepositories();
    this.repositoryRoot = await this.gitService.getRepositoryRoot();
    this.repoRoot = await this.gitService.getRepoRoot();
    await this.loadBranchOptions(this.repoRoot);
    const commits = this.repoRoot
      ? await this.gitService.getLogChunk(limit, undefined, {
          selectedBranch: this.selectedBranch,
          showRemoteBranches: this.showRemoteBranches,
          sortMode: this.selectedSortMode,
          skip: 0,
        })
      : [];
    this.loadedCommits = commits;
    this.operation = await this.gitService.operationState().catch(() => undefined);
    await this.loadWorkingTreeState();
    const { graphCommits, maxLanes } = buildGraphCommits(this.buildDisplayCommits());
    const text = this.repoRoot
      ? message ?? 'Repository detected.'
      : 'No Git repository detected. Open a folder that contains a Git repository.';

    await this.host.post({
      type,
      payload: {
        ...this.basePayload(text),
        commits: graphCommits,
        nextCursor: commits.length ? commits[commits.length - 1].hash : undefined,
        hasMore: commits.length === limit,
        append: false,
        maxLanes,
      },
    });

    await this.updateWatchers(this.repoRoot);
  }

  // Refresh after a repository change, keeping roughly the amount of loaded commits.
  private async handleAutoRefresh(message?: string): Promise<void> {
    if (!this.host.isOpen()) {
      return;
    }
    if (!this.host.isVisible()) {
      this.autoRefreshPending = true;
      return;
    }
    // Shortly after an own action the change is its own: keep its message (or error) visible.
    const notice =
      !message && this.lastNotice && Date.now() - this.lastNotice.at < NOTICE_KEEP_MS ? this.lastNotice : undefined;
    if (notice?.kind === 'error') {
      await this.reload('commits', undefined, this.reloadLimit());
      await this.host.post({ type: 'error', payload: { message: notice.message } });
      return;
    }
    await this.reload('commits', message ?? notice?.message ?? 'Updated after repository change.', this.reloadLimit());
  }

  private scheduleWorkingTreeCheck(): void {
    if (this.workingTreeTimer) {
      clearTimeout(this.workingTreeTimer);
    }
    this.workingTreeTimer = setTimeout(() => {
      this.workingTreeTimer = undefined;
      void this.runSafely(() => this.refreshWorkingTreeIfChanged());
    }, AUTO_REFRESH_DEBOUNCE_MS);
  }

  // Collapse bursts of file events into one refresh.
  private scheduleAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
    }
    this.autoRefreshTimer = setTimeout(() => {
      this.autoRefreshTimer = undefined;
      void this.runSafely(() => this.handleAutoRefresh());
    }, AUTO_REFRESH_DEBOUNCE_MS);
  }

  // Watch HEAD, refs and index of the shown repository so commits, checkouts and fetches refresh the view.
  private async updateWatchers(repoRoot: string | undefined): Promise<void> {
    const enabled = this.host.config<boolean>('autoRefresh', true);
    const target = enabled ? repoRoot : undefined;
    if (target === this.watchedRepoRoot && (target === undefined || this.watcher)) {
      return;
    }
    this.disposeWatchers();
    this.watchedRepoRoot = target;
    if (!target) {
      return;
    }

    try {
      const { gitDir, commonDir } = await this.gitService.getGitDirectories(target);
      this.watcher = this.host.watchRepository(
        { repoRoot: target, gitDir, commonDir },
        {
          onRepositoryChanged: () => this.scheduleAutoRefresh(),
          onWorkingTreeMaybeChanged: () => this.scheduleWorkingTreeCheck(),
        },
      );
      // Other worktrees (Claude sessions, terminals) change without events here: poll them.
      this.worktreePollTimer = setInterval(() => {
        if (this.worktrees.length > 1) {
          this.scheduleWorkingTreeCheck();
        }
      }, WORKTREE_POLL_MS);
    } catch {
      // Auto refresh is a convenience; manual refresh keeps working without it.
      this.disposeWatchers();
    }
  }

  private disposeWatchers(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (this.worktreePollTimer) {
      clearInterval(this.worktreePollTimer);
      this.worktreePollTimer = undefined;
    }
    this.watchedRepoRoot = undefined;
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = undefined;
    }
    if (this.workingTreeTimer) {
      clearTimeout(this.workingTreeTimer);
      this.workingTreeTimer = undefined;
    }
  }

  // Short status line message in the webview footer.
  private async postStatus(message: string): Promise<void> {
    await this.host.post({ type: 'status', payload: { message } });
  }

  private async handleLoadMore(cursor?: string): Promise<void> {
    const repoRoot = await this.gitService.getRepoRoot();
    if (!repoRoot) {
      this.loadedCommits = [];
    }
    const limit = this.pageSize();
    const newCommits = repoRoot
      ? await this.gitService.getLogChunk(limit, cursor, {
          selectedBranch: this.selectedBranch,
          showRemoteBranches: this.showRemoteBranches,
          sortMode: this.selectedSortMode,
          skip: this.loadedCommits.length,
        })
      : [];

    if (newCommits.length > 0) {
      this.loadedCommits = [...this.loadedCommits, ...newCommits];
    }
    const nextCursor = newCommits.length ? newCommits[newCommits.length - 1].hash : cursor;
    const { graphCommits, maxLanes } = buildGraphCommits(this.buildDisplayCommits());
    const message = newCommits.length ? 'Loaded more commits.' : 'No more commits.';

    await this.host.post({
      type: 'commits',
      payload: {
        ...this.basePayload(message),
        commits: graphCommits,
        nextCursor,
        hasMore: newCommits.length === limit,
        append: false,
        maxLanes,
      },
    });
  }

  private async handleSelectCommit(hash: string): Promise<void> {
    if (hash.startsWith('__virtual__')) {
      await this.host.post({
        type: 'commitDetails',
        payload: {
          message: 'Virtual row selected.',
          details: undefined,
        },
      });
      return;
    }

    if (hash === UNCOMMITTED_HASH || hash.startsWith(OTHER_WORKTREE_PREFIX)) {
      // Changed files of the working tree; Diff compares HEAD with the file on disk.
      const other = hash === UNCOMMITTED_HASH ? undefined : this.worktreeByPath(hash.slice(OTHER_WORKTREE_PREFIX.length));
      const files = hash === UNCOMMITTED_HASH ? this.workingTreeChanges : other?.changes ?? [];
      await this.host.post({
        type: 'commitDetails',
        payload: {
          message: 'Uncommitted changes loaded.',
          details: {
            hash,
            shortHash: '*',
            authorName: '*',
            authorEmail: '',
            authorDate: localIsoNow(),
            subject: other
              ? `Uncommitted Changes in ${other.name} (${files.length})`
              : `Uncommitted Changes (${files.length})`,
            body: other ? other.path : '',
            files,
          },
        },
      });
      return;
    }

    const details = await this.gitService.getCommitDetails(hash);
    const message = details ? 'Commit details loaded.' : 'Commit details not available.';

    await this.host.post({
      type: 'commitDetails',
      payload: {
        message,
        details,
      },
    });
  }

  // Folder a row's files live in, and whether the row is an uncommitted pseudo commit.
  private async folderForHash(hash: string): Promise<{ folder: string | undefined; uncommitted: boolean }> {
    if (hash.startsWith(OTHER_WORKTREE_PREFIX)) {
      return { folder: this.worktreeByPath(hash.slice(OTHER_WORKTREE_PREFIX.length))?.path, uncommitted: true };
    }
    return { folder: await this.gitService.getRepoRoot(), uncommitted: hash === UNCOMMITTED_HASH };
  }

  private async handleOpenDiff(hash: string, filePath: string): Promise<void> {
    const { folder, uncommitted } = await this.folderForHash(hash);
    if (!folder) {
      return;
    }
    // Uncommitted row: left side is that worktree's HEAD, right side the file on disk.
    const ref = uncommitted ? 'HEAD' : hash;
    const title = uncommitted ? `${filePath} (Working Tree)` : `${filePath} (${hash.slice(0, 7)})`;
    await this.host.openDiff(folder, filePath, ref, title);
  }

  private async handleOpenFile(hash: string, filePath: string): Promise<void> {
    const { folder, uncommitted } = await this.folderForHash(hash);
    if (!folder) {
      return;
    }
    // Uncommitted row: open the file as it is on disk.
    await this.host.openFile(folder, filePath, uncommitted ? undefined : hash);
  }

  private async loadBranchOptions(repoRoot: string | undefined): Promise<void> {
    if (!repoRoot) {
      this.branchOptions = [{ value: '__all__', label: 'Show All', type: 'all' }];
      this.selectedBranch = '__all__';
      return;
    }

    const branches = await this.gitService.getBranches(this.showRemoteBranches);
    this.branchOptions = [
      { value: '__all__', label: 'Show All', type: 'all' },
      ...branches.map((branch) => ({
        value: branch.name,
        label: branch.name,
        type: branch.type,
      })),
    ];

    const selectedExists = this.branchOptions.some((option) => option.value === this.selectedBranch);
    if (!selectedExists) {
      this.selectedBranch = '__all__';
    }
  }

  // Rows for the webview: the shown worktree's uncommitted row on top, rows of other worktrees
  // with changes directly above their HEAD, refs marked with the worktree they are checked out in.
  private buildDisplayCommits(): DisplayCommit[] {
    const rows: DisplayCommit[] = [];
    const top = this.buildUncommittedRow();
    if (top) {
      rows.push(top);
    }
    const others = this.worktrees.filter((worktree) => !worktree.isCurrent && worktree.head && worktree.changes.length > 0);
    this.loadedCommits.forEach((commit) => {
      others
        .filter((worktree) => worktree.head === commit.hash)
        .forEach((worktree) => rows.push(this.otherWorktreeRow(worktree, commit)));
      rows.push(this.withTracking(this.withStashRefs(this.withWorktreeRefs(commit))));
    });
    return rows;
  }

  // Local branches get their upstream and ahead/behind counts (shown as a badge on the chip).
  private withTracking(commit: CommitSummary): CommitSummary {
    if (this.tracking.size === 0 || !commit.refs.some((ref) => ref.type === 'local' && this.tracking.has(ref.name))) {
      return commit;
    }
    const refs = commit.refs.map((ref) => {
      const track = ref.type === 'local' ? this.tracking.get(ref.name) : undefined;
      return track
        ? { ...ref, upstream: track.upstream, ahead: track.ahead, behind: track.behind, upstreamGone: track.gone || undefined }
        : ref;
    });
    return { ...commit, refs };
  }

  // Stashes made on this commit as chips (newest first), with message and stash commit.
  private withStashRefs(commit: CommitSummary): CommitSummary {
    const here = this.stashes.filter((stash) => stash.base === commit.hash);
    if (here.length === 0) {
      return commit;
    }
    const refs: Ref[] = [
      ...commit.refs.filter((ref) => ref.type !== 'stash'),
      ...here.map((stash) => ({ name: stash.selector, type: 'stash' as const, message: stash.message, stashHash: stash.hash })),
    ];
    return { ...commit, refs };
  }

  // Copy of the commit whose refs show the worktrees: branches checked out in a worktree get its
  // name (linked worktrees show it on the chip, also the shown one), a detached linked worktree
  // gets its own chip. Only other worktrees carry the path (menu: switch, open, remove).
  private withWorktreeRefs(commit: CommitSummary): CommitSummary {
    const usable = this.worktrees.filter((worktree) => !worktree.isBare && !worktree.isPrunable);
    if (usable.length <= 1) {
      return commit;
    }
    const mark = (worktree: WorktreeState): Partial<Ref> => ({
      worktree: worktree.name,
      worktreePath: worktree.isCurrent ? undefined : worktree.path,
      worktreeIsMain: worktree.isMain || undefined,
    });
    const refs: Ref[] = commit.refs.map((ref) => {
      const owner = ref.type === 'local' ? usable.find((worktree) => worktree.branch === ref.name) : undefined;
      // The shown main worktree needs nothing: its branch is the HEAD branch as without worktrees.
      return owner && !(owner.isCurrent && owner.isMain) ? { ...ref, ...mark(owner) } : ref;
    });
    usable
      .filter((worktree) => worktree.isDetached && worktree.head === commit.hash && !(worktree.isCurrent && worktree.isMain))
      .forEach((worktree) => refs.push({ name: worktree.name, type: 'worktree', ...mark(worktree) }));
    return { ...commit, refs };
  }

  private otherWorktreeRow(worktree: WorktreeState, head: CommitSummary): DisplayCommit {
    return {
      hash: `${OTHER_WORKTREE_PREFIX}${worktree.path}`,
      shortHash: '*',
      parents: [head.hash],
      authorName: '*',
      authorDate: localIsoNow(),
      subject: `Uncommitted Changes in ${worktree.name} (${worktree.changes.length})`,
      refs: [],
      graphPrefix: head.graphPrefix,
      isUncommitted: true,
      worktreePath: worktree.path,
      worktreeName: worktree.name,
    };
  }

  private async loadWorkingTreeState(): Promise<void> {
    if (!this.repoRoot) {
      this.workingTreeChanges = [];
      this.headHash = undefined;
      this.worktrees = [];
      return;
    }
    const [changes, head, list, stashes] = await Promise.all([
      this.gitService.getWorkingTreeChanges(),
      this.gitService.getHeadHash(),
      this.gitService.listWorktrees().catch(() => [] as WorktreeInfo[]),
      this.gitService.getStashes().catch(() => [] as StashEntry[]),
    ]);
    this.stashes = stashes;
    this.tracking = await this.gitService.branchTracking().catch(() => new Map<string, BranchTracking>());
    this.workingTreeChanges = changes;
    this.headHash = head;
    this.worktrees = await this.loadWorktrees(list, changes);
  }

  // Status of every worktree (a few at a time); the shown one reuses its already loaded changes.
  private async loadWorktrees(list: WorktreeInfo[], currentChanges: CommitFileChange[]): Promise<WorktreeState[]> {
    if (list.length <= 1) {
      return list.map((info) => ({ ...info, name: worktreeName(info.path), isCurrent: true, changes: currentChanges }));
    }
    const states: WorktreeState[] = list.map((info) => ({
      ...info,
      name: worktreeName(info.path),
      isCurrent: samePath(info.path, this.repoRoot),
      changes: [],
    }));
    const pending = states.filter((state) => !state.isCurrent && !state.isBare && !state.isPrunable);
    states.filter((state) => state.isCurrent).forEach((state) => {
      state.changes = currentChanges;
    });
    for (let start = 0; start < pending.length; start += WORKTREE_STATUS_CONCURRENCY) {
      await Promise.all(
        pending.slice(start, start + WORKTREE_STATUS_CONCURRENCY).map(async (state) => {
          // A broken or locked worktree just shows no changes.
          state.changes = await this.gitService.getWorkingTreeChangesAt(state.path).catch(() => []);
        }),
      );
    }
    return states;
  }

  private worktreeByPath(folder: string): WorktreeState | undefined {
    return this.worktrees.find((worktree) => samePath(worktree.path, folder));
  }

  // Pseudo commit on top whose parent is HEAD, so the graph draws a line down to HEAD.
  // Only shown when something changed and HEAD is among the loaded commits (not filtered out).
  private buildUncommittedRow(): DisplayCommit | undefined {
    const head = this.headHash ? this.loadedCommits.find((commit) => commit.hash === this.headHash) : undefined;
    if (!head || this.workingTreeChanges.length === 0) {
      return undefined;
    }
    return {
      hash: UNCOMMITTED_HASH,
      shortHash: '*',
      parents: [head.hash],
      authorName: '*',
      authorDate: localIsoNow(),
      subject: `Uncommitted Changes (${this.workingTreeChanges.length})`,
      refs: [],
      // Start in HEAD's column (lane hint for the layout).
      graphPrefix: head.graphPrefix,
      isUncommitted: true,
    };
  }

  // After a file save or a poll: reload only if a worktree's changes, HEAD or branch differ.
  private async refreshWorkingTreeIfChanged(): Promise<void> {
    if (!this.host.isVisible() || !this.repoRoot) {
      return;
    }
    const changesKey = (list: CommitFileChange[]): string => list.map((c) => `${c.status}:${c.path}`).join('|');
    const changes = await this.gitService.getWorkingTreeChanges();
    if (changesKey(changes) !== changesKey(this.workingTreeChanges)) {
      await this.handleAutoRefresh();
      return;
    }
    if (this.worktrees.length <= 1) {
      return;
    }
    const list = await this.gitService.listWorktrees().catch(() => [] as WorktreeInfo[]);
    const fresh = await this.loadWorktrees(list, changes);
    const key = (states: WorktreeState[]): string =>
      states.map((state) => `${state.path}:${state.head}:${state.branch}:${changesKey(state.changes)}`).join('\n');
    if (key(fresh) !== key(this.worktrees)) {
      await this.handleAutoRefresh();
    }
  }
}

// Lane hint from git's --graph prefix: column of the "*".
const laneFromGraphPrefix = (prefix: string | undefined): number => {
  if (!prefix) {
    return 0;
  }
  const starIndex = prefix.indexOf('*');
  if (starIndex < 0) {
    return 0;
  }
  return Math.max(0, Math.floor(starIndex / 2));
};

const activeLanesFromGraphPrefix = (prefix: string | undefined): number[] => {
  if (!prefix) {
    return [];
  }
  const lanes = new Set<number>();
  for (let idx = 0; idx < prefix.length; idx += 1) {
    const char = prefix[idx];
    if (char === '|' || char === '/' || char === '\\' || char === '*' || char === '_') {
      lanes.add(Math.max(0, Math.floor(idx / 2)));
    }
  }
  return [...lanes].sort((a, b) => a - b);
};

// Commits as the webview expects them (lane hints; the webview computes the real layout).
const buildGraphCommits = (displayCommits: DisplayCommit[]) => {
  let maxLaneIndex = 0;
  const graphCommits = displayCommits.map((commit) => {
    const lane = laneFromGraphPrefix(commit.graphPrefix);
    const activeLanes = activeLanesFromGraphPrefix(commit.graphPrefix);
    const normalizedActive = activeLanes.length > 0 ? activeLanes : [lane];
    normalizedActive.forEach((activeLane) => {
      if (activeLane > maxLaneIndex) {
        maxLaneIndex = activeLane;
      }
    });
    if (lane > maxLaneIndex) {
      maxLaneIndex = lane;
    }

    return {
      ...commit,
      lane,
      segments: [] as { fromLane: number; toLane: number }[],
      entrySegments: [] as { fromLane: number; toLane: number }[],
      incomingLanes: normalizedActive,
      outgoingLanes: normalizedActive,
    };
  });

  return { graphCommits, maxLanes: Math.max(1, maxLaneIndex + 1) };
};
