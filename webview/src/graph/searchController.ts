import type { CommitView } from './model';
import { findMatchingHashes, stepMatchIndex } from './searchCommits';

type SearchControllerOptions = {
  // Currently rendered commits (search covers only what is loaded).
  getCommits: () => CommitView[];
  // Container holding the .commit rows.
  items: HTMLElement | null;
  // Esc in the search field: called with the current match (if any) after clearing.
  onLeave?: (currentHash: string | undefined) => void;
};

export type SearchController = {
  // Re-apply the current query after the list was re-rendered.
  refresh: () => void;
};

const MATCH_CLASS = 'search-match';
const CURRENT_CLASS = 'search-current';
const INPUT_DEBOUNCE_MS = 150;

export const createSearchController = (options: SearchControllerOptions): SearchController => {
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  const count = document.getElementById('search-count');
  const prevButton = document.getElementById('search-prev') as HTMLButtonElement | null;
  const nextButton = document.getElementById('search-next') as HTMLButtonElement | null;

  let matches: string[] = [];
  let currentIndex = -1;
  let debounceTimer: number | undefined;

  // Map hash -> row element for the rows currently in the DOM.
  const rowsByHash = (): Map<string, HTMLElement> => {
    const map = new Map<string, HTMLElement>();
    options.items?.querySelectorAll<HTMLElement>('.commit').forEach((row) => {
      if (row.dataset.hash) {
        map.set(row.dataset.hash, row);
      }
    });
    return map;
  };

  // Update the "3 / 12" counter and the enabled state of the step buttons.
  const renderCount = (): void => {
    const hasQuery = Boolean(input?.value.trim());
    if (count) {
      count.textContent = !hasQuery
        ? ''
        : matches.length === 0
          ? 'No results'
          : `${currentIndex >= 0 ? currentIndex + 1 : 0} / ${matches.length}`;
    }
    const canStep = matches.length > 0;
    if (prevButton) {
      prevButton.disabled = !canStep;
    }
    if (nextButton) {
      nextButton.disabled = !canStep;
    }
  };

  // Set match/current classes on the rows; optionally scroll the current match into view.
  const paint = (scrollToCurrent: boolean): void => {
    const rows = rowsByHash();
    const matchSet = new Set(matches);
    const currentHash = matches[currentIndex];
    rows.forEach((row, hash) => {
      row.classList.toggle(MATCH_CLASS, matchSet.has(hash));
      row.classList.toggle(CURRENT_CLASS, hash === currentHash);
    });
    if (scrollToCurrent && currentHash) {
      rows.get(currentHash)?.scrollIntoView({ block: 'center' });
    }
    renderCount();
  };

  // Recompute matches; keep the current match if it still matches.
  const recompute = (scrollToCurrent: boolean): void => {
    const previousHash = matches[currentIndex];
    matches = findMatchingHashes(options.getCommits(), input?.value ?? '');
    const keptIndex = previousHash ? matches.indexOf(previousHash) : -1;
    currentIndex = keptIndex >= 0 ? keptIndex : matches.length > 0 ? 0 : -1;
    paint(scrollToCurrent);
  };

  const step = (direction: 1 | -1): void => {
    currentIndex = stepMatchIndex(currentIndex, matches.length, direction);
    paint(true);
  };

  input?.addEventListener('input', () => {
    if (debounceTimer !== undefined) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = undefined;
      recompute(true);
    }, INPUT_DEBOUNCE_MS);
  });

  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      // Escape clears the search (and does not close the details pane) and continues in the
      // list at the current match.
      event.stopPropagation();
      const currentHash = currentIndex >= 0 ? matches[currentIndex] : undefined;
      input.value = '';
      recompute(false);
      options.onLeave?.(currentHash);
    }
  });

  prevButton?.addEventListener('click', () => step(-1));
  nextButton?.addEventListener('click', () => step(1));

  // Ctrl+F / Cmd+F focuses the search field inside the webview; "/" does the same outside
  // text fields (for hosts that keep Ctrl+F for their own page search).
  window.addEventListener('keydown', (event) => {
    const focused = document.activeElement;
    const typing = focused instanceof HTMLInputElement
      || focused instanceof HTMLTextAreaElement
      || focused instanceof HTMLSelectElement;
    const ctrlF = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f';
    const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !typing;
    if (ctrlF || slash) {
      event.preventDefault();
      input?.focus();
      input?.select();
    }
  });

  renderCount();

  return {
    refresh: () => recompute(false),
  };
};
