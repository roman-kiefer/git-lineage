import type { CommitView } from './model';
import { renderCommitTable } from './renderCommitTable';
import { renderCommitGraphOverlay } from './renderSvg';

type GraphOrchestratorOptions = {
  commitItemsElement: HTMLElement | null;
  graphOverlay: SVGSVGElement | null;
  graphPaddingX: number;
  laneWidth: number;
  dotSize: number;
  virtualTrackColor: string;
  virtualRingRadius: number;
  maxImmediateParentCurveDistance: number;
  visualLaneCount: (laneCount: number) => number;
  laneColor: (lane: number) => string;
  editorBackground: () => string;
  commitLane: (commit: CommitView) => number;
  isCurrentCommit: (commit: CommitView) => boolean;
  showGraphDebugMeta: boolean;
  laneToX: (lane: number) => number;
};

// What the list reports; the app decides about the details pane.
export type SelectionHandlers = {
  // A row was selected by mouse (opens the details) or keyboard (details only follow when open).
  onSelect: (hash: string, source: 'mouse' | 'keyboard') => void;
  onOpenDetails: (hash: string) => void;
  onCloseDetails: () => void;
  // Context menu key / Shift+F10 on the selected row.
  onContextMenu: (row: HTMLElement) => void;
};

export type GraphRenderResult = {
  resetSelection: boolean;
};

export type GraphOrchestrator = {
  render: (commits: CommitView[], append: boolean, maxLanesHint?: number) => GraphRenderResult;
  renderEmpty: () => GraphRenderResult;
  handleResize: () => void;
  bindCommitSelection: (handlers: SelectionHandlers) => void;
  // Keyboard focus into the commit list.
  focusList: () => void;
  // Select a listed commit (no details request); false when it is not listed.
  selectHash: (hash: string) => boolean;
  getSelectedHash: () => string | undefined;
  // Remove the row highlight and forget the selected commit.
  clearSelection: () => void;
  // Commits currently rendered in the list (used by the search).
  getRenderedCommits: () => CommitView[];
};

export const createGraphOrchestrator = (
  options: GraphOrchestratorOptions,
): GraphOrchestrator => {
  let selectedHash: string | undefined;
  let maxLanes = 1;
  let renderedCommits: CommitView[] = [];

  const render = (
    commits: CommitView[],
    append: boolean,
    maxLanesHint?: number,
  ): GraphRenderResult => {
    const items = options.commitItemsElement;
    if (!items) {
      return { resetSelection: !append };
    }

    maxLanes = maxLanesHint ?? maxLanes;

    const result = renderCommitTable({
      items,
      overlay: options.graphOverlay,
      commits,
      renderedCommits,
      append,
      maxLanes,
      graphOptions: {
        selectedHash,
        graphPaddingX: options.graphPaddingX,
        laneWidth: options.laneWidth,
        dotSize: options.dotSize,
        virtualTrackColor: options.virtualTrackColor,
        virtualRingRadius: options.virtualRingRadius,
        maxImmediateParentCurveDistance: options.maxImmediateParentCurveDistance,
        visualLaneCount: options.visualLaneCount,
        laneColor: options.laneColor,
        editorBackground: options.editorBackground(),
        commitLane: options.commitLane,
        isCurrentCommit: options.isCurrentCommit,
        showGraphDebugMeta: options.showGraphDebugMeta,
        laneToX: options.laneToX,
      },
    });

    renderedCommits = result.renderedCommits;
    maxLanes = result.maxLanes;

    // Keep the selection across a full re-render (refresh) if the commit is still listed.
    const selectionStillListed =
      selectedHash !== undefined && renderedCommits.some((commit) => commit.hash === selectedHash);
    const resetSelection = result.resetSelection && !selectionStillListed;
    if (resetSelection) {
      selectedHash = undefined;
    }

    return { resetSelection };
  };

  const renderEmpty = (): GraphRenderResult => render([], false);

  const handleResize = (): void => {
    const items = options.commitItemsElement;
    const overlay = options.graphOverlay;
    if (!items || !overlay) {
      return;
    }

    const result = renderCommitGraphOverlay({
      items,
      overlay,
      commits: renderedCommits,
      maxLanes,
      graphPaddingX: options.graphPaddingX,
      laneWidth: options.laneWidth,
      dotSize: options.dotSize,
      virtualTrackColor: options.virtualTrackColor,
      virtualRingRadius: options.virtualRingRadius,
      maxImmediateParentCurveDistance: options.maxImmediateParentCurveDistance,
      visualLaneCount: options.visualLaneCount,
      laneColor: options.laneColor,
      editorBackground: options.editorBackground(),
      commitLane: options.commitLane,
      isCurrentCommit: options.isCurrentCommit,
      laneToX: options.laneToX,
    });
    maxLanes = result.nextMaxLanes;
  };

  // Focus is in a field that takes text (plain letters must reach it).
  const isTyping = (): boolean => {
    const focused = document.activeElement;
    return focused instanceof HTMLInputElement
      || focused instanceof HTMLTextAreaElement
      || focused instanceof HTMLSelectElement
      || (focused instanceof HTMLElement && focused.isContentEditable);
  };

  const selectableRows = (): HTMLElement[] =>
    Array.from(
      options.commitItemsElement?.querySelectorAll<HTMLElement>('.commit:not(.commit--connector):not(.commit--virtual)') ?? [],
    );

  // Mark one row as selected (no message to the extension; the caller decides).
  const markSelected = (commitEl: HTMLElement): string | undefined => {
    const hash = commitEl.dataset.hash;
    if (!hash || hash.startsWith('__virtual__')) {
      return undefined;
    }
    options.commitItemsElement?.querySelector<HTMLElement>('.commit.selected')?.classList.remove('selected');
    commitEl.classList.add('selected');
    selectedHash = hash;
    return hash;
  };

  // Keyboard model (overview in the README, section "Tastatur"):
  // - the list is a focus target (Tab, Ctrl+G, Esc from the search field);
  // - in the list: Up/Down, Home/End, PageUp/PageDown move the selection without opening the
  //   details (an open pane follows); Enter or Ctrl+Right opens, Ctrl+Left closes the details;
  //   the context menu key or Shift+F10 opens the context menu of the selected row;
  // - anywhere (except dropdowns and multi-line fields): Ctrl+Up/Down move the selection.
  // A mouse click selects and opens the details.
  const bindCommitSelection = (handlers: SelectionHandlers): void => {
    const items = options.commitItemsElement;
    if (!items) {
      return;
    }
    items.tabIndex = 0;
    items.setAttribute('role', 'listbox');
    items.setAttribute('aria-label', 'Commits');

    items.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const commitEl = target?.closest<HTMLElement>('.commit');
      const hash = commitEl ? markSelected(commitEl) : undefined;
      if (hash) {
        handlers.onSelect(hash, 'mouse');
      }
    });

    // Move the selection by a step (+1/-1, page) or to the first/last row.
    const move = (target: 'first' | 'last' | number): void => {
      const rows = selectableRows();
      if (rows.length === 0) {
        return;
      }
      const current = rows.findIndex((row) => row.dataset.hash === selectedHash);
      let next: number;
      if (target === 'first') {
        next = 0;
      } else if (target === 'last') {
        next = rows.length - 1;
      } else if (current < 0) {
        // Without a selection, going down starts at the first row, going up at the last.
        next = target > 0 ? 0 : rows.length - 1;
      } else {
        next = Math.min(rows.length - 1, Math.max(0, current + target));
      }
      if (next === current) {
        return;
      }
      const hash = markSelected(rows[next]);
      // Keep the new row visible without jumping when it already is.
      rows[next].scrollIntoView?.({ block: 'nearest' });
      if (hash) {
        handlers.onSelect(hash, 'keyboard');
      }
    };

    // Rows that fit into the visible part of the window (for PageUp/PageDown).
    const pageSize = (): number => {
      const rowHeight = selectableRows()[0]?.offsetHeight || 24;
      return Math.max(1, Math.floor((window.innerHeight || 600) / rowHeight) - 3);
    };

    items.addEventListener('keydown', (event) => {
      const ctrl = event.ctrlKey || event.metaKey;
      const plain = !ctrl && !event.altKey && !event.shiftKey;
      const selectedRow = items.querySelector<HTMLElement>('.commit.selected');
      let handled = true;
      if (plain && event.key === 'ArrowDown') {
        move(1);
      } else if (plain && event.key === 'ArrowUp') {
        move(-1);
      } else if (plain && event.key === 'Home') {
        move('first');
      } else if (plain && event.key === 'End') {
        move('last');
      } else if (plain && event.key === 'PageDown') {
        move(pageSize());
      } else if (plain && event.key === 'PageUp') {
        move(-pageSize());
      } else if ((plain && event.key === 'Enter') || (ctrl && event.key === 'ArrowRight')) {
        if (selectedHash) {
          handlers.onOpenDetails(selectedHash);
        }
      } else if (ctrl && event.key === 'ArrowLeft') {
        handlers.onCloseDetails();
      } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        if (selectedRow) {
          handlers.onContextMenu(selectedRow);
        }
      } else {
        handled = false;
      }
      if (handled) {
        event.preventDefault();
        // Arrow keys must not also reach the global Ctrl+Up/Down handler.
        event.stopPropagation();
      }
    });

    window.addEventListener('keydown', (event) => {
      const ctrl = event.ctrlKey || event.metaKey;
      // "g" without modifier (outside text fields): focus the list. Hosts never take a plain
      // letter, unlike Ctrl+G (the Claude Code browser pane uses it for its page search).
      if (!ctrl && !event.altKey && !event.shiftKey && event.key === 'g' && !isTyping()) {
        event.preventDefault();
        focusList();
        return;
      }
      if (!ctrl || event.altKey || event.shiftKey) {
        return;
      }
      // Ctrl+G: focus the list from anywhere (where the host lets it through).
      if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        focusList();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (direction === 0) {
        return;
      }
      // Dropdowns and multi-line fields need the arrow keys themselves.
      const focused = document.activeElement;
      if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement) {
        return;
      }
      event.preventDefault();
      move(direction);
    });
  };

  // Give the list the keyboard focus without scrolling the page.
  const focusList = (): void => {
    options.commitItemsElement?.focus({ preventScroll: true });
  };

  // Select a commit from outside (e.g. the current search match) and show it.
  const selectHash = (hash: string): boolean => {
    const row = selectableRows().find((entry) => entry.dataset.hash === hash);
    if (!row || !markSelected(row)) {
      return false;
    }
    row.scrollIntoView?.({ block: 'nearest' });
    return true;
  };

  return {
    render,
    renderEmpty,
    handleResize,
    bindCommitSelection,
    focusList,
    selectHash,
    getSelectedHash: () => selectedHash,
    clearSelection: () => {
      options.commitItemsElement?.querySelector('.commit.selected')?.classList.remove('selected');
      selectedHash = undefined;
    },
    getRenderedCommits: () => renderedCommits,
  };
};
