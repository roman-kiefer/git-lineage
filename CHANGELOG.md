# Changelog

All notable changes to Git Lineage are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- The checked-out branch is easier to spot: its chip shows the name larger and in bold (on a detached HEAD, the HEAD chip).

## [0.1.1] - 2026-11-10

### Security

- Local server (Claude Code plugin): the start page now requires the token from the printed URL by default, so other programs and user accounts on the same computer cannot open the graph. `--no-require-token` restores the old behavior.
- Local server: a malformed token (non-ASCII characters) no longer stops the server.
- Local server: other pages can no longer embed the graph or post messages into a window they opened with it.
- Interactive rebase: commit messages with control characters can no longer add lines to the rebase todo list.

## [0.1.0] - 2026-11-09

First public preview, for VS Code and as a Claude Code plugin.

### Added

- Graph view of the Git history in an editor tab (command **Open Git Lineage**, status bar entry), and the same view in the Claude Code browser pane through the plugin (`/git-lineage:git-graph`).
- Own lane layout: branches and merges as curves, lanes move left into freed columns, lane colors stay stable while loading more. Commits load page by page; the graph column scrolls sideways when lanes do not fit.
- Ref chips for local and remote branches, tags, HEAD and stashes; ahead/behind badge for local branches with an upstream.
- "Uncommitted Changes" row with the changed files of the working tree.
- Commit details with changed files, Diff and Open (VS Code), copy hash and message.
- Hover over a commit dot: branches and tags that contain the commit, and whether HEAD does.
- Worktrees: picker in the toolbar, markers on chips and in the graph, a changes row for every other worktree with changes, and worktree actions in the context menu.
- Context menu with forms: tag, branch, worktree, checkout (with fast-forward when the local branch lags behind the remote branch), cherry-pick, revert, merge, rebase, reset, delete branch or remote branch, push and delete tags (with live info whether the tag is on origin), apply, pop and drop stashes.
- Interactive rebase view: reorder, pick, reword, edit, squash, fixup and drop, without a text editor.
- Banner for stopped merges, cherry-picks, reverts and rebases with the conflicted files and Continue, Skip and Abort.
- Search in the loaded commits, branch filter, remote branches on/off, repository picker, automatic refresh, full keyboard control.
- Settings: page size, remote branches, automatic refresh, detached checkout confirmation, git timeout, date format.
