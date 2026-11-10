import * as fs from 'fs';
import * as path from 'path';
import type { ServerResponse } from 'http';
import type { ConfirmOptions, Disposable, GraphHost, PromptOptions, WatchCallbacks, WatchTarget } from '../core/graphHost';

// Host for the Claude Code browser pane (or any browser on this machine): messages go to the
// page over Server-Sent Events, questions are shown as dialogs in the page by the bridge
// (webview/src/standaloneBridge.ts). Diff and Open send the file contents to the page, which
// shows them itself (webview/src/graph/fileViewer.ts). Terminal and new windows need VS Code.

// Settings (same keys and defaults as the extension's gitLineage.* settings).
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  pageSize: 120,
  showRemoteBranches: true,
  autoRefresh: true,
  gitTimeoutSeconds: 30,
  dateFormat: 'short',
};

// How often the working tree is checked for changes (no save events outside an editor).
export const WORKING_TREE_POLL_MS = 3000;

type HostRequest =
  | { kind: 'confirm'; message: string; detail?: string; buttons: string[] }
  | { kind: 'prompt'; title: string; prompt: string; value?: string; error?: string }
  | { kind: 'copy'; text: string };

// Reads a file at a commit (empty when it does not exist there); GitService.fileAtRef.
export type FileAtRef = (repoRoot: string, ref: string, filePath: string) => Promise<string>;

// Larger files are not sent to the page.
export const MAX_VIEW_BYTES = 2 * 1024 * 1024;

// One side of a diff, or the file of Open, as sent to the page.
export type FileViewSide = { label: string; text: string };

export type FileViewPayload = {
  mode: 'diff' | 'file';
  path: string;
  title: string;
  // diff: old and new side; file: only right.
  left?: FileViewSide;
  right: FileViewSide;
  // Shown instead of the content (binary or too large).
  notice?: string;
};

export class StandaloneHost implements GraphHost {
  private readonly clients = new Set<ServerResponse>();
  private readonly pending = new Map<number, (value: string | undefined) => void>();
  private nextRequestId = 1;
  // Called when the first page connects again / the last one closes.
  onFirstClient: () => void = () => undefined;
  onNoClients: () => void = () => undefined;

  constructor(
    private readonly settings: Record<string, unknown> = DEFAULT_SETTINGS,
    private readonly fileAtRef: FileAtRef = async () => '',
  ) {}

  // --- connection handling (used by the server) ---

  addClient(response: ServerResponse): void {
    this.clients.add(response);
    if (this.clients.size === 1) {
      this.onFirstClient();
    }
    response.on('close', () => {
      this.clients.delete(response);
      if (this.clients.size === 0) {
        // Nobody can answer open questions any more.
        this.pending.forEach((resolve) => resolve(undefined));
        this.pending.clear();
        this.onNoClients();
      }
    });
  }

  // Answer from the page to a confirm/prompt/copy request.
  resolveRequest(id: number, value: string | undefined): void {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve(typeof value === 'string' ? value : undefined);
      // Other open pages close the same dialog.
      void this.post({ type: 'hostRequestClosed', payload: { id } });
    }
  }

  // --- GraphHost ---

  async post(message: unknown): Promise<void> {
    const frame = `data: ${JSON.stringify(message)}\n\n`;
    this.clients.forEach((client) => client.write(frame));
  }

  config<T>(key: string, fallback: T): T {
    return key in this.settings ? (this.settings[key] as T) : fallback;
  }

  // Kept in memory: the server has no settings file.
  async updateConfig(key: string, value: unknown): Promise<void> {
    this.settings[key] = value;
  }

  isOpen(): boolean {
    return this.clients.size > 0;
  }

  isVisible(): boolean {
    return this.clients.size > 0;
  }

  confirm(options: ConfirmOptions): Promise<string | undefined> {
    return this.request({ kind: 'confirm', message: options.message, detail: options.detail, buttons: options.buttons });
  }

  // Asks again with the problem shown until the value is valid or the dialog is cancelled.
  async prompt(options: PromptOptions): Promise<string | undefined> {
    let error: string | undefined;
    // Initial text, then the last (invalid) input so the user can correct it.
    let value: string | undefined = options.value;
    for (;;) {
      value = await this.request({ kind: 'prompt', title: options.title, prompt: options.prompt, value, error });
      if (value === undefined) {
        return undefined;
      }
      error = await options.validate(value);
      if (!error) {
        return value;
      }
    }
  }

  async copy(text: string): Promise<void> {
    await this.request({ kind: 'copy', text });
  }

  async openDiff(repoRoot: string, filePath: string, leftRef: string, rightRef: string | undefined, title: string): Promise<void> {
    const [left, right] = await Promise.all([
      this.readSide(repoRoot, filePath, leftRef),
      this.readSide(repoRoot, filePath, rightRef),
    ]);
    await this.showFileView({ mode: 'diff', path: filePath, title, left, right });
  }

  async openFile(repoRoot: string, filePath: string, ref: string | undefined): Promise<void> {
    const right = await this.readSide(repoRoot, filePath, ref);
    await this.showFileView({ mode: 'file', path: filePath, title: `${filePath} (${right.label})`, right });
  }

  async openTerminal(): Promise<void> {
    await this.onlyInVsCode('The terminal');
  }

  async openFolder(): Promise<void> {
    await this.onlyInVsCode('Opening a worktree in a new window');
  }

  // fs.watch on the git directories plus a periodic working tree check.
  watchRepository(target: WatchTarget, callbacks: WatchCallbacks): Disposable {
    const watchers: fs.FSWatcher[] = [];
    const watch = (dir: string, recursive: boolean, accept: (name: string) => boolean): void => {
      try {
        const watcher = fs.watch(dir, { recursive }, (_event, name) => {
          if (accept(String(name ?? ''))) {
            callbacks.onRepositoryChanged();
          }
        });
        watcher.on('error', () => watcher.close());
        watchers.push(watcher);
      } catch {
        // Missing folder (e.g. no refs yet) or no watch support: manual refresh still works.
      }
    };
    watch(target.gitDir, false, (name) => name === 'HEAD' || name === 'index');
    watch(target.commonDir, false, (name) => name === 'packed-refs');
    watch(path.join(target.commonDir, 'refs'), true, (name) => !name.endsWith('.lock'));
    const timer = setInterval(() => callbacks.onWorkingTreeMaybeChanged(), WORKING_TREE_POLL_MS);
    return {
      dispose: () => {
        clearInterval(timer);
        watchers.forEach((watcher) => watcher.close());
      },
    };
  }

  // A file at a commit, or on disk without ref. Missing files read as empty.
  private async readSide(repoRoot: string, filePath: string, ref: string | undefined): Promise<FileViewSide> {
    if (ref) {
      // Full hashes shortened like in the graph (also "<hash>~1").
      const label = ref.replace(/^([0-9a-f]{7})[0-9a-f]{33}/i, '$1');
      return { label, text: await this.fileAtRef(repoRoot, ref, filePath) };
    }
    return { label: 'Working Tree', text: await readWorkingTreeFile(repoRoot, filePath) };
  }

  private async showFileView(payload: FileViewPayload): Promise<void> {
    const sides = [payload.left, payload.right].filter((side): side is FileViewSide => side !== undefined);
    if (sides.some((side) => Buffer.byteLength(side.text, 'utf8') > MAX_VIEW_BYTES)) {
      payload = { ...payload, left: payload.left && { ...payload.left, text: '' }, right: { ...payload.right, text: '' }, notice: `The file is larger than ${MAX_VIEW_BYTES / 1024 / 1024} MB and is not shown here.` };
    } else if (sides.some((side) => isBinary(side.text))) {
      payload = { ...payload, left: payload.left && { ...payload.left, text: '' }, right: { ...payload.right, text: '' }, notice: 'Binary file, not shown.' };
    }
    await this.post({ type: 'showFileView', payload });
  }

  private async onlyInVsCode(feature: string): Promise<void> {
    await this.post({ type: 'status', payload: { message: `${feature} is only available in VS Code.` } });
  }

  // Send a question to the page and wait for its answer (undefined without a page).
  private request(request: HostRequest): Promise<string | undefined> {
    if (this.clients.size === 0) {
      return Promise.resolve(undefined);
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      void this.post({ type: 'hostRequest', payload: { id, ...request } });
    });
  }
}

// A file of the working tree; only inside repoRoot (the path comes from the page). Missing: empty.
export const readWorkingTreeFile = async (repoRoot: string, filePath: string): Promise<string> => {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, filePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return '';
  }
  try {
    return await fs.promises.readFile(target, 'utf8');
  } catch {
    return '';
  }
};

// Like git: a NUL byte near the start means binary.
export const isBinary = (text: string): boolean => text.slice(0, 8000).includes(String.fromCharCode(0));
