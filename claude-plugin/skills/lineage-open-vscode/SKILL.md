---
description: Open VS Code in the current working directory of this session (the repository or worktree Claude is working in). Use when the user asks to open the current folder, repository or worktree in VS Code, or runs /git-lineage:lineage-open-vscode.
---

Open the current working directory of this session in VS Code. This does not need the Git Lineage server.

1. Take the current working directory of this session (in a worktree session, that is the worktree folder).
2. Run:

   ```
   code "<working directory>"
   ```

   VS Code opens the folder in a new window, or brings an existing window with that folder to the front.
3. If `code` is not found, tell the user that the VS Code command line is not on the PATH: on Windows, run the VS Code installer again with "Add to PATH" checked; on macOS, run "Shell Command: Install 'code' command in PATH" from the command palette in VS Code. Then stop.
4. Tell the user in one sentence which folder was opened in VS Code.
