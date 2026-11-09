type ResizableColumnKey = 'graph' | 'date' | 'author' | 'hash';

type ColumnWidths = Record<ResizableColumnKey, number>;

const STORAGE_KEY = 'git-lineage.column-widths.v1';

const DEFAULT_WIDTHS: ColumnWidths = {
  graph: 220,
  date: 140,
  author: 140,
  hash: 90,
};

const MIN_WIDTHS: ColumnWidths = {
  graph: 120,
  date: 90,
  author: 90,
  hash: 70,
};

const MAX_WIDTHS: ColumnWidths = {
  graph: 520,
  date: 380,
  author: 380,
  hash: 220,
};

// Limit a column width to safe bounds so layout cannot break.
const clampWidth = (key: ResizableColumnKey, value: number): number =>
  Math.max(MIN_WIDTHS[key], Math.min(MAX_WIDTHS[key], value));

// Read persisted widths from local storage and validate values.
const loadPersistedWidths = (): ColumnWidths => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_WIDTHS };
    }
    const parsed = JSON.parse(raw) as Partial<Record<ResizableColumnKey, unknown>>;
    return {
      graph: clampWidth('graph', Number(parsed.graph ?? DEFAULT_WIDTHS.graph)),
      date: clampWidth('date', Number(parsed.date ?? DEFAULT_WIDTHS.date)),
      author: clampWidth('author', Number(parsed.author ?? DEFAULT_WIDTHS.author)),
      hash: clampWidth('hash', Number(parsed.hash ?? DEFAULT_WIDTHS.hash)),
    };
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
};

// Persist current widths so they survive reloads.
const savePersistedWidths = (widths: ColumnWidths): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Ignore storage errors (private mode / blocked storage).
  }
};

// Apply widths to CSS custom properties used by header and rows.
const applyWidths = (listElement: HTMLElement, widths: ColumnWidths): void => {
  listElement.style.setProperty('--graph-col-width', `${widths.graph}px`);
  listElement.style.setProperty('--col-date-width', `${widths.date}px`);
  listElement.style.setProperty('--col-author-width', `${widths.author}px`);
  listElement.style.setProperty('--col-hash-width', `${widths.hash}px`);
};

// Enable boundary drag-resizing in the commit header.
// Rule: dragging the boundary before a column resizes the column on the left side.
export const setupColumnResizeController = (): void => {
  const listElement = document.getElementById('commit-list') as HTMLElement | null;
  if (!listElement) {
    return;
  }

  // Throttle expensive graph relayout to once per animation frame while dragging.
  let resizeQueued = false;
  const scheduleGraphResize = (): void => {
    if (resizeQueued) {
      return;
    }
    resizeQueued = true;
    window.requestAnimationFrame(() => {
      resizeQueued = false;
      window.dispatchEvent(new Event('resize'));
    });
  };

  const handles = Array.from(
    listElement.querySelectorAll<HTMLElement>('.col-resize-handle[data-resize-col]'),
  );
  if (handles.length === 0) {
    return;
  }

  let widths = loadPersistedWidths();
  applyWidths(listElement, widths);

  handles.forEach((handle) => {
    const key = handle.dataset.resizeCol as ResizableColumnKey | undefined;
    if (!key || !(key in DEFAULT_WIDTHS)) {
      return;
    }

    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widths[key];

      const onPointerMove = (moveEvent: PointerEvent): void => {
        const deltaX = moveEvent.clientX - startX;
        // Boundary behavior: right drag expands left side => right-side width shrinks.
        const nextWidth = key === 'graph'
          ? startWidth + deltaX
          : startWidth - deltaX;
        widths = {
          ...widths,
          [key]: clampWidth(key, nextWidth),
        };
        applyWidths(listElement, widths);
        scheduleGraphResize();
      };

      const onPointerUp = (): void => {
        document.body.classList.remove('is-resizing-columns');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        savePersistedWidths(widths);
        scheduleGraphResize();
      };

      document.body.classList.add('is-resizing-columns');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  });
};
