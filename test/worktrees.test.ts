import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphController } from '../src/core/graphController';
import type { ConfirmOptions, GraphHost, PromptOptions } from '../src/core/graphHost';
import { GitService } from '../src/git/gitService';
import { defaultWorktreePath, parseWorktreeList, samePath } from '../src/git/worktrees';
import { FormAnswerer } from './helpers/formAnswers';

describe('git worktree list --porcelain', () => {
  it('reads path, HEAD, branch and states; the first entry is the main worktree', () => {
    const raw = [
      'worktree C:/repo', 'HEAD aaa', 'branch refs/heads/main', '',
      'worktree C:/wt/feature', 'HEAD bbb', 'branch refs/heads/feature/x', 'locked', '',
      'worktree C:/wt/probe', 'HEAD ccc', 'detached', 'prunable gitdir file points to non-existent location', '',
    ].join('\n');
    const list = parseWorktreeList(raw);
    expect(list.map((entry) => [entry.isMain, entry.head, entry.branch, entry.isDetached, entry.isLocked, entry.isPrunable])).toEqual([
      [true, 'aaa', 'main', false, false, false],
      [false, 'bbb', 'feature/x', false, true, false],
      [false, 'ccc', undefined, true, false, true],
    ]);
    expect(samePath(list[1].path, path.resolve('C:/wt/feature'))).toBe(true);
  });

  it('suggested folder for a new worktree: next to the repository in <repo>.worktrees', () => {
    expect(defaultWorktreePath(path.resolve('/src/app'), 'feature/x y')).toBe(path.resolve('/src/app.worktrees/feature-x-y'));
  });
});

// Repository with three worktrees:
//   main      (main worktree, branch main)
//   wt-feat   (branch feat, one uncommitted file)
//   wt-probe  (detached at main~1, clean)
let root: string;
let main: string;
let feat: string;
let probe: string;
const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...identity } }).trim();

beforeAll(() => {
  // realpath: git reports resolved folders (no 8.3 short names).
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-wt-')));
  main = path.join(root, 'main');
  feat = path.join(root, 'wt-feat');
  probe = path.join(root, 'wt-probe');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'first');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'second');
  git(main, 'worktree', 'add', '-q', '-b', 'feat', feat, 'HEAD');
  git(feat, 'commit', '-q', '--allow-empty', '-m', 'feat work');
  fs.writeFileSync(path.join(feat, 'todo.txt'), 'x');
  git(main, 'worktree', 'add', '-q', '--detach', probe, 'HEAD~1');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

type Posted = { type: string; payload?: Record<string, unknown> };
type Row = { hash: string; subject: string; parents: string[]; isUncommitted?: boolean; refs: Array<Record<string, unknown>> };

class ScriptedHost implements GraphHost {
  posted: Posted[] = [];
  confirmAnswers: Array<string | undefined> = [];
  promptAnswers: Array<string | undefined> = [];
  prompts: PromptOptions[] = [];
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
  async confirm(_options: ConfirmOptions): Promise<string | undefined> {
    return this.confirmAnswers.shift();
  }
  async prompt(options: PromptOptions): Promise<string | undefined> {
    this.prompts.push(options);
    const value = this.promptAnswers.shift();
    if (value === undefined) {
      return undefined;
    }
    return (await options.validate(value)) ? undefined : value;
  }
  async copy(): Promise<void> {}
  async openDiff(): Promise<void> {}
  async openFile(): Promise<void> {}
  async openTerminal(): Promise<void> {}
  async openFolder(): Promise<void> {}
  watchRepository() {
    return { dispose: () => undefined };
  }
  last(type: string): Posted | undefined {
    return [...this.posted].reverse().find((message) => message.type === type);
  }
  rows(): Row[] {
    return (this.last('commits') ?? this.last('init'))!.payload!.commits as Row[];
  }
}

const setup = (repo = main) => {
  const host = new ScriptedHost();
  const controller = new GraphController(host, new GitService({ locateRepositories: async () => [repo], timeoutMs: () => 30_000 }));
  host.forms.controller = controller;
  return { host, controller };
};

describe('Worktrees in the graph', () => {
  it('the changes row of another worktree sits right above its HEAD; chips show the worktree', async () => {
    const { host, controller } = setup();
    await controller.receive({ type: 'ready' });
    const rows = host.rows();
    const featHead = git(feat, 'rev-parse', 'HEAD');
    const index = rows.findIndex((row) => row.hash === `__uncommitted__:${feat}`);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(rows[index]).toMatchObject({ subject: 'Uncommitted Changes in wt-feat (1)', parents: [featHead], isUncommitted: true });
    expect(rows[index + 1].hash).toBe(featHead);
    // Branch feat carries its worktree, the detached probe worktree has its own chip.
    expect(rows[index + 1].refs).toContainEqual(expect.objectContaining({ name: 'feat', type: 'local', worktree: 'wt-feat' }));
    const probeHead = rows.find((row) => row.hash === git(probe, 'rev-parse', 'HEAD'))!;
    expect(probeHead.refs).toContainEqual(expect.objectContaining({ name: 'wt-probe', type: 'worktree' }));

    const worktrees = host.last('init')!.payload!.worktrees as Array<{ name: string; isCurrent: boolean; changeCount: number }>;
    expect(worktrees.map((entry) => [entry.name, entry.isCurrent, entry.changeCount])).toEqual([
      ['main', true, 0],
      ['wt-feat', false, 1],
      ['wt-probe', false, 0],
    ]);

    // Details of the other worktree's row list its files.
    await controller.receive({ type: 'selectCommit', payload: { hash: `__uncommitted__:${feat}` } });
    const details = host.last('commitDetails')!.payload!.details as { files: Array<{ path: string }> };
    expect(details.files.map((file) => file.path)).toEqual(['todo.txt']);
  });

  it('switching worktrees: commands run there; checking out a branch checked out there is explained', async () => {
    const { host, controller } = setup();
    await controller.receive({ type: 'ready' });
    await controller.receive({ type: 'selectWorktree', payload: { path: feat } });
    expect(samePath(host.last('commits')!.payload!.repoRoot as string, feat)).toBe(true);
    // The feat worktree's own changes are now the row on top.
    expect(host.rows()[0]).toMatchObject({ hash: '__uncommitted__', subject: 'Uncommitted Changes (1)' });
    // The shown linked worktree keeps its name on the chip (no path: no worktree menu for itself),
    // main is marked as main worktree with its path for the menu.
    const refs = host.rows().flatMap((row) => row.refs);
    const feature = refs.find((ref) => ref.name === 'feat' && ref.type === 'local')!;
    expect(feature).toMatchObject({ worktree: 'wt-feat' });
    expect(feature.worktreePath).toBeUndefined();
    expect(refs.find((ref) => ref.name === 'main' && ref.type === 'local')).toMatchObject({ worktree: 'main', worktreeIsMain: true });

    await controller.receive({ type: 'checkoutBranch', payload: { name: 'main' } });
    expect(host.last('error')!.payload!.message).toBe(
      'main is checked out in worktree main. Switch to that worktree instead (Worktree selector or context menu).',
    );

    await controller.receive({ type: 'selectWorktree', payload: { path: path.join(root, 'does-not-exist') } });
    expect(host.last('error')!.payload!.message).toContain('is not a usable worktree');
  });

  it('add and remove worktrees; the main worktree and the own folder stay', async () => {
    const { host, controller } = setup();
    await controller.receive({ type: 'ready' });
    const added = path.join(root, 'wt-new');
    host.forms.answers = [{ branch: 'fresh', folder: added, switch: false }];
    await controller.receive({ type: 'commitAction', payload: { action: 'addWorktree', hash: git(main, 'rev-parse', 'HEAD') } });
    expect(git(added, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('fresh');

    // Empty folder: next to the repository in <repo>.worktrees/<branch>; shown right away.
    host.forms.answers = [{ branch: 'neu2', folder: '', switch: true }];
    await controller.receive({ type: 'commitAction', payload: { action: 'addWorktree', hash: git(main, 'rev-parse', 'HEAD') } });
    const suggested = path.join(root, 'main.worktrees', 'neu2');
    expect(git(suggested, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('neu2');
    expect(samePath(host.last('commits')!.payload!.repoRoot as string, suggested)).toBe(true);
    host.forms.answers = [{}];
    await controller.receive({ type: 'worktreeAction', payload: { action: 'remove', path: suggested } });
    expect(fs.existsSync(suggested)).toBe(false);

    host.forms.answers = [{}];
    await controller.receive({ type: 'worktreeAction', payload: { action: 'remove', path: added } });
    expect(fs.existsSync(added)).toBe(false);
    expect(git(main, 'branch', '--list', 'fresh')).toContain('fresh');

    await controller.receive({ type: 'worktreeAction', payload: { action: 'remove', path: main } });
    expect(host.last('error')!.payload!.message).toBe('The main worktree cannot be removed.');

    // Opened for wt-probe (like a Claude Code session in its worktree): that folder stays.
    const other = setup(probe);
    await other.controller.receive({ type: 'ready' });
    await other.controller.receive({ type: 'worktreeAction', payload: { action: 'remove', path: probe } });
    expect(other.host.last('error')!.payload!.message).toContain('the folder this graph was opened for');
  });
});
