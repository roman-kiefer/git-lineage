import { describe, expect, it } from 'vitest';
import { columnsToHide } from '../webview/src/graph/columnVisibility';

// Default side columns: Date 140, Author 140, Commit 90 (+ 10 px gap each).
const widths = { date: 140, author: 140, hash: 90 };

describe('Narrow window: side columns give way to the description', () => {
  it('wide enough: nothing hidden', () => {
    expect(columnsToHide(1000, widths)).toEqual([]);
    // 400 for the side columns (with gaps) + 180 for the description.
    expect(columnsToHide(580, widths)).toEqual([]);
  });

  it('hides Author, then Date, then Commit', () => {
    expect(columnsToHide(579, widths)).toEqual(['author']);
    expect(columnsToHide(430, widths)).toEqual(['author']);
    expect(columnsToHide(429, widths)).toEqual(['author', 'date']);
    expect(columnsToHide(250, widths)).toEqual(['author', 'date', 'hash']);
  });
});
