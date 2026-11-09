import * as vscode from 'vscode';

export function registerRefreshCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('gitLineage.refresh', () => {
    vscode.commands.executeCommand('gitLineage.open');
  });

  context.subscriptions.push(disposable);
}
