import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { parseGitLog, parsePorcelainStatus } from './gitParser';
import type { CommitDetails, CommitFileChange, CommitSummary } from './gitTypes';
import { GitError, toGitError } from './gitErrors';
import { parseWorktreeList, samePath, type WorktreeInfo } from './worktrees';
import {
  buildTodo,
  hasConflictMarkers,
  isObjectId,
  readOperationState,
  shellPath,
  type OperationState,
  type RebaseCommit,
  type RebaseStep,
} from './rebase';

export { GitError } from './gitErrors';

type LogOptions = {
  selectedBranch?: string;
  showRemoteBranches?: boolean;
  skip?: number;
  sortMode?: 'default' | 'topo' | 'date' | 'authorDate';
};

type BranchOption = {
  name: string;
  type: 'local' | 'remote';
};

// What the host provides: where the repositories are and how long one git call may take.
// Upstream of a local branch and how far the branch is ahead of / behind it.
export type BranchTracking = { upstream: string; ahead: number; behind: number; gone: boolean };

// One entry of git stash list: "stash@{0}", its commit, the commit it was made on, message, date.
export type StashEntry = {
  selector: string;
  hash: string;
  base: string;
  message: string;
  date: string;
};

// Local facts about one tag (see tagDetails).
export type TagDetails = {
  name: string;
  commit: string;
  annotated: boolean;
  tagger?: string;
  date?: string;
  message?: string;
};

export type GitServiceOptions = {
  // Repositories to offer (VS Code: the workspace's; standalone: the --repo path).
  locateRepositories(): Promise<string[]>;
  // Timeout per git command in milliseconds.
  timeoutMs(): number;
};

export class GitService {
  // Repo chosen in the webview; undefined means "first detected repository".
  private selectedRepoRoot: string | undefined;
  // Worktree chosen in the webview (another worktree of the selected repository) and the
  // repository it was chosen for; ignored once another repository is selected.
  private selectedWorktree: { repository: string; worktree: string } | undefined;

  constructor(private readonly options: GitServiceOptions) {}

  // Remember the repository the user picked in the repo selector.
  setSelectedRepoRoot(repoRoot: string | undefined): void {
    this.selectedRepoRoot = repoRoot;
  }

  // All Git repositories offered by the host, sorted by path.
  async getRepositories(): Promise<string[]> {
    return this.options.locateRepositories();
  }

  // Repository picked in the repo selector: the selected one if it still exists, otherwise the first.
  async getRepositoryRoot(): Promise<string | undefined> {
    const repositories = await this.getRepositories();
    if (this.selectedRepoRoot && repositories.includes(this.selectedRepoRoot)) {
      return this.selectedRepoRoot;
    }
    return repositories[0];
  }

  // Folder all commands run in: the chosen worktree of the repository, otherwise the repository.
  async getRepoRoot(): Promise<string | undefined> {
    const repository = await this.getRepositoryRoot();
    if (repository && this.selectedWorktree && samePath(this.selectedWorktree.repository, repository)) {
      return this.selectedWorktree.worktree;
    }
    return repository;
  }

  // Switch to another worktree of the shown repository (undefined: back to the repository itself).
  // The caller checks that the folder is one of listWorktrees().
  async setSelectedWorktree(worktree: string | undefined): Promise<void> {
    const repository = await this.getRepositoryRoot();
    this.selectedWorktree = repository && worktree && !samePath(repository, worktree)
      ? { repository, worktree }
      : undefined;
  }

  // All worktrees of the shown repository (main worktree first).
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const repository = await this.getRepositoryRoot();
    if (!repository) {
      return [];
    }
    return parseWorktreeList(await this.execGit(['worktree', 'list', '--porcelain'], repository));
  }

  // New worktree at a commit; with a branch name the branch is created there, otherwise detached.
  async addWorktree(folder: string, hash: string, branch: string | undefined): Promise<void> {
    const args = branch
      ? ['worktree', 'add', '-b', branch, folder, hash]
      : ['worktree', 'add', '--detach', folder, hash];
    await this.execGit(args, await this.requireRepoRoot());
  }

  // Remove a worktree; force also discards its uncommitted changes.
  async removeWorktree(folder: string, force: boolean): Promise<void> {
    const repository = await this.getRepositoryRoot();
    if (!repository) {
      throw new GitError('No Git repository is open.');
    }
    await this.execGit(['worktree', 'remove', ...(force ? ['--force'] : []), folder], repository);
  }

  // Git directory (HEAD lives here) and common directory (refs live here; differs in worktrees).
  async getGitDirectories(repoRoot: string): Promise<{ gitDir: string; commonDir: string }> {
    const output = await this.execGit(['rev-parse', '--absolute-git-dir', '--git-common-dir'], repoRoot);
    const [gitDir = '', commonDirRaw = ''] = output.split('\n').map((line) => line.trim());
    // --git-common-dir may be relative to the repository root.
    const commonDir = path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(repoRoot, commonDirRaw);
    return { gitDir, commonDir };
  }

  async getBranches(showRemoteBranches: boolean): Promise<BranchOption[]> {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return [];
    }

    // for-each-ref writes a byte as %1f (git log uses %x1f; that would stay literal here).
    const format = ['%(refname:short)', '%(refname)'].join('%1f');
    const output = await this.execGit(
      ['for-each-ref', '--format', format, 'refs/heads', 'refs/remotes'],
      repoRoot,
    );

    const branches = output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split('\u001f'))
      .filter((parts) => parts.length >= 2)
      .map(([name, fullName]) => {
        const type: 'local' | 'remote' = fullName.startsWith('refs/remotes/') ? 'remote' : 'local';
        return { name, type };
      })
      .filter((branch) => !branch.name.endsWith('/HEAD'))
      .filter((branch) => showRemoteBranches || branch.type === 'local')
      .sort((a, b) => a.name.localeCompare(b.name));

    return branches;
  }

  async getLogChunk(limit = 50, beforeHash?: string, options?: LogOptions): Promise<CommitSummary[]> {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return [];
    }

    const selectedBranch = options?.selectedBranch ?? '__all__';
    const showRemoteBranches = options?.showRemoteBranches ?? true;
    const skip = Math.max(options?.skip ?? 0, 0);
    const sortMode = options?.sortMode ?? 'date';

    const format = '%x1d%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%D%x1e';
    const args = [
      'log',
      `-n`,
      String(limit),
      '--skip',
      String(skip),
      '--graph',
      '--date=iso-strict',
      // Full ref names: only the prefix tells a local "feature/x" from a remote "origin/x".
      '--decorate=full',
      `--pretty=format:${format}`,
    ];
    if (sortMode === 'topo') {
      args.push('--topo-order');
    } else if (sortMode === 'date') {
      args.push('--date-order');
    } else if (sortMode === 'authorDate') {
      args.push('--author-date-order');
    }
    if (beforeHash && skip === 0) {
      args.splice(1, 0, `${beforeHash}^`);
    }

    if (selectedBranch && selectedBranch !== '__all__') {
      args.push(selectedBranch);
    } else if (showRemoteBranches) {
      // Stashes are shown as chips on the commit they were made on (getStashes), not as the
      // two internal commits git keeps for each of them.
      args.push('--exclude=refs/stash', '--all');
    } else {
      const localBranches = (await this.getBranches(false)).map((branch) => branch.name);
      if (localBranches.length > 0) {
        args.push(...localBranches);
      }
    }

    const output = await this.execGit(args, repoRoot);
    return parseGitLog(output);
  }

  async getCommitDetails(hash: string): Promise<CommitDetails | undefined> {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return undefined;
    }

    const format = ['%H', '%h', '%an', '%ae', '%ad', '%s', '%b'].join('%x1f');
    const args = [
      'show',
      '--name-status',
      '--date=iso-strict',
      `--pretty=format:${format}%x1e`,
      hash,
    ];

    const output = await this.execGit(args, repoRoot);
    const [headerPart, filePart = ''] = output.split('\u001e');
    const headerFields = headerPart.split('\u001f');

    if (headerFields.length < 6) {
      return undefined;
    }

    const [fullHash, shortHash, authorName, authorEmail, authorDate, subject, body = ''] =
      headerFields;

    const files = filePart
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [status, ...pathParts] = line.split('\t');
        return {
          status,
          path: pathParts.join('\t'),
        };
      });

    return {
      hash: fullHash,
      shortHash,
      authorName,
      authorEmail,
      authorDate,
      subject,
      body,
      files,
    };
  }

  // Changed files in the working tree and index (staged, unstaged, untracked), for the
  // "Uncommitted Changes" row. Empty when there is no repository or nothing changed.
  async getWorkingTreeChanges(): Promise<CommitFileChange[]> {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return [];
    }
    return this.getWorkingTreeChangesAt(repoRoot);
  }

  // Changed files of one worktree folder (also another worktree than the shown one).
  async getWorkingTreeChangesAt(folder: string): Promise<CommitFileChange[]> {
    const output = await this.execGit(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], folder);
    return parsePorcelainStatus(output);
  }

  // Full hash of HEAD, or undefined (e.g. empty repository without commits).
  async getHeadHash(): Promise<string | undefined> {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return undefined;
    }
    try {
      return (await this.execGit(['rev-parse', '--verify', '--quiet', 'HEAD'], repoRoot)).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  // --- Actions (context menu). All run in the shown repository without a shell. ---

  // Switch to an existing local branch.
  async checkoutBranch(name: string): Promise<void> {
    await this.execGit(['checkout', name, '--'], await this.requireRepoRoot());
  }

  // Detached HEAD at a commit or tag.
  async checkoutDetached(target: string): Promise<void> {
    await this.execGit(['checkout', '--detach', target, '--'], await this.requireRepoRoot());
  }

  // New local branch that tracks the remote branch, checked out.
  async checkoutTrackingBranch(localName: string, remoteRef: string): Promise<void> {
    await this.execGit(['checkout', '-b', localName, '--track', remoteRef, '--'], await this.requireRepoRoot());
  }

  // Moves the checked-out branch forward to ref; fails instead of creating a merge commit.
  async fastForward(ref: string): Promise<void> {
    await this.execGit(['merge', '--ff-only', ref], await this.requireRepoRoot());
  }

  // New branch at a commit; optionally checked out right away.
  async createBranch(name: string, startPoint: string, checkout: boolean): Promise<void> {
    const args = checkout ? ['checkout', '-b', name, startPoint, '--'] : ['branch', name, startPoint];
    await this.execGit(args, await this.requireRepoRoot());
  }

  // Tag at a commit: annotated when a message is given, otherwise lightweight.
  async createTag(name: string, hash: string, message: string | undefined): Promise<void> {
    const args = message ? ['tag', '-a', name, '-m', message, hash] : ['tag', name, hash];
    await this.execGit(args, await this.requireRepoRoot());
  }

  // Upstream of every local branch with ahead/behind counts (local data, as of the last fetch).
  async branchTracking(): Promise<Map<string, BranchTracking>> {
    const format = ['%(refname:short)', '%(upstream:short)', '%(upstream:track,nobracket)'].join('%1f');
    const output = await this.execGit(['for-each-ref', '--format', format, 'refs/heads'], await this.requireRepoRoot());
    const result = new Map<string, BranchTracking>();
    output.split('\n').forEach((line) => {
      const [name, upstream, track = ''] = line.split('\u001f');
      if (!name || !upstream) {
        return;
      }
      // track: "", "ahead 2", "behind 1", "ahead 2, behind 1" or "gone".
      const count = (word: string): number => Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0);
      result.set(name, { upstream, ahead: count('ahead'), behind: count('behind'), gone: track.trim() === 'gone' });
    });
    return result;
  }

  // All stashes, newest first. Empty when there are none.
  async getStashes(): Promise<StashEntry[]> {
    const format = ['%gd', '%H', '%P', '%gs', '%aI'].join('%x1f');
    const output = await this.execGit(['stash', 'list', `--format=${format}`], await this.requireRepoRoot());
    return output
      .split('\n')
      .map((line) => line.split('\u001f'))
      .filter((parts) => parts.length >= 5 && parts[0].startsWith('stash@{'))
      .map(([selector, hash, parents, message, date]) => ({
        selector,
        hash,
        // First parent = the commit HEAD was on when the stash was made.
        base: parents.split(' ')[0] ?? '',
        message,
        date,
      }));
  }

  // Apply a stash to the working tree; pop also removes it when that worked. index: restore
  // what was staged as staged (otherwise everything comes back unstaged).
  async applyStash(selector: string, pop: boolean, index: boolean): Promise<void> {
    const args = ['stash', pop ? 'pop' : 'apply', ...(index ? ['--index'] : []), selector];
    await this.execGit(args, await this.requireRepoRoot());
  }

  async dropStash(selector: string): Promise<void> {
    await this.execGit(['stash', 'drop', selector], await this.requireRepoRoot());
  }

  // Delete a local branch; without force git refuses one that is not merged.
  async deleteBranch(name: string, force: boolean): Promise<void> {
    await this.execGit(['branch', force ? '-D' : '-d', name], await this.requireRepoRoot());
  }

  // Delete a branch on a remote (network); also removes the local remote-tracking ref.
  async deleteRemoteBranch(remote: string, branch: string): Promise<void> {
    await this.execGit(['push', remote, '--delete', `refs/heads/${branch}`], await this.requireRepoRoot());
  }

  // Remove a remote-tracking ref whose branch no longer exists on the remote (no network).
  async deleteRemoteTrackingRef(remoteRef: string): Promise<void> {
    await this.execGit(['branch', '-r', '-d', remoteRef], await this.requireRepoRoot());
  }

  // Upstream of a local branch as "origin/feature", or undefined.
  async branchUpstream(name: string): Promise<string | undefined> {
    const output = await this.execGit(
      ['for-each-ref', '--format', '%(upstream:short)', `refs/heads/${name}`],
      await this.requireRepoRoot(),
    );
    return output.split('\n')[0]?.trim() || undefined;
  }

  // True if every commit of ref is contained in target (target = commit-ish).
  async isMergedInto(ref: string, target: string): Promise<boolean> {
    try {
      await this.execGit(['merge-base', '--is-ancestor', ref, target], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }

  // Number of commits in ref that target does not contain.
  async countNotIn(ref: string, target: string): Promise<number> {
    const output = await this.execGit(['rev-list', '--count', `${target}..${ref}`, '--'], await this.requireRepoRoot());
    return Number(output.trim()) || 0;
  }

  // Commit a branch points to on a remote, asked live (network). undefined = not there;
  // throws when the remote cannot be reached.
  async remoteBranchCommit(remote: string, branch: string): Promise<string | undefined> {
    const output = await this.execGit(['ls-remote', '--', remote, `refs/heads/${branch}`], await this.requireRepoRoot());
    const line = output.split('\n').find((entry) => entry.trim().endsWith(`\trefs/heads/${branch}`));
    return line?.split('\t')[0]?.trim() || undefined;
  }

  // Names of the configured remotes (e.g. ["origin"]).
  async remotes(): Promise<string[]> {
    const output = await this.execGit(['remote'], await this.requireRepoRoot());
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  // Push one tag to a remote (network; uses the user's git credentials, never prompts).
  async pushTag(remote: string, name: string): Promise<void> {
    await this.execGit(['push', remote, `refs/tags/${name}`], await this.requireRepoRoot());
  }

  async deleteTag(name: string): Promise<void> {
    await this.execGit(['tag', '-d', name], await this.requireRepoRoot());
  }

  // Remove a tag on a remote (network).
  async deleteRemoteTag(remote: string, name: string): Promise<void> {
    await this.execGit(['push', remote, '--delete', `refs/tags/${name}`], await this.requireRepoRoot());
  }

  async tagExists(name: string): Promise<boolean> {
    try {
      await this.execGit(['show-ref', '--verify', '--quiet', `refs/tags/${name}`], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }

  // Tag name check by git itself.
  async isValidTagName(name: string): Promise<boolean> {
    try {
      await this.execGit(['check-ref-format', `refs/tags/${name}`], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }

  // Local facts about one tag (no network): the commit it points to and, for annotated tags,
  // tagger, date and the first line of the message. undefined if the tag does not exist.
  async tagDetails(name: string): Promise<TagDetails | undefined> {
    const format = [
      '%(refname)',
      '%(objecttype)',
      '%(objectname)',
      '%(*objectname)',
      '%(taggername)',
      '%(taggerdate:iso-strict)',
      '%(contents:subject)',
    ].join('%1f');
    const output = await this.execGit(['for-each-ref', '--format', format, `refs/tags/${name}`], await this.requireRepoRoot());
    // The pattern also matches "refs/tags/<name>/..." (prefix per path part): keep the exact ref.
    const line = output.split('\n').find((entry) => entry.split('\u001f')[0] === `refs/tags/${name}`);
    if (!line) {
      return undefined;
    }
    const [, type, object, peeled, tagger, date, subject] = line.split('\u001f');
    const annotated = type === 'tag';
    return {
      name,
      // Annotated: the tag object points to the commit (*objectname); lightweight: the commit itself.
      commit: annotated ? peeled : object,
      annotated,
      tagger: annotated && tagger ? tagger : undefined,
      date: annotated && date ? date : undefined,
      message: annotated && subject ? subject : undefined,
    };
  }

  // Remote used for tag checks: "origin" if configured, otherwise the first remote.
  async defaultRemote(): Promise<string | undefined> {
    const remotes = await this.remotes();
    return remotes.includes('origin') ? 'origin' : remotes[0];
  }

  // Commit a tag points to on a remote, asked live (network, one ls-remote for this tag only).
  // undefined = the remote has no such tag; throws when the remote cannot be reached.
  async remoteTagCommit(remote: string, name: string): Promise<string | undefined> {
    const ref = `refs/tags/${name}`;
    // With "<ref>^{}" the remote also lists the commit behind an annotated tag ("peeled").
    const output = await this.execGit(['ls-remote', '--', remote, ref, `${ref}^{}`], await this.requireRepoRoot());
    const entries = new Map(
      output
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length === 2)
        .map(([hash, refName]) => [refName, hash] as const),
    );
    return entries.get(`${ref}^{}`) ?? entries.get(ref);
  }

  // Number of parents (2+ = merge commit; cherry-pick/revert then need a mainline).
  async parentCount(hash: string): Promise<number> {
    const line = (await this.execGit(['rev-list', '--parents', '-n', '1', hash, '--'], await this.requireRepoRoot())).trim();
    return Math.max(0, line.split(/\s+/).length - 1);
  }

  // Apply a commit on top of HEAD; merge commits relative to their first parent.
  // recordOrigin: "(cherry picked from commit …)" in the message (-x); noCommit: only apply the changes.
  async cherryPick(hash: string, isMerge: boolean, options: { recordOrigin?: boolean; noCommit?: boolean } = {}): Promise<void> {
    const args = [
      'cherry-pick',
      ...(isMerge ? ['-m', '1'] : []),
      ...(options.recordOrigin ? ['-x'] : []),
      ...(options.noCommit ? ['--no-commit'] : []),
      hash,
    ];
    await this.execGit(args, await this.requireRepoRoot());
  }

  // New commit that undoes a commit; merge commits relative to their first parent.
  async revert(hash: string, isMerge: boolean): Promise<void> {
    await this.execGit(['revert', '--no-edit', ...(isMerge ? ['-m', '1'] : []), hash], await this.requireRepoRoot());
  }

  // Merge a commit into the current branch. noFastForward: always a merge commit; squash: the
  // changes as one set in the index (no merge commit); noCommit: merge but stop before committing.
  async merge(hash: string, options: { noFastForward?: boolean; squash?: boolean; noCommit?: boolean } = {}): Promise<void> {
    const args = [
      'merge',
      '--no-edit',
      ...(options.squash ? ['--squash'] : options.noFastForward ? ['--no-ff'] : []),
      ...(options.noCommit && !options.squash ? ['--no-commit'] : []),
      hash,
    ];
    await this.execGit(args, await this.requireRepoRoot());
  }

  // Rebase the current branch onto a commit.
  // ignoreDate: author dates of the rewritten commits become the current time.
  async rebase(hash: string, ignoreDate = false): Promise<void> {
    await this.execGit(['rebase', ...(ignoreDate ? ['--ignore-date'] : []), hash], await this.requireRepoRoot());
  }

  // Move the current branch to a commit (soft: keep index and files, mixed: keep files, hard: discard).
  async reset(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    await this.execGit(['reset', `--${mode}`, hash, '--'], await this.requireRepoRoot());
  }

  // Commits an interactive rebase onto base rewrites: base..HEAD without merges (git rebase -i
  // makes the branch linear), oldest first. At most `limit` + 1 are read to detect "too many".
  // Commits are separated by NUL (-z), which a commit message cannot contain; the message is the
  // rest after the third field separator, so separators inside it cannot forge fields. Every hash
  // must be a full object name: these hashes end up in the rebase todo list.
  async rebaseCommits(base: string, limit: number): Promise<RebaseCommit[]> {
    const output = await this.execGit(
      ['log', '-z', '--no-merges', '--topo-order', '--reverse', `--max-count=${limit + 1}`, '--format=%H%x1f%h%x1f%an%x1f%B', `${base}..HEAD`, '--'],
      await this.requireRepoRoot(),
    );
    return output
      .split('\u0000')
      .map((entry) => entry.replace(/^\s+/, ''))
      .filter(Boolean)
      .map((entry) => {
        const [hash, shortHash, authorName, ...rest] = entry.split('\u001f');
        if (!isObjectId(hash)) {
          throw new GitError('Unexpected output of git log: the commits to rebase could not be read.');
        }
        const text = rest.join('\u001f').trim();
        return { hash, shortHash, authorName: authorName ?? '', message: text, subject: text.split('\n')[0] };
      });
  }

  // Interactive rebase with a prepared todo list (steps oldest first): git gets the list from
  // the "sequence editor" (a copy command) and needs no editor for messages (squash keeps the
  // combined message, reword amends with a prepared message file).
  async interactiveRebase(base: string, steps: RebaseStep[], ignoreDate: boolean): Promise<void> {
    const repoRoot = await this.requireRepoRoot();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'git-lineage-rebase-'));
    try {
      const messageFile = (index: number): string => path.join(folder, `message-${index}.txt`);
      steps.forEach((step, index) => {
        if (step.action === 'reword') {
          fs.writeFileSync(messageFile(index), `${(step.message ?? '').trim()}\n`, 'utf8');
        }
      });
      const todo = path.join(folder, 'todo.txt');
      fs.writeFileSync(todo, buildTodo(steps, messageFile), 'utf8');
      await this.execGit(
        ['rebase', '-i', ...(ignoreDate ? ['--ignore-date'] : []), base],
        repoRoot,
        { GIT_SEQUENCE_EDITOR: `cp ${shellPath(todo)}`, GIT_EDITOR: ':' },
      );
    } finally {
      // Message files are still needed while the rebase waits (conflict or "edit" stop).
      if (!(await this.operationState())) {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    }
  }

  // Merge/cherry-pick/revert/rebase that stopped and waits, with its conflicted files.
  async operationState(): Promise<OperationState | undefined> {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return undefined;
    }
    const { gitDir } = await this.getGitDirectories(repoRoot);
    const state = readOperationState(gitDir);
    if (!state) {
      return undefined;
    }
    return { ...state, conflicts: await this.conflictedFiles().catch(() => []) };
  }

  // Continue the waiting operation. Conflicted files without conflict markers count as resolved
  // and are staged first; files that still contain markers stop it with a message.
  async continueOperation(): Promise<void> {
    const repoRoot = await this.requireRepoRoot();
    const state = await this.operationState();
    if (!state) {
      throw new GitError('Nothing to continue: no merge, cherry-pick, revert or rebase is in progress.');
    }
    const unresolved = state.conflicts.filter((file) => {
      try {
        return hasConflictMarkers(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
      } catch {
        // Deleted on one side: resolved by keeping or removing the file, git add handles both.
        return false;
      }
    });
    if (unresolved.length > 0) {
      const list = `${unresolved.slice(0, 3).join(', ')}${unresolved.length > 3 ? ', …' : ''}`;
      throw new GitError(`Conflicts are not resolved yet in ${list}: remove the conflict markers first.`);
    }
    if (state.conflicts.length > 0) {
      await this.execGit(['add', '-A', '--', ...state.conflicts], repoRoot);
    }
    // Keep the prepared or combined message: no editor.
    await this.execGit([state.kind, '--continue'], repoRoot, { GIT_EDITOR: ':' });
  }

  // Skip the current commit (rebase, cherry-pick, revert) or abort the operation.
  async skipOperation(): Promise<void> {
    const state = await this.operationState();
    if (!state || state.kind === 'merge') {
      throw new GitError('Only a rebase, cherry-pick or revert can skip a commit.');
    }
    await this.execGit([state.kind, '--skip'], await this.requireRepoRoot(), { GIT_EDITOR: ':' });
  }

  async abortOperation(): Promise<void> {
    const state = await this.operationState();
    if (!state) {
      throw new GitError('Nothing to abort.');
    }
    await this.execGit([state.kind, '--abort'], await this.requireRepoRoot());
  }

  // Files with unresolved conflicts (after a merge, cherry-pick, revert or rebase stopped).
  async conflictedFiles(): Promise<string[]> {
    const output = await this.execGit(['diff', '--name-only', '--diff-filter=U'], await this.requireRepoRoot());
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  // Name of the checked-out branch, or undefined when HEAD is detached.
  async currentBranch(): Promise<string | undefined> {
    try {
      return (await this.execGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], await this.requireRepoRoot())).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  // Remote-tracking ref such as "origin/feature" known locally (as of the last fetch).
  async remoteRefExists(remoteRef: string): Promise<boolean> {
    try {
      await this.execGit(['show-ref', '--verify', '--quiet', `refs/remotes/${remoteRef}`], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }

  async localBranchExists(name: string): Promise<boolean> {
    try {
      await this.execGit(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }

  // Full name check by git itself (rules for "..", "~", "^", ":", ".lock", ...).
  async isValidBranchName(name: string): Promise<boolean> {
    try {
      await this.execGit(['check-ref-format', '--branch', name], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }

  private async requireRepoRoot(): Promise<string> {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      throw new GitError('No Git repository is open.');
    }
    return repoRoot;
  }

  // Content of a file (path relative to repoRoot, forward slashes) at a commit; empty when
  // the file does not exist there (added or deleted in the compared commit, or a root commit).
  async fileAtRef(repoRoot: string, ref: string, filePath: string): Promise<string> {
    if (ref.startsWith('-')) {
      throw new GitError(`Invalid ref: ${ref}`);
    }
    try {
      return await this.execGit(['show', `${ref}:${filePath}`], repoRoot);
    } catch {
      return '';
    }
  }

  // Run git with a timeout; failures are mapped to a readable GitError.
  private execGit(args: string[], cwd: string, extraEnv: Record<string, string> = {}): Promise<string> {
    const timeoutMs = this.getTimeoutMs();
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          cwd,
          maxBuffer: 50 * 1024 * 1024,
          encoding: 'utf8',
          timeout: timeoutMs,
          // Nobody can answer a password prompt here (no terminal): fail at once instead of
          // waiting for the timeout. Credential helpers (e.g. Git Credential Manager) still work.
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extraEnv },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(toGitError(error, stderr, args, timeoutMs));
            return;
          }
          resolve(stdout);
        },
      );
    });
  }

  // Timeout from the host, with a sane lower bound of 5 seconds.
  private getTimeoutMs(): number {
    return Math.max(5000, this.options.timeoutMs());
  }

  // Top-level folder of the repository containing dir (also for a worktree), or undefined.
  static async findRepoRoot(dir: string, timeoutMs = 30_000): Promise<string | undefined> {
    return new Promise((resolve) => {
      execFile(
        'git',
        ['rev-parse', '--show-toplevel'],
        { cwd: dir, encoding: 'utf8', timeout: timeoutMs },
        (error, stdout) => resolve(error ? undefined : path.resolve(stdout.trim())),
      );
    });
  }
}
