import type { GraphLayout } from '../../webview/src/graph/graphLayout';

export type Collision = { column: number; y1: number; y2: number; lanes: [number, number]; kind: 'line' | 'dot' };

// Find places where two different lanes draw over each other in the same column:
// overlapping vertical segments, or a foreign vertical segment passing through a commit point.
export const findCollisions = (layout: GraphLayout): Collision[] => {
  const collisions: Collision[] = [];
  const lines = layout.primitives.filter((primitive) => primitive.kind === 'line');
  const dots = layout.primitives.filter((primitive) => primitive.kind === 'dot');

  // Group segments by column to keep the comparison small.
  const byColumn = new Map<number, typeof lines>();
  lines.forEach((line) => {
    const bucket = byColumn.get(line.visualLane) ?? [];
    bucket.push(line);
    byColumn.set(line.visualLane, bucket);
  });

  byColumn.forEach((bucket, column) => {
    const sorted = [...bucket].sort((a, b) => a.y1 - b.y1);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length && sorted[j].y1 < sorted[i].y2; j += 1) {
        if (sorted[i].laneId !== sorted[j].laneId) {
          collisions.push({
            column,
            y1: sorted[j].y1,
            y2: Math.min(sorted[i].y2, sorted[j].y2),
            lanes: [sorted[i].laneId, sorted[j].laneId],
            kind: 'line',
          });
        }
      }
    }
  });

  dots.forEach((dot) => {
    (byColumn.get(dot.visualLane) ?? []).forEach((line) => {
      if (line.laneId !== dot.laneId && line.y1 < dot.y && dot.y < line.y2) {
        collisions.push({ column: dot.visualLane, y1: dot.y, y2: dot.y, lanes: [dot.laneId, line.laneId], kind: 'dot' });
      }
    });
  });

  return collisions;
};
