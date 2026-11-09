// Measures the pure graph layout (no DOM) for large synthetic histories.
// Usage: npx tsx scripts/bench-layout.ts [1000,5000,10000]
import { performance } from 'node:perf_hooks';
import { parseGitLog } from '../src/git/gitParser';
import { buildRows } from '../webview/src/graph/buildRows';
import { coalesceLines, computeGraphLayout } from '../webview/src/graph/graphLayout';
import { buildRowVisualLaneMaps, laneFromGraphPrefix } from '../webview/src/graph/layoutRows';
import type { CommitView } from '../webview/src/graph/model';
import { generateHistoryLog } from './make-history';

const ROW_HEIGHT = 24;

// Turn the log into CommitView[] the way extension and webview do at runtime.
const toCommitViews = (raw: string): CommitView[] =>
  buildRows(
    parseGitLog(raw).map((commit) => ({
      ...commit,
      lane: laneFromGraphPrefix(commit.graphPrefix),
      segments: [],
    })),
  );

// Median of several runs so outliers (GC, JIT) do not dominate.
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const sizes = (process.argv[2] ?? '1000,5000,10000').split(',').map(Number);
console.log('Commits | Columns | Primitives | SVG elements | Layout (median of 5)');
for (const size of sizes) {
  const commits = toCommitViews(generateHistoryLog(size, 42));
  const rows = commits.map((_, index) => ({ top: index * ROW_HEIGHT, height: ROW_HEIGHT }));
  const timings: number[] = [];
  let columns = 0;
  let primitiveCount = 0;
  let elementCount = 0;
  for (let run = 0; run < 5; run += 1) {
    const start = performance.now();
    const maps = buildRowVisualLaneMaps(commits);
    const layout = computeGraphLayout(commits, rows, (commit) => commit.lane, maps);
    elementCount = coalesceLines(layout.primitives).length;
    timings.push(performance.now() - start);
    primitiveCount = layout.primitives.length;
    // reduce instead of Math.max(...): spreading very many arguments overflows the stack.
    columns = 1 + layout.primitives.reduce(
      (max, primitive) =>
        Math.max(max, 'visualLane' in primitive ? primitive.visualLane : Math.max(primitive.fromLane, primitive.toLane)),
      0,
    );
  }
  console.log(`${String(commits.length).padStart(7)} | ${String(columns).padStart(7)} | ${String(primitiveCount).padStart(9)} | ${String(elementCount).padStart(12)} | ${median(timings).toFixed(1)} ms`);
}
