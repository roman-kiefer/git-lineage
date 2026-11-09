// Narrow windows: the side columns (Author, then Date, then Commit) are hidden one after the
// other so the Description keeps a readable width. Without this the fixed-width side columns
// squeezed the Description to nothing below roughly 600 px.

// Least width the Description should keep before a side column is hidden.
export const MIN_DESCRIPTION_WIDTH = 180;
// Gap between the grid columns (CSS: .commit-row / .list-head-row gap).
const COLUMN_GAP = 10;

type SideColumn = 'author' | 'date' | 'hash';
// Hidden first to last.
const HIDE_ORDER: SideColumn[] = ['author', 'date', 'hash'];

// Which side columns to hide for the room the rows have (width right of the graph column).
export const columnsToHide = (rowWidth: number, widths: Record<SideColumn, number>): SideColumn[] => {
  const hidden: SideColumn[] = [];
  const description = (): number =>
    rowWidth - HIDE_ORDER.filter((key) => !hidden.includes(key)).reduce((sum, key) => sum + widths[key] + COLUMN_GAP, 0);
  for (const key of HIDE_ORDER) {
    if (description() >= MIN_DESCRIPTION_WIDTH) {
      break;
    }
    hidden.push(key);
  }
  return hidden;
};

const cssWidth = (element: HTMLElement, name: string, fallback: number): number => {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
};

export const bindColumnVisibility = (list: HTMLElement): void => {
  const update = (): void => {
    const graph = cssWidth(list, '--graph-col-width', 220);
    // Row = graph column + gap + description/side columns; the list has 4 px padding on the right.
    const rowWidth = list.clientWidth - graph - COLUMN_GAP - 4;
    if (rowWidth <= 0) {
      return;
    }
    const hidden = columnsToHide(rowWidth, {
      author: cssWidth(list, '--col-author-width', 140),
      date: cssWidth(list, '--col-date-width', 140),
      hash: cssWidth(list, '--col-hash-width', 90),
    });
    HIDE_ORDER.forEach((key) => list.classList.toggle(`list--hide-${key}`, hidden.includes(key)));
    // Grid of the description and the remaining side columns (hidden ones are display: none).
    const columns = ['minmax(0, 1fr)'];
    (['date', 'author', 'hash'] as const).forEach((key) => {
      if (!hidden.includes(key)) {
        columns.push(`var(--col-${key}-width)`);
      }
    });
    // Only on a change: this writes the style attribute the MutationObserver below watches.
    const value = columns.join(' ');
    if (list.style.getPropertyValue('--row-columns') !== value) {
      list.style.setProperty('--row-columns', value);
    }
  };

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(update).observe(list);
  }
  // Column widths dragged in the header are set as inline custom properties on the list.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(update).observe(list, { attributes: true, attributeFilter: ['style'] });
  }
  update();
};
