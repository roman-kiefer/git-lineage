import * as path from 'path';
import * as vscode from 'vscode';

// All Git repositories of the VS Code workspace (multi-root aware), sorted by path.
export const locateWorkspaceRepositories = async (): Promise<string[]> => {
  if (!vscode.workspace.workspaceFolders?.length) {
    return [];
  }

  // Prefer the built-in Git extension: it already knows every opened repository.
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (gitExtension) {
    const gitExports = await gitExtension.activate();
    const gitApi = gitExports?.getAPI?.(1) as
      | { repositories?: { rootUri?: vscode.Uri }[] }
      | undefined;
    const roots = (gitApi?.repositories ?? [])
      .map((repo) => repo.rootUri?.fsPath)
      .filter((root): root is string => Boolean(root));
    if (roots.length > 0) {
      return [...new Set(roots)].sort((a, b) => a.localeCompare(b));
    }
  }

  // Fallback: look for .git folders inside the workspace.
  const matches = await vscode.workspace.findFiles('**/.git/config', '**/node_modules/**', 20);
  const roots = matches.map((match) => path.dirname(path.dirname(match.fsPath)));
  return [...new Set(roots)].sort((a, b) => a.localeCompare(b));
};
