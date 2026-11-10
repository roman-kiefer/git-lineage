---
description: Show the Git history of the current repository as an interactive graph (branches, merges, worktrees, commit details) in the browser pane. Use when the user asks to see the git graph, git history, branches or worktrees visually, or runs /git-lineage:git-graph.
argument-hint: "[repository folder or name]"
---

Open Git Lineage for a repository and show it in the browser pane.

1. Repository: the arguments ($ARGUMENTS) may be empty, a folder path, a repository name, or free text such as "open my-api for testing". Pick the folder like this:
   - A path in the arguments (absolute or relative to the working directory) that exists: use it.
   - A word that names a folder directly below the working directory (for example `my-api` in "open my-api"): use that folder.
   - Otherwise ignore the free text and use the current working directory.

   The chosen folder must be inside a Git repository (check with `git -C "<folder>" rev-parse --show-toplevel`). If it is not, look for Git repositories directly below it: exactly one, use it; several, list their names and ask which one; none, say so and stop.
2. Start the local server in the background (it keeps running while the graph is open):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/server/server.js" --repo "<repository folder>" --port 0
   ```

   Run it as a background command. It needs Node.js 18 or later; if `node` is missing, tell the user to install Node.js and stop.
   If the user asked for a setting, add `--set key=value` for it (keys as in the VS Code extension without the `gitLineage.` prefix: `pageSize`, `showRemoteBranches`, `autoRefresh`, `confirmDetachedCheckout`, `gitTimeoutSeconds`, `dateFormat` with `short`, `iso`, `local` or `relative`).
3. Wait for its first output line, `Git Lineage: http://127.0.0.1:<port>/?token=<token>`, and take the complete URL from it, including the token (without it the page answers "Token required"). An error line instead (for example not a Git repository) goes to the user as it is.
4. Open that URL in the built-in browser pane (preview_start with the URL, or navigate). If there is no browser pane in this session, give the user the URL to open in their browser.
5. Tell the user in one or two sentences that the graph is open, and that the server stops when this session ends or when they ask you to stop it.

The server listens on 127.0.0.1 only and changes the repository only through actions the user confirms in the page (checkout, branch, tag, merge, rebase, stash, ...). Do not stop it unless the user asks; if they ask, stop the background command.
