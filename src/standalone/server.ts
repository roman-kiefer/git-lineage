import { randomBytes, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { GraphController } from '../core/graphController';
import { GitService } from '../git/gitService';
import type { WebviewMessage } from '../webview/webviewMessages';
import { DEFAULT_SETTINGS, StandaloneHost } from './standaloneHost';

// Local web server that shows the Git Lineage webview in a browser, e.g. the Claude Code
// browser pane. Same webview bundle and graph logic as the VS Code extension.
//
// Security (see docs/claude-code.md):
// - listens on 127.0.0.1 only;
// - Host header must name 127.0.0.1/localhost with this port (DNS rebinding);
// - a random token per start is required for everything except the favicon: the start page
//   wants it as ?token= (the URL printed at start) and hands it out as an HttpOnly
//   SameSite=Strict cookie for the rest (--no-require-token: start page without ?token=);
// - POST only with JSON content type and our own Origin; no CORS headers at all;
// - no opener and no framing by other pages (COOP, frame-ancestors).

export type ServerOptions = {
  repo: string;
  port: number;
  requireToken: boolean;
  settings?: Record<string, unknown>;
};

export type RunningServer = {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
};

// Cookie name prefix; the port is appended because browsers share cookies across the ports of
// one host (two servers on localhost would otherwise overwrite each other's token).
const COOKIE_PREFIX = 'ggn_token_';
const MAX_BODY_BYTES = 1024 * 1024;
// Assets: next to the bundled server in the Claude Code plugin (server.js, webview/, icon.png),
// otherwise in the repository (out/standalone/server.js -> webview/dist, media/icon.png).
const BUNDLED = fs.existsSync(path.join(__dirname, 'webview', 'main.js'));
const DIST_DIR = BUNDLED ? path.join(__dirname, 'webview') : path.resolve(__dirname, '..', '..', 'webview', 'dist');
// Extension icon (light G on a dark square), served as the page's favicon.
const ICON_FILE = BUNDLED ? path.join(__dirname, 'icon.png') : path.resolve(__dirname, '..', '..', 'media', 'icon.png');
const STATIC_FILES: Record<string, string> = {
  '/dist/main.js': 'application/javascript; charset=utf-8',
  '/dist/main.css': 'text/css; charset=utf-8',
  '/dist/standaloneBridge.js': 'application/javascript; charset=utf-8',
  '/dist/standaloneBridge.css': 'text/css; charset=utf-8',
};

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Git Lineage</title>
    <!-- Browser tab icon, served as a file (see /favicon.png below). -->
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="stylesheet" href="/dist/standaloneBridge.css" />
    <link rel="stylesheet" href="/dist/main.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/dist/standaloneBridge.js"></script>
    <script src="/dist/main.js"></script>
  </body>
</html>`;

// Constant-time comparison of two tokens. Lengths are compared in bytes: a string of the same
// length with non-ASCII characters is longer in UTF-8 and would make timingSafeEqual throw.
const sameToken = (given: string | undefined, token: string): boolean => {
  if (!given) {
    return false;
  }
  const givenBytes = Buffer.from(given, 'utf8');
  const tokenBytes = Buffer.from(token, 'utf8');
  return givenBytes.length === tokenBytes.length && timingSafeEqual(givenBytes, tokenBytes);
};

const cookieToken = (request: http.IncomingMessage, name: string): string | undefined =>
  (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];

const send = (response: http.ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void => {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
};

export const startServer = async (options: ServerOptions): Promise<RunningServer> => {
  const repoRoot = await GitService.findRepoRoot(options.repo);
  if (!repoRoot) {
    throw new Error(`${options.repo} is not inside a Git repository.`);
  }
  const settings = { ...DEFAULT_SETTINGS, ...options.settings };
  const host = new StandaloneHost(settings);
  const gitService = new GitService({
    locateRepositories: async () => [repoRoot],
    timeoutMs: () => Number(settings.gitTimeoutSeconds) * 1000,
  });
  const controller = new GraphController(host, gitService);
  host.onFirstClient = () => controller.onVisible();
  host.onNoClients = () => controller.onClosed();

  const token = randomBytes(32).toString('hex');
  let port = options.port;
  // Token cookie of this server (port known only after listen when port 0 was asked for).
  const cookieName = (): string => `${COOKIE_PREFIX}${port}`;
  const allowedHosts = (): string[] => [`127.0.0.1:${port}`, `localhost:${port}`];
  const allowedOrigins = (): string[] => allowedHosts().map((value) => `http://${value}`);

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!allowedHosts().includes(request.headers.host ?? '')) {
      send(response, 421, 'Unknown host.');
      return;
    }

    // Start page: hands out the token cookie, only for ?token=<token> (unless --no-require-token).
    if (request.method === 'GET' && url.pathname === '/') {
      if (options.requireToken && !sameToken(url.searchParams.get('token') ?? undefined, token)) {
        send(response, 403, 'Token required: open the URL printed by the server.');
        return;
      }
      response.setHeader('Set-Cookie', `${cookieName()}=${token}; HttpOnly; SameSite=Strict; Path=/`);
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
      );
      // A page that opened this one keeps no reference to it (no forged window messages).
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      send(response, 200, PAGE, 'text/html; charset=utf-8');
      return;
    }

    // Favicon without token: the browser (or the pane around it) may fetch it without the cookie,
    // and the icon reveals nothing about the repository.
    if (request.method === 'GET' && (url.pathname === '/favicon.png' || url.pathname === '/favicon.ico')) {
      fs.readFile(ICON_FILE, (error, data) => {
        if (error) {
          send(response, 404, 'No icon.');
          return;
        }
        response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600', 'X-Content-Type-Options': 'nosniff' });
        response.end(data);
      });
      return;
    }

    if (!sameToken(cookieToken(request, cookieName()), token)) {
      send(response, 403, 'Forbidden.');
      return;
    }

    if (request.method === 'GET' && STATIC_FILES[url.pathname]) {
      fs.readFile(path.join(DIST_DIR, path.basename(url.pathname)), (error, data) => {
        if (error) {
          send(response, 404, 'Not built yet: run npm run esbuild.');
          return;
        }
        response.writeHead(200, {
          'Content-Type': STATIC_FILES[url.pathname],
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(data);
      });
      return;
    }

    // Server -> page: one long-lived event stream per open page.
    if (request.method === 'GET' && url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });
      response.write(': connected\n\n');
      host.addClient(response);
      return;
    }

    // Page -> server: webview messages and answers to dialogs.
    if (request.method === 'POST' && url.pathname === '/message') {
      const type = String(request.headers['content-type'] ?? '').split(';')[0].trim();
      if (type !== 'application/json' || !allowedOrigins().includes(String(request.headers.origin ?? ''))) {
        send(response, 403, 'Forbidden.');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          send(response, 413, 'Too large.');
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (response.writableEnded) {
          return;
        }
        let message: { type?: unknown; payload?: { id?: unknown; value?: unknown } };
        try {
          message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          send(response, 400, 'Invalid JSON.');
          return;
        }
        send(response, 204, '');
        if (message.type === 'hostResponse') {
          host.resolveRequest(Number(message.payload?.id), message.payload?.value as string | undefined);
          return;
        }
        if (typeof message.type === 'string') {
          void controller.receive(message as WebviewMessage);
        }
      });
      return;
    }

    send(response, 404, 'Not found.');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : options.port;
  const url = `http://127.0.0.1:${port}/${options.requireToken ? `?token=${token}` : ''}`;

  return {
    url,
    port,
    token,
    close: () =>
      new Promise((resolve) => {
        controller.onClosed();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

// Command line: --repo <dir> (default: current folder), --port <n> (default 5179),
// --no-require-token (start page without ?token=), --set key=value (settings such as dateFormat=iso).
const parseArgs = (argv: string[]): ServerOptions => {
  const options: ServerOptions = { repo: process.cwd(), port: 5179, requireToken: true, settings: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') {
      options.repo = path.resolve(argv[++index] ?? '.');
    } else if (arg === '--port') {
      options.port = Number(argv[++index]);
    } else if (arg === '--require-token') {
      // Now the default; still accepted for existing command lines.
      options.requireToken = true;
    } else if (arg === '--no-require-token') {
      options.requireToken = false;
    } else if (arg === '--set') {
      const [key, ...rest] = (argv[++index] ?? '').split('=');
      const raw = rest.join('=');
      // Numbers and booleans as such, everything else as text.
      options.settings![key] = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
    }
  }
  return options;
};

if (require.main === module) {
  startServer(parseArgs(process.argv.slice(2)))
    .then((running) => {
      console.log(`Git Lineage: ${running.url}`);
    })
    .catch((error: unknown) => {
      console.error(`Git Lineage: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
