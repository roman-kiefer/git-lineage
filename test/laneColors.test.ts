import { describe, expect, it } from 'vitest';
import { computeGraphLayout, type GraphPrimitive } from '../webview/src/graph/graphLayout';
import { assignLaneColors } from '../webview/src/graph/laneColors';
import type { CommitView } from '../webview/src/graph/model';
import { fixtureNames, loadCommitViews } from './helpers/fixtures';

// Rows 0..3 with their middles at 10, 30, 50, 70.
const mids = [10, 30, 50, 70];
const line = (laneId: number, visualLane: number, rowIndex: number): GraphPrimitive => ({
  kind: 'line', laneId, visualLane, rowIndex, y1: mids[rowIndex] - 10, y2: mids[rowIndex] + 10, source: 'lane',
});

describe('Lane colors: neighbours differ where possible', () => {
  it('lanes without a conflict keep their usual color (laneId modulo palette)', () => {
    const colors = assignLaneColors([line(0, 0, 0), line(1, 1, 0), line(2, 2, 0)], mids, 8);
    expect([...colors.entries()]).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it('the same color right next to each other is avoided (laneId 0 and 8 with 8 colors)', () => {
    const colors = assignLaneColors([line(0, 0, 0), line(0, 0, 1), line(8, 1, 1)], mids, 8);
    expect(colors.get(0)).toBe(0);
    expect(colors.get(8)).not.toBe(0);
  });

  it('merge curve into a lane of the same color: the branching lane gets another one', () => {
    const primitives: GraphPrimitive[] = [
      line(0, 0, 0), line(0, 0, 1), line(0, 0, 2),
      line(8, 2, 0), line(8, 2, 1),
      { kind: 'branch', laneId: 8, fromLane: 2, toLane: 0, yFrom: 30, yTo: 50 },
    ];
    expect(assignLaneColors(primitives, mids, 8).get(8)).not.toBe(0);
  });

  it('excluded lanes (uncommitted) do not count', () => {
    const colors = assignLaneColors([line(0, 0, 0), line(8, 1, 0)], mids, 8, new Set([8]));
    expect(colors.has(8)).toBe(false);
    expect(colors.get(0)).toBe(0);
  });

  it('a remembered color stays, even when a neighbour of the same color appears below', () => {
    const memory = new Map<string, number>();
    const rowKey = (row: number): string => `c${row}`;
    // First only lane 0 is visible: color 0.
    assignLaneColors([line(0, 0, 0), line(0, 0, 1)], mids, 8, new Set(), { rowKey, memory });
    // Loaded more: a second lane that starts at the top and competes with lane 0 (remembered) for the color.
    const colors = assignLaneColors(
      [line(5, 0, 0), line(5, 0, 1), line(7, 1, 0), line(7, 1, 1)],
      mids,
      8,
      new Set(),
      { rowKey, memory },
    );
    expect(colors.get(5)).toBe(0);
    expect(colors.get(7)).not.toBe(0);
  });

  it('a merge line out of a commit and the lane of the commit are remembered separately', () => {
    const memory = new Map<string, number>();
    const primitives: GraphPrimitive[] = [
      { kind: 'dot', laneId: 3, visualLane: 3, rowIndex: 1, y: 30 },
      line(3, 3, 1), line(3, 3, 2),
      { kind: 'branch', laneId: 4, fromLane: 3, toLane: 4, yFrom: 30, yTo: 50 },
      line(4, 4, 2),
    ];
    const colors = assignLaneColors(primitives, mids, 8, new Set(), { rowKey: (row) => `c${row}`, memory });
    expect(memory.get('c1:dot')).toBe(colors.get(3));
    expect(memory.get('c1:3>4')).toBe(colors.get(4));
  });
});

// Graph as in the webview: first `count` commits, then load page by page (same memory).
const renderColors = (commits: CommitView[], memory: Map<string, number>) => {
  const rows = commits.map((_, index) => ({ top: index * 2, height: 2 }));
  const layout = computeGraphLayout(commits, rows, (commit) => commit.lane);
  const colors = assignLaneColors(layout.primitives, rows.map((row) => row.top + 1), 8, new Set(), {
    rowKey: (row) => commits[row]?.hash,
    memory,
  });
  // Color per place (row:column) and lane per place.
  const cellColor = new Map<string, number>();
  const laneAt = new Map<string, number>();
  layout.primitives.forEach((primitive) => {
    if (primitive.kind === 'line' || primitive.kind === 'dot') {
      cellColor.set(`${primitive.rowIndex}:${primitive.visualLane}`, colors.get(primitive.laneId)!);
      laneAt.set(`${primitive.rowIndex}:${primitive.visualLane}`, primitive.laneId);
    }
  });
  return { cellColor, laneAt, colors };
};

describe('Lane colors while loading more', () => {
  it.each(fixtureNames.flatMap((name) => [1, 3, 10, 30].map((page) => [name, page] as const)))(
    '%s, pages of %i commits: no visible place changes its color',
    (name, page) => {
      const all = loadCommitViews(name);
      const memory = new Map<string, number>();
      let shown = renderColors(all.slice(0, page), memory);
      for (let count = page + page; count < all.length + page; count += page) {
        const next = renderColors(all.slice(0, count), memory);
        shown.cellColor.forEach((color, cell) => {
          const now = next.cellColor.get(cell);
          // Places without any line after loading more do not count.
          if (now !== undefined) {
            expect({ cell, count, color: now }).toEqual({ cell, count, color });
          }
        });
        shown = next;
      }
    },
  );

  it.each([1, 10, 300])('many-branches, pages of %i commits: no equal colors right next to each other', (page) => {
    const all = loadCommitViews('many-branches');
    const memory = new Map<string, number>();
    let result = renderColors(all.slice(0, page), memory);
    for (let count = page + page; count < all.length + page; count += page) {
      result = renderColors(all.slice(0, count), memory);
    }
    let clashes = 0;
    result.laneAt.forEach((lane, cell) => {
      const [row, column] = cell.split(':').map(Number);
      const right = result.laneAt.get(`${row}:${column + 1}`);
      if (right !== undefined && right !== lane && result.colors.get(right) === result.colors.get(lane)) {
        clashes += 1;
      }
    });
    expect(clashes).toBe(0);
  });
});
