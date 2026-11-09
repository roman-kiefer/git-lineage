import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GitService } from '../src/git/gitService';
import { buildTodo, hasConflictMarkers, rebaseStepsProblem, type RebaseStep } from '../src/git/rebase';

// Interactive rebase from the rebase view, against throwaway repositories:
//   main: base
//   feature: base -- a (a.txt) -- b (b.txt) -- c (a.txt changed) -- d (d.txt)
const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const savedEnv: Record<string, string | undefined> = {};
let repo: string;
let service: GitService;
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...identity } }).trim();
const write = (file: string, text: string): void => fs.writeFileSync(path.join(repo, file), text);
const commit = (message: string, file: string, text: string): void => {
  write(file, text);
  git('add', '.');
  git('commit', '-q', '-m', message);
};
// Subjects of base..HEAD, oldest first.
const subjects = (): string[] => git('log', '--reverse', '--format=%s', 'main..HEAD').split('\n').filter(Boolean);

beforeAll(() => {
  // GitService runs git with the process environment: commits need an identity (CI has none).
  for (const [key, value] of Object.entries(identity)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-rebase-'));
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  commit('base', 'base.txt', 'base\n');
  git('checkout', '-q', '-b', 'feature');
  commit('a', 'a.txt', 'one\n');
  commit('b', 'b.txt', 'b\n');
  commit('c', 'a.txt', 'two\n');
  commit('d', 'd.txt', 'd\n');
  service = new GitService({ locateRepositories: async () => [repo], timeoutMs: () => 30_000 });
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

// Steps (oldest first) for the commits of base..HEAD: action per subject, default pick.
const stepsFor = async (
  actions: Record<string, RebaseStep['action']>,
  messages: Record<string, string> = {},
  order?: string[],
): Promise<RebaseStep[]> => {
  const commits = await service.rebaseCommits('main', 100);
  const bySubject = new Map(commits.map((entry) => [entry.subject, entry]));
  return (order ?? commits.map((entry) => entry.subject)).map((subject) => ({
    hash: bySubject.get(subject)!.hash,
    action: actions[subject] ?? 'pick',
    message: messages[subject],
  }));
};

describe('Rebase view: checks and todo list', () => {
  it('reports impossible lists', () => {
    expect(rebaseStepsProblem([])).toMatch(/no commits/);
    expect(rebaseStepsProblem([{ hash: 'a', action: 'drop' }])).toMatch(/at least one/);
    expect(rebaseStepsProblem([{ hash: 'a', action: 'drop' }, { hash: 'b', action: 'squash' }])).toMatch(/oldest/);
    expect(rebaseStepsProblem([{ hash: 'abcdef12', action: 'reword', message: '  ' }])).toMatch(/abcdef12/);
    expect(rebaseStepsProblem([{ hash: 'a', action: 'pick' }, { hash: 'b', action: 'fixup' }])).toBeUndefined();
  });

  it('reword becomes pick + amend with a message file', () => {
    const todo = buildTodo(
      [{ hash: 'aaa', action: 'reword', message: 'x' }, { hash: 'bbb', action: 'squash' }, { hash: 'ccc', action: 'drop' }],
      (index) => `C:\\tmp\\msg-${index}.txt`,
    );
    expect(todo).toBe("pick aaa\nexec git commit --amend --quiet -F 'C:/tmp/msg-0.txt'\nsquash bbb\ndrop ccc\n");
  });

  it('detects conflict markers', () => {
    expect(hasConflictMarkers('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\n')).toBe(true);
    expect(hasConflictMarkers('a\nb\n')).toBe(false);
  });
});

describe('Interactive rebase in a repository', () => {
  it('offers the commits of the branch (oldest first)', async () => {
    const commits = await service.rebaseCommits('main', 100);
    expect(commits.map((entry) => entry.subject)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reword, squash, fixup and drop in one run, without an editor', async () => {
    await service.interactiveRebase(
      'main',
      await stepsFor({ a: 'reword', b: 'squash', d: 'drop' }, { a: 'A new\n\nwith text' }),
      false,
    );
    expect(await service.operationState()).toBeUndefined();
    // a (new) + b combined, c stays, d is gone.
    expect(subjects()).toEqual(['A new', 'c']);
    expect(git('log', '-1', '--format=%B', 'HEAD~1')).toContain('with text');
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(true);
    expect(fs.existsSync(path.join(repo, 'd.txt'))).toBe(false);
  });

  it('reorder with a conflict: stops, Continue refuses markers, goes on after resolving', async () => {
    // c before a: c changes a.txt, which does not exist yet -> conflict.
    await expect(service.interactiveRebase('main', await stepsFor({}, {}, ['c', 'a', 'b', 'd']), false)).rejects.toThrow();
    const stopped = await service.operationState();
    expect(stopped?.kind).toBe('rebase');
    expect(stopped?.conflicts).toEqual(['a.txt']);
    expect(stopped?.step).toBe(1);
    expect(stopped?.branch).toBe('feature');

    // Markers still in the file? (modify/delete has none, so simulate a file with markers.)
    write('a.txt', '<<<<<<< HEAD\n=======\ntwo\n>>>>>>> c\n');
    await expect(service.continueOperation()).rejects.toThrow(/a\.txt/);

    // Resolved: on to the next stop (a meets the a.txt that already exists).
    write('a.txt', 'two\n');
    await service.continueOperation().catch(() => undefined);
    const next = await service.operationState();
    expect(next?.conflicts).toEqual(['a.txt']);
    // Resolved with new content, so commit a is kept (unchanged content would drop it as empty).
    write('a.txt', 'one\ntwo\n');
    await service.continueOperation();
    expect(await service.operationState()).toBeUndefined();
    expect(subjects()).toEqual(['c', 'a', 'b', 'd']);
  });

  it('edit stops without a conflict; Continue goes on', async () => {
    await service.interactiveRebase('main', await stepsFor({ b: 'edit' }), false);
    const stopped = await service.operationState();
    expect(stopped).toMatchObject({ kind: 'rebase', conflicts: [] });
    await service.continueOperation();
    expect(await service.operationState()).toBeUndefined();
    expect(subjects()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('abort restores the branch', async () => {
    const before = git('rev-parse', 'HEAD');
    await service.interactiveRebase('main', await stepsFor({ b: 'edit' }), false);
    await service.abortOperation();
    expect(await service.operationState()).toBeUndefined();
    expect(git('rev-parse', 'HEAD')).toBe(before);
  });
});
