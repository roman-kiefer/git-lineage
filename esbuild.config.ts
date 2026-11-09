import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const config = {
  // main: the webview (VS Code and browser); standaloneBridge: only for the local server (Claude Code).
  entryPoints: ['webview/src/main.ts', 'webview/src/standaloneBridge.ts'],
  bundle: true,
  outdir: 'webview/dist',
  sourcemap: true,
  target: 'es2020',
  platform: 'browser',
  format: 'iife',
  loader: {
    '.ts': 'ts',
    '.css': 'css',
  },
};

const run = async (): Promise<void> => {
  if (isWatch) {
    const ctx = await context(config);
    console.log('[esbuild-watch] started');
    await ctx.watch();
    await ctx.rebuild();
    console.log('[esbuild-watch] ready');
    return;
  }

  await build(config);
};

void run();
