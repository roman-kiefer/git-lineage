// Creates a deterministic synthetic Git history with `git fast-import`
// and writes its `git log --graph` in the format of GitService.getLogChunk.
// Usage: npx tsx scripts/make-history.ts <commits> <seed> <outFile> [--keep]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Options = { commits: number; seed: number; outFile: string; keep: boolean };

// Small deterministic random generator (mulberry32).
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Build a fast-import stream for a history with feature branches, merges and open branches.
export const buildFastImportStream = (commitCount: number, seed: number): string => {
  const random = createRandom(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  const lines: string[] = [];
  // Branch name -> mark of its current tip commit.
  const tips = new Map<string, number>();
  let mark = 0;
  let time = 1767225600; // 2026-01-01T00:00:00Z
  let featureCounter = 0;

  // Write a commit (optionally with a second parent) on a branch.
  const commit = (branch: string, message: string, from?: number, merge?: number): number => {
    mark += 1;
    time += 60;
    lines.push(`commit refs/heads/${branch}`);
    lines.push(`mark :${mark}`);
    lines.push(`author Synthetic <synthetic@example.invalid> ${time} +0000`);
    lines.push(`committer Synthetic <synthetic@example.invalid> ${time} +0000`);
    lines.push(`data ${Buffer.byteLength(message)}`);
    lines.push(message);
    if (from !== undefined) {
      lines.push(`from :${from}`);
    }
    if (merge !== undefined) {
      lines.push(`merge :${merge}`);
    }
    lines.push('');
    tips.set(branch, mark);
    return mark;
  };

  commit('main', 'initial');
  while (mark < commitCount) {
    const features = [...tips.keys()].filter((name) => name !== 'main');
    const roll = random();
    if (roll < 0.14 || features.length === 0) {
      // New feature branch from the current main.
      featureCounter += 1;
      const name = `feature/f${featureCounter}`;
      commit(name, `${name}: start`, tips.get('main'));
    } else if (roll < 0.26) {
      // Merge the feature into main with a merge commit and close the branch.
      const name = pick(features);
      commit('main', `merge ${name}`, tips.get('main'), tips.get(name));
      tips.delete(name);
      lines.push(`reset refs/heads/${name}`, 'from 0000000000000000000000000000000000000000', '');
    } else if (roll < 0.31) {
      // Back-merge: main into a feature branch.
      const name = pick(features);
      commit(name, `merge main into ${name}`, tips.get(name), tips.get('main'));
    } else if (roll < 0.55) {
      commit('main', `main work ${mark}`, tips.get('main'));
    } else {
      const name = pick(features);
      commit(name, `${name}: work ${mark}`, tips.get(name));
    }
  }
  return `${lines.join('\n')}\n`;
};

// Create the repository, import the stream, return the log in GitService format.
export const generateHistoryLog = (commitCount: number, seed: number, keep = false): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ggn-history-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'fast-import', '--quiet'], {
      input: buildFastImportStream(commitCount, seed),
    });
    return execFileSync(
      'git',
      [
        '-C', dir, 'log', '-n', String(commitCount + 10), '--skip', '0', '--graph',
        '--date=iso-strict', '--decorate=short',
        '--pretty=format:%x1d%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%D%x1e',
        '--date-order', '--all',
      ],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
  } finally {
    if (keep) {
      console.log(`Repository kept: ${dir}`);
    } else {
      rmSync(dir, { recursive: true, force: true });
    }
  }
};

const parseArgs = (argv: string[]): Options => {
  const [commits = '400', seed = '1', outFile = 'history.log'] = argv.filter((arg) => !arg.startsWith('--'));
  return { commits: Number(commits), seed: Number(seed), outFile, keep: argv.includes('--keep') };
};

// Run only as a script, not when imported (e.g. by the benchmark).
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/make-history.ts')) {
  const options = parseArgs(process.argv.slice(2));
  writeFileSync(options.outFile, generateHistoryLog(options.commits, options.seed, options.keep));
  console.log(`${options.commits} commits written to ${options.outFile}.`);
}
