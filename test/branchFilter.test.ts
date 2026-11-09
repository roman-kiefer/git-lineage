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
});
