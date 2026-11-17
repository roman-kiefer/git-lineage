import * as https from 'https';

// Avatars from GitHub (setting avatarSource = github). Only used when the author column shows
// avatars and the user chose GitHub as their source; otherwise nothing is sent anywhere.
//   - Mails like 12345+name@users.noreply.github.com name the account directly.
//   - Other mails: one request per author to the repository's commit API
//     (GET /repos/{owner}/{repo}/commits/{sha}); its "author" is the GitHub account linked to
//     the commit mail, if any.
// The picture itself is fetched here and handed to the webview as a data URL (no direct
// requests from the page, cached for the session). Authors without a GitHub picture keep their
// initials.

export type HttpResponse = { status: number; body: Buffer; contentType?: string };
export type HttpGet = (url: string, headers: Record<string, string>) => Promise<HttpResponse>;

export type GitHubRepo = { owner: string; repo: string };

// Pixel size requested from GitHub: 16 px avatars, sharp on 2x screens.
const AVATAR_SIZE = 32;
// At most this many requests at the same time.
const PARALLEL = 4;

// github.com remote in any of its forms: https://github.com/o/r(.git), git@github.com:o/r.git,
// ssh://git@github.com/o/r.git. Other hosts (GitHub Enterprise, GitLab, ...) are not supported.
export const parseGitHubRepo = (url: string | undefined): GitHubRepo | undefined => {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
    (url ?? '').trim(),
  );
  return match ? { owner: match[1], repo: match[2] } : undefined;
};

// 12345+name@users.noreply.github.com (or the older name@users.noreply.github.com).
export const noreplyAvatarUrl = (email: string): string | undefined => {
  const match = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email.trim());
  if (!match) {
    return undefined;
  }
  return match[1]
    ? `https://avatars.githubusercontent.com/u/${match[1]}?s=${AVATAR_SIZE}`
    : `https://github.com/${encodeURIComponent(match[2])}.png?size=${AVATAR_SIZE}`;
};

const withSize = (avatarUrl: string): string =>
  `${avatarUrl}${avatarUrl.includes('?') ? '&' : '?'}s=${AVATAR_SIZE}`;

// GET over https, following up to three redirects (github.com/name.png redirects).
export const httpsGet: HttpGet = (url, headers) =>
  new Promise((resolve, reject) => {
    const fetchUrl = (target: string, redirects: number): void => {
      const request = https.get(target, { headers, timeout: 10_000 }, (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location && redirects > 0) {
          response.resume();
          fetchUrl(new URL(location, target).toString(), redirects - 1);
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status, body: Buffer.concat(chunks), contentType: response.headers['content-type'] }));
        response.on('error', reject);
      });
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', reject);
    };
    fetchUrl(url, 3);
  });

export class GitHubAvatars {
  // Mail (lower case) -> data URL, or undefined when GitHub has no picture for it.
  private readonly cache = new Map<string, Promise<string | undefined>>();
  // Rate limit reached or GitHub unreachable: no more API requests this session.
  private apiBlocked = false;

  constructor(
    private readonly get: HttpGet = httpsGet,
    private readonly token: () => Promise<string | undefined> = async () => undefined,
  ) {}

  // Pictures known so far (for a webview that was opened again).
  async known(): Promise<Record<string, string>> {
    const entries = await Promise.all(
      [...this.cache.entries()].map(async ([email, pending]) => [email, await pending.catch(() => undefined)] as const),
    );
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => !!entry[1]));
  }

  // Resolve the authors not asked about yet; returns the pictures found among them.
  // authors: mail -> one commit of that author (for the commit API).
  async resolve(repo: GitHubRepo | undefined, authors: Map<string, string>): Promise<Record<string, string>> {
    const todo = [...authors.entries()]
      .map(([email, sha]) => [email.trim().toLowerCase(), sha] as const)
      .filter(([email]) => email && !this.cache.has(email));
    const found: Record<string, string> = {};
    for (let index = 0; index < todo.length; index += PARALLEL) {
      await Promise.all(
        todo.slice(index, index + PARALLEL).map(async ([email, sha]) => {
          const pending = this.lookup(repo, email, sha).catch(() => undefined);
          this.cache.set(email, pending);
          const dataUrl = await pending;
          if (dataUrl) {
            found[email] = dataUrl;
          }
        }),
      );
    }
    return found;
  }

  private async lookup(repo: GitHubRepo | undefined, email: string, sha: string): Promise<string | undefined> {
    const direct = noreplyAvatarUrl(email);
    if (direct) {
      return this.download(direct);
    }
    if (!repo || this.apiBlocked) {
      return undefined;
    }
    const headers: Record<string, string> = {
      'User-Agent': 'git-lineage',
      Accept: 'application/vnd.github+json',
    };
    const token = await this.token().catch(() => undefined);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await this.get(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits/${sha}`,
      headers,
    ).catch(() => undefined);
    if (!response || response.status === 403 || response.status === 429) {
      // Rate limit (60 requests per hour without sign-in) or offline: try again next session.
      this.apiBlocked = true;
      this.cache.delete(email);
      return undefined;
    }
    if (response.status !== 200) {
      // 404: repository unknown or private without access; 422: commit not on GitHub.
      return undefined;
    }
    const avatarUrl = (JSON.parse(response.body.toString('utf8')) as { author?: { avatar_url?: string } | null }).author?.avatar_url;
    return avatarUrl ? this.download(withSize(avatarUrl)) : undefined;
  }

  private async download(url: string): Promise<string | undefined> {
    const response = await this.get(url, { 'User-Agent': 'git-lineage' });
    const type = (response.contentType ?? '').split(';')[0].trim();
    if (response.status !== 200 || !type.startsWith('image/')) {
      return undefined;
    }
    return `data:${type};base64,${response.body.toString('base64')}`;
  }
}
