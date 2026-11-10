# Git Lineage in Claude Code

The same graph as in VS Code, shown in the built-in browser pane of Claude Code. A small local server takes the place of VS Code; the interface and the Git logic are the same.

## Install

```
/plugin marketplace add roman-kiefer/git-lineage
/plugin install git-lineage@git-lineage
```

Requires Node.js 18 or later on your computer (`node` on the PATH). Nothing else is installed: the plugin brings the server as one prebuilt file.

## Open the graph

Ask Claude to show the git graph (for example "show me the git graph"), or run:

```
/git-lineage:git-graph [folder or name]
```

Claude starts the server for the current folder (or the folder you name: a path, or the name of a repository folder below the current one, as in `/git-lineage:git-graph my-api`) and opens it in the browser pane. If the folder holds several repositories, Claude asks which one. The server shows the repository of that folder; in a worktree it shows that worktree, with all other worktrees of the repository in the toolbar.

The server runs in the background until the session ends or you ask Claude to stop it. Several repositories or worktrees can be open at the same time; each gets its own server and port.

### Settings

The settings of the VS Code extension apply with their defaults. To change one, ask Claude when opening the graph, for example "open the git graph with ISO dates". Claude passes it to the server as `--set dateFormat=iso` (the setting name without the `gitLineage.` prefix). Available: `pageSize`, `showRemoteBranches`, `autoRefresh`, `confirmDetachedCheckout`, `gitTimeoutSeconds`, `dateFormat`; see the [README](../README.md#settings).

## What works only in VS Code

- Diff and Open for changed files, and "Show in Terminal": the status line says so in the browser pane.
- "Open Worktree in New Window".

Everything else works the same: checkout, branches, tags, merge, rebase (also interactive), cherry-pick, revert, reset, stashes, worktrees, with the same confirmation forms. Changes to HEAD, refs and the index show up at once; the working tree is checked every 3 seconds, other worktrees every 10 seconds.

## Security

The server is reachable only from your computer and runs only while it is started. It makes no outgoing connections of its own; Git does, for the remote actions you trigger (push or delete a tag or branch on a remote, the live check whether a tag or branch exists there).

- It listens on `127.0.0.1` only.
- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (protection against DNS rebinding).
- Every start creates a random token (32 bytes). The start page needs it in the URL (`?token=...`, the URL the server prints) and then sets it as a cookie (`HttpOnly`, `SameSite=Strict`, named after the port); the event stream, the scripts and all messages require it. Other programs and other user accounts on the same computer therefore cannot open the graph without the printed URL.
- Messages are accepted only as POST with `Content-Type: application/json` and the server's own `Origin`; there are no CORS headers, so other web pages can neither read data nor trigger actions.
- Git runs without a shell and never asks for passwords (credential helpers such as Git Credential Manager still work). Names are checked by Git (`git check-ref-format`), and every action that changes the repository, except a plain branch checkout, asks first in the page.
- Other pages can neither embed the graph (`frame-ancestors 'none'`) nor keep a reference to a window they opened with it (`Cross-Origin-Opener-Policy: same-origin`); the page only accepts messages from its own server connection.
- The page icon (`/favicon.png`) is the only file served without the token.

`--no-require-token` lets the start page hand out the cookie without `?token=...` (only for setups where the plain URL must work; any program on the computer can then open the graph).
