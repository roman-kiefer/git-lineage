import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitService } from '../src/git/gitService';

// Branch selector of the toolbar: the branches offered and the log of one branch.
//   main: base -- m1;  feature: base -- f1
let repo: string;
const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...identity } }).trim();

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-branches-'));
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  git('commit', '-q', '--allow-empty', '-m', 'f1');
  git('checkout', '-q', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'm1');
  // A remote-tracking branch without a remote server: just the ref.
  git('update-ref', 'refs/remotes/origin/feature', 'feature');
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('Branch selector', () => {
  const service = () => new GitService({ locateRepositories: async () => [repo], timeoutMs: () => 30_000 });

  it('offers local and (if wanted) remote branches', async () => {
    expect(await service().getBranches(true)).toEqual([
      { name: 'feature', type: 'local' },
      { name: 'main', type: 'local' },
      { name: 'origin/feature', type: 'remote' },
    ]);
    expect((await service().getBranches(false)).map((branch) => branch.name)).toEqual(['feature', 'main']);
  });

  it('shows only the commits of the chosen branch', async () => {
    const commits = await service().getLogChunk(50, undefined, { selectedBranch: 'feature' });
    expect(commits.map((commit) => commit.subject)).toEqual(['f1', 'base']);
  });

  it('shows remote refs on the commits only while remotes are shown', async () => {
    const refsOfF1 = async (showRemoteBranches: boolean) =>
      (await service().getLogChunk(50, undefined, { showRemoteBranches }))
        .find((commit) => commit.subject === 'f1')
        ?.refs.map((ref) => `${ref.type}:${ref.name}`);
    expect(await refsOfF1(true)).toEqual(expect.arrayContaining(['local:feature', 'remote:origin/feature']));
    expect(await refsOfF1(false)).toEqual(['local:feature']);
  });

  it('forks: remotes besides origin, their branches left out on request', async () => {
    git('remote', 'add', 'origin', 'https://example.invalid/main.git');
    git('remote', 'add', 'colleague', 'https://example.invalid/fork.git');
    git('update-ref', 'refs/remotes/colleague/feature', 'feature');
    git('update-ref', 'refs/remotes/colleague/only-fork', 'main~1');
    try {
      expect(await service().forkRemotes()).toEqual(['colleague']);
      expect((await service().getBranches(true, ['colleague'])).map((branch) => branch.name))
        .toEqual(['feature', 'main', 'origin/feature']);
      const commits = await service().getLogChunk(50, undefined, { showRemoteBranches: true, hiddenRemotes: ['colleague'] });
      const refNames = commits.flatMap((commit) => commit.refs.map((ref) => ref.name));
      expect(refNames).toContain('origin/feature');
      expect(refNames.filter((name) => name.startsWith('colleague/'))).toEqual([]);
    } finally {
      git('update-ref', '-d', 'refs/remotes/colleague/feature');
      git('update-ref', '-d', 'refs/remotes/colleague/only-fork');
      git('remote', 'remove', 'colleague');
      git('remote', 'remove', 'origin');
    }
  });

  it('other refs (e.g. refs/codex/snapshots/...): left out unless asked for', async () => {
    const snapshot = git('commit-tree', '-m', 'snapshot', '-p', 'main', 'main^{tree}');
    git('update-ref', 'refs/codex/snapshots/abc', snapshot);
    try {
      expect(await service().countOtherRefs()).toBe(1);
      const subjects = async (showOtherRefs: boolean) =>
        (await service().getLogChunk(50, undefined, { showOtherRefs })).map((commit) => commit.subject);
      expect(await subjects(false)).not.toContain('snapshot');
      const withOthers = await service().getLogChunk(50, undefined, { showOtherRefs: true });
      const row = withOthers.find((commit) => commit.subject === 'snapshot');
      expect(row?.refs).toEqual([{ name: 'codex/snapshots/abc', type: 'other' }]);
      // HEAD and the branches keep their decorations.
      expect(withOthers.flatMap((commit) => commit.refs.map((ref) => ref.name))).toEqual(expect.arrayContaining(['HEAD', 'main', 'feature']));
      // Remotes hidden: other refs still on request.
      expect((await service().getLogChunk(50, undefined, { showRemoteBranches: false, showOtherRefs: true })).map((commit) => commit.subject)).toContain('snapshot');
    } finally {
      git('update-ref', '-d', 'refs/codex/snapshots/abc');
    }
    expect(await service().countOtherRefs()).toBe(0);
  });

  it('forks: without origin the main remote is the one most local branches track', async () => {
    git('remote', 'add', 'upstream', 'https://example.invalid/main.git');
    git('remote', 'add', 'aaa-fork', 'https://example.invalid/fork.git');
    git('config', 'branch.main.remote', 'upstream');
    git('config', 'branch.main.merge', 'refs/heads/main');
    try {
      expect(await service().forkRemotes()).toEqual(['aaa-fork']);
    } finally {
      git('config', '--unset', 'branch.main.remote');
      git('config', '--unset', 'branch.main.merge');
      git('remote', 'remove', 'aaa-fork');
      git('remote', 'remove', 'upstream');
    }
  });
});
