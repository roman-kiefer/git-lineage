// Interactive rebase view: the commits of the branch (newest first, like the graph) with an
// action each, reorderable by dragging or Alt+Up/Down. Protocol (see graphController.ts):
// "showRebase" opens, the view answers "rebaseSubmit" / "rebaseCancel"; "rebaseError" shows a
// problem (view stays open), "rebaseClose" closes it.

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

type RebaseCommit = { hash: string; shortHash: string; subject: string; message: string; authorName: string };

export type RebaseRequest = { id: string; branch: string; base: string; ignoreDate: boolean; commits: RebaseCommit[] };

export type RebaseStepAnswer = { hash: string; action: RebaseAction; message?: string };

type RebaseAnswers = {
  submit: (id: string, steps: RebaseStepAnswer[], ignoreDate: boolean) => void;
  cancel: (id: string) => void;
};

type IncomingMessage = { type?: string; payload?: Record<string, unknown> };

// Actions with their key (shown in the list and usable on a focused row) and explanation.
const ACTIONS: Array<{ action: RebaseAction; label: string; key: string; info: string }> = [
  { action: 'pick', label: 'Pick', key: 'p', info: 'Keep the commit as it is.' },
  { action: 'reword', label: 'Reword', key: 'r', info: 'Keep the changes, change the message.' },
  { action: 'edit', label: 'Edit', key: 'e', info: 'Stop after this commit to change it; then Continue.' },
  { action: 'squash', label: 'Squash ↓', key: 's', info: 'Add to the older commit below; both messages are kept.' },
  { action: 'fixup', label: 'Fixup ↓', key: 'f', info: 'Add to the older commit below; this message is dropped.' },
  { action: 'drop', label: 'Drop', key: 'd', info: 'Leave the commit out.' },
];

// One row of the list: the commit, its chosen action and a new message for reword.
type Row = { commit: RebaseCommit; action: RebaseAction; message: string; element: HTMLElement };

export const createRebaseDialog = (answers: RebaseAnswers) => {
  let backdrop: HTMLElement | undefined;
  let openId: string | undefined;
  let showError: (message: string) => void = () => undefined;
  let previousFocus: HTMLElement | null = null;

  const close = (): void => {
    backdrop?.remove();
    backdrop = undefined;
    openId = undefined;
    const target = previousFocus?.isConnected && previousFocus !== document.body
      ? previousFocus
      : document.getElementById('commit-items');
    target?.focus({ preventScroll: true });
    previousFocus = null;
  };

  const show = (request: RebaseRequest): void => {
    close();
    previousFocus = document.activeElement as HTMLElement | null;
    openId = request.id;

    backdrop = document.createElement('div');
    backdrop.className = 'form-dialog-backdrop';
    const dialog = document.createElement('form');
    dialog.className = 'form-dialog rebase-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.noValidate = true;

    const title = document.createElement('div');
    title.className = 'form-dialog__title';
    title.id = `${request.id}-title`;
    title.textContent = `Interactive rebase of ${request.branch} onto ${request.base}`;
    dialog.setAttribute('aria-labelledby', title.id);
    const detail = document.createElement('div');
    detail.className = 'form-dialog__detail';
    detail.textContent = 'Newest commit on top, like in the graph. Drag a row or use Alt+↑/↓ to move it; '
      + 'keys p, r, e, s, f, d choose the action of the selected row. Merge commits are left out (the branch becomes linear).';
    dialog.append(title, detail);

    const list = document.createElement('div');
    list.className = 'rebase-list';
    list.setAttribute('role', 'list');
    dialog.appendChild(list);

    const rows: Row[] = request.commits.map((commit) => ({
      commit,
      action: 'pick',
      message: commit.message,
      element: document.createElement('div'),
    }));

    const summary = document.createElement('span');
    summary.className = 'rebase-summary';

    // Rebuild the list in the current order (keeps the focused row focused).
    const render = (): void => {
      const focusedHash = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.rebase-row')?.dataset.hash;
      const focusedPart = (document.activeElement as HTMLElement | null)?.dataset.part;
      list.replaceChildren(...rows.map((row, index) => renderRow(row, index)));
      const kept = rows.filter((row) => row.action !== 'drop');
      const result = kept.filter((row) => row.action !== 'squash' && row.action !== 'fixup').length;
      summary.textContent = `${rows.length} commit${rows.length === 1 ? '' : 's'} → ${result}`;
      if (focusedHash) {
        const row = list.querySelector<HTMLElement>(`.rebase-row[data-hash="${focusedHash}"]`);
        const part = focusedPart ? row?.querySelector<HTMLElement>(`[data-part="${focusedPart}"]`) : row;
        (part ?? row)?.focus({ preventScroll: true });
      }
    };

    const move = (from: number, to: number): void => {
      if (to < 0 || to >= rows.length || from === to) {
        return;
      }
      const [row] = rows.splice(from, 1);
      rows.splice(to, 0, row);
      clearError();
      render();
    };

    const setAction = (row: Row, action: RebaseAction): void => {
      row.action = action;
      clearError();
      render();
    };

    let dragFrom: number | undefined;

    const renderRow = (row: Row, index: number): HTMLElement => {
      // A new element per render, so listeners are not added twice.
      const element = document.createElement('div');
      row.element = element;
      element.className = `rebase-row rebase-row--${row.action}`;
      element.dataset.hash = row.commit.hash;
      element.tabIndex = 0;
      element.setAttribute('role', 'listitem');
      element.setAttribute('aria-label', `${row.action} ${row.commit.shortHash} ${row.commit.subject}`);
      element.draggable = true;

      const grip = document.createElement('span');
      grip.className = 'rebase-row__grip';
      grip.textContent = '⋮⋮';
      grip.title = 'Drag to move';
      grip.setAttribute('aria-hidden', 'true');

      const select = document.createElement('select');
      select.className = 'form-dialog__input rebase-row__action';
      select.dataset.part = 'action';
      select.setAttribute('aria-label', `Action for ${row.commit.shortHash}`);
      ACTIONS.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.action;
        option.textContent = entry.label;
        option.title = entry.info;
        select.appendChild(option);
      });
      select.value = row.action;
      select.title = ACTIONS.find((entry) => entry.action === row.action)?.info ?? '';
      select.addEventListener('change', () => setAction(row, select.value as RebaseAction));

      const hash = document.createElement('code');
      hash.className = 'rebase-row__hash';
      hash.textContent = row.commit.shortHash;
      hash.title = `${row.commit.hash} by ${row.commit.authorName}`;

      const text = document.createElement('div');
      text.className = 'rebase-row__text';
      if (row.action === 'reword') {
        const input = document.createElement('textarea');
        input.className = 'form-dialog__input rebase-row__message';
        input.dataset.part = 'message';
        input.value = row.message;
        input.rows = Math.min(6, Math.max(2, row.message.split('\n').length));
        input.spellcheck = false;
        input.setAttribute('aria-label', `New message for ${row.commit.shortHash}`);
        input.addEventListener('input', () => {
          row.message = input.value;
          clearError();
        });
        text.appendChild(input);
      } else {
        const subject = document.createElement('span');
        subject.className = 'rebase-row__subject';
        // Squash/fixup go into the next older row below.
        subject.textContent = row.action === 'squash' || row.action === 'fixup'
          ? `↳ ${row.commit.subject}`
          : row.commit.subject;
        subject.title = row.commit.message;
        text.appendChild(subject);
      }

      element.append(grip, select, hash, text);

      element.addEventListener('dragstart', (event) => {
        dragFrom = index;
        element.classList.add('rebase-row--dragging');
        event.dataTransfer?.setData('text/plain', row.commit.hash);
      });
      element.addEventListener('dragend', () => {
        dragFrom = undefined;
        element.classList.remove('rebase-row--dragging');
      });
      element.addEventListener('dragover', (event) => {
        if (dragFrom !== undefined) {
          event.preventDefault();
        }
      });
      element.addEventListener('drop', (event) => {
        event.preventDefault();
        if (dragFrom !== undefined) {
          move(dragFrom, index);
        }
      });
      return element;
    };

    // Keys on a row: Alt+Up/Down moves it, Up/Down moves the focus, letters choose the action.
    list.addEventListener('keydown', (event) => {
      const rowElement = (event.target as HTMLElement).closest<HTMLElement>('.rebase-row');
      if (!rowElement) {
        return;
      }
      const index = rows.findIndex((row) => row.commit.hash === rowElement.dataset.hash);
      const inField = event.target !== rowElement;
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
        return;
      }
      if (inField) {
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = list.children[index + (event.key === 'ArrowUp' ? -1 : 1)] as HTMLElement | undefined;
        next?.focus();
        return;
      }
      const entry = ACTIONS.find((candidate) => candidate.key === event.key.toLowerCase());
      if (entry && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setAction(rows[index], entry.action);
        if (entry.action === 'reword') {
          list.querySelector<HTMLTextAreaElement>(`.rebase-row[data-hash="${rows[index].commit.hash}"] textarea`)?.focus();
        }
      }
    });

    const error = document.createElement('div');
    error.className = 'form-dialog__error form-dialog__error--general';
    error.hidden = true;
    error.setAttribute('role', 'alert');
    const clearError = (): void => {
      error.hidden = true;
      error.textContent = '';
    };

    const footer = document.createElement('div');
    footer.className = 'rebase-footer';
    const dateLabel = document.createElement('label');
    dateLabel.className = 'form-dialog__check';
    const ignoreDate = document.createElement('input');
    ignoreDate.type = 'checkbox';
    ignoreDate.checked = request.ignoreDate;
    dateLabel.title = 'Set the author date of the rewritten commits to now (git rebase --ignore-date).';
    dateLabel.append(ignoreDate, document.createTextNode('Ignore date'));
    footer.append(dateLabel, summary);

    const buttons = document.createElement('div');
    buttons.className = 'form-dialog__buttons';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'form-dialog__button form-dialog__button--primary';
    submit.textContent = 'Start Rebase';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'form-dialog__button';
    cancel.textContent = 'Cancel';
    buttons.append(submit, cancel);
    dialog.append(error, footer, buttons);

    showError = (message: string): void => {
      error.textContent = message;
      error.hidden = false;
      submit.disabled = false;
    };

    const doCancel = (): void => {
      const id = openId;
      close();
      if (id) {
        answers.cancel(id);
      }
    };

    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!openId || submit.disabled) {
        return;
      }
      submit.disabled = true;
      answers.submit(
        openId,
        rows.map((row) => ({
          hash: row.commit.hash,
          action: row.action,
          message: row.action === 'reword' ? row.message : undefined,
        })),
        ignoreDate.checked,
      );
    });
    cancel.addEventListener('click', doCancel);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) {
        doCancel();
      }
    });
    dialog.addEventListener('keydown', (event) => {
      // Keys stay in the view (the graph's shortcuts must not react).
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        doCancel();
      }
    });

    render();
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    (list.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
  };

  // Messages of the controller for the view; returns whether the message was one of them.
  const handle = (message: IncomingMessage): boolean => {
    const payload = message.payload ?? {};
    switch (message.type) {
      case 'showRebase':
        show(payload as unknown as RebaseRequest);
        return true;
      case 'rebaseError':
        if (payload.id === openId) {
          showError(String(payload.message ?? 'The rebase cannot start.'));
        }
        return true;
      case 'rebaseClose':
        if (payload.id === openId) {
          close();
        }
        return true;
      default:
        return false;
    }
  };

  return { handle };
};
