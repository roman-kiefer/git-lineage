import { describe, expect, it } from 'vitest';
import {
  coalesceLines,
  computeGraphLayout,
  type GraphLayout,
  type GraphPrimitive,
} from '../webview/src/graph/graphLayout';
import type { CommitView } from '../webview/src/graph/model';
import { findCollisions } from './helpers/collisions';
import { fixtureNames, indexBySubject, loadCommitViews, type FixtureName } from './helpers/fixtures';

const ROW_HEIGHT = 2;

// Layout of a fixture with rows of equal height.
const layoutFor = (name: FixtureName): { commits: CommitView[]; layout: GraphLayout } => {
  const commits = loadCommitViews(name);
  const rows = commits.map((_, index) => ({ top: index * ROW_HEIGHT, height: ROW_HEIGHT }));
  return { commits, layout: computeGraphLayout(commits, rows, (commit) => commit.lane) };
};

const yMid = (rowIndex: number): number => rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

// Visible column per commit subject (easier to read than row indices).
const columnsBySubject = (commits: CommitView[], layout: GraphLayout): Record<string, number | undefined> =>
  Object.fromEntries(
    commits.map((commit, index) => [commit.subject, layout.commitVisualLaneByCommitIndex.get(index)]),
  );

// Whether a primitive ends at (column, y).
const endsAt = (primitive: GraphPrimitive, column: number, y: number): boolean => {
  switch (primitive.kind) {
    case 'line':
      return primitive.visualLane === column && primitive.y2 === y;
    case 'branch':
      return primitive.toLane === column && primitive.yTo === y;
    default:
      return false;
  }
};

describe('computeGraphLayout: invariants for all fixtures', () => {
  it.each(fixtureNames)('%s: every commit has a lane and a column', (name) => {
    const { commits, layout } = layoutFor(name);
    commits.forEach((_, index) => {
      expect(layout.ownerLaneByCommitIndex.has(index)).toBe(true);
      expect(layout.commitVisualLaneByCommitIndex.has(index)).toBe(true);
    });
  });

  it.each(fixtureNames)('%s: at most one commit dot per row', (name) => {
    const { commits, layout } = layoutFor(name);
    const dots = layout.primitives.filter((primitive) => primitive.kind === 'dot');
    expect(dots).toHaveLength(commits.length);
    expect(new Set(dots.map((dot) => dot.rowIndex)).size).toBe(commits.length);
  });

  it.each(fixtureNames)('%s: every parent connection ends at the commit dot of the parent', (name) => {
    const { commits, layout } = layoutFor(name);
    const indexByHash = new Map(commits.map((commit, index) => [commit.hash, index]));
    commits.forEach((commit) => {
      (commit.parents ?? []).forEach((parentHash) => {
        const parentIndex = indexByHash.get(parentHash);
        if (parentIndex === undefined) {
          return;
        }
        const parentColumn = layout.commitVisualLaneByCommitIndex.get(parentIndex)!;
        const arrives = layout.primitives.some((primitive) =>
          endsAt(primitive, parentColumn, yMid(parentIndex)),
        );
        expect(arrives, `${commit.subject} -> Parent in Zeile ${parentIndex}`).toBe(true);
      });
    });
  });

  it.each(fixtureNames)('%s: merge lines start at the dot of the merge commit', (name) => {
    const { commits, layout } = layoutFor(name);
    commits.forEach((commit, index) => {
      if ((commit.parents ?? []).length < 2) {
        return;
      }
      // Every outgoing edge (first parent and merge parents) leaves from the commit point:
      // a vertical line or an S-curve that starts at (column, row middle).
      const column = layout.commitVisualLaneByCommitIndex.get(index)!;
      const starts = layout.primitives.filter(
        (primitive) =>
          (primitive.kind === 'branch' && primitive.fromLane === column && primitive.yFrom === yMid(index)) ||
          (primitive.kind === 'line' && primitive.visualLane === column && primitive.y1 === yMid(index)),
      );
      expect(starts.length, commit.subject).toBeGreaterThanOrEqual((commit.parents ?? []).length);
    });
  });
});

describe('computeGraphLayout: no overlaps', () => {
  it.each(fixtureNames)('%s: no two lanes on top of each other in one column', (name) => {
    const { layout } = layoutFor(name);
    expect(findCollisions(layout)).toEqual([]);
  });
});

// Union of covered y-intervals per lane+column, as sorted [start, end] pairs.
const coverage = (primitives: GraphPrimitive[]): Map<string, Array<[number, number]>> => {
  const byKey = new Map<string, Array<[number, number]>>();
  primitives.forEach((primitive) => {
    if (primitive.kind !== 'line') {
      return;
    }
    const key = `${primitive.laneId}:${primitive.visualLane}`;
    byKey.set(key, [...(byKey.get(key) ?? []), [primitive.y1, primitive.y2]]);
  });
  byKey.forEach((intervals, key) => {
    const merged: Array<[number, number]> = [];
    [...intervals].sort((a, b) => a[0] - b[0]).forEach(([start, end]) => {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    });
    byKey.set(key, merged);
  });
  return byKey;
};

describe('open ends (parent not loaded)', () => {
  // First page of a large history: many parents are outside the loaded rows.
  const commits = loadCommitViews('many-branches').slice(0, 60);
  const rows = commits.map((_, index) => ({ top: index * ROW_HEIGHT, height: ROW_HEIGHT }));
  const layout = computeGraphLayout(commits, rows, (commit) => commit.lane);
  const loaded = new Set(commits.map((commit) => commit.hash));
  const tails = layout.primitives.filter(
    (primitive): primitive is Extract<GraphPrimitive, { kind: 'line' }> =>
      primitive.kind === 'line' && primitive.source === 'tail',
  );

  it('draws an open end for every edge to a parent that is not loaded', () => {
    const missingEdges = commits.flatMap((commit) => (commit.parents ?? []).filter((parent) => !loaded.has(parent)));
    expect(missingEdges.length).toBeGreaterThan(0);
    // Each missing edge gets its own open end (one lane each).
    expect(new Set(tails.map((line) => line.laneId)).size).toBe(missingEdges.length);
  });

  it('open ends run to the end of the list', () => {
    const listBottom = commits.length * ROW_HEIGHT;
    const bottomByLane = new Map<number, number>();
    tails.forEach((line) => bottomByLane.set(line.laneId, Math.max(bottomByLane.get(line.laneId) ?? 0, line.y2)));
    bottomByLane.forEach((bottom, laneId) => expect(bottom, `Lane ${laneId}`).toBe(listBottom));
  });

  it('no overlaps', () => {
    expect(findCollisions(layout)).toEqual([]);
  });

  it('a merge line to a parent that is not loaded moves left into freed columns', () => {
    // Minimal commit for hand-built histories (lane: only a starting hint).
    const commit = (hash: string, parents: string[], lane: number): CommitView => ({
      hash, shortHash: hash, parents, lane, segments: [], refs: [], authorName: 'a', authorDate: '', subject: hash,
    });
    // T-S-C-D is the main line; B and M end in C, M also has the parent X that is not loaded.
    const handmade = [
      commit('T', ['S'], 0),
      commit('B', ['C'], 1),
      commit('M', ['C', 'X'], 2),
      commit('S', ['C'], 0),
      commit('C', ['D'], 0),
      commit('D', [], 0),
    ];
    const handRows = handmade.map((_, index) => ({ top: index * ROW_HEIGHT, height: ROW_HEIGHT }));
    const result = computeGraphLayout(handmade, handRows, (entry) => entry.lane);
    const tailLane = result.primitives.find((primitive) => primitive.kind === 'line' && primitive.source === 'tail')!.laneId;
    // B and M end in row 3; in row 4 the open end moves from column 3 to column 1.
    const shift = result.primitives.find((primitive) => primitive.kind === 'shift' && primitive.laneId === tailLane);
    expect(shift).toMatchObject({ fromLane: 3, toLane: 1, yTop: 4 * ROW_HEIGHT });
    expect(findCollisions(result)).toEqual([]);

    // Same history with X loaded below: the merge line is placed in row order as well,
    // moves left the same way and X continues in the column the line arrives in.
    const withParent = [...handmade, commit('X', [], 5)];
    const parentRows = withParent.map((_, index) => ({ top: index * ROW_HEIGHT, height: ROW_HEIGHT }));
    const loadedResult = computeGraphLayout(withParent, parentRows, (entry) => entry.lane);
    expect(loadedResult.primitives.find((primitive) => primitive.kind === 'shift')).toMatchObject({
      fromLane: 3,
      toLane: 1,
      yTop: 4 * ROW_HEIGHT,
    });
    expect(loadedResult.commitVisualLaneByCommitIndex.get(6)).toBe(1);
    expect(findCollisions(loadedResult)).toEqual([]);
  });

  it('a shared parent continues in the left line (merge line left, lane right)', () => {
    const commit = (hash: string, parents: string[], lane: number): CommitView => ({
      hash, shortHash: hash, parents, lane, segments: [], refs: [], authorName: 'a', authorDate: '', subject: hash,
    });
    // M merges X; the merge line arrives at X in column 1. G (column 2) and X share parent P.
    const history = [
      commit('M', ['A', 'X'], 0),
      commit('G', ['P'], 1),
      commit('A', ['B'], 0),
      commit('X', ['P'], 1),
      commit('P', ['B'], 1),
      commit('B', [], 0),
    ];
    const historyRows = history.map((_, index) => ({ top: index * ROW_HEIGHT, height: ROW_HEIGHT }));
    const result = computeGraphLayout(history, historyRows, (entry) => entry.lane);
    // X and P stay in column 1 (left line), G bends into P from column 2.
    expect(columnsBySubject(history, result)).toMatchObject({ G: 2, X: 1, P: 1 });
    expect(result.ownerLaneByCommitIndex.get(4)).toBe(result.ownerLaneByCommitIndex.get(3));
    expect(findCollisions(result)).toEqual([]);
  });
});

describe('compaction (lanes move into freed columns)', () => {
  // Rightmost used column per row, averaged: a simple measure for the graph width.
  const averageWidth = (layout: GraphLayout, rowCount: number): number => {
    const widths = new Array<number>(rowCount).fill(0);
    layout.primitives.forEach((primitive) => {
      if (primitive.kind === 'line' || primitive.kind === 'dot') {
        widths[primitive.rowIndex] = Math.max(widths[primitive.rowIndex], primitive.visualLane + 1);
      }
    });
    return widths.reduce((sum, width) => sum + width, 0) / rowCount;
  };
  // limit: only the first n commits (first page, open ends to the list end exist).
  const layouts = (name: FixtureName, limit?: number) => {
    const commits = loadCommitViews(name).slice(0, limit);
    const rows = commits.map((_, index) => ({ top: index * ROW_HEIGHT, height: ROW_HEIGHT }));
    const lane = (commit: CommitView) => commit.lane;
    return {
      commits,
      compact: computeGraphLayout(commits, rows, lane),
      plain: computeGraphLayout(commits, rows, lane, undefined, { compact: false }),
    };
  };

  it.each(fixtureNames)('%s: never gets wider and commit dots stay where they are', (name) => {
    const { commits, compact, plain } = layouts(name);
    expect(averageWidth(compact, commits.length)).toBeLessThanOrEqual(averageWidth(plain, commits.length));
    expect(compact.commitVisualLaneByCommitIndex).toEqual(plain.commitVisualLaneByCommitIndex);
  });

  it.each([60, 120])('many-branches, first %i commits: never wider, no overlap', (limit) => {
    const { commits, compact, plain } = layouts('many-branches', limit);
    expect(averageWidth(compact, commits.length)).toBeLessThanOrEqual(averageWidth(plain, commits.length));
    expect(findCollisions(compact)).toEqual([]);
  });

  it('shifts only for good (no curve back to the right)', () => {
    const { compact, plain } = layouts('many-branches', 120);
    const shiftKeys = (layout: GraphLayout) =>
      new Set(
        layout.primitives
          .filter((primitive) => primitive.kind === 'shift')
          .map((primitive) => (primitive.kind === 'shift' ? `${primitive.laneId}:${primitive.yTop}` : '')),
      );
    const plainShifts = shiftKeys(plain);
    compact.primitives.forEach((primitive) => {
      if (primitive.kind === 'shift' && !plainShifts.has(`${primitive.laneId}:${primitive.yTop}`)) {
        // Shifts added by compaction always go left.
        expect(primitive.toLane).toBeLessThan(primitive.fromLane);
      }
    });
  });
});

describe('coalesceLines', () => {
  it.each(fixtureNames)('%s: the same stretches with fewer lines', (name) => {
    const { layout } = layoutFor(name);
    const coalesced = coalesceLines(layout.primitives);
    expect(coverage(coalesced)).toEqual(coverage(layout.primitives));
    // Curves and dots stay untouched and in order.
    const others = (list: GraphPrimitive[]) => list.filter((primitive) => primitive.kind !== 'line');
    expect(others(coalesced)).toEqual(others(layout.primitives));
    expect(coalesced.length).toBeLessThanOrEqual(layout.primitives.length);
  });

  it('does not change its input', () => {
    const { layout } = layoutFor('linear');
    const before = JSON.stringify(layout.primitives);
    coalesceLines(layout.primitives);
    expect(JSON.stringify(layout.primitives)).toBe(before);
  });
});

describe('computeGraphLayout: single scenarios', () => {
  it('linear: one lane in column 0', () => {
    const { commits, layout } = layoutFor('linear');
    expect(layout.laneCount).toBe(1);
    expect(new Set(Object.values(columnsBySubject(commits, layout)))).toEqual(new Set([0]));
  });

  it('feature-merge: feature commits lie together right of main', () => {
    const { commits, layout } = layoutFor('feature-merge');
    expect(layout.laneCount).toBe(2);
    expect(columnsBySubject(commits, layout)).toEqual({
      d: 0,
      'merge feature': 0,
      c: 0,
      f2: 1,
      f1: 1,
      b: 0,
      a: 0,
    });
    const index = indexBySubject(commits);
    const owner = (subject: string): number | undefined =>
      layout.ownerLaneByCommitIndex.get(index.get(subject)!);
    // The first-parent chain keeps its lane (= color).
    expect(owner('f2')).toBe(owner('f1'));
    expect(owner('d')).toBe(owner('a'));
    expect(owner('f2')).not.toBe(owner('d'));
  });

  it('parallel-branches: both branches end in the base commit', () => {
    const { commits, layout } = layoutFor('parallel-branches');
    expect(layout.laneCount).toBe(3);
    const baseRow = indexBySubject(commits).get('base')!;
    const branchesIntoBase = layout.primitives.filter(
      (primitive) => primitive.kind === 'branch' && primitive.toLane === 0 && primitive.yTo === yMid(baseRow),
    );
    expect(branchesIntoBase).toHaveLength(2);
  });

  it('staggered-merges: every merge line meets the tip of its branch', () => {
    const { commits, layout } = layoutFor('staggered-merges');
    const index = indexBySubject(commits);
    const column = (subject: string): number => layout.commitVisualLaneByCommitIndex.get(index.get(subject)!)!;
    // Merge commit -> column its merge line turns into (S-curve from the merge point, in the
    // color of the merged lane).
    const mergeTarget = (subject: string): number | undefined => {
      const row = index.get(subject)!;
      const mergedLane = layout.ownerLaneByCommitIndex.get(row);
      const entry = layout.primitives.find(
        (primitive) =>
          primitive.kind === 'branch' &&
          primitive.yFrom === yMid(row) &&
          primitive.fromLane === layout.commitVisualLaneByCommitIndex.get(row) &&
          primitive.laneId !== mergedLane,
      );
      return entry?.kind === 'branch' ? entry.toLane : undefined;
    };
    expect(mergeTarget('merge one')).toBe(column('o1'));
    expect(mergeTarget('merge two')).toBe(column('t2'));
    expect(mergeTarget('merge three')).toBe(column('h1'));
  });
});

describe('Uncommitted Changes (pseudo row with parent HEAD)', () => {
  const commit = (hash: string, parents: string[], lane: number, isUncommitted = false): CommitView => ({
    hash, shortHash: hash, parents, lane, segments: [], refs: [], authorName: 'a', authorDate: '', subject: hash,
    isUncommitted,
  });
  const layoutOf = (history: CommitView[]): GraphLayout =>
    computeGraphLayout(
      history,
      history.map((_, index) => ({ top: index * ROW_HEIGHT, height: ROW_HEIGHT })),
      (entry) => entry.lane,
    );

  // The pseudo row has its own lane (drawn grey); all its pieces stay in one column.
  const uncommittedColumns = (result: GraphLayout): Set<number> => {
    const laneId = result.ownerLaneByCommitIndex.get(0);
    return new Set(
      result.primitives
        .filter((primitive) => primitive.laneId === laneId)
        .map((primitive) => ('visualLane' in primitive ? primitive.visualLane : primitive.toLane)),
    );
  };
  // Columns of the real commits must be the same as without the pseudo row.
  const realColumnsUnchanged = (history: CommitView[], result: GraphLayout): void => {
    const without = layoutOf(history.slice(1).map((entry) => ({ ...entry })));
    const { U: _ignored, ...withRow } = columnsBySubject(history, result);
    expect(withRow).toEqual(columnsBySubject(history.slice(1), without));
  };

  it('HEAD on top: same column as HEAD, no extra column', () => {
    const history = [commit('U', ['H'], 0, true), commit('H', ['A'], 0), commit('A', [], 0)];
    const result = layoutOf(history);
    expect(columnsBySubject(history, result)).toEqual({ U: 0, H: 0, A: 0 });
    expect(uncommittedColumns(result)).toEqual(new Set([0]));
    realColumnsUnchanged(history, result);
    expect(findCollisions(result)).toEqual([]);
  });

  it('HEAD on a side branch further down: the line runs into the column of HEAD, the rest stays the same', () => {
    // T is the newest commit on main; HEAD (F) is a feature commit one row further down.
    const history = [commit('U', ['F'], 1, true), commit('T', ['A'], 0), commit('F', ['A'], 1), commit('A', [], 0)];
    const result = layoutOf(history);
    expect(columnsBySubject(history, result)).toEqual({ U: 1, T: 0, F: 1, A: 0 });
    expect(uncommittedColumns(result)).toEqual(new Set([1]));
    realColumnsUnchanged(history, result);
    expect(findCollisions(result)).toEqual([]);
  });

  it.each(fixtureNames)('%s: the pseudo row above HEAD (top commit) does not change the columns', (name) => {
    const real = loadCommitViews(name);
    const history = [commit('U', [real[0].hash], real[0].lane, true), ...real];
    const result = layoutOf(history);
    expect(result.commitVisualLaneByCommitIndex.get(0)).toBe(result.commitVisualLaneByCommitIndex.get(1));
    expect(uncommittedColumns(result).size).toBe(1);
    expect(findCollisions(result)).toEqual([]);
  });
});
