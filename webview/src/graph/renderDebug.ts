import type { CommitView } from './model';

type RenderDebugOptions = {
  maxLanes: number;
  visualLaneCount: (laneCount: number) => number;
  commitLane: (commit: CommitView) => number;
};

export const createCommitGraphDebug = (
  commit: CommitView,
  options: RenderDebugOptions,
): HTMLSpanElement => {
  const debug = document.createElement('span');
  debug.className = 'commit-graph-debug';
  const debugWidthChars = options.visualLaneCount(Math.max(options.maxLanes, 1)) * 2 + 2;
  debug.style.width = `${debugWidthChars}ch`;
  // Keep the spacer element but suppress line-level debug output.
  debug.textContent = '';
  debug.title = '';
  return debug;
};

export const createCommitGraphDebugMeta = (
  commit: CommitView,
  rowIndex: number,
  options: RenderDebugOptions,
): HTMLSpanElement => {
  const meta = document.createElement('span');
  meta.className = 'commit-graph-debug-meta';
  if (commit.isConnectorRow) {
    meta.textContent = '';
    return meta;
  }
  // Show only parent hashes in debug meta.
  const parents = (commit.parents ?? []).map((hash) => hash.slice(0, 8)).join(',');
  meta.textContent = `P[${parents}]`;
  return meta;
};
