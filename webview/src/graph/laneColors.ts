import type { GraphPrimitive } from './graphLayout';

// Colors for the logical lanes: lanes that run next to each other (or meet in a branch/merge
// curve) should not share a color. Lanes are colored top to bottom; each takes its usual color
// (lanes in order of their start, modulo palette) when no neighbour already has it, otherwise
// the color that clashes least with its neighbours. Uses the final primitives, so compaction
// moves are included.
// A color once shown never changes: with `memory`, every lane is remembered by where it starts
// (commit of its first row + its columns there) and keeps its color in later renders, e.g. when
// more commits are loaded and a neighbour shows up below. Only lanes new to the view are chosen.
// Lane ids are not used for colors or keys: they can be numbered differently once more commits
// are loaded (a merge line to a parent that is not loaded yet gets an id of its own).

// How much a neighbour counts by column distance: touching or next column clash, two columns
// apart only slightly (it still helps to spread colors).
const WEIGHT_BY_DISTANCE = [10, 10, 1];

// Row of a y coordinate: the row whose middle is nearest (rowMids ascending).
const rowAt = (rowMids: number[], y: number): number => {
  let low = 0;
  let high = rowMids.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rowMids[mid] < y) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  if (low > 0 && Math.abs(rowMids[low - 1] - y) <= Math.abs(rowMids[low] - y)) {
    return low - 1;
  }
  return low;
};

export const assignLaneColors = (
  primitives: GraphPrimitive[],
  rowMids: number[],
  paletteSize: number,
  // Lanes drawn in their own fixed color (e.g. the grey "Uncommitted Changes" lanes).
  skipLanes: Set<number> = new Set(),
  // Colors shown before: rowKey(row) names the commit of a row; memory maps lane keys to colors
  // and is updated with the colors of this render.
  remember?: { rowKey: (row: number) => string | undefined; memory: Map<string, number> },
): Map<number, number> => {
  // Per row: which columns each lane occupies.
  const cells = new Map<number, Array<{ laneId: number; column: number }>>();
  const firstRow = new Map<number, number>();
  // Rows with the lane's own commit dot (to tell a lane from merge lines leaving the same row).
  const dotRows = new Map<number, Set<number>>();
  const occupy = (row: number, laneId: number, column: number): void => {
    if (skipLanes.has(laneId)) {
      return;
    }
    const list = cells.get(row);
    if (list) {
      list.push({ laneId, column });
    } else {
      cells.set(row, [{ laneId, column }]);
    }
    firstRow.set(laneId, Math.min(firstRow.get(laneId) ?? row, row));
  };
  if (rowMids.length === 0) {
    return new Map();
  }
  primitives.forEach((primitive) => {
    switch (primitive.kind) {
      case 'dot':
        if (!skipLanes.has(primitive.laneId)) {
          const rows = dotRows.get(primitive.laneId) ?? new Set<number>();
          rows.add(primitive.rowIndex);
          dotRows.set(primitive.laneId, rows);
        }
        occupy(primitive.rowIndex, primitive.laneId, primitive.visualLane);
        return;
      case 'line':
        occupy(primitive.rowIndex, primitive.laneId, primitive.visualLane);
        return;
      case 'branch':
        occupy(rowAt(rowMids, primitive.yFrom), primitive.laneId, primitive.fromLane);
        occupy(rowAt(rowMids, primitive.yTo), primitive.laneId, primitive.toLane);
        return;
      case 'shift': {
        const row = rowAt(rowMids, (primitive.yTop + primitive.yBottom) / 2);
        occupy(row, primitive.laneId, primitive.fromLane);
        occupy(row, primitive.laneId, primitive.toLane);
        return;
      }
    }
  });

  // Neighbour weights between lanes (summed over all rows where they are close).
  const weights = new Map<number, Map<number, number>>();
  const addWeight = (a: number, b: number, weight: number): void => {
    const map = weights.get(a) ?? new Map<number, number>();
    map.set(b, (map.get(b) ?? 0) + weight);
    weights.set(a, map);
  };
  cells.forEach((list) => {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.laneId === b.laneId) {
          continue;
        }
        const weight = WEIGHT_BY_DISTANCE[Math.abs(a.column - b.column)];
        if (weight) {
          addWeight(a.laneId, b.laneId, weight);
          addWeight(b.laneId, a.laneId, weight);
        }
      }
    }
  });

  // Start of each lane: first row, then its columns there (left to right).
  const startColumns = new Map<number, number[]>();
  firstRow.forEach((row, laneId) => {
    const columns = (cells.get(row) ?? []).filter((cell) => cell.laneId === laneId).map((cell) => cell.column);
    startColumns.set(laneId, [...new Set(columns)].sort((a, b) => a - b));
  });
  // Top to bottom, left to right (the id only breaks remaining ties).
  const lanes = [...firstRow.keys()].sort(
    (a, b) => firstRow.get(a)! - firstRow.get(b)! || startColumns.get(a)![0] - startColumns.get(b)![0] || a - b,
  );
  // Key of a lane: the commit of its first row and the columns there. A lane that starts with its
  // own commit dot is the only one of that row; lanes starting with a curve out of a commit (merge
  // lines, several per commit) add the columns of the next row, where the curve arrives.
  const columnsIn = (row: number, laneId: number): string =>
    [...new Set((cells.get(row) ?? []).filter((cell) => cell.laneId === laneId).map((cell) => cell.column))]
      .sort((a, b) => a - b)
      .join(',');
  const keyOf = (laneId: number): string | undefined => {
    const row = firstRow.get(laneId)!;
    const commit = remember?.rowKey(row);
    if (commit === undefined) {
      return undefined;
    }
    return dotRows.get(laneId)?.has(row)
      ? `${commit}:dot`
      : `${commit}:${columnsIn(row, laneId)}>${columnsIn(row + 1, laneId)}`;
  };

  // Lanes shown before keep their color.
  const colors = new Map<number, number>();
  lanes.forEach((laneId) => {
    const key = keyOf(laneId);
    const known = key === undefined ? undefined : remember?.memory.get(key);
    if (known !== undefined && known < paletteSize) {
      colors.set(laneId, known);
    }
  });
  lanes.forEach((laneId, order) => {
    if (colors.has(laneId)) {
      return;
    }
    const preferred = order % paletteSize;
    const clash = new Array<number>(paletteSize).fill(0);
    (weights.get(laneId) ?? new Map<number, number>()).forEach((weight, other) => {
      const color = colors.get(other);
      if (color !== undefined) {
        clash[color] += weight;
      }
    });
    // Least clash wins; on a tie the usual color, then the next ones after it.
    let best = preferred;
    for (let step = 1; step < paletteSize; step += 1) {
      const color = (preferred + step) % paletteSize;
      if (clash[color] < clash[best]) {
        best = color;
      }
    }
    colors.set(laneId, best);
  });

  if (remember) {
    // Remember this render's colors; drop old entries only when the memory grows large.
    const current = new Map<string, number>();
    lanes.forEach((laneId) => {
      const key = keyOf(laneId);
      if (key !== undefined) {
        current.set(key, colors.get(laneId)!);
      }
    });
    if (remember.memory.size > Math.max(20_000, current.size * 4)) {
      remember.memory.clear();
    }
    current.forEach((color, key) => remember.memory.set(key, color));
  }
  return colors;
};
