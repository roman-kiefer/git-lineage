import * as vscode from 'vscode';
import { GitGraphWebviewProvider } from '../webview/webviewProvider';

export function registerOpenViewCommand(context: vscode.ExtensionContext): void {
  const provider = new GitGraphWebviewProvider(context);

  const disposable = vscode.commands.registerCommand('gitLineage.open', async () => {
    await provider.showInPanel();
  });

  context.subscriptions.push(disposable);
}
