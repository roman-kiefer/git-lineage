import type { CommitView } from './model';
import { buildRowVisualLaneMaps } from './layoutRows';
import { coalesceLines, computeGraphLayout, type GraphLayout, type GraphPrimitive } from './graphLayout';
import { assignLaneColors } from './laneColors';
import { lanePaletteSize } from './graphConfig';

type DrawContext = {
  graphPaddingX: number;
  laneWidth: number;
  dotSize: number;
  virtualTrackColor: string;
  virtualRingRadius: number;
  maxImmediateParentCurveDistance: number;
  visualLaneCount: (laneCount: number) => number;
  laneColor: (lane: number) => string;
  editorBackground: string;
  commitLane: (commit: CommitView) => number;
  isCurrentCommit: (commit: CommitView) => boolean;
  laneToX: (lane: number) => number;
};

export type RenderCommitGraphOverlayOptions = DrawContext & {
  items: HTMLElement;
  overlay: SVGSVGElement;
  commits: CommitView[];
  maxLanes: number;
};

export type RenderCommitGraphOverlayResult = {
  nextMaxLanes: number;
};

const svgNamespace = 'http://www.w3.org/2000/svg';

// Lane colors shown so far, per graph overlay: a lane keeps its color in later renders (more
// commits loaded, refresh), see laneColors.ts.
const laneColorMemory = new WeakMap<SVGSVGElement, Map<string, number>>();

// Create a stroked SVG path with the given bezier data.
const createCurve = (d: string, stroke: string): SVGPathElement => {
  const path = document.createElementNS(svgNamespace, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', 'graph-line graph-line--main');
  path.setAttribute('stroke', stroke);
  return path;
};

// Translate one layout primitive into its SVG element.
// uncommitted: piece of the "Uncommitted Changes" row - grey, and its dot drawn as a ring.
const createPrimitiveElement = (primitive: GraphPrimitive, ctx: DrawContext, uncommitted = false): SVGElement => {
  const hollow = uncommitted && primitive.kind === 'dot';
  const stroke = uncommitted ? ctx.virtualTrackColor : ctx.laneColor(primitive.laneId);
  switch (primitive.kind) {
    case 'line': {
      const x = ctx.laneToX(primitive.visualLane);
      const line = document.createElementNS(svgNamespace, 'line');
      line.setAttribute('x1', `${x}`);
      line.setAttribute('y1', `${primitive.y1}`);
      line.setAttribute('x2', `${x}`);
      line.setAttribute('y2', `${primitive.y2}`);
      line.setAttribute('class', 'graph-line graph-line--track');
      line.setAttribute('stroke', stroke);
      return line;
    }
    case 'branch': {
      // Rule-based Bezier controls: c1 on start-x at end-y, c2 on end-x at start-y.
      const xFrom = ctx.laneToX(primitive.fromLane);
      const xTo = ctx.laneToX(primitive.toLane);
      const { yFrom, yTo } = primitive;
      return createCurve(`M ${xFrom} ${yFrom} C ${xFrom} ${yTo}, ${xTo} ${yFrom}, ${xTo} ${yTo}`, stroke);
    }
    case 'shift': {
      // Same lane, same color: only position shifts left within one row.
      const xFrom = ctx.laneToX(primitive.fromLane);
      const xTo = ctx.laneToX(primitive.toLane);
      const { yTop, yBottom } = primitive;
      return createCurve(`M ${xFrom} ${yTop} C ${xFrom} ${yBottom}, ${xTo} ${yTop}, ${xTo} ${yBottom}`, stroke);
    }
    case 'dot': {
      const dot = document.createElementNS(svgNamespace, 'circle');
      dot.setAttribute('cx', `${ctx.laneToX(primitive.visualLane)}`);
      dot.setAttribute('cy', `${primitive.y}`);
      if (hollow) {
        dot.setAttribute('r', `${ctx.dotSize / 2 - 1}`);
        dot.setAttribute('fill', ctx.editorBackground);
        dot.setAttribute('stroke', stroke);
        dot.setAttribute('stroke-width', '2');
        dot.setAttribute('class', 'graph-dot graph-dot--uncommitted');
        return dot;
      }
      dot.setAttribute('r', `${ctx.dotSize / 2}`);
      dot.setAttribute('fill', stroke);
      dot.setAttribute('stroke', ctx.editorBackground);
      dot.setAttribute('stroke-width', '1.2');
      return dot;
    }
  }
};

// HEAD of a linked worktree (not the main checkout): a ring around the commit dot.
const isLinkedWorktreeHead = (commit: CommitView | undefined): boolean =>
  !!commit && commit.refs.some((ref) => ref.worktree && !ref.worktreeIsMain);

const createWorktreeRing = (primitive: Extract<GraphPrimitive, { kind: 'dot' }>, ctx: DrawContext): SVGElement => {
  const ring = document.createElementNS(svgNamespace, 'circle');
  ring.setAttribute('cx', `${ctx.laneToX(primitive.visualLane)}`);
  ring.setAttribute('cy', `${primitive.y}`);
  ring.setAttribute('r', `${ctx.dotSize / 2 + 3}`);
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', ctx.laneColor(primitive.laneId));
  ring.setAttribute('stroke-width', '1.5');
  ring.setAttribute('class', 'graph-dot-worktree');
  return ring;
};

// Append row-level occupancy (O[...]) and shift budget (B[...]) to the debug meta labels.
const writeDebugMeta = (rows: HTMLElement[], layout: GraphLayout): void => {
  rows.forEach((rowEl, rowIndex) => {
    const metaEl = rowEl.querySelector<HTMLElement>('.commit-graph-debug-meta');
    if (!metaEl) {
      return;
    }
    const baseText = (metaEl.textContent ?? '').replace(/\s(?:O|B)\[[^\]]*\]/g, '');
    const occupancy = layout.rowLaneOccupancy.get(rowIndex);
    const budget = layout.rowShiftBudgetByLaneId.get(rowIndex);
    const parts: string[] = [baseText];
    if (occupancy && occupancy.size > 0) {
      const occupancyText = [...occupancy.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([visualLane, laneIds]) => `${visualLane}:${[...laneIds].sort((a, b) => a - b).join('|')}`)
        .join(',');
      parts.push(`O[${occupancyText}]`);
    }
    if (budget && budget.size > 0) {
      const budgetText = [...budget.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([laneId, steps]) => `${laneId}:${steps}`)
        .join(',');
      parts.push(`B[${budgetText}]`);
    }
    metaEl.textContent = parts.join(' ');
  });
};

export const renderCommitGraphOverlay = (
  options: RenderCommitGraphOverlayOptions,
): RenderCommitGraphOverlayResult => {
  const { items, overlay, commits, maxLanes } = options;
  const ctx: DrawContext = options;
  const rows = Array.from(items.querySelectorAll<HTMLElement>('.commit'));
  // Align overlay with commit rows (not with table header).
  overlay.style.top = `${items.offsetTop}px`;
  const rowVisualLaneMaps = buildRowVisualLaneMaps(commits);
  const laneCount = Math.max(maxLanes, rowVisualLaneMaps.laneCount, 1);
  const listElement = items.closest('.list') as HTMLElement | null;
  const configuredGraphWidth = listElement
    ? Number.parseFloat(
      getComputedStyle(listElement).getPropertyValue('--graph-col-width').replace('px', '').trim(),
    )
    : Number.NaN;
  const width = Number.isFinite(configuredGraphWidth) && configuredGraphWidth > 0
    ? configuredGraphWidth
    : ctx.graphPaddingX * 2 + ctx.visualLaneCount(laneCount) * ctx.laneWidth;
  const height =
    rows.length > 0 ? rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight : 0;

  overlay.innerHTML = '';
  overlay.setAttribute('width', `${width}`);
  overlay.setAttribute('height', `${height}`);

  // Lanes that do not fit into the column are drawn anyway; the column scrolls sideways by moving
  // the viewBox (graphScroll.ts). The offset is kept across redraws, limited to the drawn width.
  const setExtent = (contentWidth: number): void => {
    const scrollX = Math.max(0, Math.min(Number(overlay.dataset.scrollX) || 0, contentWidth - width));
    overlay.dataset.scrollX = String(scrollX);
    overlay.dataset.contentWidth = String(contentWidth);
    overlay.setAttribute('viewBox', `${scrollX} 0 ${width} ${height}`);
    overlay.dispatchEvent(new CustomEvent('graph-extent'));
  };

  if (rows.length === 0 || commits.length === 0) {
    setExtent(width);
    return { nextMaxLanes: laneCount };
  }

  const layout = computeGraphLayout(
    commits,
    rows.map((row) => ({ top: row.offsetTop, height: row.offsetHeight })),
    ctx.commitLane,
    rowVisualLaneMaps,
  );
  // Rightmost column actually used (lines, curves, dots), not the number of lanes ever opened.
  const rightmost = layout.primitives.reduce(
    (max, primitive) =>
      Math.max(max, 'visualLane' in primitive ? primitive.visualLane : Math.max(primitive.fromLane, primitive.toLane)),
    0,
  );
  setExtent(Math.max(width, ctx.laneToX(rightmost) + ctx.laneWidth / 2 + ctx.graphPaddingX));

  // Lanes of the "Uncommitted Changes" rows (one per worktree with changes; placed last by the
  // layout, so the colors of real lanes stay).
  const uncommittedLanes = new Set<number>();
  commits.forEach((commit, index) => {
    const lane = commit.isUncommitted ? layout.ownerLaneByCommitIndex.get(index) : undefined;
    if (lane !== undefined) {
      uncommittedLanes.add(lane);
    }
  });

  // Colors: neighbouring lanes get different colors where possible (laneColors.ts).
  const rowMids = rows.map((row) => row.offsetTop + row.offsetHeight / 2);
  let memory = laneColorMemory.get(overlay);
  if (!memory) {
    memory = new Map();
    laneColorMemory.set(overlay, memory);
  }
  const colorIndex = assignLaneColors(layout.primitives, rowMids, lanePaletteSize, uncommittedLanes, {
    rowKey: (row) => commits[row]?.hash,
    memory,
  });
  const drawCtx: DrawContext = { ...ctx, laneColor: (laneId) => ctx.laneColor(colorIndex.get(laneId) ?? laneId) };

  // Fewer, longer lines: same picture, far fewer SVG elements for long lanes.
  coalesceLines(layout.primitives).forEach((primitive) => {
    const uncommitted = uncommittedLanes.has(primitive.laneId);
    if (primitive.kind === 'dot') {
      // Dot position in overlay coordinates, for the hover popup (commitHover.ts).
      const row = rows[primitive.rowIndex];
      if (row) {
        row.dataset.dotX = `${ctx.laneToX(primitive.visualLane)}`;
        row.dataset.dotY = `${primitive.y}`;
      }
      // Row accent (ref chips etc.) follows the commit's lane color.
      rows[primitive.rowIndex]?.style.setProperty(
        '--commit-accent',
        uncommitted ? ctx.virtualTrackColor : drawCtx.laneColor(primitive.laneId),
      );
    }
    overlay.appendChild(createPrimitiveElement(primitive, drawCtx, uncommitted));
    if (primitive.kind === 'dot' && !uncommitted && isLinkedWorktreeHead(commits[primitive.rowIndex])) {
      overlay.appendChild(createWorktreeRing(primitive, drawCtx));
    }
  });

  writeDebugMeta(rows, layout);

  return { nextMaxLanes: Math.max(laneCount, layout.laneCount, 1) };
};
