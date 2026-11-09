// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { bootstrapGraphApp } from '../webview/src/graph/bootstrapGraphApp';
import { loadCommitViews } from './helpers/fixtures';

// Messages the webview sent to the extension.
const sent: Array<{ type: string; payload?: Record<string, unknown> }> = [];
const commits = loadCommitViews('feature-merge');

// Deliver an extension -> webview message like VS Code does.
const receive = (type: string, payload: Record<string, unknown>): void => {
  window.dispatchEvent(new MessageEvent('message', { data: { type, payload } }));
};

// Wait for debounced handlers (search input) and animation frames.
const settle = (ms = 200): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const content = (): HTMLElement => document.getElementById('content')!;
const row = (subject: string): HTMLElement => {
  const commit = commits.find((entry) => entry.subject === subject)!;
  return document.querySelector<HTMLElement>(`.commit[data-hash="${commit.hash}"]`)!;
};

// Keyboard helpers: a key on the window (global shortcuts) or on the focused commit list.
type Mods = { ctrlKey?: boolean; shiftKey?: boolean };
const items = (): HTMLElement => document.getElementById('commit-items')!;
const pressGlobal = (key: string, mods: Mods = {}): void => {
  (document.activeElement ?? window).dispatchEvent(new KeyboardEvent('keydown', { key, ...mods, bubbles: true, cancelable: true }));
};
const pressInList = (key: string, mods: Mods = {}): void => {
  items().dispatchEvent(new KeyboardEvent('keydown', { key, ...mods, bubbles: true, cancelable: true }));
};
const selectedSubject = (): string | undefined => {
  const hash = document.querySelector<HTMLElement>('.commit.selected')?.dataset.hash;
  return commits.find((entry) => entry.hash === hash)?.subject;
};
const hashOf = (subject: string): string => commits.find((entry) => entry.subject === subject)!.hash;

beforeAll(() => {
  document.body.innerHTML = '<div id="app"></div>';
  bootstrapGraphApp({ postMessage: (message) => sent.push(message as (typeof sent)[number]) });
  receive('init', {
    message: 'Repository detected.',
    repoRoot: 'C:/repo',
    repositories: ['C:/repo'],
    branches: [{ value: '__all__', label: 'Show All', type: 'all' }],
    selectedBranch: '__all__',
    showRemoteBranches: true,
    commits,
    hasMore: false,
    maxLanes: 2,
  });
});

describe('Webview app', () => {
  it('reports ready on start', () => {
    expect(sent[0]?.type).toBe('ready');
  });

  it('hides the details at first, and the repository picker with one repository', () => {
    expect(content().classList.contains('details-hidden')).toBe(true);
    expect((document.getElementById('repo-select') as HTMLSelectElement).hidden).toBe(true);
  });

  it('folder: name shown, full path in the tooltip and through the copy button', () => {
    const long = 'C:\\Users\\micro\\AppData\\Local\\Temp\\wtdemo\\app';
    receive('commits', { repoRoot: long, commits, append: false, hasMore: false });
    expect(document.getElementById('repo-path')!.textContent).toBe('app');
    expect(document.getElementById('repo')!.title).toBe(long);
    sent.length = 0;
    document.getElementById('repo-copy')!.click();
    expect(sent).toEqual([{ type: 'copyToClipboard', payload: { text: long, label: 'Path' } }]);
    receive('commits', { repoRoot: '/home/me/repo/', commits, append: false, hasMore: false });
    expect(document.getElementById('repo-path')!.textContent).toBe('repo');
  });

  it('toolbar: three groups, refresh as an icon, no title', () => {
    const groups = Array.from(document.querySelectorAll('.toolbar > .toolbar__group'));
    expect(groups.map((group) => group.querySelector('select, input')?.id)).toEqual([
      'repo-select',
      'branch-select',
      'search-input',
    ]);
    expect(document.querySelector('.toolbar .title')).toBeNull();
    const refresh = document.querySelector<HTMLButtonElement>('[data-action="refresh"]')!;
    expect(refresh.textContent!.trim()).toBe('');
    expect(refresh.getAttribute('aria-label')).toBe('Refresh');
  });

  it('Load more only while there are more commits (no "No more commits")', () => {
    const footer = document.querySelector<HTMLElement>('.list-footer')!;
    expect(footer.hidden).toBe(true);
    receive('commits', { commits, append: false, hasMore: true, nextCursor: 'abc', maxLanes: 2 });
    expect(footer.hidden).toBe(false);
    expect(document.getElementById('load-more')!.textContent).toBe('Load more');
    receive('commits', { commits, append: false, hasMore: false, maxLanes: 2 });
    expect(footer.hidden).toBe(true);
  });

  it('branch chip shows ahead/behind of its upstream, "gone" without upstream', () => {
    const withRefs = commits.map((commit, index) =>
      index === 0
        ? { ...commit, refs: [
            { name: 'feat', type: 'local', upstream: 'origin/feat', ahead: 2, behind: 1 },
            { name: 'old', type: 'local', upstream: 'origin/old', upstreamGone: true },
            { name: 'same', type: 'local', upstream: 'origin/same', ahead: 0, behind: 0 },
          ] }
        : commit,
    );
    receive('commits', { commits: withRefs, append: false, hasMore: false, maxLanes: 2 });
    const chip = (name: string) => document.querySelector<HTMLElement>(`.ref-chip[data-ref-name="${name}"]`)!;
    const badge = chip('feat').querySelector<HTMLElement>('.ref-chip__track')!;
    expect(badge.dataset.track).toBe('↑2 ↓1');
    expect(badge.textContent).toBe('21');
    expect(badge.querySelectorAll('.ref-chip__track-arrow')).toHaveLength(2);
    expect(chip('feat').title).toContain('2 commits to push, 1 commit to pull');
    expect(chip('old').querySelector('.ref-chip__track')!.textContent).toBe('gone');
    expect(chip('same').querySelector('.ref-chip__track')).toBeNull();
    expect(chip('same').title).toContain('up to date with origin/same');
    receive('commits', { commits, append: false, hasMore: false, maxLanes: 2 });
  });

  it('shows the date in the default format', () => {
    // "1 Jan 2026 01:04": one-digit day padded with a figure space, 24-hour time.
    const cell = row('f2').querySelector<HTMLElement>('.commit-col--date')!;
    expect(cell.textContent).toMatch(/^[ \d]\d [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/);
  });

  it('marks search matches and counts them', async () => {
    const input = document.getElementById('search-input') as HTMLInputElement;
    input.value = 'f';
    input.dispatchEvent(new Event('input'));
    await settle();
    // "f1", "f2", "merge feature" and the "feature" ref -> 3 commits; author "Fixture" matches all.
    expect(document.querySelectorAll('.commit.search-match').length).toBe(commits.length);
    input.value = 'f2';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(document.querySelectorAll('.commit.search-match').length).toBe(1);
    expect(row('f2').classList.contains('search-current')).toBe(true);
    expect(document.getElementById('search-count')?.textContent).toBe('1 / 1');
  });

  it('opens the details on click and loads the commit', () => {
    row('c').click();
    expect(content().classList.contains('details-hidden')).toBe(false);
    const commit = commits.find((entry) => entry.subject === 'c')!;
    expect(sent.at(-1)).toEqual({ type: 'selectCommit', payload: { hash: commit.hash } });
  });

  it('copies hash and message through the extension', () => {
    const commit = commits.find((entry) => entry.subject === 'c')!;
    receive('commitDetails', {
      details: { ...commit, authorEmail: 'fixture@example.invalid', body: 'Body text', files: [] },
    });
    document.getElementById('copy-hash')!.click();
    expect(sent.at(-1)).toEqual({ type: 'copyToClipboard', payload: { text: commit.hash, label: 'Commit hash' } });
    document.getElementById('copy-message')!.click();
    expect(sent.at(-1)?.payload).toEqual({ text: 'c\n\nBody text', label: 'Commit message' });
  });

  it('keeps the selection on refresh', () => {
    receive('commits', { commits, hasMore: false, maxLanes: 2, append: false });
    expect(row('c').classList.contains('selected')).toBe(true);
    expect(content().classList.contains('details-hidden')).toBe(false);
  });

  it('closes the details with Esc, the selection stays', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(content().classList.contains('details-hidden')).toBe(true);
    expect(selectedSubject()).toBe('c');
  });

  it('Ctrl+arrow from anywhere: the selection moves, closed details stay closed', () => {
    const before = sent.length;
    pressGlobal('ArrowUp', { ctrlKey: true });
    expect(selectedSubject()).toBe('merge feature');
    pressGlobal('ArrowDown', { ctrlKey: true });
    expect(selectedSubject()).toBe('c');
    expect(content().classList.contains('details-hidden')).toBe(true);
    // No details requested while the pane is closed.
    expect(sent.slice(before).some((message) => message.type === 'selectCommit')).toBe(false);
    // Plain arrow keys outside the list only scroll.
    pressGlobal('ArrowDown');
    expect(selectedSubject()).toBe('c');
  });

  it('Ctrl+G focuses the list; arrows, Home/End, Enter and Ctrl+Left/Right', () => {
    pressGlobal('g', { ctrlKey: true });
    expect(document.activeElement).toBe(items());
    pressInList('Home');
    expect(selectedSubject()).toBe('d');
    pressInList('ArrowDown');
    expect(selectedSubject()).toBe('merge feature');
    expect(content().classList.contains('details-hidden')).toBe(true);

    // Enter opens the details of the selected commit.
    pressInList('Enter');
    expect(content().classList.contains('details-hidden')).toBe(false);
    expect(sent.at(-1)).toEqual({ type: 'selectCommit', payload: { hash: hashOf('merge feature') } });
    // With the pane open, the details follow the selection.
    pressInList('ArrowDown');
    expect(sent.at(-1)).toEqual({ type: 'selectCommit', payload: { hash: hashOf('c') } });
    // Ctrl+Left closes, Ctrl+Right opens again.
    pressInList('ArrowLeft', { ctrlKey: true });
    expect(content().classList.contains('details-hidden')).toBe(true);
    pressInList('ArrowRight', { ctrlKey: true });
    expect(content().classList.contains('details-hidden')).toBe(false);
    pressInList('ArrowLeft', { ctrlKey: true });

    pressInList('End');
    expect(selectedSubject()).toBe(commits.at(-1)!.subject);
    pressInList('Home');
    expect(selectedSubject()).toBe('d');
  });

  it('context menu with the menu key and Shift+F10; Esc returns the focus to the list', () => {
    items().focus();
    pressInList('ContextMenu');
    const labels = Array.from(document.querySelectorAll('.context-menu__item')).map((item) => item.textContent);
    expect(labels[0]).toBe('Add Tag…');
    expect(document.activeElement?.textContent).toBe('Add Tag…');
    // The browser's contextmenu event that follows the key (target: the focused entry) must not
    // open the host's native menu as well.
    const follow = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(follow);
    expect(follow.defaultPrevented).toBe(true);
    // Up/Down move inside the menu, Esc closes it and returns to the list.
    pressGlobal('ArrowDown');
    expect(document.activeElement?.textContent).toBe('Create Branch…');
    pressGlobal('Escape');
    expect(document.querySelector('.context-menu')).toBeNull();
    expect(document.activeElement).toBe(items());

    pressInList('F10', { shiftKey: true });
    expect(document.querySelector('.context-menu')).not.toBeNull();
    pressGlobal('Escape');
  });

  it('g and / without modifier: focus the list or the search box, not while typing', () => {
    const input = document.getElementById('search-input') as HTMLInputElement;
    (document.activeElement as HTMLElement | null)?.blur();
    pressGlobal('/');
    expect(document.activeElement).toBe(input);
    // While typing, "g" is just a letter.
    pressGlobal('g');
    expect(document.activeElement).toBe(input);
    input.blur();
    pressGlobal('g');
    expect(document.activeElement).toBe(items());
  });

  it('Esc in the search box clears the search and continues at the match in the list', async () => {
    const input = document.getElementById('search-input') as HTMLInputElement;
    input.focus();
    input.value = 'f2';
    input.dispatchEvent(new Event('input'));
    await settle();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(input.value).toBe('');
    expect(selectedSubject()).toBe('f2');
    expect(document.activeElement).toBe(items());
  });

  it('right-click opens a context menu; Esc closes only the menu', () => {
    const rightClick = (element: Element): void => {
      element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    };
    const menuLabels = (): string[] =>
      Array.from(document.querySelectorAll('.context-menu__item')).map((item) => item.textContent ?? '');

    // On the "feature" branch chip: branch checkout first, then the commit entries.
    const chip = row('f2').querySelector('.ref-chip')!;
    rightClick(chip);
    expect(menuLabels()[0]).toBe('Check Out Branch "feature"');
    expect(row('f2').classList.contains('context-target')).toBe(true);

    // Esc closes the menu; with the details pane open it stays open.
    row('f2').click();
    rightClick(row('f2').querySelector('.commit-title')!);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(document.querySelector('.context-menu')).toBeNull();
    expect(content().classList.contains('details-hidden')).toBe(false);

    // An entry sends its action and closes the menu.
    rightClick(row('f2').querySelector('.commit-title')!);
    const copyHash = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu__item'))
      .find((item) => item.textContent === 'Copy Hash')!;
    copyHash.click();
    const commit = commits.find((entry) => entry.subject === 'f2')!;
    expect(sent.at(-1)).toEqual({ type: 'copyToClipboard', payload: { text: commit.hash, label: 'Commit hash' } });
    expect(document.querySelector('.context-menu')).toBeNull();
    expect(row('f2').classList.contains('context-target')).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('shows errors of the extension in the status line', () => {
    receive('error', { message: 'git log timed out after 30s.' });
    const status = document.getElementById('status')!;
    expect(status.textContent).toBe('Error: git log timed out after 30s.');
    expect(status.classList.contains('status--error')).toBe(true);
  });

  it('shows the repository picker with several repositories', () => {
    receive('commits', {
      repoRoot: 'C:/b',
      repositories: ['C:/a', 'C:/b'],
      commits,
      hasMore: false,
      maxLanes: 2,
    });
    const select = document.getElementById('repo-select') as HTMLSelectElement;
    expect(select.hidden).toBe(false);
    expect(select.value).toBe('C:/b');
    select.value = 'C:/a';
    select.dispatchEvent(new Event('change'));
    expect(sent.at(-1)).toEqual({ type: 'selectRepo', payload: { repoRoot: 'C:/a' } });
  });
});
