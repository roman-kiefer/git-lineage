import type { CommitView } from './model';
import type { WebviewActions } from './webviewActions';

// Ref under the mouse (from the chip's data attributes).
export type ContextRef = {
  name: string;
  type: string;
  // Paired chip (local + remote of the same name): the remote part.
  remoteName?: string;
  isCurrent: boolean;
  // Checked out in another worktree (or a worktree chip): its folder and name.
  worktreePath?: string;
  worktreeName?: string;
  // Stash chip: the stash commit.
  stashHash?: string;
};

// key: marks entries the menu changes later (e.g. "tagPush" once the remote state is known).
export type ContextMenuItem = { label: string; run: () => void; key?: string } | { separator: true };

// Answer of the extension to "tagInfo" (see graphController.handleTagInfo).
export type TagInfo = {
  requestId: string;
  name: string;
  missing?: boolean;
  annotated?: boolean;
  tagger?: string;
  date?: string;
  message?: string;
  remote?: string;
  remoteState?: 'checking' | 'noRemote' | 'same' | 'absent' | 'different' | 'unreachable';
  remoteCommit?: string;
};

// How long the remote may take before the menu says it is checking (shorter would only flash).
const CHECKING_DELAY_MS = 400;

// Lines of the info block at the top of a tag's menu, the state for its color, and whether
// pushing makes sense (not when the remote already has the tag, or has it on another commit).
export const describeTagInfo = (
  info: TagInfo,
): { lines: string[]; remoteLine: string; state: string; pushBlocked: boolean } => {
  if (info.missing) {
    return { lines: [`Tag ${info.name}`], remoteLine: 'Tag not found.', state: 'different', pushBlocked: true };
  }
  // The title is only the name: it is shown at once and does not change when the details arrive.
  const kind = info.annotated ? 'Annotated' : 'Lightweight';
  const who = [info.tagger, info.date?.slice(0, 10)].filter(Boolean).join(', ');
  const lines = [`Tag ${info.name}`, who ? `${kind} · ${who}` : kind];
  if (info.message && info.message !== info.name) {
    lines.push(`"${info.message}"`);
  }
  const remote = info.remote ?? 'remote';
  const remoteLines: Record<NonNullable<TagInfo['remoteState']>, string> = {
    checking: `Checking ${remote}…`,
    noRemote: 'No remote configured.',
    same: `✓ On ${remote}`,
    absent: `↑ Only local, not on ${remote}`,
    different: `⚠ ${remote} has this tag on another commit (${info.remoteCommit ?? '?'})`,
    unreachable: `${remote} could not be reached`,
  };
  const state = info.remoteState ?? 'checking';
  return {
    lines,
    remoteLine: remoteLines[state],
    state,
    pushBlocked: state === 'same' || state === 'different' || state === 'noRemote',
  };
};

type MenuActions = Pick<
  WebviewActions,
  | 'checkoutBranch'
  | 'checkoutRemoteBranch'
  | 'checkoutDetached'
  | 'createBranch'
  | 'showInTerminal'
  | 'copyToClipboard'
  | 'commitAction'
  | 'tagAction'
  | 'branchAction'
  | 'stashAction'
  | 'worktreeAction'
>;

// The menu itself also asks for tag details.
type BindActions = MenuActions & Pick<WebviewActions, 'tagInfo'>;

// Entries for a right-click on a commit row, optionally on one of its ref chips.
// Pure function: the extension asks for confirmation where an action needs one.
export const buildContextMenuItems = (
  commit: CommitView,
  ref: ContextRef | undefined,
  actions: MenuActions,
): ContextMenuItem[] => {
  if (commit.isVirtual || commit.isConnectorRow) {
    return [];
  }
  // "Uncommitted Changes" rows are no commits: other worktrees offer their worktree actions,
  // the shown worktree's row has no menu.
  if (commit.isUncommitted) {
    return commit.worktreePath ? worktreeItems(commit.worktreePath, commit.worktreeName ?? '', actions) : [];
  }
  const items: ContextMenuItem[] = [];

  // Branch checked out in another worktree (git would refuse a checkout here) or a worktree chip.
  if (ref?.worktreePath) {
    items.push(...worktreeItems(ref.worktreePath, ref.worktreeName ?? ref.name, actions), { separator: true });
  } else if (ref && !ref.isCurrent) {
    if (ref.type === 'local') {
      items.push(
        { label: `Check Out Branch "${ref.name}"`, run: () => actions.checkoutBranch(ref.name) },
        { label: `Delete Branch "${ref.name}"…`, run: () => actions.branchAction('delete', ref.name) },
      );
      // Chip that shows the local and the remote branch together: the remote one alone as well.
      const remoteName = ref.remoteName;
      if (remoteName) {
        items.push({
          label: `Delete Remote Branch "${remoteName}"…`,
          run: () => actions.branchAction('deleteRemote', remoteName),
        });
      }
    } else if (ref.type === 'remote') {
      items.push(
        { label: `Check Out "${ref.name}" as Local Branch`, run: () => actions.checkoutRemoteBranch(ref.name) },
        { label: `Delete Remote Branch "${ref.name}"…`, run: () => actions.branchAction('deleteRemote', ref.name) },
      );
    } else if (ref.type === 'stash' && ref.stashHash) {
      const stashHash = ref.stashHash;
      items.push(
        { label: `Apply Stash "${ref.name}"…`, run: () => actions.stashAction('apply', ref.name, stashHash) },
        { label: `Pop Stash "${ref.name}"…`, run: () => actions.stashAction('pop', ref.name, stashHash) },
        { label: `Drop Stash "${ref.name}"…`, run: () => actions.stashAction('drop', ref.name, stashHash) },
      );
    } else if (ref.type === 'tag') {
      items.push(
        { label: `Check Out Tag "${ref.name}" (Detached)…`, run: () => actions.checkoutDetached(ref.name) },
        { label: `Push Tag "${ref.name}"…`, run: () => actions.tagAction('push', ref.name), key: 'tagPush' },
        { label: `Delete Tag "${ref.name}"…`, run: () => actions.tagAction('delete', ref.name) },
      );
    }
    if (items.length > 0) {
      items.push({ separator: true });
    }
  }

  // HEAD itself: checking out, picking, merging, rebasing or resetting onto it changes nothing.
  const isHead = commit.refs.some((entry) => entry.isCurrent || entry.type === 'head');
  const hash = commit.hash;

  // Groups: create refs | bring the commit to HEAD | move the current branch | copy and show.
  items.push(
    { label: 'Add Tag…', run: () => actions.commitAction('addTag', hash) },
    { label: 'Create Branch…', run: () => actions.createBranch(hash) },
    { label: 'Add Worktree…', run: () => actions.commitAction('addWorktree', hash) },
    { separator: true },
  );
  if (!isHead) {
    items.push(
      { label: 'Check Out (Detached)…', run: () => actions.checkoutDetached(hash) },
      { label: 'Cherry-Pick onto Current Branch…', run: () => actions.commitAction('cherryPick', hash) },
    );
  }
  items.push({ label: 'Revert…', run: () => actions.commitAction('revert', hash) }, { separator: true });
  if (!isHead) {
    items.push(
      { label: 'Merge into Current Branch…', run: () => actions.commitAction('merge', hash) },
      { label: 'Rebase Current Branch onto This Commit…', run: () => actions.commitAction('rebase', hash) },
      { label: 'Reset Current Branch to This Commit…', run: () => actions.commitAction('reset', hash) },
      { separator: true },
    );
  }
  items.push(
    { label: 'Copy Hash', run: () => actions.copyToClipboard(hash, 'Commit hash') },
    { label: 'Copy Subject', run: () => actions.copyToClipboard(commit.subject, 'Commit subject') },
    { label: 'Show in Terminal', run: () => actions.showInTerminal(hash) },
  );
  return items;
};

// Actions on another worktree (its uncommitted row or a chip checked out there).
const worktreeItems = (folder: string, name: string, actions: MenuActions): ContextMenuItem[] => [
  { label: `Switch to Worktree "${name}"`, run: () => actions.worktreeAction('switch', folder) },
  { label: 'Open Worktree in New Window', run: () => actions.worktreeAction('openWindow', folder) },
  { label: 'Copy Worktree Path', run: () => actions.worktreeAction('copyPath', folder) },
  { label: `Remove Worktree "${name}"…`, run: () => actions.worktreeAction('remove', folder) },
];

// Read the ref from a chip element (see renderCommitColumns: data-ref-*).
const refFromChip = (chip: HTMLElement | null): ContextRef | undefined => {
  const name = chip?.dataset.refName;
  const type = chip?.dataset.refType;
  if (!chip || !name || !type) {
    return undefined;
  }
  return {
    name,
    type,
    remoteName: chip.dataset.remoteName,
    isCurrent: chip.classList.contains('ref-chip--current'),
    worktreePath: chip.dataset.worktreePath,
    worktreeName: chip.dataset.worktreeName,
    stashHash: chip.dataset.stashHash,
  };
};

// Right-click menu over the commit list. One menu at a time; closes on click, Esc, scroll,
// resize and when the webview loses focus.
export const bindContextMenu = (
  items: HTMLElement,
  findCommit: (hash: string) => CommitView | undefined,
  actions: BindActions,
): ContextMenuController => {
  let menu: HTMLDivElement | undefined;
  // Tag whose details the open menu waits for (answers to older menus are ignored).
  let tagRequest: string | undefined;
  let requestCounter = 0;
  let targetRow: HTMLElement | undefined;
  // Element that had the focus before the menu opened (e.g. the commit list).
  let returnFocus: HTMLElement | undefined;

  const close = (): void => {
    menu?.remove();
    menu = undefined;
    tagRequest = undefined;
    targetRow?.classList.remove('context-target');
    targetRow = undefined;
  };

  // Closed by Esc or by choosing an entry: the keyboard user continues where they were.
  const closeAndRestoreFocus = (): void => {
    close();
    if (returnFocus?.isConnected) {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = undefined;
  };

  // Info block at the top of a tag's menu; filled by showTagInfo when the answer arrives.
  const addTagInfoBlock = (name: string): void => {
    const block = document.createElement('div');
    block.className = 'context-menu__info';
    block.setAttribute('role', 'presentation');
    menu!.append(block);
    const line = document.createElement('div');
    line.className = 'context-menu__separator';
    line.setAttribute('role', 'separator');
    menu!.append(line);
    requestCounter += 1;
    lastState = 'checking';
    checkingText = 'Checking…';
    const request = `tag-${requestCounter}`;
    tagRequest = request;
    // Until the details arrive: the title (it stays) and an empty, height-keeping remote line.
    const title = document.createElement('div');
    title.className = 'context-menu__info-title';
    title.textContent = `Tag ${name}`;
    const remote = document.createElement('div');
    remote.className = 'context-menu__info-remote';
    remote.textContent = ' ';
    block.append(title, remote);
    actions.tagInfo(request, name);
    // "Checking…" only when the answer takes a while: a quick answer would just flash it.
    window.setTimeout(() => {
      const line = menu?.querySelector<HTMLElement>('.context-menu__info-remote');
      if (tagRequest === request && line && lastState === 'checking') {
        line.textContent = checkingText;
      }
    }, CHECKING_DELAY_MS);
  };

  // State of the open menu's remote line ("checking" until the remote answered).
  let lastState = 'checking';
  let checkingText = 'Checking…';

  const showTagInfo = (info: TagInfo): void => {
    const block = menu?.querySelector<HTMLElement>('.context-menu__info');
    if (!menu || !block || info.requestId !== tagRequest) {
      return;
    }
    const { lines, remoteLine, state, pushBlocked } = describeTagInfo(info);
    lastState = state;
    block.replaceChildren();
    lines.forEach((text, index) => {
      const line = document.createElement('div');
      line.className = index === 0 ? 'context-menu__info-title' : 'context-menu__info-line';
      line.textContent = text;
      block.append(line);
    });
    const remote = document.createElement('div');
    remote.className = `context-menu__info-remote context-menu__info-remote--${state}`;
    if (state === 'checking') {
      // Shown by the timer in addTagInfoBlock if the remote is still silent by then.
      checkingText = remoteLine;
      remote.textContent = ' ';
    } else {
      remote.textContent = remoteLine;
    }
    block.append(remote);
    // Push only while it makes sense; the extension checks again before pushing anyway.
    const push = menu.querySelector<HTMLButtonElement>('[data-key="tagPush"]');
    if (push) {
      const hadFocus = document.activeElement === push;
      push.disabled = pushBlocked && state !== 'checking';
      if (push.disabled && hadFocus) {
        menu.querySelector<HTMLButtonElement>('.context-menu__item:not(:disabled)')?.focus();
      }
    }
  };

  window.addEventListener('message', (event) => {
    const message = event.data as { type?: string; payload?: TagInfo };
    if (message?.type === 'tagInfo' && message.payload) {
      showTagInfo(message.payload);
    }
  });

  const open = (entries: ContextMenuItem[], x: number, y: number, row: HTMLElement, tagName?: string): void => {
    close();
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && active !== document.body ? active : undefined;
    menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');
    if (tagName) {
      addTagInfoBlock(tagName);
    }
    entries.forEach((entry) => {
      if ('separator' in entry) {
        const line = document.createElement('div');
        line.className = 'context-menu__separator';
        line.setAttribute('role', 'separator');
        menu!.appendChild(line);
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'context-menu__item';
      button.setAttribute('role', 'menuitem');
      button.textContent = entry.label;
      if (entry.key) {
        button.dataset.key = entry.key;
      }
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        closeAndRestoreFocus();
        entry.run();
      });
      menu!.appendChild(button);
    });
    document.body.appendChild(menu);
    // Keep the menu inside the viewport.
    const { offsetWidth, offsetHeight } = menu;
    menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - offsetHeight - 4))}px`;
    targetRow = row;
    row.classList.add('context-target');
    menu.querySelector<HTMLButtonElement>('.context-menu__item')?.focus();
  };

  // Menu for a row, placed below its description (keyboard: context menu key, Shift+F10).
  const openForRow = (row: HTMLElement): boolean => {
    const commit = row.dataset.hash ? findCommit(row.dataset.hash) : undefined;
    const entries = commit ? buildContextMenuItems(commit, undefined, actions) : [];
    if (entries.length === 0) {
      return false;
    }
    const anchor = row.querySelector<HTMLElement>('.commit-title') ?? row;
    const rect = anchor.getBoundingClientRect();
    open(entries, rect.left, rect.bottom, row);
    return true;
  };

  items.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest<HTMLElement>('.commit');
    // Context menu key while the list itself has the focus: the selected row.
    if (!row && target === items) {
      const selected = items.querySelector<HTMLElement>('.commit.selected');
      if (selected && openForRow(selected)) {
        event.preventDefault();
      }
      return;
    }
    const commit = row?.dataset.hash ? findCommit(row.dataset.hash) : undefined;
    if (!row || !commit) {
      return;
    }
    const ref = refFromChip(target!.closest<HTMLElement>('.ref-chip'));
    const entries = buildContextMenuItems(commit, ref, actions);
    if (entries.length === 0) {
      return;
    }
    event.preventDefault();
    // Tag chip: info block with details and the live state on the remote.
    open(entries, event.clientX, event.clientY, row, ref?.type === 'tag' ? ref.name : undefined);
  });

  // The context menu key opens the menu on keydown and moves the focus into it; the browser's
  // own contextmenu event follows (on Windows with keyup) and targets the menu entry. Without
  // this the host's native menu (Copy / Select All) would open on top of ours.
  window.addEventListener('contextmenu', (event) => {
    if (menu && menu.contains(event.target as Node)) {
      event.preventDefault();
    }
  });
  // Clicks outside the menu close it.
  window.addEventListener('mousedown', (event) => {
    if (menu && !menu.contains(event.target as Node)) {
      close();
    }
  });
  // Esc closes only the menu (capture phase: runs before the details pane's Esc handler).
  window.addEventListener(
    'keydown',
    (event) => {
      if (!menu) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeAndRestoreFocus();
        return;
      }
      // Tab leaves the menu like a click elsewhere would.
      if (event.key === 'Tab') {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      // Up/Down move between the entries.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('.context-menu__item:not(:disabled)'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        buttons[(index + step + buttons.length) % buttons.length]?.focus();
      }
    },
    true,
  );
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  // Any scrolling (page or inner containers) moves the rows away from the menu.
  window.addEventListener('scroll', close, true);

  return { openForRow };
};

export type ContextMenuController = {
  // Open the menu of a row from the keyboard; false when the row has no menu.
  openForRow: (row: HTMLElement) => boolean;
};
