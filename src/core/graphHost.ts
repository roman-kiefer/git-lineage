// What the graph controller needs from the program that shows the webview.
// Two implementations: VS Code (src/webview/vscodeHost.ts) and the local server for the
// Claude Code browser pane (src/standalone/standaloneHost.ts). Everything else is shared.

export type Disposable = { dispose(): void };

// Git directories of the shown repository (they differ in worktrees: HEAD/index live in
// gitDir, refs and packed-refs in commonDir).
export type WatchTarget = {
  repoRoot: string;
  gitDir: string;
  commonDir: string;
};

export type WatchCallbacks = {
  // HEAD, refs, packed-refs or the index changed: reload the list.
  onRepositoryChanged(): void;
  // A file in the working tree may have changed: check git status, reload only on a change.
  onWorkingTreeMaybeChanged(): void;
};

export type ConfirmOptions = {
  message: string;
  detail?: string;
  // Button labels; the result is the pressed label or undefined (cancelled).
  buttons: string[];
};

export type PromptOptions = {
  title: string;
  prompt: string;
  // Initial text of the input field.
  value?: string;
  // Returns a problem text, or undefined when the value is fine.
  validate(value: string): Promise<string | undefined>;
};

export interface GraphHost {
  // Message to the webview (no-op while nothing is shown).
  post(message: unknown): Promise<void>;
  // Setting under gitLineage.<key>.
  config<T>(key: string, fallback: T): T;
  // Change a setting (e.g. "Always accept" in a dialog). VS Code: user settings; browser pane:
  // until the server stops.
  updateConfig(key: string, value: unknown): Promise<void>;
  // Webview exists (may be hidden) / is visible right now.
  isOpen(): boolean;
  isVisible(): boolean;
  confirm(options: ConfirmOptions): Promise<string | undefined>;
  prompt(options: PromptOptions): Promise<string | undefined>;
  copy(text: string): Promise<void>;
  // leftRef/rightRef: commits to compare; rightRef undefined: the file as it is on disk.
  openDiff(repoRoot: string, filePath: string, leftRef: string, rightRef: string | undefined, title: string): Promise<void>;
  // ref undefined: the file as it is on disk.
  openFile(repoRoot: string, filePath: string, ref: string | undefined): Promise<void>;
  openTerminal(cwd: string, name: string, command: string): Promise<void>;
  // Open a folder (a worktree) in a new editor window.
  openFolder(folder: string): Promise<void>;
  watchRepository(target: WatchTarget, callbacks: WatchCallbacks): Disposable;
}
