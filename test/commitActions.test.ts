import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphController, splitRemoteRef } from '../src/core/graphController';
import type { ConfirmOptions, GraphHost, PromptOptions } from '../src/core/graphHost';
import { GitService } from '../src/git/gitService';
import { FormAnswerer } from './helpers/formAnswers';

// Commit actions of the context menu (tag, cherry-pick, revert, merge, rebase, reset) against a
// throwaway repository:
//   main:    base -- m1        (file.txt = "main")
//   feature: base -- f1        (file.txt = "feature", conflicts with m1)
//            base -- other     (branch "other": adds other.txt, no conflict)
let repo: string;
const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const savedEnv: Record<string, string | undefined> = {};
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...identity } }).trim();
const write = (file: string, text: string): void => fs.writeFileSync(path.join(repo, file), text);

beforeAll(() => {
  // The controller runs git with the process environment: commits need an identity (CI has none).
  for (const [key, value] of Object.entries(identity)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-actions-'));
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  write('file.txt', 'base\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  write('file.txt', 'feature\n');
  git('commit', '-q', '-am', 'f1');
  git('checkout', '-q', '-b', 'other', 'main');
  write('other.txt', 'other\n');
  git('add', '.');
  git('commit', '-q', '-m', 'other');
  git('checkout', '-q', 'main');
  write('file.txt', 'main\n');
  git('commit', '-q', '-am', 'm1');
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

type Posted = { type: string; payload?: Record<string, unknown> };

// Host that answers the dialogs from a script and records what it was asked.
class ScriptedHost implements GraphHost {
  posted: Posted[] = [];
  confirms: ConfirmOptions[] = [];
  confirmAnswers: Array<string | undefined> = [];
  promptAnswers: Array<string | undefined> = [];
  forms = new FormAnswerer();
  async post(message: unknown): Promise<void> {
    this.posted.push(message as Posted);
    this.forms.observe(message as Posted);
  }
  config<T>(_key: string, fallback: T): T {
    return fallback;
  }
  async updateConfig(): Promise<void> {}
  isOpen(): boolean {
    return true;
  }
  isVisible(): boolean {
    return true;
  }
  async confirm(options: ConfirmOptions): Promise<string | undefined> {
    this.confirms.push(options);
    return this.confirmAnswers.shift();
  }
  // One scripted answer per prompt; invalid answers count as cancel.
  async prompt(options: PromptOptions): Promise<string | undefined> {
    const value = this.promptAnswers.shift();
    if (value === undefined) {
      return undefined;
    }
    return (await options.validate(value)) ? undefined : value;
  }
  async copy(): Promise<void> {}
  async openDiff(): Promise<void> {}
  async openFile(): Promise<void> {}
  folders: string[] = [];
  async openFolder(folder: string): Promise<void> {
    this.folders.push(folder);
  }
  terminals: string[] = [];
  async openTerminal(_cwd: string, _name: string, command: string): Promise<void> {
    this.terminals.push(command);
  }
  // Callbacks of the repository watcher, to simulate a change on disk.
  repositoryChanged?: () => void;
  watchRepository(_target: unknown, callbacks: { onRepositoryChanged: () => void }) {
    this.repositoryChanged = callbacks.onRepositoryChanged;
    return { dispose: () => undefined };
  }
  last(type: string): Posted | undefined {
    return [...this.posted].reverse().find((message) => message.type === type);
  }
}

const setup = () => {
  const host = new ScriptedHost();
  const controller = new GraphController(
    host,
    new GitService({ locateRepositories: async () => [repo], timeoutMs: () => 30_000 }),
  );
  host.forms.controller = controller;
  const act = (action: string, hash: string) =>
    controller.receive({ type: 'commitAction', payload: { action, hash } } as never);
  const tagAct = (action: 'push' | 'delete', name: string) =>
    controller.receive({ type: 'tagAction', payload: { action, name } });
  return { host, act, tagAct, controller };
};

describe('Commit actions of the context menu', () => {
  it('tag: lightweight without message, annotated with message, existing name refused', async () => {
    const { host, act } = setup();
    const base = git('rev-parse', 'main~1');
    host.forms.answers = [{ name: 'v1', type: 'lightweight' }];
    await act('addTag', base);
    expect(git('cat-file', '-t', 'v1')).toBe('commit');
    // One form: name, type, message (only for annotated); no remote, so no push option.
    expect((host.forms.lastForm()!.fields as Array<{ id: string }>).map((field) => field.id)).toEqual(['name', 'type', 'message']);

    host.forms.answers = [{ name: 'v2', type: 'annotated', message: 'Release 2' }];
    await act('addTag', base);
    expect(git('cat-file', '-t', 'v2')).toBe('tag');
    expect(git('tag', '-l', '--format=%(contents:subject)', 'v2')).toBe('Release 2');

    // Annotated without a message: the name is the message.
    host.forms.answers = [{ name: 'v3', type: 'annotated', message: '' }];
    await act('addTag', base);
    expect(git('tag', '-l', '--format=%(contents:subject)', 'v3')).toBe('v3');

    // Existing name: the form reports it at the field and stays open (then cancelled).
    host.forms.answers = [{ name: 'v1', type: 'annotated' }];
    await act('addTag', git('rev-parse', 'main'));
    expect(host.forms.errors.at(-1)).toBe('A tag with this name already exists.');
    expect(git('rev-parse', 'v1^{commit}')).toBe(base);
  });

  it('reset: cancel changes nothing; hard needs a second confirmation', async () => {
    const { host, act } = setup();
    const before = git('rev-parse', 'main');
    const base = git('rev-parse', 'main~1');
    host.forms.answers = [undefined];
    await act('reset', base);
    expect(git('rev-parse', 'main')).toBe(before);

    // Hard chosen, second question declined: nothing happens.
    host.forms.answers = [{ mode: 'hard' }, undefined];
    await act('reset', base);
    expect(git('rev-parse', 'main')).toBe(before);
    expect(host.forms.lastForm()!.submitLabel).toBe('Reset Hard');

    // Soft: branch moves, the change of m1 stays staged; then back with a hard reset.
    host.forms.answers = [{ mode: 'soft' }];
    await act('reset', base);
    expect(git('rev-parse', 'main')).toBe(base);
    expect(git('diff', '--cached', '--name-only')).toBe('file.txt');
    host.forms.answers = [{ mode: 'hard' }, {}];
    await act('reset', before);
    expect(git('rev-parse', 'main')).toBe(before);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('cherry-pick with a conflict: the state stays, the message names the file and --continue/--abort', async () => {
    const { host, act } = setup();
    host.forms.answers = [{ recordOrigin: false, noCommit: false }];
    await act('cherryPick', git('rev-parse', 'feature'));
    const message = host.last('error')!.payload!.message as string;
    expect(message).toContain('conflicts in 1 file (file.txt)');
    expect(message).toContain('git cherry-pick --abort');
    // The cherry-pick is still in progress for the user to resolve.
    expect(fs.existsSync(path.join(repo, '.git', 'CHERRY_PICK_HEAD'))).toBe(true);
    git('cherry-pick', '--abort');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('merge without conflict with a merge commit, then revert of the merge', async () => {
    const { host, act } = setup();
    host.forms.answers = [{ noFastForward: true, squash: false, noCommit: false }];
    await act('merge', git('rev-parse', 'other'));
    expect(git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3);
    expect(fs.existsSync(path.join(repo, 'other.txt'))).toBe(true);

    // Reverting a merge commit uses the first parent as mainline.
    host.forms.answers = [{}];
    await act('revert', git('rev-parse', 'HEAD'));
    expect(host.forms.lastForm()!.detail).toContain('merge commit');
    expect(fs.existsSync(path.join(repo, 'other.txt'))).toBe(false);
    expect(git('log', '-1', '--format=%s')).toMatch(/^Revert/);
  });

  it('push and delete a tag (remote = local bare repository)', async () => {
    const { host, act, tagAct } = setup();
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-remote-'));
    try {
      execFileSync('git', ['init', '-q', '--bare', remote]);
      git('remote', 'add', 'origin', remote);
      const remoteTags = () => execFileSync('git', ['tag', '--list'], { cwd: remote, encoding: 'utf8' }).trim();

      // New tag with "Add and Push": exists locally and on the remote.
      host.forms.answers = [{ name: 'rel-1', type: 'lightweight', push: true }];
      await act('addTag', git('rev-parse', 'main'));
      // One remote: the checkbox names it, no remote selection.
      const fields = host.forms.lastForm()!.fields as Array<{ id: string; label: string }>;
      expect(fields.find((field) => field.id === 'push')!.label).toBe('Push to origin');
      expect(fields.some((field) => field.id === 'remote')).toBe(false);
      expect(remoteTags()).toBe('rel-1');
      expect(host.last('commits')!.payload!.message).toBe('Pushed tag rel-1 to origin.');

      // Existing tag pushed from its chip (only one remote: no question).
      git('tag', 'rel-2', 'main');
      await tagAct('push', 'rel-2');
      expect(remoteTags().split(/\s+/)).toEqual(['rel-1', 'rel-2']);

      // Delete locally only, then locally and on the remote.
      host.forms.answers = [{ remote: false }];
      await tagAct('delete', 'rel-2');
      expect(git('tag', '--list', 'rel-2')).toBe('');
      expect(remoteTags()).toContain('rel-2');
      host.forms.answers = [{ remote: true }];
      await tagAct('delete', 'rel-1');
      expect(git('tag', '--list', 'rel-1')).toBe('');
      expect(remoteTags()).toBe('rel-2');

      // Unknown or option-like names are rejected before git sees them as arguments.
      await tagAct('push', '--force');
      expect(host.last('error')!.payload!.message).toBe('Tag --force was not found.');
    } finally {
      git('remote', 'remove', 'origin');
      fs.rmSync(remote, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  it('tag info and remote check: live when opened and again before push/delete', async () => {
    const { host, tagAct, controller } = setup();
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-remote-'));
    const remoteGit = (...args: string[]) => execFileSync('git', args, { cwd: remote, encoding: 'utf8' }).trim();
    // All "tagInfo" answers of one request, in order.
    const infos = (requestId: string) =>
      host.posted
        .filter((message) => message.type === 'tagInfo' && message.payload!.requestId === requestId)
        .map((message) => message.payload!);
    try {
      execFileSync('git', ['init', '-q', '--bare', remote]);
      git('remote', 'add', 'origin', remote);
      git('tag', '-a', 'info-1', '-m', 'Release info', 'main');
      git('tag', 'info-2', 'main');
      git('push', '-q', 'origin', 'info-1');

      // Annotated and on origin: details first ("checking"), then the live state.
      await controller.receive({ type: 'tagInfo', payload: { requestId: 'r1', name: 'info-1' } });
      const [first, second] = infos('r1');
      expect(first).toMatchObject({ annotated: true, tagger: 't', message: 'Release info', remote: 'origin', remoteState: 'checking' });
      expect(second.remoteState).toBe('same');

      // Lightweight and only local.
      await controller.receive({ type: 'tagInfo', payload: { requestId: 'r2', name: 'info-2' } });
      expect(infos('r2').at(-1)).toMatchObject({ annotated: false, remoteState: 'absent' });

      // Someone else moved the tag on origin: reported with the other commit; push refuses.
      const other = git('rev-parse', 'main~1');
      remoteGit('tag', '-f', 'info-1', other);
      await controller.receive({ type: 'tagInfo', payload: { requestId: 'r3', name: 'info-1' } });
      expect(infos('r3').at(-1)).toMatchObject({ remoteState: 'different', remoteCommit: other.slice(0, 7) });
      await tagAct('push', 'info-1');
      expect(host.last('error')!.payload!.message).toContain('another commit');

      // Already there: no push, just a note.
      remoteGit('tag', '-d', 'info-1');
      git('push', '-q', 'origin', 'info-1');
      await tagAct('push', 'info-1');
      expect(host.last('status')!.payload!.message).toBe('Tag info-1 is already on origin.');

      // Delete of a tag that is only local: no "also delete on origin" choice.
      host.forms.answers = [{}];
      await tagAct('delete', 'info-2');
      expect(host.forms.lastForm()!.fields).toEqual([]);
      expect(host.forms.lastForm()!.detail).toContain('not on origin');
      expect(git('tag', '--list', 'info-2')).toBe('');

      // Remote unreachable: the menu says so instead of failing.
      git('remote', 'set-url', 'origin', path.join(remote, 'missing'));
      await controller.receive({ type: 'tagInfo', payload: { requestId: 'r4', name: 'info-1' } });
      expect(infos('r4').at(-1)!.remoteState).toBe('unreachable');

      // Unknown tag.
      await controller.receive({ type: 'tagInfo', payload: { requestId: 'r5', name: '--all' } });
      expect(infos('r5')).toEqual([{ requestId: 'r5', name: '--all', missing: true }]);
    } finally {
      git('remote', 'remove', 'origin');
      git('tag', '-d', 'info-1');
      fs.rmSync(remote, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  it('delete branch: merged at once, unmerged only with confirmation, upstream optionally too', async () => {
    const { host, controller } = setup();
    const branchAct = (action: 'delete' | 'deleteRemote', name: string) =>
      controller.receive({ type: 'branchAction', payload: { action, name } });
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-remote-'));
    const remoteBranches = () =>
      execFileSync('git', ['branch', '--list', '--format=%(refname:short)'], { cwd: remote, encoding: 'utf8' }).trim();
    const fieldIds = () => (host.forms.lastForm()!.fields as Array<{ id: string }>).map((field) => field.id);
    try {
      execFileSync('git', ['init', '-q', '--bare', remote]);
      git('remote', 'add', 'origin', remote);
      git('branch', 'del-merged', 'main~1');
      git('checkout', '-q', '-b', 'del-open', 'main');
      write('open.txt', 'open\n');
      git('add', '.');
      git('commit', '-q', '-m', 'open work');
      git('push', '-q', '-u', 'origin', 'del-open');
      git('checkout', '-q', 'main');

      // The checked-out branch and option-like names are refused.
      await branchAct('delete', 'main');
      expect(host.last('error')!.payload!.message).toContain('is checked out');
      await branchAct('delete', '--all');
      expect(host.last('error')!.payload!.message).toBe('Branch --all was not found.');

      // Merged, no upstream: a plain confirmation.
      host.forms.answers = [{}];
      await branchAct('delete', 'del-merged');
      expect(fieldIds()).toEqual([]);
      expect(git('branch', '--list', 'del-merged')).toBe('');
      expect(host.last('commits')!.payload!.message).toBe('Deleted branch del-merged.');

      // Not merged, upstream on origin: needs the extra checkbox; then local and remote are gone.
      host.forms.answers = [{ remote: true }, { force: true, remote: true }];
      await branchAct('delete', 'del-open');
      expect(fieldIds()).toEqual(['force', 'remote']);
      expect(host.forms.lastForm()!.detail).toContain('Not merged into main; its commit is still on origin/del-open.');
      expect(host.forms.errors.at(-1)).toContain('not merged');
      expect(git('branch', '--list', 'del-open')).toBe('');
      expect(remoteBranches()).toBe('');
      expect(host.last('commits')!.payload!.message).toBe('Deleted branch del-open and origin/del-open.');

      // Remote branch chip: deleted on the server; an already deleted one only drops the stale ref.
      git('push', '-q', 'origin', 'main:gone-soon', 'main:feature-x');
      git('fetch', '-q', 'origin');
      host.forms.answers = [{}];
      await branchAct('deleteRemote', 'origin/feature-x');
      expect(remoteBranches()).toBe('gone-soon');
      execFileSync('git', ['branch', '-D', 'gone-soon'], { cwd: remote });
      host.forms.answers = [{}];
      await branchAct('deleteRemote', 'origin/gone-soon');
      expect(host.forms.lastForm()!.submitLabel).toBe('Remove Reference');
      expect(git('branch', '-r', '--list', 'origin/gone-soon')).toBe('');
    } finally {
      git('remote', 'remove', 'origin');
      fs.rmSync(remote, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  it('checkout of a remote branch when the local branch exists: direct, fast-forward, diverged, new name', async () => {
    const { host, controller } = setup();
    const checkoutRemote = (name: string) => controller.receive({ type: 'checkoutRemoteBranch', payload: { remoteRef: name } });
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-remote-'));
    const formCount = () => host.forms.forms.length;
    const optionValues = () =>
      ((host.forms.lastForm()!.fields as Array<{ id: string; options?: Array<{ value: string }> }>)[0].options ?? []).map(
        (option) => option.value,
      );
    try {
      execFileSync('git', ['init', '-q', '--bare', remote]);
      git('remote', 'add', 'origin', remote);
      // co-x: local at main~1, origin/co-x at main (local is 1 behind).
      git('branch', 'co-x', 'main~1');
      git('push', '-q', 'origin', 'main:co-x');
      git('fetch', '-q', 'origin');

      // Same state as the remote branch: checked out without a form.
      git('push', '-q', 'origin', 'main~1:refs/heads/co-same');
      git('fetch', '-q', 'origin');
      git('branch', 'co-same', 'main~1');
      let shown = formCount();
      await checkoutRemote('origin/co-same');
      expect(formCount()).toBe(shown);
      expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('co-same');
      git('checkout', '-q', 'main');

      // Behind: the form offers fast-forward first; cancel changes nothing.
      host.forms.answers = [undefined];
      await checkoutRemote('origin/co-x');
      expect(host.forms.lastForm()!.detail).toBe('It is 1 commit behind origin/co-x (as of the last fetch).');
      expect(optionValues()).toEqual(['fastForward', 'local', 'new']);
      expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

      host.forms.answers = [{ mode: 'fastForward' }];
      await checkoutRemote('origin/co-x');
      expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('co-x');
      expect(git('rev-parse', 'co-x')).toBe(git('rev-parse', 'origin/co-x'));
      expect(host.last('commits')!.payload!.message).toBe('Checked out co-x and fast-forwarded it to origin/co-x.');

      // Diverged: no fast-forward offered; a new name is checked like any branch name.
      write('local.txt', 'local\n');
      git('add', '.');
      git('commit', '-q', '-m', 'local only');
      git('checkout', '-q', 'main');
      git('checkout', '-q', '-b', 'co-remote', 'main~1');
      write('remote.txt', 'remote\n');
      git('add', '.');
      git('commit', '-q', '-m', 'remote only');
      git('checkout', '-q', 'main');
      git('push', '-q', 'origin', 'co-remote:co-x', '--force');
      git('branch', '-D', 'co-remote');
      git('fetch', '-q', 'origin');
      shown = formCount();
      host.forms.answers = [{ mode: 'new', name: 'co-x' }, { mode: 'new', name: 'co-y' }];
      await checkoutRemote('origin/co-x');
      expect(formCount()).toBe(shown + 1);
      expect(host.forms.lastForm()!.detail).toContain('2 commits only local, 1 commit only on origin/co-x');
      expect(optionValues()).toEqual(['local', 'new']);
      expect(host.forms.errors.at(-1)).toBe('A branch with this name already exists.');
      expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('co-y');
      expect(git('rev-parse', 'co-y')).toBe(git('rev-parse', 'origin/co-x'));
      expect(git('rev-parse', '--abbrev-ref', 'co-y@{upstream}')).toBe('origin/co-x');

      host.forms.answers = [{ mode: 'local' }];
      await checkoutRemote('origin/co-x');
      expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('co-x');
      expect(host.last('commits')!.payload!.message).toBe('Checked out existing local branch co-x (1 behind origin/co-x).');
    } finally {
      git('checkout', '-q', 'main');
      for (const branch of ['co-x', 'co-y', 'co-same']) {
        if (git('branch', '--list', branch)) {
          git('branch', '-D', branch);
        }
      }
      git('remote', 'remove', 'origin');
      fs.rmSync(remote, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  it('stashes: chip on the base commit instead of own rows; apply, pop, drop', async () => {
    const { host, controller } = setup();
    const stashAct = (action: 'apply' | 'pop' | 'drop', selector: string, hash: string) =>
      controller.receive({ type: 'stashAction', payload: { action, selector, hash } });
    const head = git('rev-parse', 'HEAD');
    try {
      write('file.txt', 'stashed one\n');
      git('stash', 'push', '-q', '-m', 'first idea');
      write('file.txt', 'stashed two\n');
      git('stash', 'push', '-q', '-m', 'second idea');
      await controller.receive({ type: 'refresh' } as never);
      type Row = { hash: string; subject: string; refs: Array<{ name: string; type: string; message?: string; stashHash?: string }> };
      const rows = host.last('commits')!.payload!.commits as Row[];
      // No rows for the internal stash commits; both stashes as chips on HEAD, newest first.
      expect(rows.some((row) => /idea|^index on/.test(row.subject))).toBe(false);
      const chips = rows.find((row) => row.hash === head)!.refs.filter((ref) => ref.type === 'stash');
      expect(chips.map((chip) => [chip.name, chip.message])).toEqual([
        ['stash@{0}', 'On main: second idea'],
        ['stash@{1}', 'On main: first idea'],
      ]);

      // A chip whose stash moved on (stale number) is refused.
      await stashAct('drop', 'stash@{0}', chips[1].stashHash!);
      expect(host.last('error')!.payload!.message).toContain('has changed');

      // Apply keeps the stash, pop removes it, drop asks and deletes.
      host.forms.answers = [{ index: false }];
      await stashAct('apply', 'stash@{1}', chips[1].stashHash!);
      expect(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8')).toBe('stashed one\n');
      expect(git('stash', 'list').split('\n')).toHaveLength(2);
      git('checkout', '--', 'file.txt');
      host.forms.answers = [{ index: false }];
      await stashAct('pop', 'stash@{0}', chips[0].stashHash!);
      expect(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8')).toBe('stashed two\n');
      expect(git('stash', 'list')).toBe('stash@{0}: On main: first idea');
      git('checkout', '--', 'file.txt');
      host.forms.answers = [{}];
      await stashAct('drop', 'stash@{0}', chips[1].stashHash!);
      expect(git('stash', 'list')).toBe('');
      expect(host.last('commits')!.payload!.message).toBe('Dropped stash@{0}.');
    } finally {
      git('checkout', '--', 'file.txt');
      git('stash', 'clear');
    }
  });

  it('ahead/behind: local branches carry their upstream and distance (as of the last fetch)', async () => {
    const { host, controller } = setup();
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-remote-'));
    type Row = { refs: Array<{ name: string; type: string; upstream?: string; ahead?: number; behind?: number; upstreamGone?: boolean }> };
    const refOf = (name: string) =>
      (host.last('commits')!.payload!.commits as Row[]).flatMap((row) => row.refs).find((ref) => ref.type === 'local' && ref.name === name);
    try {
      execFileSync('git', ['init', '-q', '--bare', remote]);
      git('remote', 'add', 'origin', remote);
      // track-x: 1 commit behind origin (pushed from a temporary branch), then 2 own commits.
      git('branch', 'track-x', 'main~1');
      git('push', '-q', '-u', 'origin', 'track-x');
      git('push', '-q', 'origin', 'main:track-x');
      git('fetch', '-q', 'origin');
      git('checkout', '-q', 'track-x');
      git('commit', '-q', '--allow-empty', '-m', 'own 1');
      git('commit', '-q', '--allow-empty', '-m', 'own 2');
      git('checkout', '-q', 'main');
      // track-gone: its upstream was deleted on the remote.
      git('branch', 'track-gone', 'main');
      git('push', '-q', '-u', 'origin', 'track-gone');
      git('push', '-q', 'origin', '--delete', 'track-gone');
      await controller.receive({ type: 'refresh' } as never);
      expect(refOf('track-x')).toMatchObject({ upstream: 'origin/track-x', ahead: 2, behind: 1 });
      expect(refOf('track-gone')).toMatchObject({ upstream: 'origin/track-gone', upstreamGone: true });
      expect(refOf('main')?.upstream).toBeUndefined();
    } finally {
      git('branch', '-D', 'track-x', 'track-gone');
      git('remote', 'remove', 'origin');
      fs.rmSync(remote, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  it('splitRemoteRef: longest matching remote name', () => {
    expect(splitRemoteRef('origin/feature/x', ['origin', 'up'])).toEqual({ remote: 'origin', branch: 'feature/x' });
    expect(splitRemoteRef('team/a/main', ['team', 'team/a'])).toEqual({ remote: 'team/a', branch: 'main' });
    expect(splitRemoteRef('other/x', ['origin'])).toBeUndefined();
  });

  it('an auto-refresh right after an action keeps its message (and error)', async () => {
    const { host, tagAct } = setup();
    await host.forms.controller!.receive({ type: 'refresh' } as never);
    // Report a change and wait until the auto-refresh (debounced) has posted, plus what follows it.
    const changed = async (lastType: 'commits' | 'error') => {
      const before = host.posted.length;
      host.repositoryChanged!();
      for (let waited = 0; waited < 5000; waited += 50) {
        const fresh = host.posted.slice(before);
        if (fresh.some((message) => message.type === 'commits') && fresh.at(-1)!.type === lastType) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    // Own action, then the watcher reports the change it made.
    git('tag', 'keep-1', 'main');
    host.forms.answers = [{}];
    await tagAct('delete', 'keep-1');
    expect(host.last('commits')!.payload!.message).toBe('Deleted tag keep-1.');
    await changed('commits');
    expect(host.last('commits')!.payload!.message).toBe('Deleted tag keep-1.');
    // Error, then a change: the error is shown again after the refresh.
    await tagAct('push', 'missing-tag');
    await changed('error');
    expect(host.posted.at(-1)).toEqual({ type: 'error', payload: { message: 'Tag missing-tag was not found.' } });
  });

  it('interactive rebase: the view shows the commits, a foreign list is refused, reword changes the message', async () => {
    const { host, act, controller } = setup();
    const base = git('rev-parse', 'main~1');
    await act('rebaseInteractive', base);
    const shown = host.last('showRebase')!.payload!;
    const commits = shown.commits as Array<{ hash: string; subject: string }>;
    expect(commits.map((entry) => entry.subject)).toEqual([git('log', '-1', '--format=%s')]);
    expect(shown.branch).toBe('main');
    const id = shown.id as string;

    // A hash the view was not offered: refused, the view stays open.
    await controller.receive({
      type: 'rebaseSubmit',
      payload: { id, steps: [{ hash: base, action: 'pick' }], ignoreDate: false },
    });
    expect(host.last('rebaseError')!.payload!.message).toContain('does not match');

    await controller.receive({
      type: 'rebaseSubmit',
      payload: { id, steps: [{ hash: commits[0].hash, action: 'reword', message: 'reworded' }], ignoreDate: false },
    });
    expect(host.last('rebaseClose')!.payload!.id).toBe(id);
    expect(git('log', '-1', '--format=%s')).toBe('reworded');
    expect(git('rev-parse', 'HEAD~1')).toBe(base);
    expect(host.last('commits')!.payload!.operation).toBeNull();
  });

  it('rebase form: interactive opens the view (with --ignore-date); cherry-pick with -x without commit', async () => {
    const { host, act, controller } = setup();
    const base = git('rev-parse', 'main~1');
    host.forms.answers = [{ interactive: true, ignoreDate: true }];
    await act('rebase', base);
    const shown = host.last('showRebase')!.payload!;
    expect(shown.ignoreDate).toBe(true);
    expect(host.terminals).toEqual([]);
    await controller.receive({ type: 'rebaseCancel', payload: { id: shown.id as string } });

    // Cherry-pick "other" (no conflict) without committing: changes staged, HEAD unchanged.
    const head = git('rev-parse', 'HEAD');
    host.forms.answers = [{ recordOrigin: true, noCommit: true }];
    await act('cherryPick', git('rev-parse', 'other'));
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('diff', '--cached', '--name-only')).toBe('other.txt');
    git('reset', '-q', '--hard', 'HEAD');
  });

  it('banner: rebase with a conflict reports state and files; abort restores the branch', async () => {
    const { host, act, controller } = setup();
    git('checkout', '-q', 'feature');
    const before = git('rev-parse', 'HEAD');
    host.forms.answers = [{ interactive: false, ignoreDate: false }];
    await act('rebase', git('rev-parse', 'main'));
    const operation = host.last('commits')!.payload!.operation as Record<string, unknown>;
    expect(operation).toMatchObject({ kind: 'rebase', branch: 'feature', conflicts: ['file.txt'] });

    // Continue with the conflict markers still in the file: refused with the file name.
    await controller.receive({ type: 'operationAction', payload: { action: 'continue' } });
    expect(host.last('error')!.payload!.message).toContain('file.txt');

    await controller.receive({ type: 'operationAction', payload: { action: 'abort' } });
    expect(host.last('commits')!.payload!.operation).toBeNull();
    expect(git('rev-parse', 'HEAD')).toBe(before);
    git('checkout', '-q', 'main');
  });

  it('rebase needs a branch (not with a detached HEAD)', async () => {
    const { host, act } = setup();
    git('checkout', '-q', '--detach', 'main');
    await act('rebase', git('rev-parse', 'other'));
    expect(host.last('error')!.payload!.message).toContain('HEAD is detached');
    git('checkout', '-q', 'main');
  });
});
