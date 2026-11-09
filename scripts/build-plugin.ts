// Builds the server of the Claude Code plugin (claude-plugin/server/): the local server as one
// file without dependencies, plus the webview bundle and the icon it serves. The result is
// committed, because plugins are installed straight from the repository (no build step there).
// Run after `npm run esbuild` (the webview bundle): `npm run plugin`.
import { build } from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'claude-plugin', 'server');

const run = async (): Promise<void> => {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, 'webview'), { recursive: true });

  // Server and git logic in one CommonJS file; only Node built-ins stay external.
  await build({
    entryPoints: [path.join(root, 'src', 'standalone', 'server.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: path.join(target, 'server.js'),
    legalComments: 'none',
    banner: { js: '// Git Lineage - local server for the Claude Code browser pane. Built by scripts/build-plugin.ts, do not edit.' },
  });

  // What the server hands to the browser.
  for (const file of ['main.js', 'main.css', 'standaloneBridge.js', 'standaloneBridge.css']) {
    const source = path.join(root, 'webview', 'dist', file);
    if (!fs.existsSync(source)) {
      throw new Error(`${source} is missing: run npm run esbuild first.`);
    }
    fs.copyFileSync(source, path.join(target, 'webview', file));
  }
  fs.copyFileSync(path.join(root, 'media', 'icon.png'), path.join(target, 'icon.png'));
  console.log(`Plugin server built in ${path.relative(root, target)}`);
};

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
