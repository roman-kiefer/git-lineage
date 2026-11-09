import * as vscode from 'vscode';
import { registerOpenViewCommand } from './commands/openView';
import { registerRefreshCommand } from './commands/refresh';

export function activate(context: vscode.ExtensionContext): void {
  registerOpenViewCommand(context);
  registerRefreshCommand(context);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(git-branch) Git Lineage';
  statusBarItem.tooltip = 'Open Git Lineage';
  statusBarItem.command = 'gitLineage.open';
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {}
