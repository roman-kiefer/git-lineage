import type { CommitView, LaneEdge } from './model';

export type RowVisualLaneMaps = {
  maps: Array<Map<number, number>>;
  laneCount: number;
};

export const laneFromGraphPrefix = (prefix: string | undefined): number => {
  if (!prefix) {
    return 0;
  }
  const starIndex = prefix.indexOf('*');
  if (starIndex < 0) {
    return 0;
  }
  return Math.max(0, Math.floor(starIndex / 2));
};

export const activeLanesFromPrefix = (prefix: string | undefined): number[] => {
  if (!prefix) {
    return [];
  }
  const lanes = new Set<number>();
  for (let idx = 0; idx < prefix.length; idx += 1) {
    const char = prefix[idx];
    if (char === '|' || char === '/' || char === '\\' || char === '*' || char === '_') {
      lanes.add(Math.max(0, Math.floor(idx / 2)));
    }
  }
  return [...lanes].sort((a, b) => a - b);
};

export const laneCountFromGraphPrefix = (prefix: string | undefined): number =>
  Math.max(1, Math.ceil((prefix?.length ?? 0) / 2));

export const uniqueLaneEdges = (edges: LaneEdge[]): LaneEdge[] => {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.fromLane}->${edge.toLane}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

// Parse one git-graph text row into outgoing lane edges for the next rendered row.
export const outgoingEdgesFromPrefix = (prefix: string | undefined): LaneEdge[] => {
  if (!prefix) {
    return [];
  }

  const edges: LaneEdge[] = [];
  const laneCount = Math.ceil(prefix.length / 2);
  for (let lane = 0; lane < laneCount; lane += 1) {
    const headIndex = lane * 2;
    const head = prefix[headIndex] ?? ' ';
    const gap = prefix[headIndex + 1] ?? ' ';

    if (head === '|' || head === '*') {
      edges.push({ fromLane: lane, toLane: lane });
    }

    if (gap === '/' || head === '/') {
      edges.push({ fromLane: lane + 1, toLane: lane });
    }

    if (gap === '\\' || head === '\\') {
      edges.push({ fromLane: lane, toLane: lane + 1 });
    }
  }

  return uniqueLaneEdges(edges);
};

const composeLaneEdges = (left: LaneEdge[], right: LaneEdge[]): LaneEdge[] => {
  if (left.length === 0 || right.length === 0) {
    return [];
  }

  const composed: LaneEdge[] = [];
  left.forEach((source) => {
    right.forEach((target) => {
      if (source.toLane === target.fromLane) {
        composed.push({ fromLane: source.fromLane, toLane: target.toLane });
      }
    });
  });

  return uniqueLaneEdges(composed);
};

export const transitionEdges = (
  startPrefix: string | undefined,
  connectors: string[] | undefined,
): LaneEdge[] => {
  let relation = outgoingEdgesFromPrefix(startPrefix);
  (connectors ?? []).forEach((connectorPrefix) => {
    const connectorEdges = outgoingEdgesFromPrefix(connectorPrefix);
    if (connectorEdges.length === 0 || relation.length === 0) {
      return;
    }
    const composed = composeLaneEdges(relation, connectorEdges);
    if (composed.length > 0) {
      relation = composed;
    }
  });
  return uniqueLaneEdges(relation);
};

export const buildRowVisualLaneMaps = (commits: CommitView[]): RowVisualLaneMaps => {
  const maps: Array<Map<number, number>> = [];
  let nextVisualLane = 0;
  let maxVisualLane = 0;

  commits.forEach((commit, index) => {
    const map = new Map<number, number>();

    if (commit.isVirtual) {
      map.set(commit.lane, commit.lane);
      nextVisualLane = Math.max(nextVisualLane, commit.lane + 1);
      maxVisualLane = Math.max(maxVisualLane, commit.lane);
      maps.push(map);
      return;
    }

    const rawCommitLane = laneFromGraphPrefix(commit.graphPrefix);
    const activeRawLanes = activeLanesFromPrefix(commit.graphPrefix);
    if (activeRawLanes.length === 0) {
      activeRawLanes.push(rawCommitLane);
    }

    if (index > 0) {
      const previousCommit = commits[index - 1];
      const previousMap = maps[index - 1];
      const transitions = transitionEdges(
        previousCommit.graphPrefix,
        commit.graphConnectorPrefixes,
      );
      transitions.forEach((edge) => {
        const fromVisual = previousMap?.get(edge.fromLane);
        if (fromVisual === undefined) {
          return;
        }
        if (!map.has(edge.toLane)) {
          map.set(edge.toLane, fromVisual);
        }
      });
    }

    activeRawLanes.forEach((rawLane) => {
      if (!map.has(rawLane)) {
        map.set(rawLane, nextVisualLane);
        nextVisualLane += 1;
      }
      const visualLane = map.get(rawLane) ?? 0;
      if (visualLane > maxVisualLane) {
        maxVisualLane = visualLane;
      }
    });

    maps.push(map);
  });

  return { maps, laneCount: Math.max(1, maxVisualLane + 1) };
};

export const buildCommitIndexByHash = (commits: CommitView[]): Map<string, number> => {
  const indexByHash = new Map<string, number>();
  commits.forEach((commit, idx) => {
    indexByHash.set(commit.hash, idx);
  });
  return indexByHash;
};

