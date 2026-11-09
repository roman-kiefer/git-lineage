import { buildRows } from './buildRows';
import {
  buildRowVisualLaneMaps,
  laneCountFromGraphPrefix,
} from './layoutRows';
import type { CommitView } from './model';
import {
  createCommitItemsFragment,
  type RenderCommitItemOptions,
} from './renderCommitColumns';
import { renderCommitGraphOverlay } from './renderSvg';

export type RenderCommitTableOptions = {
  items: HTMLElement;
  overlay: SVGSVGElement | null;
  commits: CommitView[];
  renderedCommits: CommitView[];
  append: boolean;
  maxLanes: number;
  graphOptions: Omit<RenderCommitItemOptions, 'selectedHash' | 'maxLanes'> & {
    selectedHash?: string;
    graphPaddingX: number;
    laneWidth: number;
    dotSize: number;
    virtualTrackColor: string;
    virtualRingRadius: number;
    maxImmediateParentCurveDistance: number;
    laneColor: (lane: number) => string;
    editorBackground: string;
    laneToX: (lane: number) => number;
  };
};

export type RenderCommitTableResult = {
  renderedCommits: CommitView[];
  maxLanes: number;
  resetSelection: boolean;
};

const laneCountFor = (commit: CommitView): number =>
  Math.max(laneCountFromGraphPrefix(commit.graphPrefix), commit.lane + 1);

export const renderCommitTable = (
  options: RenderCommitTableOptions,
): RenderCommitTableResult => {
  const { items, overlay, commits, append } = options;

  let renderedCommits = append ? options.renderedCommits : [];
  let maxLanes = append ? options.maxLanes : 1;

  if (!append) {
    items.innerHTML = '';
    renderedCommits = [];
    maxLanes = 1;
  }

  const rows = buildRows(commits);

  if (rows.length === 0 && renderedCommits.length === 0) {
    items.innerHTML = '<div class="empty">No commits found.</div>';
    if (overlay) {
      overlay.innerHTML = '';
    }
    return {
      renderedCommits,
      maxLanes,
      resetSelection: !append,
    };
  }

  const laneCount = Math.max(
    1,
    ...commits.map((commit) => laneCountFor(commit)),
    ...rows.map((commit) => laneCountFor(commit)),
    ...renderedCommits.map((commit) => laneCountFor(commit)),
  );
  const projectedRenderedCommits = append ? [...renderedCommits, ...rows] : [...rows];
  const projectedVisualLaneCount = buildRowVisualLaneMaps(projectedRenderedCommits).laneCount;
  maxLanes = Math.max(maxLanes, laneCount, projectedVisualLaneCount);

  const rowBase = append ? renderedCommits.length : 0;
  items.append(
    createCommitItemsFragment(rows, rowBase, {
      selectedHash: options.graphOptions.selectedHash,
      maxLanes,
      graphPaddingX: options.graphOptions.graphPaddingX,
      laneWidth: options.graphOptions.laneWidth,
      visualLaneCount: options.graphOptions.visualLaneCount,
      showGraphDebugMeta: options.graphOptions.showGraphDebugMeta,
      commitLane: options.graphOptions.commitLane,
      isCurrentCommit: options.graphOptions.isCurrentCommit,
    }),
  );
  renderedCommits = projectedRenderedCommits;

  if (overlay) {
    const result = renderCommitGraphOverlay({
      items,
      overlay,
      commits: renderedCommits,
      maxLanes,
      graphPaddingX: options.graphOptions.graphPaddingX,
      laneWidth: options.graphOptions.laneWidth,
      dotSize: options.graphOptions.dotSize,
      virtualTrackColor: options.graphOptions.virtualTrackColor,
      virtualRingRadius: options.graphOptions.virtualRingRadius,
      maxImmediateParentCurveDistance: options.graphOptions.maxImmediateParentCurveDistance,
      visualLaneCount: options.graphOptions.visualLaneCount,
      laneColor: options.graphOptions.laneColor,
      editorBackground: options.graphOptions.editorBackground,
      commitLane: options.graphOptions.commitLane,
      isCurrentCommit: options.graphOptions.isCurrentCommit,
      laneToX: options.graphOptions.laneToX,
    });
    maxLanes = result.nextMaxLanes;
  }

  return {
    renderedCommits,
    maxLanes,
    resetSelection: !append,
  };
};




