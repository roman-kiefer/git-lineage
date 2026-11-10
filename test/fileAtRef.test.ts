import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitService } from '../src/git/gitService';

// Diff and Open read a file at a commit with git show; a file missing there reads as empty.
let repo: string;
let added: string;
const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...identity } }).trim();

beforeAll(() => {
  repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-show-')));
  git('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(repo, 'dir'));
  fs.writeFileSync(path.join(repo, 'dir', 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  fs.writeFileSync(path.join(repo, 'dir', 'b.txt'), 'new\n');
  git('add', '.');
  git('commit', '-q', '-m', 'second');
  added = git('rev-parse', 'HEAD');
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('GitService.fileAtRef', () => {
  const service = (): GitService => new GitService({ locateRepositories: async () => [repo], timeoutMs: () => 30_000 });

  it('reads a file in a subfolder at a commit', async () => {
    expect(await service().fileAtRef(repo, added, 'dir/b.txt')).toBe('new\n');
  });

  it('reads an added file in the parent commit as empty', async () => {
    expect(await service().fileAtRef(repo, `${added}~1`, 'dir/b.txt')).toBe('');
  });

  it('reads the parent of a root commit as empty', async () => {
    expect(await service().fileAtRef(repo, `${added}~2`, 'dir/a.txt')).toBe('');
  });

  it('refuses a ref that git would take for an option', async () => {
    await expect(service().fileAtRef(repo, '--output=x', 'dir/a.txt')).rejects.toThrow('Invalid ref');
  });
});
