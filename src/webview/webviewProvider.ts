import * as vscode from 'vscode';
import { GraphController } from '../core/graphController';
import type { ConfirmOptions, Disposable, GraphHost, PromptOptions, WatchCallbacks, WatchTarget } from '../core/graphHost';
import { GitService } from '../git/gitService';
import { WebviewMessage } from './webviewMessages';
import { locateWorkspaceRepositories } from './vscodeRepoLocator';

// True when filePath lies inside folder (case-insensitive on Windows).
const isInside = (filePath: string, folder: string): boolean => {
  const normalize = (value: string): string => {
    const unified = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? unified.toLowerCase() : unified;
  };
  return normalize(filePath).startsWith(`${normalize(folder)}/`);
};

const config = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('gitLineage');

// VS Code host: the webview panel plus everything VS Code offers (dialogs, diff, terminal).
// The graph logic itself lives in GraphController (shared with the Claude Code browser pane).
const FILE_AT_REF_SCHEME = 'git-lineage';

interface FileAtRefQuery {
  repoRoot: string;
  filePath: string;
  ref: string;
}

export class GitGraphWebviewProvider implements GraphHost {
  private panel: vscode.WebviewPanel | undefined;
  private readonly controller: GraphController;

  constructor(private readonly context: vscode.ExtensionContext) {
    const gitService = new GitService({
      locateRepositories: locateWorkspaceRepositories,
      timeoutMs: () => config().get<number>('gitTimeoutSeconds', 30) * 1000,
    });
    this.controller = new GraphController(this, gitService);

    context.subscriptions.push(
      // File contents at a commit for Diff and Open, read with git show.
      vscode.workspace.registerTextDocumentContentProvider(FILE_AT_REF_SCHEME, {
        provideTextDocumentContent: (uri) => {
          const { repoRoot, filePath, ref } = JSON.parse(uri.query) as FileAtRefQuery;
          return gitService.fileAtRef(repoRoot, ref, filePath);
        },
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('gitLineage')) {
          this.controller.onConfigurationChanged({
            dateFormat: event.affectsConfiguration('gitLineage.dateFormat'),
          });
        }
      }),
      { dispose: () => this.controller.onClosed() },
    );
  }

  async showInPanel(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'gitLineage',
      'Git Lineage',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    // Tab icon: the G of the extension icon, dark on light themes and light on dark themes.
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'tab-light.svg'),
      dark: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'tab-dark.svg'),
    };

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.controller.onClosed();
    });

    // Catch up on repository changes that happened while the panel was hidden.
    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        this.controller.onVisible();
      }
    });

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.controller.receive(message);
    });
  }

  // --- GraphHost ---

  async post(message: unknown): Promise<void> {
    await this.panel?.webview.postMessage(message);
  }

  config<T>(key: string, fallback: T): T {
    return config().get<T>(key, fallback);
  }

  async updateConfig(key: string, value: unknown): Promise<void> {
    await config().update(key, value, vscode.ConfigurationTarget.Global);
  }

  isOpen(): boolean {
    return this.panel !== undefined;
  }

  isVisible(): boolean {
    return this.panel?.visible ?? false;
  }

  async confirm(options: ConfirmOptions): Promise<string | undefined> {
    // One button: a warning (destructive-ish), several: a plain question.
    const dialog = { modal: true, detail: options.detail };
    return options.buttons.length === 1
      ? vscode.window.showWarningMessage(options.message, dialog, ...options.buttons)
      : vscode.window.showInformationMessage(options.message, dialog, ...options.buttons);
  }

  prompt(options: PromptOptions): Promise<string | undefined> {
    return Promise.resolve(
      vscode.window.showInputBox({
        title: options.title,
        prompt: options.prompt,
        value: options.value,
        validateInput: (value) => options.validate(value),
      }),
    );
  }

  async copy(text: string): Promise<void> {
    // Clipboard via VS Code API works regardless of webview focus/permissions.
    await vscode.env.clipboard.writeText(text);
  }

  async openDiff(
    repoRoot: string,
    filePath: string,
    leftRef: string,
    rightRef: string | undefined,
    title: string,
  ): Promise<void> {
    const absPath = vscode.Uri.joinPath(vscode.Uri.file(repoRoot), filePath);
    const right = rightRef ? this.gitUri(repoRoot, filePath, rightRef) : absPath;
    await vscode.commands.executeCommand('vscode.diff', this.gitUri(repoRoot, filePath, leftRef), right, title);
  }

  async openFile(repoRoot: string, filePath: string, ref: string | undefined): Promise<void> {
    const absPath = vscode.Uri.joinPath(vscode.Uri.file(repoRoot), filePath);
    await vscode.commands.executeCommand('vscode.open', ref ? this.gitUri(repoRoot, filePath, ref) : absPath);
  }

  async openFolder(folder: string): Promise<void> {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), { forceNewWindow: true });
  }

  async openTerminal(cwd: string, name: string, command: string): Promise<void> {
    const terminal = vscode.window.createTerminal({ name, cwd });
    terminal.show();
    terminal.sendText(command);
  }

  watchRepository(target: WatchTarget, callbacks: WatchCallbacks): Disposable {
    const disposables: vscode.Disposable[] = [];
    const patterns = [
      new vscode.RelativePattern(vscode.Uri.file(target.gitDir), 'HEAD'),
      new vscode.RelativePattern(vscode.Uri.file(target.commonDir), 'refs/**'),
      new vscode.RelativePattern(vscode.Uri.file(target.commonDir), 'packed-refs'),
      // Index: staging/unstaging and commits change the "Uncommitted Changes" row.
      new vscode.RelativePattern(vscode.Uri.file(target.gitDir), 'index'),
    ];
    // Saved files inside the repository may add or remove uncommitted changes.
    disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.uri.scheme === 'file' && isInside(document.uri.fsPath, target.repoRoot)) {
          callbacks.onWorkingTreeMaybeChanged();
        }
      }),
    );
    patterns.forEach((pattern) => {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onChange = (): void => callbacks.onRepositoryChanged();
      disposables.push(watcher, watcher.onDidCreate(onChange), watcher.onDidChange(onChange), watcher.onDidDelete(onChange));
    });
    return { dispose: () => disposables.forEach((disposable) => disposable.dispose()) };
  }

  // File content at a commit, served by our own content provider (not VS Code's Git
  // extension, which only knows repositories it has opened). The URI keeps the file's
  // path so the editor shows the right name and language.
  private gitUri(repoRoot: string, filePath: string, ref: string): vscode.Uri {
    const absPath = vscode.Uri.joinPath(vscode.Uri.file(repoRoot), filePath);
    const query: FileAtRefQuery = { repoRoot, filePath, ref };
    return absPath.with({ scheme: FILE_AT_REF_SCHEME, query: JSON.stringify(query) });
  }

  private getHtml(): string {
    const scriptUri = this.panel?.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'main.js'),
    );
    const styleUri = this.panel?.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'main.css'),
    );

    const nonce = String(Date.now());

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel?.webview.cspSource} https:; style-src ${this.panel?.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <title>Git Lineage</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
