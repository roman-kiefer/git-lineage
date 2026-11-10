import { describe, expect, it } from 'vitest';
import { countChanges, diffLines, groupHunks, splitLines, type DiffLine } from '../webview/src/graph/lineDiff';

// Compact form: " a" same, "-a" removed, "+a" added.
const show = (lines: DiffLine[]): string[] =>
  lines.map((line) => `${line.kind === 'same' ? ' ' : line.kind === 'del' ? '-' : '+'}${line.text}`);

// Applying the diff must give back both texts.
const sides = (lines: DiffLine[]): { old: string[]; new: string[] } => ({
  old: lines.filter((line) => line.kind !== 'add').map((line) => line.text),
  new: lines.filter((line) => line.kind !== 'del').map((line) => line.text),
});

describe('splitLines', () => {
  it('a final line break starts no extra line; CRLF counts as one break', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
    expect(splitLines('\n')).toEqual(['']);
  });
});

describe('diffLines', () => {
  it('a changed line in the middle: removed, then added, with line numbers of both sides', () => {
    const lines = diffLines('a\nb\nc\n', 'a\nB\nc\n');
    expect(show(lines)).toEqual([' a', '-b', '+B', ' c']);
    expect(lines.map((line) => [line.oldNo, line.newNo])).toEqual([[1, 1], [2, undefined], [undefined, 2], [3, 3]]);
  });

  it('an added file is all added, a deleted file all removed', () => {
    expect(show(diffLines('', 'x\ny\n'))).toEqual(['+x', '+y']);
    expect(show(diffLines('x\ny\n', ''))).toEqual(['-x', '-y']);
  });

  it('finds the shortest diff (moved block)', () => {
    const lines = diffLines('a\nb\nc\nd\ne\n', 'a\nc\nd\nb\ne\n');
    expect(countChanges(lines)).toEqual({ added: 1, removed: 1 });
    expect(sides(lines)).toEqual({ old: ['a', 'b', 'c', 'd', 'e'], new: ['a', 'c', 'd', 'b', 'e'] });
  });

  it('random edits always reproduce both texts', () => {
    let seed = 7;
    const random = (max: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let round = 0; round < 50; round += 1) {
      const oldLines = Array.from({ length: random(40) }, () => String(random(6)));
      const newLines = oldLines.filter(() => random(4) !== 0);
      for (let insert = random(6); insert > 0; insert -= 1) {
        newLines.splice(random(newLines.length + 1), 0, String(random(6)));
      }
      const lines = diffLines(oldLines.join('\n'), newLines.join('\n'));
      expect(sides(lines)).toEqual({ old: oldLines, new: newLines });
    }
  });

  it('too many changes: everything removed, then everything added (still correct)', () => {
    const oldText = Array.from({ length: 50 }, (_, index) => `old ${index}`).join('\n');
    const newText = Array.from({ length: 50 }, (_, index) => `new ${index}`).join('\n');
    const lines = diffLines(oldText, newText, 10);
    expect(countChanges(lines)).toEqual({ added: 50, removed: 50 });
    expect(lines.slice(0, 50).every((line) => line.kind === 'del')).toBe(true);
  });
});

describe('groupHunks', () => {
  it('keeps three lines around changes and folds the rest into gaps', () => {
    const oldText = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
    const newText = oldText.replace('line 10', 'changed');
    const lines = diffLines(oldText, newText);
    expect(groupHunks(lines)).toEqual([
      { type: 'gap', start: 0, end: 6 },
      { type: 'lines', start: 6, end: 14 },
      { type: 'gap', start: 14, end: 21 },
    ]);
  });

  it('no changes: one gap', () => {
    const lines = diffLines('a\nb\n', 'a\nb\n');
    expect(groupHunks(lines)).toEqual([{ type: 'gap', start: 0, end: 2 }]);
  });
});
