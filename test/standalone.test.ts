import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphController, UNCOMMITTED_HASH } from '../src/core/graphController';
import type { ConfirmOptions, GraphHost, PromptOptions } from '../src/core/graphHost';
import { GitService } from '../src/git/gitService';
import { startServer, type RunningServer } from '../src/standalone/server';
import { FormAnswerer } from './helpers/formAnswers';

// Throwaway repository: two commits on main, a branch "feature", one uncommitted file.
let repo: string;
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-'));
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'first');
  git('commit', '-q', '--allow-empty', '-m', 'second');
  git('branch', 'feature', 'HEAD~1');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'x');
});

afterAll(() => {
  // Windows may hold the folder a moment after the watchers closed.
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

type Posted = { type: string; payload?: Record<string, unknown> };

// Host that records messages and answers questions from a script.
class FakeHost implements GraphHost {
  posted: Posted[] = [];
  confirmAnswers: Array<string | undefined> = [];
  promptAnswers: string[] = [];
  promptProblems: Array<string | undefined> = [];
  forms = new FormAnswerer();
  settings: Record<string, unknown> = {};
  async post(message: unknown): Promise<void> {
    this.posted.push(message as Posted);
    this.forms.observe(message as Posted);
  }
  config<T>(key: string, fallback: T): T {
    return key in this.settings ? (this.settings[key] as T) : fallback;
  }
  async updateConfig(key: string, value: unknown): Promise<void> {
    this.settings[key] = value;
  }
  isOpen(): boolean {
    return true;
  }
  isVisible(): boolean {
    return true;
  }
  async confirm(_options: ConfirmOptions): Promise<string | undefined> {
    return this.confirmAnswers.shift();
  }
  // Like a real input box: every value is validated, the first valid one is returned.
  async prompt(options: PromptOptions): Promise<string | undefined> {
    for (const value of this.promptAnswers) {
      const problem = await options.validate(value);
      this.promptProblems.push(problem);
      if (!problem) {
        return value;
      }
    }
    return undefined;
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
}

const controllerFor = (host: FakeHost): GraphController => {
  const controller = new GraphController(host, new GitService({ locateRepositories: async () => [repo], timeoutMs: () => 30_000 }));
  host.forms.controller = controller;
  return controller;
};

describe('GraphController (shared core, fake host)', () => {
  it('ready: loads commits with the uncommitted row on top', async () => {
    const host = new FakeHost();
    await controllerFor(host).receive({ type: 'ready' });
    const init = host.last('init')!;
    const commits = init.payload!.commits as Array<{ hash: string; subject: string; isUncommitted?: boolean }>;
    expect(commits.map((commit) => commit.subject)).toEqual(['Uncommitted Changes (1)', 'second', 'first']);
    expect(commits[0]).toMatchObject({ hash: UNCOMMITTED_HASH, isUncommitted: true });
    expect(init.payload!.repositories).toEqual([repo]);
  });

  it('checkout (detached) only after confirmation', async () => {
    const host = new FakeHost();
    const controller = controllerFor(host);
    const first = git('rev-parse', 'HEAD~1');
    host.forms.answers = [undefined];
    await controller.receive({ type: 'checkoutDetached', payload: { target: first } });
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

    // "Always accept": checked out, and the next time without a question.
    host.forms.answers = [{ always: true }];
    await controller.receive({ type: 'checkoutDetached', payload: { target: first } });
    expect(git('rev-parse', 'HEAD')).toBe(first);
    expect(host.last('commits')!.payload!.message).toContain('detached HEAD');
    expect(host.settings.confirmDetachedCheckout).toBe(false);

    await controller.receive({ type: 'checkoutBranch', payload: { name: 'main' } });
    const shown = host.forms.forms.length;
    await controller.receive({ type: 'checkoutDetached', payload: { target: first } });
    expect(host.forms.forms.length).toBe(shown);
    expect(git('rev-parse', 'HEAD')).toBe(first);
    await controller.receive({ type: 'checkoutBranch', payload: { name: 'main' } });
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  it('create branch: invalid and existing names are refused', async () => {
    const host = new FakeHost();
    const controller = controllerFor(host);
    // One form; invalid names are reported at the field, the form stays open.
    host.forms.answers = [{ name: 'a..b' }, { name: 'feature' }, { name: 'fresh', checkout: false }];
    await controller.receive({ type: 'createBranch', payload: { hash: git('rev-parse', 'HEAD') } });
    expect(host.forms.errors).toEqual([
      'Git does not accept this branch name.',
      'A branch with this name already exists.',
    ]);
    expect(git('branch', '--list', 'fresh')).toContain('fresh');
    // Created only, not checked out.
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  it('git errors reach the webview as error messages', async () => {
    const host = new FakeHost();
    await controllerFor(host).receive({ type: 'checkoutBranch', payload: { name: 'does-not-exist' } });
    expect(host.last('error')!.payload!.message).toMatch(/^git checkout failed/);
  });
});

// Small HTTP helper (fetch cannot set the Host header).
const request = (
  server: RunningServer,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.port, method: options.method ?? 'GET', path: options.path, headers: options.headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });

describe('Local server (Claude Code browser pane)', () => {
  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer({ repo, port: 0, requireToken: false });
  });
  afterAll(async () => {
    await server.close();
  });

  it('the start page sets the token cookie, everything else needs it', async () => {
    const start = await request(server, { path: '/' });
    expect(start.status).toBe(200);
    // The cookie name carries the port: two servers on localhost must not share one token cookie.
    expect(start.headers['set-cookie']?.[0]).toMatch(
      new RegExp(`^ggn_token_${server.port}=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/`),
    );
    expect(start.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(server, { path: '/events' })).status).toBe(403);
    expect((await request(server, { path: '/dist/main.js', headers: { Cookie: `ggn_token_${server.port}=wrong` } })).status).toBe(403);
    // A valid token under another port's cookie name is not accepted.
    expect((await request(server, { path: '/dist/main.js', headers: { Cookie: `ggn_token_1=${server.token}` } })).status).toBe(403);
  });

  it('favicon without token (the extension icon), but only for its own host', async () => {
    const icon = await request(server, { path: '/favicon.png' });
    expect(icon.status).toBe(200);
    expect(icon.headers['content-type']).toBe('image/png');
    expect((await request(server, { path: '/favicon.png', headers: { Host: 'evil.example' } })).status).toBe(421);
  });

  it('a foreign Host header (DNS rebinding) and a foreign Origin are refused', async () => {
    expect((await request(server, { path: '/', headers: { Host: 'evil.example' } })).status).toBe(421);
    const cookie = `ggn_token_${server.port}=${server.token}`;
    const post = (headers: Record<string, string>) =>
      request(server, { method: 'POST', path: '/message', headers: { Cookie: cookie, ...headers }, body: '{"type":"refresh"}' });
    expect((await post({ 'Content-Type': 'application/json', Origin: 'http://evil.example' })).status).toBe(403);
    expect((await post({ 'Content-Type': 'text/plain', Origin: `http://127.0.0.1:${server.port}` })).status).toBe(403);
    expect((await post({ 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${server.port}` })).status).toBe(204);
  });

  it('ready via POST delivers init through the event stream', async () => {
    const cookie = `ggn_token_${server.port}=${server.token}`;
    const firstMessage = new Promise<Posted>((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: server.port, path: '/events', headers: { Cookie: cookie } },
        (res) => {
          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk;
            // Other messages (e.g. from the refresh above) may come first: wait for init.
            const init = [...buffer.matchAll(/data: (.*)\n\n/g)]
              .map((match) => JSON.parse(match[1]) as Posted)
              .find((message) => message.type === 'init');
            if (init) {
              resolve(init);
              req.destroy();
            }
          });
        },
      );
      req.on('error', reject);
    });
    // Give the stream a moment to register before asking for data.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sent = await request(server, {
      method: 'POST',
      path: '/message',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${server.port}` },
      body: JSON.stringify({ type: 'ready' }),
    });
    expect(sent.status).toBe(204);
    const message = await firstMessage;
    expect(message.type).toBe('init');
    expect((message.payload!.commits as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
});
