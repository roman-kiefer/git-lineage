// Diff and file view of the browser pane (VS Code opens its own editors instead).
// Protocol: "showFileView" from the host opens it (payload: see FileViewPayload in
// src/standalone/standaloneHost.ts). Read-only; Esc or the close button closes it.
import { countChanges, diffLines, groupHunks, splitLines, type DiffLine } from './lineDiff';

type FileViewSide = { label: string; text: string };

export type FileViewRequest = {
  mode: 'diff' | 'file';
  path: string;
  title: string;
  left?: FileViewSide;
  right: FileViewSide;
  notice?: string;
};

type IncomingMessage = { type?: string; payload?: unknown };

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
};

const MARKS: Record<DiffLine['kind'], string> = { same: ' ', del: '−', add: '+' };

const renderDiffLine = (line: DiffLine): HTMLElement => {
  const row = element('div', `file-view__line file-view__line--${line.kind}`);
  row.append(
    element('span', 'file-view__no', line.oldNo === undefined ? '' : String(line.oldNo)),
    element('span', 'file-view__no', line.newNo === undefined ? '' : String(line.newNo)),
    element('span', 'file-view__mark', MARKS[line.kind]),
    element('span', 'file-view__text', line.text),
  );
  return row;
};

const renderFileLine = (text: string, index: number): HTMLElement => {
  const row = element('div', 'file-view__line file-view__line--file');
  row.append(element('span', 'file-view__no', String(index + 1)), element('span', 'file-view__text', text));
  return row;
};

// Unchanged lines left out of the diff; a click shows them in place.
const renderGap = (lines: DiffLine[], start: number, end: number): HTMLElement => {
  const count = end - start;
  const gap = element('button', 'file-view__gap', `⋯ ${count} unchanged line${count === 1 ? '' : 's'}`);
  gap.type = 'button';
  gap.title = 'Show these lines';
  gap.addEventListener('click', () => {
    const fragment = document.createDocumentFragment();
    lines.slice(start, end).forEach((line) => fragment.appendChild(renderDiffLine(line)));
    gap.replaceWith(fragment);
  });
  return gap;
};

const renderDiff = (request: FileViewRequest, body: HTMLElement, summary: HTMLElement): void => {
  const lines = diffLines(request.left?.text ?? '', request.right.text);
  const { added, removed } = countChanges(lines);
  summary.append(element('span', 'file-view__added', `+${added}`), element('span', 'file-view__removed', `−${removed}`));
  if (added === 0 && removed === 0) {
    body.appendChild(element('div', 'file-view__notice', 'No changes in this file.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  groupHunks(lines).forEach((segment) => {
    if (segment.type === 'gap') {
      fragment.appendChild(renderGap(lines, segment.start, segment.end));
    } else {
      lines.slice(segment.start, segment.end).forEach((line) => fragment.appendChild(renderDiffLine(line)));
    }
  });
  body.appendChild(fragment);
};

const renderFile = (request: FileViewRequest, body: HTMLElement): void => {
  const lines = splitLines(request.right.text);
  if (lines.length === 0) {
    body.appendChild(element('div', 'file-view__notice', 'The file is empty or does not exist here.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  lines.forEach((text, index) => fragment.appendChild(renderFileLine(text, index)));
  body.appendChild(fragment);
};

export const createFileViewer = (): { handle: (message: IncomingMessage) => boolean; close: () => void } => {
  let open: { backdrop: HTMLElement; returnFocus: Element | null } | undefined;

  const close = (): void => {
    if (!open) {
      return;
    }
    const { backdrop, returnFocus } = open;
    open = undefined;
    backdrop.remove();
    if (returnFocus instanceof HTMLElement) {
      returnFocus.focus();
    }
  };

  const show = (request: FileViewRequest): void => {
    const returnFocus = open?.returnFocus ?? document.activeElement;
    close();
    const backdrop = element('div', 'file-view-backdrop');
    const dialog = element('div', 'file-view');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const header = element('div', 'file-view__header');
    const title = element('div', 'file-view__title', request.title);
    title.id = 'file-view-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const sides = element('div', 'file-view__sides');
    sides.textContent = request.mode === 'diff' && request.left
      ? `${request.left.label} → ${request.right.label}`
      : request.right.label;
    const summary = element('div', 'file-view__summary');
    const closeButton = element('button', 'file-view__close', '×');
    closeButton.type = 'button';
    closeButton.title = 'Close (Esc)';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.addEventListener('click', close);
    const heading = element('div', 'file-view__heading');
    heading.append(title, sides);
    header.append(heading, summary, closeButton);

    const body = element('div', 'file-view__body');
    body.tabIndex = 0;
    body.setAttribute('aria-label', request.mode === 'diff' ? 'Changes' : 'File content');
    if (request.notice) {
      body.appendChild(element('div', 'file-view__notice', request.notice));
    } else if (request.mode === 'diff') {
      renderDiff(request, body, summary);
    } else {
      body.classList.add('file-view__body--file');
      renderFile(request, body);
    }

    dialog.append(header, body);
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    });
    // A click next to the dialog closes it.
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) {
        close();
      }
    });
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    open = { backdrop, returnFocus };
    body.focus();
  };

  return {
    handle: (message) => {
      if (message.type !== 'showFileView' || !message.payload) {
        return false;
      }
      show(message.payload as FileViewRequest);
      return true;
    },
    close,
  };
};
