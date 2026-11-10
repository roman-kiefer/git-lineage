// Line diff for the file viewer of the browser pane (Myers' O(ND) algorithm).

export type DiffLine = {
  kind: 'same' | 'del' | 'add';
  text: string;
  // Line numbers on the old / new side (1-based), where the line exists.
  oldNo?: number;
  newNo?: number;
};

type Op = 'same' | 'del' | 'add';

// Lines of a text; a final line break does not start another (empty) line.
export const splitLines = (text: string): string[] => {
  if (text === '') {
    return [];
  }
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
};

// Shortest edit script from a to b, or undefined when it needs more than maxEdits edits.
// trace[d] holds the furthest x per diagonal k after step d - 1, for k in [-d - 1, d + 1].
const shortestEdit = (a: string[], b: string[], maxEdits: number): Op[] | undefined => {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  const limit = Math.min(max, maxEdits);
  for (let d = 0; d <= limit; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, d, n, m);
      }
    }
  }
  return undefined;
};

const backtrack = (trace: Int32Array[], edits: number, n: number, m: number): Op[] => {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = edits; d > 0; d -= 1) {
    const before = trace[d];
    const at = (k: number): number => before[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('same');
      x -= 1;
      y -= 1;
    }
    ops.push(down ? 'add' : 'del');
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push('same');
    x -= 1;
    y -= 1;
  }
  return ops.reverse();
};

// Diff of two texts, line by line. Very different files (more than maxEdits changed lines
// after the common start and end) show as everything removed and everything added.
export const diffLines = (oldText: string, newText: string, maxEdits = 4000): DiffLine[] => {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const middle = shortestEdit(midA, midB, maxEdits)
    ?? [...midA.map((): Op => 'del'), ...midB.map((): Op => 'add')];
  const ops: Op[] = [...Array<Op>(start).fill('same'), ...middle, ...Array<Op>(a.length - endA).fill('same')];

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  ops.forEach((op) => {
    if (op === 'same') {
      lines.push({ kind: 'same', text: b[j], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (op === 'del') {
      lines.push({ kind: 'del', text: a[i], oldNo: i + 1 });
      i += 1;
    } else {
      lines.push({ kind: 'add', text: b[j], newNo: j + 1 });
      j += 1;
    }
  });
  return lines;
};

export type DiffSegment =
  | { type: 'lines'; start: number; end: number }
  | { type: 'gap'; start: number; end: number };

// Changed lines with `context` unchanged lines around them; longer unchanged runs become gaps
// (start inclusive, end exclusive, indexes into lines). No changes: one gap for everything.
export const groupHunks = (lines: DiffLine[], context = 3): DiffSegment[] => {
  const visible = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind !== 'same') {
      for (let near = Math.max(0, index - context); near <= Math.min(lines.length - 1, index + context); near += 1) {
        visible[near] = true;
      }
    }
  });
  const segments: DiffSegment[] = [];
  let index = 0;
  while (index < lines.length) {
    const shown = visible[index];
    let end = index;
    while (end < lines.length && visible[end] === shown) {
      end += 1;
    }
    segments.push({ type: shown ? 'lines' : 'gap', start: index, end });
    index = end;
  }
  return segments;
};

export const countChanges = (lines: DiffLine[]): { added: number; removed: number } => ({
  added: lines.filter((line) => line.kind === 'add').length,
  removed: lines.filter((line) => line.kind === 'del').length,
});
