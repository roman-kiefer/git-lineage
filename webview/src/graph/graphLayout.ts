import type { CommitView } from './model';
import { buildCommitIndexByHash, buildRowVisualLaneMaps, type RowVisualLaneMaps } from './layoutRows';

// Pure lane layout (no DOM).
// The result are drawing primitives in lane and pixel-y coordinates;
// renderSvg.ts turns them into SVG (x = laneToX(lane)).

// Vertical extent of a rendered row.
export type RowGeometry = { top: number; height: number };

// Vertical lane piece within one row.
export type LinePrimitive = {
  kind: 'line';
  laneId: number;
  visualLane: number;
  rowIndex: number;
  y1: number;
  y2: number;
  // Origin: lane towards the first parent, line to a further merge parent, or open end (parent not loaded).
  source: 'lane' | 'merge' | 'tail';
};

// Branch: from the middle of the row above the parent to the parent's commit dot.
export type BranchPrimitive = {
  kind: 'branch';
  laneId: number;
  fromLane: number;
  toLane: number;
  yFrom: number;
  yTo: number;
};

// Shift of a lane to the left over one whole row (same color).
export type ShiftPrimitive = {
  kind: 'shift';
  laneId: number;
  fromLane: number;
  toLane: number;
  yTop: number;
  yBottom: number;
};

// Commit dot.
export type DotPrimitive = {
  kind: 'dot';
  laneId: number;
  visualLane: number;
  rowIndex: number;
  y: number;
};

export type GraphPrimitive =
  | LinePrimitive
  | BranchPrimitive
  | ShiftPrimitive
  | DotPrimitive;

export type GraphLayout = {
  // Primitives in drawing order.
  primitives: GraphPrimitive[];
  // Number of logical lanes the layout assigned.
  laneCount: number;
  // Logical lane (color) per commit row.
  ownerLaneByCommitIndex: Map<number, number>;
  // Visible column of the commit dot per commit row.
  commitVisualLaneByCommitIndex: Map<number, number>;
  // Debug: per row, which logical lanes occupy which visible columns.
  rowLaneOccupancy: Map<number, Map<number, Set<number>>>;
  // Debug: per row and lane, how many left steps were possible.
  rowShiftBudgetByLaneId: Map<number, Map<number, number>>;
};

export const computeGraphLayout = (
  commits: CommitView[],
  rows: RowGeometry[],
  commitLane: (commit: CommitView) => number,
  rowVisualLaneMaps: RowVisualLaneMaps = buildRowVisualLaneMaps(commits),
  // compact: move long straight pass-through stretches left into freed columns (default on).
  options: { compact?: boolean } = {},
): GraphLayout => {
  const primitives: GraphPrimitive[] = [];
  const yMids = rows.map((row) => row.top + row.height / 2);
  const indexByHash = buildCommitIndexByHash(commits);
  // Build lanes top-to-bottom by rules:
  // 1) next free commit starts next lane
  // 2) lane follows first parent downward
  // 3) if parent already belongs to another lane, branch in parent row via bezier.
  const ownerLaneByCommitIndex = new Map<number, number>();
  // Visual lane can move left over time while keeping the same logical lane/color.
  const currentVisualLaneByLaneId = new Map<number, number>();
  const commitVisualLaneByCommitIndex = new Map<number, number>();
  // Marks rows where a branch starts on a visual lane (rowIndex:visualLane).
  const branchSourceByRowAndLane = new Set<string>();
  // Marks lanes that became free due to a left-shift in the same row (rowIndex:freedVisualLane).
  const freedByShiftRowAndLane = new Set<string>();
  // Lane-specific shift-free marker (rowIndex:freedVisualLane:laneId).
  const freedByShiftRowLaneAndOwner = new Set<string>();
  // Per row, which laneIds touched which visual lanes (also used for collision checks).
  const rowLaneOccupancy = new Map<number, Map<number, Set<number>>>();
  // Debug: per row and lane, how many left-shift steps were possible in that row.
  const rowShiftBudgetByLaneId = new Map<number, Map<number, number>>();
  let laneCountByRules = 0;

  const recordRowOccupancy = (rowIndex: number, laneId: number, visualLane: number): void => {
    const rowMap = rowLaneOccupancy.get(rowIndex) ?? new Map<number, Set<number>>();
    const lanesAtVisual = rowMap.get(visualLane) ?? new Set<number>();
    lanesAtVisual.add(laneId);
    rowMap.set(visualLane, lanesAtVisual);
    rowLaneOccupancy.set(rowIndex, rowMap);
  };

  const recordShiftBudget = (rowIndex: number, laneId: number, budget: number): void => {
    const rowMap = rowShiftBudgetByLaneId.get(rowIndex) ?? new Map<number, number>();
    const existing = rowMap.get(laneId) ?? 0;
    if (budget > existing) {
      rowMap.set(laneId, budget);
    }
    rowShiftBudgetByLaneId.set(rowIndex, rowMap);
  };

  const candidateIndices = commits
    .map((commit, index) => ({ commit, index }))
    .filter(({ commit }) => !commit.isVirtual && !commit.isConnectorRow)
    .map(({ index }) => index);
  // The "Uncommitted Changes" row is placed after all real lanes: it only joins HEAD and
  // must not take over HEAD's line (that would move other branches when HEAD is not on top).
  const isPlacedLast = (index: number): boolean => commits[index]?.isUncommitted === true;
  const remaining = new Set<number>([
    ...candidateIndices.filter((index) => !isPlacedLast(index)),
    ...candidateIndices.filter(isPlacedLast),
  ]);

  const isVisualLaneOccupiedByOtherLane = (
    laneId: number,
    visualLane: number,
    rowIndex: number,
  ): boolean => {
    const laneOwners = rowLaneOccupancy.get(rowIndex)?.get(visualLane);
    if (!laneOwners || laneOwners.size === 0) {
      return false;
    }
    for (const ownerLaneId of laneOwners) {
      // A lane vacated by a same-row shift no longer blocks.
      if (freedByShiftRowLaneAndOwner.has(`${rowIndex}:${visualLane}:${ownerLaneId}`)) {
        continue;
      }
      if (ownerLaneId !== laneId) {
        return true;
      }
    }
    return false;
  };

  const leftLaneFreeReasonAtRow = (
    rowIndex: number,
    leftVisualLane: number,
  ): 'none' | 'branch' | 'shift' => {
    // A lane can be free for this row when a branch started there in the row above,
    // or when a previously processed same-row shift vacated that lane.
    if (rowIndex <= 0 || leftVisualLane < 0) {
      return 'none';
    }
    if (branchSourceByRowAndLane.has(`${rowIndex - 1}:${leftVisualLane}`)) {
      return 'branch';
    }
    if (freedByShiftRowAndLane.has(`${rowIndex}:${leftVisualLane}`)) {
      return 'shift';
    }
    return 'none';
  };

  const resolveInitialVisualLaneAtRow = (
    rowIndex: number,
    laneId: number,
    preferredVisualLane: number,
  ): number => {
    // Keep lane starts stable: prefer the commit lane hint and only move right on collision.
    let candidate = Math.max(0, preferredVisualLane);
    while (isVisualLaneOccupiedByOtherLane(laneId, candidate, rowIndex)) {
      candidate += 1;
    }
    return candidate;
  };

  const canShiftLeftThisRow = (
    rowIndex: number,
    laneId: number,
    visualLane: number,
    allowShiftFreed: boolean,
  ): 'none' | 'branch' | 'shift' => {
    if (visualLane <= 0) {
      return 'none';
    }
    const leftVisualLane = visualLane - 1;
    const freeReason = leftLaneFreeReasonAtRow(rowIndex, leftVisualLane);
    if (freeReason === 'none') {
      return 'none';
    }
    if (freeReason === 'shift' && !allowShiftFreed) {
      return 'none';
    }
    if (isVisualLaneOccupiedByOtherLane(laneId, leftVisualLane, rowIndex)) {
      return 'none';
    }
    return freeReason;
  };

  const resolveLeftShiftTargetLane = (rowIndex: number, laneId: number, visualLane: number): number => {
    if (visualLane <= 0) {
      return visualLane;
    }
    // Multi-step shifts are allowed across branch-freed lanes.
    // Same-row shift-freed lane may be consumed at most once per row/lane.
    let targetLane = visualLane;
    let usedShiftFreedStep = false;
    let movedSteps = 0;
    while (targetLane > 0) {
      const freeReason = canShiftLeftThisRow(rowIndex, laneId, targetLane, !usedShiftFreedStep);
      if (freeReason === 'none') {
        break;
      }
      if (freeReason === 'shift') {
        usedShiftFreedStep = true;
      }
      targetLane -= 1;
      movedSteps += 1;
    }
    recordShiftBudget(rowIndex, laneId, movedSteps);
    return targetLane;
  };

  const emitVerticalSegment = (
    laneId: number,
    visualLane: number,
    rowIndex: number,
    yStart: number,
    yEnd: number,
    source: LinePrimitive['source'] = 'lane',
  ): void => {
    if (yEnd <= yStart) {
      return;
    }
    primitives.push({ kind: 'line', laneId, visualLane, rowIndex, y1: yStart, y2: yEnd, source });
    recordRowOccupancy(rowIndex, laneId, visualLane);
  };

  const emitShiftLeftCurve = (
    laneId: number,
    fromVisualLane: number,
    toVisualLane: number,
    rowIndex: number,
  ): void => {
    const row = rows[rowIndex];
    if (!row) {
      return;
    }
    primitives.push({
      kind: 'shift',
      laneId,
      fromLane: fromVisualLane,
      toLane: toVisualLane,
      yTop: row.top,
      yBottom: row.top + row.height,
    });
    // Shift row touches both source and target visual lanes.
    recordRowOccupancy(rowIndex, laneId, fromVisualLane);
    recordRowOccupancy(rowIndex, laneId, toVisualLane);
    // Source lane is now freed in this row and can be reused by the right lane.
    freedByShiftRowAndLane.add(`${rowIndex}:${fromVisualLane}`);
    freedByShiftRowLaneAndOwner.add(`${rowIndex}:${fromVisualLane}:${laneId}`);
  };

  // Shared row walk: optional left shift, otherwise a vertical segment from segmentRange().
  const walkRow = (
    laneId: number,
    rowIndex: number,
    allowShift: boolean,
  ): { visualLane: number; shifted: boolean } => {
    let visualLane = currentVisualLaneByLaneId.get(laneId) ?? laneId;
    const shiftTarget = allowShift && visualLane > 0
      ? resolveLeftShiftTargetLane(rowIndex, laneId, visualLane)
      : visualLane;
    if (shiftTarget < visualLane) {
      // Rule: if left lane is effectively empty, shift left via bezier while keeping color.
      emitShiftLeftCurve(laneId, visualLane, shiftTarget, rowIndex);
      visualLane = shiftTarget;
      currentVisualLaneByLaneId.set(laneId, visualLane);
      return { visualLane, shifted: true };
    }
    return { visualLane, shifted: false };
  };

  // Edge whose parent is not among the loaded rows: continue down to the end of the list
  // (it connects once more commits are loaded). allowShift lets the line move left into
  // columns freed by branches, like a regular lane.
  const emitOpenEnd = (
    laneId: number,
    firstRow: number,
    startY: number,
    allowShift: boolean,
  ): void => {
    for (let rowIndex = firstRow; rowIndex <= rows.length - 1; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row) {
        continue;
      }
      const { visualLane, shifted } = walkRow(laneId, rowIndex, allowShift && rowIndex > firstRow);
      if (shifted) {
        // In-row shift: curve already covers this row from top to bottom.
        continue;
      }
      const yStart = rowIndex === firstRow ? startY : row.top;
      emitVerticalSegment(laneId, visualLane, rowIndex, yStart, row.top + row.height, 'tail');
    }
  };

  // Lane whose first parent is not loaded: continue below its last commit to the list end.
  const emitLaneOpenEnd = (laneId: number, fromRowIndex: number): void => {
    const yMid = yMids[fromRowIndex];
    if (yMid !== undefined) {
      emitOpenEnd(laneId, fromRowIndex, yMid, true);
    }
  };

  const emitBranchCurve = (
    laneId: number,
    sourceVisualLane: number,
    parentVisualLane: number,
    parentRowIndex: number,
  ): void => {
    const row = rows[parentRowIndex];
    const yMid = yMids[parentRowIndex];
    if (!row || yMid === undefined) {
      return;
    }
    // Rule: branch starts at the vertical middle of the row above parent.
    const sourceRowIndex = Math.max(0, parentRowIndex - 1);
    primitives.push({
      kind: 'branch',
      laneId,
      fromLane: sourceVisualLane,
      toLane: parentVisualLane,
      yFrom: yMids[sourceRowIndex] ?? row.top,
      yTo: yMid,
    });
    branchSourceByRowAndLane.add(`${sourceRowIndex}:${sourceVisualLane}`);
    recordRowOccupancy(sourceRowIndex, laneId, sourceVisualLane);
    recordRowOccupancy(parentRowIndex, laneId, parentVisualLane);
  };

  // Leave the merge point towards the route column. Mirrors the branch rule:
  // an S-curve with vertical tangents from the merge point (row middle) to the middle of
  // the next row. Returns the y in the next row where the vertical continuation starts.
  const emitMergeEntryCurve = (
    colorLaneId: number,
    sourceVisualLane: number,
    routeColumn: number,
    sourceRowIndex: number,
  ): number | undefined => {
    const row = rows[sourceRowIndex];
    const yMid = yMids[sourceRowIndex];
    if (!row || yMid === undefined) {
      return undefined;
    }
    const nextRow = rows[sourceRowIndex + 1];
    const nextMid = yMids[sourceRowIndex + 1];
    if (sourceVisualLane === routeColumn) {
      // Same column: straight down, continue from the top of the next row.
      emitVerticalSegment(colorLaneId, routeColumn, sourceRowIndex, yMid, row.top + row.height, 'merge');
      return nextRow?.top;
    }
    primitives.push({
      kind: 'branch',
      laneId: colorLaneId,
      fromLane: sourceVisualLane,
      toLane: routeColumn,
      yFrom: yMid,
      // Last loaded row: only half a row is available.
      yTo: nextMid ?? row.top + row.height,
    });
    recordRowOccupancy(sourceRowIndex, colorLaneId, sourceVisualLane);
    if (nextRow) {
      recordRowOccupancy(sourceRowIndex + 1, colorLaneId, routeColumn);
    }
    return nextMid;
  };

  const emitMergeParentPath = (
    colorLaneId: number,
    sourceVisualLane: number,
    targetVisualLane: number,
    sourceRowIndex: number,
    parentRowIndex: number,
    reservedPath?: number[],
  ): void => {
    // Route through a column that is free (or owned by the target lane itself) in every
    // row between merge commit and parent, so the merge line never runs on top of another lane.
    // A path reserved while the lanes were placed (reserveMergeRoute) takes precedence:
    // one column per row between merge commit and parent, possibly moving left on the way.
    const firstColumn =
      reservedPath?.[0] ??
      findFreeMergeColumn(colorLaneId, targetVisualLane, sourceRowIndex + 1, parentRowIndex - 1);
    const columnAt = (rowIndex: number): number =>
      reservedPath?.[Math.min(rowIndex - sourceRowIndex - 1, reservedPath.length - 1)] ?? firstColumn;
    const continueY = emitMergeEntryCurve(colorLaneId, sourceVisualLane, firstColumn, sourceRowIndex);
    for (let rowIndex = sourceRowIndex + 1; rowIndex <= parentRowIndex; rowIndex += 1) {
      const row = rows[rowIndex];
      const yMid = yMids[rowIndex];
      if (!row || yMid === undefined) {
        continue;
      }
      const yStart = rowIndex === sourceRowIndex + 1 && continueY !== undefined ? continueY : row.top;
      // Column above this row (the path's column in the previous row).
      const routeColumn = rowIndex === sourceRowIndex + 1 ? firstColumn : columnAt(rowIndex - 1);
      if (rowIndex < parentRowIndex && columnAt(rowIndex) !== routeColumn) {
        // Reserved path moves left in this row: same shift curve as a lane.
        emitShiftLeftCurve(colorLaneId, routeColumn, columnAt(rowIndex), rowIndex);
      } else if (rowIndex < parentRowIndex) {
        emitVerticalSegment(colorLaneId, routeColumn, rowIndex, yStart, row.top + row.height, 'merge');
      } else if (routeColumn === targetVisualLane) {
        // Parent row: straight down into the commit point (nothing left if the curve ended there).
        emitVerticalSegment(colorLaneId, routeColumn, rowIndex, yStart, yMid, 'merge');
      } else {
        // Parent row: bend from the detour column into the commit point (same bezier rule as branches).
        primitives.push({
          kind: 'branch',
          laneId: colorLaneId,
          fromLane: routeColumn,
          toLane: targetVisualLane,
          yFrom: row.top,
          yTo: yMid,
        });
        recordRowOccupancy(rowIndex, colorLaneId, routeColumn);
        recordRowOccupancy(rowIndex, colorLaneId, targetVisualLane);
      }
    }
  };

  // True if no other lane uses the column anywhere in the row range (inclusive).
  const isColumnFreeForLane = (laneId: number, column: number, fromRow: number, toRow: number): boolean => {
    for (let rowIndex = fromRow; rowIndex <= toRow; rowIndex += 1) {
      if (isVisualLaneOccupiedByOtherLane(laneId, column, rowIndex)) {
        return false;
      }
    }
    return true;
  };

  // Preferred column first, then alternate right/left with growing distance.
  // A column right of everything used is always free, so the search terminates.
  const findFreeMergeColumn = (laneId: number, preferred: number, fromRow: number, toRow: number): number => {
    if (toRow < fromRow) {
      return preferred;
    }
    for (let distance = 0; ; distance += 1) {
      const candidates = distance === 0 ? [preferred] : [preferred + distance, preferred - distance];
      for (const column of candidates) {
        if (column >= 0 && isColumnFreeForLane(laneId, column, fromRow, toRow)) {
          return column;
        }
      }
    }
  };

  // Merge whose extra parent is not loaded: curve into a column that is free down to the
  // list end and continue there. The merged-in branch gets its own logical lane (= color).
  // Timing matters (see flushMergeOpenEnds): drawn after all lanes starting above the merge
  // commit are placed and before lanes starting below it, so earlier lines keep the columns
  // further left and later lanes avoid this one. Like a lane open end, the line moves left
  // into columns freed by lanes ending above (no gaps left of it).
  const emitMergeOpenEnd = (commitIndex: number): void => {
    const sourceColumn = commitVisualLaneByCommitIndex.get(commitIndex);
    if (sourceColumn === undefined || commitIndex + 1 > rows.length - 1) {
      return;
    }
    const laneId = laneCountByRules;
    laneCountByRules += 1;
    const column = findFreeMergeColumn(laneId, sourceColumn + 1, commitIndex + 1, rows.length - 1);
    currentVisualLaneByLaneId.set(laneId, column);
    const continueY = emitMergeEntryCurve(laneId, sourceColumn, column, commitIndex);
    if (continueY !== undefined) {
      emitOpenEnd(laneId, commitIndex + 1, continueY, true);
    }
  };

  // Route per merge edge to a loaded parent (key commitIndex:extraParentIndex): one column per
  // row between merge commit and parent. Fixed in row order like the open ends, drawn after
  // all lanes (the parent column is known then).
  const reservedRouteByEdge = new Map<string, number[]>();
  // Lane starting at a merge parent continues in the column its merge line arrives in.
  const routeColumnByParentIndex = new Map<number, number>();
  // Occupancy owner for reserved routes whose parent lane is not placed yet (never a real lane).
  let nextReservationOwner = -1;

  // Reserve the column for a merge line to a loaded parent below the merge commit.
  const reserveMergeRoute = (commitIndex: number, parentIndex: number, edgeKey: string): void => {
    const sourceColumn = commitVisualLaneByCommitIndex.get(commitIndex);
    // Parent directly below: no rows in between, the line bends straight into it.
    if (sourceColumn === undefined || parentIndex <= commitIndex + 1) {
      return;
    }
    // Parent already placed: prefer its column and let the line share its own lane's column.
    const parentOwner = ownerLaneByCommitIndex.get(parentIndex);
    const parentColumn = parentOwner === undefined ? undefined : commitVisualLaneByCommitIndex.get(parentIndex);
    const owner = parentOwner ?? nextReservationOwner--;
    let column = findFreeMergeColumn(owner, parentColumn ?? sourceColumn + 1, commitIndex + 1, parentIndex - 1);
    const path: number[] = [];
    for (let rowIndex = commitIndex + 1; rowIndex < parentIndex; rowIndex += 1) {
      // Like a lane: move left into columns freed by lanes ending above, if the column stays
      // free down to the parent. Not in the first/last row (entry curve and parent bend).
      if (rowIndex > commitIndex + 1 && rowIndex < parentIndex - 1) {
        let target = column;
        while (
          target - 1 >= (parentColumn ?? 0) &&
          leftLaneFreeReasonAtRow(rowIndex, target - 1) !== 'none' &&
          isColumnFreeForLane(owner, target - 1, rowIndex, parentIndex - 1)
        ) {
          target -= 1;
        }
        if (target < column) {
          // Shift row touches both columns.
          recordRowOccupancy(rowIndex, owner, column);
          // The vacated column may be taken by the lane to the right in this row,
          // exactly as after a lane's own shift (see emitShiftLeftCurve).
          freedByShiftRowAndLane.add(`${rowIndex}:${column}`);
          freedByShiftRowLaneAndOwner.add(`${rowIndex}:${column}:${owner}`);
          column = target;
        }
      }
      recordRowOccupancy(rowIndex, owner, column);
      path.push(column);
    }
    reservedRouteByEdge.set(edgeKey, path);
    if (!routeColumnByParentIndex.has(parentIndex)) {
      routeColumnByParentIndex.set(parentIndex, column);
    }
  };

  // Commits per first parent (row index of parent -> row indices of its first-parent children).
  const firstParentChildren = new Map<number, number[]>();
  commits.forEach((commit, index) => {
    const parentIndex = commit.parents?.[0] ? indexByHash.get(commit.parents[0]) : undefined;
    if (parentIndex !== undefined && parentIndex > index) {
      const children = firstParentChildren.get(parentIndex) ?? [];
      children.push(index);
      firstParentChildren.set(parentIndex, children);
    }
  });

  // Column of a merge line arriving at another, not yet placed child of the parent, if it is
  // left of the lane's current column (smallest such column), else undefined.
  const findYieldColumn = (parentIndex: number, childIndex: number, laneId: number): number | undefined => {
    const laneColumn = currentVisualLaneByLaneId.get(laneId) ?? laneId;
    let best: number | undefined;
    (firstParentChildren.get(parentIndex) ?? []).forEach((otherChild) => {
      if (otherChild === childIndex || ownerLaneByCommitIndex.has(otherChild)) {
        return;
      }
      const column = routeColumnByParentIndex.get(otherChild);
      if (column !== undefined && column < laneColumn && (best === undefined || column < best)) {
        best = column;
      }
    });
    return best;
  };

  // Merge edges waiting for their column: parentIndex undefined = parent not loaded (open end).
  type PendingMerge = { commitIndex: number; parentIndex: number | undefined; edgeKey: string };
  const pendingMerges: PendingMerge[] = [];

  // Place waiting merge lines whose merge commit lies above the given row.
  const flushMergeOpenEnds = (beforeRow: number): void => {
    pendingMerges.sort((a, b) => a.commitIndex - b.commitIndex);
    while (pendingMerges.length > 0 && pendingMerges[0].commitIndex < beforeRow) {
      const { commitIndex, parentIndex, edgeKey } = pendingMerges.shift()!;
      if (parentIndex === undefined) {
        emitMergeOpenEnd(commitIndex);
      } else {
        reserveMergeRoute(commitIndex, parentIndex, edgeKey);
      }
    }
  };

  while (remaining.size > 0) {
    // Next free commit (smallest row index) becomes the start of the next lane.
    // Set keeps ascending insertion order and only shrinks, so the first entry is the smallest
    // (rows placed last, see isPlacedLast, come after all others).
    const startIndex: number = remaining.values().next().value!;
    // Lanes above this start are placed: now merge open ends from rows above may take columns.
    // Before a row placed last, all real lanes are done, so every pending merge is placed.
    flushMergeOpenEnds(isPlacedLast(startIndex) ? commits.length : startIndex);
    const laneId = laneCountByRules;
    laneCountByRules += 1;
    // A lane starting at a merge parent keeps the column of the arriving merge line.
    const preferredVisualLane = Math.max(
      0,
      routeColumnByParentIndex.get(startIndex) ?? commits[startIndex]?.lane ?? laneId,
    );
    currentVisualLaneByLaneId.set(
      laneId,
      resolveInitialVisualLaneAtRow(startIndex, laneId, preferredVisualLane),
    );

    let currentIndex: number | undefined = startIndex;
    while (currentIndex !== undefined) {
      if (!ownerLaneByCommitIndex.has(currentIndex)) {
        ownerLaneByCommitIndex.set(currentIndex, laneId);
      }
      if (!commitVisualLaneByCommitIndex.has(currentIndex)) {
        commitVisualLaneByCommitIndex.set(
          currentIndex,
          currentVisualLaneByLaneId.get(laneId) ?? laneId,
        );
      }
      remaining.delete(currentIndex);

      // Merge parents: queue their lines, placed in row order (see flushMergeOpenEnds).
      if (ownerLaneByCommitIndex.get(currentIndex) === laneId) {
        const mergeIndex = currentIndex;
        (commits[mergeIndex]?.parents ?? []).slice(1).forEach((mergeParent, extraParentIndex) => {
          const mergeParentIndex = indexByHash.get(mergeParent);
          // Parents above the merge commit (inconsistent order) get no line, as before.
          if (mergeParentIndex === undefined || mergeParentIndex > mergeIndex) {
            pendingMerges.push({
              commitIndex: mergeIndex,
              parentIndex: mergeParentIndex,
              edgeKey: `${mergeIndex}:${extraParentIndex}`,
            });
          }
        });
      }

      const parentHash = commits[currentIndex]?.parents?.[0];
      if (!parentHash) {
        break;
      }
      const parentIndex = indexByHash.get(parentHash);
      // If parent is not available in currently rendered rows,
      // continue this lane vertically to the end of the list.
      if (parentIndex === undefined || parentIndex <= currentIndex) {
        emitLaneOpenEnd(laneId, currentIndex);
        break;
      }
      const parentOwnerLane = ownerLaneByCommitIndex.get(parentIndex);
      // Parent not placed yet, but another child of it (not placed yet either) is reached by a
      // merge line further left: leave the parent to that child's lane (the shared parent
      // continues in the leftmost line) and bend into it at that column instead.
      const yieldColumn =
        parentOwnerLane === undefined ? findYieldColumn(parentIndex, currentIndex, laneId) : undefined;
      if (yieldColumn !== undefined) {
        commitVisualLaneByCommitIndex.set(parentIndex, yieldColumn);
      }
      const branchesToExistingParent =
        yieldColumn !== undefined || (parentOwnerLane !== undefined && parentOwnerLane !== laneId);

      // Row-by-row vertical flow from current commit down to parent row.
      for (let rowIndex: number = currentIndex; rowIndex <= parentIndex; rowIndex += 1) {
        const row = rows[rowIndex];
        const yMid = yMids[rowIndex];
        if (!row || yMid === undefined) {
          continue;
        }
        const rowTop = row.top;
        const rowBottom = row.top + row.height;
        const { visualLane, shifted } = walkRow(
          laneId,
          rowIndex,
          rowIndex > currentIndex && rowIndex < parentIndex,
        );
        if (shifted) {
          // In-row shift: curve already covers this row from top to bottom.
          continue;
        }

        if (rowIndex === currentIndex) {
          // If branch starts directly in this row and parent is the next row,
          // the curve starts at row middle and there must be no extra lower stub.
          if (branchesToExistingParent && parentIndex === currentIndex + 1) {
            continue;
          }
          emitVerticalSegment(laneId, visualLane, rowIndex, yMid, rowBottom);
          continue;
        }

        if (rowIndex < parentIndex) {
          // Rule: branch starts in the middle of the row before parent.
          const yEnd = branchesToExistingParent && rowIndex === parentIndex - 1 ? yMid : rowBottom;
          emitVerticalSegment(laneId, visualLane, rowIndex, rowTop, yEnd);
          continue;
        }

        // Parent row: either continue into parent point (same lane ownership) or branch to existing lane.
        if (branchesToExistingParent) {
          const parentVisualLane =
            commitVisualLaneByCommitIndex.get(parentIndex) ??
            currentVisualLaneByLaneId.get(parentOwnerLane ?? laneId) ??
            parentOwnerLane ??
            laneId;
          emitBranchCurve(laneId, visualLane, parentVisualLane, parentIndex);
        } else {
          emitVerticalSegment(laneId, visualLane, rowIndex, rowTop, yMid);
          if (!ownerLaneByCommitIndex.has(parentIndex)) {
            ownerLaneByCommitIndex.set(parentIndex, laneId);
            commitVisualLaneByCommitIndex.set(parentIndex, visualLane);
            remaining.delete(parentIndex);
          }
        }
      }

      if (branchesToExistingParent) {
        break;
      }
      currentIndex = parentIndex;
    }
  }

  // Remaining merge open ends (merge commits below the last lane start).
  flushMergeOpenEnds(Number.POSITIVE_INFINITY);

  const resolveDisplayedCommitVisualLane = (commitIndex: number): number => {
    const commit = commits[commitIndex];
    if (!commit) {
      return 0;
    }
    const rawLane = commitLane(commit);
    return (
      commitVisualLaneByCommitIndex.get(commitIndex) ??
      rowVisualLaneMaps.maps[commitIndex]?.get(rawLane) ??
      ownerLaneByCommitIndex.get(commitIndex) ??
      rawLane
    );
  };

  // Additional merge-parent paths after lane ownership is known.
  commits.forEach((commit, commitIndex) => {
    (commit.parents ?? []).slice(1).forEach((parentHash, extraParentIndex) => {
      const parentIndex = indexByHash.get(parentHash);
      // Not loaded: drawn as open end while the lanes were placed (flushMergeOpenEnds).
      if (parentIndex === undefined || parentIndex <= commitIndex) {
        return;
      }
      const mergeSegment = commit.segments[extraParentIndex + 1];
      const sourceRawLane = mergeSegment?.fromLane ?? commitLane(commit);
      const targetRawLane = mergeSegment?.toLane ?? commitLane(commits[parentIndex]);
      // Start and end at the commit points computed above; the git --graph based
      // row maps are only a fallback (e.g. rows without an owned commit point).
      const sourceVisualLane =
        commitVisualLaneByCommitIndex.get(commitIndex) ??
        rowVisualLaneMaps.maps[commitIndex]?.get(sourceRawLane) ??
        resolveDisplayedCommitVisualLane(commitIndex);
      const colorLaneId = ownerLaneByCommitIndex.get(parentIndex) ?? targetRawLane;
      const targetVisualLane =
        commitVisualLaneByCommitIndex.get(parentIndex) ??
        rowVisualLaneMaps.maps[parentIndex]?.get(targetRawLane) ??
        resolveDisplayedCommitVisualLane(parentIndex);
      emitMergeParentPath(
        colorLaneId,
        sourceVisualLane,
        targetVisualLane,
        commitIndex,
        parentIndex,
        reservedRouteByEdge.get(`${commitIndex}:${extraParentIndex}`),
      );
    });
  });

  // Commit points at their owned lane positions.
  ownerLaneByCommitIndex.forEach((laneId, commitIndex) => {
    const yMid = yMids[commitIndex];
    if (yMid === undefined) {
      return;
    }
    const visualLane = commitVisualLaneByCommitIndex.get(commitIndex) ?? laneId;
    primitives.push({ kind: 'dot', laneId, visualLane, rowIndex: commitIndex, y: yMid });
    recordRowOccupancy(commitIndex, laneId, visualLane);
  });

  return {
    primitives: options.compact === false ? primitives : compactLanesRepeatedly(primitives, rows, rowLaneOccupancy),
    laneCount: laneCountByRules,
    ownerLaneByCommitIndex,
    commitVisualLaneByCommitIndex,
    rowLaneOccupancy,
    rowShiftBudgetByLaneId,
  };
};

// Minimum length (rows) of a straight pass-through stretch before it may move left.
export const COMPACT_MIN_ROWS = 5;

// Row index containing y (row top inclusive; a y on a row border belongs to the lower row,
// except at the very bottom of the list).
const rowIndexAt = (rows: RowGeometry[], y: number): number => {
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (rows[middle].top <= y) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};

// Second pass ("compaction"): a lane that passes straight through a column down to the end of
// the list moves left (with one S-curve) into columns that stay free from there to the end,
// if that stretch has at least COMPACT_MIN_ROWS rows. Moves are permanent (no way back).
// Needed because lanes are placed one after another: a lane placed early cannot know that
// columns to its left are freed later by other lanes. Updates occupancy in place.
const compactLanes = (
  primitives: GraphPrimitive[],
  rows: RowGeometry[],
  occupancy: Map<number, Map<number, Set<number>>>,
  // Only these lanes are candidates (later passes: lanes moved in the previous pass).
  onlyLanes?: Set<number>,
): { primitives: GraphPrimitive[]; movedLanes: Set<number> } => {
  const movedLanes = new Set<number>();
  if (rows.length === 0) {
    return { primitives, movedLanes };
  }
  // Numeric cell key (lane, column, row); far below 2^53 for any realistic graph.
  const key = (laneId: number, column: number, rowIndex: number): number =>
    (laneId * 4096 + column) * 1048576 + rowIndex;
  // Full-row vertical segments (candidates) and cells used by anything else of the same lane.
  const fullRowLines = new Map<number, LinePrimitive>();
  const touched = new Set<number>();
  primitives.forEach((primitive) => {
    if (onlyLanes && !onlyLanes.has(primitive.laneId)) {
      return;
    }
    switch (primitive.kind) {
      case 'line': {
        const row = rows[primitive.rowIndex];
        const isFullRow = row && primitive.y1 === row.top && primitive.y2 === row.top + row.height;
        const cell = key(primitive.laneId, primitive.visualLane, primitive.rowIndex);
        if (isFullRow && !fullRowLines.has(cell)) {
          fullRowLines.set(cell, primitive);
        } else {
          touched.add(cell);
        }
        return;
      }
      case 'dot':
        touched.add(key(primitive.laneId, primitive.visualLane, primitive.rowIndex));
        return;
      case 'branch':
        touched.add(key(primitive.laneId, primitive.fromLane, rowIndexAt(rows, primitive.yFrom)));
        touched.add(key(primitive.laneId, primitive.toLane, rowIndexAt(rows, Math.max(primitive.yTo - 0.001, 0))));
        return;
      case 'shift': {
        const rowIndex = rowIndexAt(rows, primitive.yTop);
        touched.add(key(primitive.laneId, primitive.fromLane, rowIndex));
        touched.add(key(primitive.laneId, primitive.toLane, rowIndex));
        return;
      }
    }
  });

  // Group untouched full-row cells into consecutive runs per lane and column.
  type Run = { laneId: number; column: number; first: number; last: number; lines: LinePrimitive[] };
  const cellsByLaneColumn = new Map<number, LinePrimitive[]>();
  fullRowLines.forEach((line, cell) => {
    if (touched.has(cell)) {
      return;
    }
    const groupKey = line.laneId * 4096 + line.visualLane;
    const bucket = cellsByLaneColumn.get(groupKey);
    if (bucket) {
      bucket.push(line);
    } else {
      cellsByLaneColumn.set(groupKey, [line]);
    }
  });
  const runs: Run[] = [];
  cellsByLaneColumn.forEach((lines) => {
    const sorted = [...lines].sort((a, b) => a.rowIndex - b.rowIndex);
    let current: Run | undefined;
    sorted.forEach((line) => {
      if (current && line.rowIndex === current.last + 1) {
        current.last = line.rowIndex;
        current.lines.push(line);
        return;
      }
      current = { laneId: line.laneId, column: line.visualLane, first: line.rowIndex, last: line.rowIndex, lines: [line] };
      runs.push(current);
    });
  });
  // Left columns first: lanes moving left free columns for lanes further right.
  runs.sort((a, b) => a.column - b.column || a.first - b.first);

  const isFreeFor = (laneId: number, column: number, rowIndex: number): boolean => {
    const owners = occupancy.get(rowIndex)?.get(column);
    if (!owners) {
      return true;
    }
    for (const owner of owners) {
      if (owner !== laneId) {
        return false;
      }
    }
    return true;
  };
  const occupy = (laneId: number, column: number, rowIndex: number): void => {
    const rowMap = occupancy.get(rowIndex) ?? new Map<number, Set<number>>();
    rowMap.set(column, (rowMap.get(column) ?? new Set<number>()).add(laneId));
    occupancy.set(rowIndex, rowMap);
  };

  // Replaced line -> primitives drawn instead (inserted at the position of the first replaced line).
  const replaced = new Set<LinePrimitive>();
  const insertBefore = new Map<LinePrimitive, GraphPrimitive[]>();

  // True if every row of the stretch has the column free for the lane.
  const isStretchFree = (laneId: number, column: number, first: number, last: number): boolean => {
    for (let rowIndex = first; rowIndex <= last; rowIndex += 1) {
      if (!isFreeFor(laneId, column, rowIndex)) {
        return false;
      }
    }
    return true;
  };

  // Move one stretch [first..last] of a run to the leftmost column free over the whole stretch.
  const moveStretch = (run: Run, first: number, last: number): void => {
    let target = run.column;
    while (target > 0 && isStretchFree(run.laneId, target - 1, first, last)) {
      target -= 1;
    }
    if (target === run.column) {
      return;
    }
    const runsToListEnd = last === rows.length - 1;
    const lastInTarget = runsToListEnd ? last : last - 1;
    const stretchLines = run.lines.filter((line) => line.rowIndex >= first && line.rowIndex <= last);
    const firstRow = rows[first];
    const replacement: GraphPrimitive[] = [
      {
        kind: 'shift',
        laneId: run.laneId,
        fromLane: run.column,
        toLane: target,
        yTop: firstRow.top,
        yBottom: firstRow.top + firstRow.height,
      },
    ];
    stretchLines.forEach((line) => {
      replaced.add(line);
      if (line.rowIndex > first && line.rowIndex <= lastInTarget) {
        replacement.push({ ...line, visualLane: target });
      }
    });
    if (!runsToListEnd) {
      const lastRow = rows[last];
      replacement.push({
        kind: 'shift',
        laneId: run.laneId,
        fromLane: target,
        toLane: run.column,
        yTop: lastRow.top,
        yBottom: lastRow.top + lastRow.height,
      });
    }
    insertBefore.set(stretchLines[0], replacement);
    movedLanes.add(run.laneId);

    // Occupancy: the target column is used over the whole stretch, the old column is
    // released where only the moved line was (curve rows keep both).
    for (let rowIndex = first; rowIndex <= last; rowIndex += 1) {
      occupy(run.laneId, target, rowIndex);
      if (rowIndex > first && rowIndex <= lastInTarget) {
        occupancy.get(rowIndex)?.get(run.column)?.delete(run.laneId);
      }
    }
  };

  runs.forEach((run) => {
    // Only permanent moves: the stretch must reach the end of the list, so the lane never has
    // to come back (a detour out and back looked worse than staying in the column).
    if (run.column === 0 || run.last !== rows.length - 1) {
      return;
    }
    // Longest tail of the run where the column to the left is free.
    if (!isFreeFor(run.laneId, run.column - 1, run.last)) {
      return;
    }
    let first = run.last;
    while (first - 1 >= run.first && isFreeFor(run.laneId, run.column - 1, first - 1)) {
      first -= 1;
    }
    if (run.last - first + 1 >= COMPACT_MIN_ROWS) {
      moveStretch(run, first, run.last);
    }
  });

  if (replaced.size === 0) {
    return { primitives, movedLanes };
  }
  const result: GraphPrimitive[] = [];
  primitives.forEach((primitive) => {
    if (primitive.kind === 'line' && replaced.has(primitive)) {
      result.push(...(insertBefore.get(primitive) ?? []));
      return;
    }
    result.push(primitive);
  });
  return { primitives: result, movedLanes };
};

// Upper bound for compaction passes (each pass only moves lines further left, so it converges).
const MAX_COMPACT_PASSES = 8;

// Repeat compaction: a stretch moved one column left in pass n may move further in pass n+1
// where the next column is free for long enough.
const compactLanesRepeatedly = (
  primitives: GraphPrimitive[],
  rows: RowGeometry[],
  occupancy: Map<number, Map<number, Set<number>>>,
): GraphPrimitive[] => {
  let current = primitives;
  let candidates: Set<number> | undefined;
  for (let pass = 0; pass < MAX_COMPACT_PASSES; pass += 1) {
    const { primitives: next, movedLanes } = compactLanes(current, rows, occupancy, candidates);
    current = next;
    if (movedLanes.size === 0) {
      break;
    }
    // Further moves are only possible for stretches that just moved (a column further left
    // may be free for a shorter part of them); other lanes were already checked.
    candidates = movedLanes;
  }
  return current;
};

// Merge consecutive vertical segments of the same lane in the same column into one line.
// Purely an optimization for rendering: the picture stays identical, but a lane that runs
// straight over 1000 rows becomes one SVG element instead of 1000.
export const coalesceLines = (primitives: GraphPrimitive[]): GraphPrimitive[] => {
  const result: GraphPrimitive[] = [];
  // Last emitted line per lane+column; extended while the next segment starts where it ends.
  const openLineByKey = new Map<string, LinePrimitive>();
  primitives.forEach((primitive) => {
    if (primitive.kind !== 'line') {
      result.push(primitive);
      return;
    }
    // Source is part of the key so lines of different origin stay distinguishable.
    const key = `${primitive.laneId}:${primitive.visualLane}:${primitive.source}`;
    const open = openLineByKey.get(key);
    if (open && open.y2 === primitive.y1) {
      open.y2 = primitive.y2;
      return;
    }
    const copy = { ...primitive };
    openLineByKey.set(key, copy);
    result.push(copy);
  });
  return result;
};
