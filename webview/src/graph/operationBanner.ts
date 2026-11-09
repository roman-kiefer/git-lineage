// Banner below the toolbar while a merge, cherry-pick, revert or rebase waits (stopped by
// conflicts or by "edit"): what happened, the conflicted files (click opens one) and the
// buttons Continue, Skip and Abort.

export type OperationState = {
  kind: 'rebase' | 'merge' | 'cherry-pick' | 'revert';
  step?: number;
  total?: number;
  stoppedAt?: string;
  branch?: string;
  conflicts: string[];
};

type BannerActions = {
  act: (action: 'continue' | 'skip' | 'abort') => void;
  openConflict: (path: string) => void;
};

const NAMES: Record<OperationState['kind'], string> = {
  rebase: 'Rebase',
  merge: 'Merge',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
};

// Text of the banner, e.g. "Rebase of feature stopped at step 3 of 5 (c40fe58): conflicts in".
export const describeOperation = (state: OperationState): string => {
  const name = state.kind === 'rebase' && state.branch ? `Rebase of ${state.branch}` : NAMES[state.kind];
  const step = state.step && state.total ? ` at step ${state.step} of ${state.total}` : '';
  const commit = state.stoppedAt ? ` (${state.stoppedAt})` : '';
  if (state.conflicts.length > 0) {
    const files = state.conflicts.length === 1 ? '1 file' : `${state.conflicts.length} files`;
    return `${name} stopped${step}${commit}: conflicts in ${files}. Resolve them, then Continue.`;
  }
  if (state.kind === 'rebase') {
    return `${name} stopped${step}${commit} for editing: change the commit (e.g. amend), then Continue.`;
  }
  return `${name} waits${commit}: Continue to commit the result.`;
};

// Same stop (same operation, step and commit): an error shown for it stays across refreshes.
const stopKey = (state: OperationState): string => `${state.kind}:${state.step ?? ''}:${state.stoppedAt ?? ''}`;

export const createOperationBanner = (element: HTMLElement | null, actions: BannerActions) => {
  let current: OperationState | null | undefined;
  // A button was clicked and its answer is still due: an error then belongs into the banner.
  let awaiting = false;
  // Error of the last button, shown in the banner while it waits at the same place.
  let error: { message: string; key: string } | undefined;

  const update = (state: OperationState | null | undefined): void => {
    // The operation moved on (next stop or finished): the clicked button has had its effect.
    if (awaiting && (!state || !current || stopKey(state) !== stopKey(current))) {
      awaiting = false;
    }
    current = state;
    if (!element) {
      return;
    }
    element.replaceChildren();
    element.hidden = !state;
    if (!state) {
      error = undefined;
      return;
    }
    if (error && error.key !== stopKey(state)) {
      error = undefined;
    }
    const icon = document.createElement('span');
    icon.className = 'operation-banner__icon';
    icon.textContent = '⚠';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'operation-banner__text';
    text.textContent = describeOperation(state);

    const files = document.createElement('span');
    files.className = 'operation-banner__files';
    state.conflicts.slice(0, 8).forEach((file) => {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'operation-banner__file';
      link.textContent = file;
      link.title = `Open ${file}`;
      link.addEventListener('click', () => actions.openConflict(file));
      files.appendChild(link);
    });
    if (state.conflicts.length > 8) {
      files.append(` +${state.conflicts.length - 8} more`);
    }

    const buttons = document.createElement('span');
    buttons.className = 'operation-banner__buttons';
    const button = (label: string, action: 'continue' | 'skip' | 'abort', title: string): HTMLButtonElement => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `operation-banner__button${action === 'continue' ? ' operation-banner__button--primary' : ''}`;
      element.textContent = label;
      element.title = title;
      element.addEventListener('click', () => {
        // A new attempt: the old error goes, a new one will show up here again.
        error = undefined;
        awaiting = true;
        update(current);
        actions.act(action);
      });
      return element;
    };
    buttons.append(button('Continue', 'continue', 'Mark the resolved files as resolved and go on'));
    if (state.kind !== 'merge') {
      buttons.append(button('Skip', 'skip', 'Leave out this commit and go on'));
    }
    buttons.append(button('Abort', 'abort', `Cancel the ${state.kind} and go back to where it started`));

    element.append(icon, text, files, buttons);
    if (error) {
      // Answer to the button right where it was clicked (it is also in the status line).
      const problem = document.createElement('div');
      problem.className = 'operation-banner__error';
      problem.setAttribute('role', 'alert');
      problem.textContent = error.message;
      element.append(problem);
    }
  };

  // Error from the extension: shown in the banner if it answers one of its buttons.
  const showError = (message: string): boolean => {
    if (!awaiting || !current) {
      return false;
    }
    awaiting = false;
    error = { message, key: stopKey(current) };
    update(current);
    return true;
  };

  // Any other answer (a refreshed list after the action) ends the wait without an error.
  const settle = (): void => {
    awaiting = false;
  };

  return { update, showError, settle };
};
