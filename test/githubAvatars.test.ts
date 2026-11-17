import { describe, expect, it } from 'vitest';
import type { execFile } from 'child_process';
import { GitHubAvatars, noreplyAvatarUrl, parseGitHubRepo, type HttpGet } from '../src/core/githubAvatars';
import { ghCliToken } from '../src/standalone/standaloneHost';

// GitHub avatars (setting avatarSource = github), with a fake HTTP client: no network in tests.
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

const fakeGet = (routes: Record<string, { status: number; json?: unknown; image?: boolean }>) => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const get: HttpGet = async (url, headers) => {
    calls.push({ url, headers });
    const route = routes[url];
    if (!route) {
      return { status: 404, body: Buffer.alloc(0) };
    }
    if (route.image) {
      return { status: route.status, body: png, contentType: 'image/png' };
    }
    return { status: route.status, body: Buffer.from(JSON.stringify(route.json ?? {})), contentType: 'application/json' };
  };
  return { get, calls };
};

describe('GitHub avatars', () => {
  it('recognizes github.com remotes in their usual forms', () => {
    expect(parseGitHubRepo('https://github.com/novatimesysteme/_ver5-n_5_0_02_XXX.git')).toEqual({ owner: 'novatimesysteme', repo: '_ver5-n_5_0_02_XXX' });
    expect(parseGitHubRepo('git@github.com:roman-kiefer/git-lineage.git')).toEqual({ owner: 'roman-kiefer', repo: 'git-lineage' });
    expect(parseGitHubRepo('ssh://git@github.com/o/r')).toEqual({ owner: 'o', repo: 'r' });
    expect(parseGitHubRepo('https://user@github.com/o/r/')).toEqual({ owner: 'o', repo: 'r' });
    expect(parseGitHubRepo('https://gitlab.com/o/r.git')).toBeUndefined();
    expect(parseGitHubRepo(undefined)).toBeUndefined();
  });

  it('noreply mails name the account directly', () => {
    expect(noreplyAvatarUrl('12345+someone@users.noreply.github.com')).toBe('https://avatars.githubusercontent.com/u/12345?s=32');
    expect(noreplyAvatarUrl('someone@users.noreply.github.com')).toBe('https://github.com/someone.png?size=32');
    expect(noreplyAvatarUrl('someone@example.com')).toBeUndefined();
  });

  it('other mails: the commit API, once per author, with the token if there is one', async () => {
    const { get, calls } = fakeGet({
      'https://api.github.com/repos/o/r/commits/aaa': { status: 200, json: { author: { avatar_url: 'https://avatars.githubusercontent.com/u/7?v=4' } } },
      'https://avatars.githubusercontent.com/u/7?v=4&s=32': { status: 200, image: true },
      'https://api.github.com/repos/o/r/commits/bbb': { status: 200, json: { author: null } },
    });
    const avatars = new GitHubAvatars(get, async () => 'secret');
    const found = await avatars.resolve({ owner: 'o', repo: 'r' }, new Map([['Dev@Example.com', 'aaa'], ['nobody@example.com', 'bbb']]));
    expect(found).toEqual({ 'dev@example.com': dataUrl });
    expect(calls[0].headers.Authorization).toBe('Bearer secret');
    // Asked once: no new requests for known authors (found or not).
    const before = calls.length;
    expect(await avatars.resolve({ owner: 'o', repo: 'r' }, new Map([['dev@example.com', 'aaa'], ['nobody@example.com', 'bbb']]))).toEqual({});
    expect(calls.length).toBe(before);
    expect(await avatars.known()).toEqual({ 'dev@example.com': dataUrl });
  });

  it('no GitHub repository: only noreply mails get a picture', async () => {
    const { get, calls } = fakeGet({ 'https://avatars.githubusercontent.com/u/9?s=32': { status: 200, image: true } });
    const found = await new GitHubAvatars(get).resolve(undefined, new Map([['9+x@users.noreply.github.com', 'a'], ['x@example.com', 'b']]));
    expect(found).toEqual({ '9+x@users.noreply.github.com': dataUrl });
    expect(calls.map((call) => call.url)).toEqual(['https://avatars.githubusercontent.com/u/9?s=32']);
  });

  it('browser pane: the GitHub CLI sign-in as token, nothing when gh is missing or signed out', async () => {
    type Callback = (error: Error | null, stdout: string) => void;
    const fakeGh = (error: Error | null, stdout: string, seen?: string[][]) =>
      ((file: string, args: string[], _options: unknown, callback: Callback) => {
        seen?.push([file, ...args]);
        callback(error, stdout);
      }) as unknown as typeof execFile;
    const seen: string[][] = [];
    expect(await ghCliToken(fakeGh(null, 'gho_abc123\n', seen))).toBe('gho_abc123');
    expect(seen).toEqual([['gh', 'auth', 'token', '--hostname', 'github.com']]);
    expect(await ghCliToken(fakeGh(new Error('not logged in'), ''))).toBeUndefined();
    expect(await ghCliToken(fakeGh(null, 'You are not logged into any GitHub hosts.'))).toBeUndefined();
    const missing = (() => {
      throw new Error('spawn gh ENOENT');
    }) as unknown as typeof execFile;
    expect(await ghCliToken(missing)).toBeUndefined();
  });

  it('rate limit: no more API requests this session, the author is asked again later', async () => {
    const { get, calls } = fakeGet({ 'https://api.github.com/repos/o/r/commits/aaa': { status: 403 } });
    const avatars = new GitHubAvatars(get);
    expect(await avatars.resolve({ owner: 'o', repo: 'r' }, new Map([['a@example.com', 'aaa']]))).toEqual({});
    expect(await avatars.resolve({ owner: 'o', repo: 'r' }, new Map([['b@example.com', 'bbb']]))).toEqual({});
    expect(calls.length).toBe(1);
  });
});
