import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseNumstat, withLineCounts } from '../src/git/gitParser';
import { GitService } from '../src/git/gitService';

describe('parseNumstat', () => {
  it('reads counts per path, skips binary files and lists renames under the new path', () => {
    const raw = ['\n3\t1\tsrc/a.ts', '-\t-\timage.png', '5\t0\t', 'old name.txt', 'new\tname.txt', '0\t2\tb.md', ''].join(
      '\0',
    );
    const counts = parseNumstat(raw);
    expect([...counts.entries()]).toEqual([
      ['src/a.ts', { additions: 3, deletions: 1 }],
      ['new\tname.txt', { additions: 5, deletions: 0 }],
      ['b.md', { additions: 0, deletions: 2 }],
    ]);
  });

  it('adds counts only to files it knows', () => {
    const counts = parseNumstat('2\t3\ta.txt\0');
    expect(
      withLineCounts(
        [
          { status: 'M', path: 'a.txt' },
          { status: 'U', path: 'new.txt' },
        ],
        counts,
      ),
    ).toEqual([
      { status: 'M', path: 'a.txt', additions: 2, deletions: 3 },
      { status: 'U', path: 'new.txt' },
    ]);
  });
});

describe('GitService line counts', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-lineage-numstat-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('reports added and removed lines for a commit and for the working tree', async () => {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
    fs.writeFileSync(path.join(repo, 'move.txt'), 'line 1\nline 2\nline 3\nline 4\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nTWO\nthree\nfour\n');
    git('mv', 'move.txt', 'moved.txt');
    git('commit', '-q', '-am', 'second');
    const hash = git('rev-parse', 'HEAD').trim();

    const service = new GitService({ locateRepositories: async () => [repo], timeoutMs: () => 30_000 });
    const details = await service.getCommitDetails(hash);
    expect(details?.files).toEqual([
      { status: 'M', path: 'a.txt', additions: 2, deletions: 1 },
      { status: 'R100', path: 'moved.txt', additions: 0, deletions: 0 },
    ]);

    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    const counts = await service.getWorkingTreeNumstat(repo);
    expect(counts.get('a.txt')).toEqual({ additions: 0, deletions: 3 });
  });
});
