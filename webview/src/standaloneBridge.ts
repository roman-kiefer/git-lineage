// Runs before main.js when the webview is served by the local server (Claude Code browser pane).
// Provides acquireVsCodeApi() like VS Code does, so the webview itself stays unchanged:
// - page -> server: postMessage becomes POST /message (JSON);
// - server -> page: Server-Sent Events from /events become window "message" events;
// - questions of the host (confirm, prompt, copy) are answered here with a small dialog.
import './styles/standalone.css';

type HostRequest =
  | { id: number; kind: 'confirm'; message: string; detail?: string; buttons: string[] }
  | { id: number; kind: 'prompt'; title: string; prompt: string; value?: string; error?: string }
  | { id: number; kind: 'copy'; text: string };

const sendToServer = (message: unknown): void => {
  void fetch('/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    credentials: 'same-origin',
  });
};

const answer = (id: number, value: string | undefined): void => {
  sendToServer({ type: 'hostResponse', payload: { id, value } });
};

// --- dialog ---

let openDialog: { id: number; element: HTMLElement } | undefined;

const closeDialog = (id?: number): void => {
  if (openDialog && (id === undefined || openDialog.id === id)) {
    openDialog.element.remove();
    openDialog = undefined;
  }
};

const showDialog = (request: Extract<HostRequest, { kind: 'confirm' | 'prompt' }>): void => {
  closeDialog();
  const backdrop = document.createElement('div');
  backdrop.className = 'host-dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'host-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const title = document.createElement('div');
  title.className = 'host-dialog__title';
  title.textContent = request.kind === 'confirm' ? request.message : request.title;
  dialog.appendChild(title);

  const detailText = request.kind === 'confirm' ? request.detail : request.prompt;
  if (detailText) {
    const detail = document.createElement('div');
    detail.className = 'host-dialog__detail';
    detail.textContent = detailText;
    dialog.appendChild(detail);
  }

  let input: HTMLInputElement | undefined;
  if (request.kind === 'prompt') {
    input = document.createElement('input');
    input.className = 'host-dialog__input';
    input.value = request.value ?? '';
    dialog.appendChild(input);
    if (request.error) {
      const error = document.createElement('div');
      error.className = 'host-dialog__error';
      error.textContent = request.error;
      dialog.appendChild(error);
    }
  }

  const buttons = document.createElement('div');
  buttons.className = 'host-dialog__buttons';
  const finish = (value: string | undefined): void => {
    closeDialog(request.id);
    answer(request.id, value);
  };
  const labels = request.kind === 'confirm' ? request.buttons : ['OK'];
  labels.forEach((label, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === 0 ? 'host-dialog__button host-dialog__button--primary' : 'host-dialog__button';
    button.textContent = label;
    button.addEventListener('click', () => finish(request.kind === 'confirm' ? label : input?.value ?? ''));
    buttons.appendChild(button);
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'host-dialog__button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => finish(undefined));
  buttons.appendChild(cancel);
  dialog.appendChild(buttons);

  // Esc cancels (and does not reach the webview). Enter in the input field confirms; on a button
  // Enter triggers that button (browser default), so Tab to "Hard" + Enter really means Hard.
  // Left/Right move between the buttons.
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      finish(undefined);
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      (buttons.firstElementChild as HTMLButtonElement | null)?.click();
    } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && event.target instanceof HTMLButtonElement) {
      event.preventDefault();
      const all = Array.from(buttons.querySelectorAll<HTMLButtonElement>('button'));
      const step = event.key === 'ArrowRight' ? 1 : -1;
      all[(all.indexOf(event.target) + step + all.length) % all.length]?.focus();
    }
  });

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  openDialog = { id: request.id, element: backdrop };
  (input ?? (buttons.firstElementChild as HTMLButtonElement | null))?.focus();
  input?.select();
};

const handleHostRequest = (request: HostRequest): void => {
  if (request.kind === 'copy') {
    // 127.0.0.1 counts as a secure context, so the clipboard API is available.
    navigator.clipboard.writeText(request.text).then(
      () => answer(request.id, 'ok'),
      () => answer(request.id, undefined),
    );
    return;
  }
  showDialog(request);
};

// --- channel ---

// Messages from the webview wait until the event stream is open (answers would be lost).
const queue: unknown[] = [];
let connected = false;
// The stream was open at least once (a later "not connected" means the connection was lost).
let wasConnected = false;

// The server is gone (stopped or restarted): say so instead of leaving "Loading…" or a spinning
// refresh behind. The webview treats this like an error of the extension (status line, loading
// state reset).
const reportDisconnected = (): void => {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'error',
        payload: { message: 'Connection to the Git Graph server lost. Start it again (e.g. the preview), then reload this page.' },
      },
    }),
  );
};

const events = new EventSource('/events');
events.onopen = () => {
  connected = true;
  wasConnected = true;
  queue.splice(0).forEach(sendToServer);
};
events.onmessage = (event: MessageEvent<string>) => {
  const message = JSON.parse(event.data) as { type: string; payload?: unknown };
  if (message.type === 'hostRequest') {
    handleHostRequest(message.payload as HostRequest);
    return;
  }
  if (message.type === 'hostRequestClosed') {
    closeDialog((message.payload as { id: number }).id);
    return;
  }
  // Same shape as VS Code's webview messages.
  window.dispatchEvent(new MessageEvent('message', { data: message }));
};
events.onerror = () => {
  // EventSource reconnects by itself; after a server restart the page asks for data again.
  if (connected) {
    connected = false;
    events.addEventListener('open', () => sendToServer({ type: 'ready' }), { once: true });
    reportDisconnected();
  }
};

(window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: (message: unknown) => {
    if (connected) {
      sendToServer(message);
    } else {
      queue.push(message);
      // After the connection was lost (not while the page is still connecting the first time),
      // a request would wait silently: report it at once.
      if (wasConnected) {
        reportDisconnected();
      }
    }
  },
  getState: () => undefined,
  setState: () => undefined,
});
