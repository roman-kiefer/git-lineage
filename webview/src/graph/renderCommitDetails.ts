export type CommitFileView = { status: string; path: string };

export type CommitDetailsView = {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  body: string;
  files: CommitFileView[];
};

type DetailElements = {
  subject: HTMLElement;
  meta: HTMLElement;
  summary: HTMLElement;
  body: HTMLElement;
  files: HTMLElement;
};

type DetailHandlers = {
  getSelectedHash: () => string | undefined;
  onOpenFile: (hash: string, path: string) => void;
  onOpenDiff: (hash: string, path: string) => void;
};

const getDetailElements = (): DetailElements | undefined => {
  const subject = document.getElementById('detail-subject');
  const meta = document.getElementById('detail-meta');
  const summary = document.getElementById('detail-summary');
  const body = document.getElementById('detail-body');
  const files = document.getElementById('detail-files');

  if (!subject || !meta || !summary || !body || !files) {
    return undefined;
  }
  return { subject, meta, summary, body, files };
};

const renderDetailFiles = (container: HTMLElement, files: CommitFileView[]): void => {
  if (files.length === 0) {
    container.textContent = 'No files changed.';
    return;
  }

  container.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'file-list';
  files.forEach((file) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'file-label';
    label.textContent = `${file.status} ${file.path}`;

    const diffAction = document.createElement('button');
    diffAction.className = 'file-action';
    diffAction.type = 'button';
    diffAction.dataset.path = file.path;
    diffAction.textContent = 'Diff';

    const openAction = document.createElement('button');
    openAction.className = 'file-action secondary';
    openAction.type = 'button';
    openAction.dataset.path = file.path;
    openAction.textContent = 'Open';

    item.append(label, diffAction, openAction);
    list.appendChild(item);
  });
  container.appendChild(list);
};

const setEmptyCommitDetails = (elements: DetailElements): void => {
  elements.subject.textContent = 'Select a commit';
  elements.meta.textContent = '';
  elements.summary.textContent = '';
  elements.body.textContent = 'No commit selected.';
  elements.files.textContent = 'No files to display.';
};

// Hash of the "Uncommitted Changes" row (set by the extension).
export const UNCOMMITTED_HASH = '__uncommitted__';

const setCommitDetails = (elements: DetailElements, details: CommitDetailsView): void => {
  const formattedDate = new Date(details.authorDate).toLocaleString();
  elements.subject.textContent = details.subject;
  elements.summary.textContent = `Files changed: ${details.files.length}`;
  if (details.hash.startsWith(UNCOMMITTED_HASH)) {
    // Own worktree, or another one ("__uncommitted__:<folder>", body = its folder).
    const other = details.hash !== UNCOMMITTED_HASH;
    elements.meta.textContent = other
      ? 'Working tree and index of this worktree compared with its HEAD'
      : 'Working tree and index compared with HEAD';
    elements.body.textContent = other ? `Not committed yet.\n${details.body}` : 'Not committed yet.';
    renderDetailFiles(elements.files, details.files);
    return;
  }
  elements.meta.textContent = `${details.shortHash} • ${details.authorName} <${details.authorEmail}> • ${formattedDate}`;
  elements.body.textContent = details.body?.trim() ? details.body : 'No commit body.';
  renderDetailFiles(elements.files, details.files);
};

// Details currently shown (source for the copy buttons).
let currentDetails: CommitDetailsView | undefined;

export const updateCommitDetails = (details?: CommitDetailsView): void => {
  currentDetails = details;
  const elements = getDetailElements();
  if (!elements) {
    return;
  }

  if (!details) {
    setEmptyCommitDetails(elements);
    return;
  }

  setCommitDetails(elements, details);
};

export const bindCommitDetailFileActions = (handlers: DetailHandlers): void => {
  const filesElement = document.getElementById('detail-files');
  if (!filesElement) {
    return;
  }

  filesElement.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('.file-action');
    const hash = handlers.getSelectedHash();
    if (!button || !hash) {
      return;
    }

    const path = button.dataset.path;
    if (!path) {
      return;
    }

    if (button.textContent === 'Open') {
      handlers.onOpenFile(hash, path);
    } else {
      handlers.onOpenDiff(hash, path);
    }
  });
};

// Show or hide the details pane; the list takes the full width when hidden.
export const setDetailsVisible = (visible: boolean): void => {
  document.getElementById('content')?.classList.toggle('details-hidden', !visible);
};

export const isDetailsVisible = (): boolean =>
  !document.getElementById('content')?.classList.contains('details-hidden');

// Full commit message as typed by the author (subject, blank line, body).
export const formatCommitMessage = (details: Pick<CommitDetailsView, 'subject' | 'body'>): string => {
  const body = details.body?.trim();
  return body ? [details.subject, '', body].join('\n') : details.subject;
};

type DetailsPanelHandlers = {
  onCopy: (text: string, label: string) => void;
  onClose: () => void;
};

// Wire copy and close buttons of the details pane; Esc closes it as well.
export const bindDetailsPanelActions = (handlers: DetailsPanelHandlers): void => {
  document.getElementById('copy-hash')?.addEventListener('click', () => {
    if (currentDetails) {
      handlers.onCopy(currentDetails.hash, 'Commit hash');
    }
  });
  document.getElementById('copy-message')?.addEventListener('click', () => {
    if (currentDetails) {
      handlers.onCopy(formatCommitMessage(currentDetails), 'Commit message');
    }
  });
  document.getElementById('details-close')?.addEventListener('click', () => {
    handlers.onClose();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isDetailsVisible()) {
      handlers.onClose();
    }
  });
};
