# Security Policy

## Supported versions

Git Lineage is in preview. Security fixes are made for the latest released version only, both for the VS Code extension and the Claude Code plugin. Please update before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report them privately through GitHub: [Report a vulnerability](https://github.com/roman-kiefer/git-lineage/security/advisories/new) (Security tab → *Report a vulnerability*).

Helpful details:

- affected version and where you use it (VS Code or Claude Code),
- what an attacker can do and under which conditions (for example a crafted repository, branch name or commit message),
- steps or a minimal repository to reproduce it.

You can expect a first answer within a week. Once the problem is confirmed, a fix is prepared and released, and the advisory is published afterwards. If you want to be credited, say so in your report.

## What is in scope

Examples of what counts as a security problem:

- Git commands built from repository content (branch, tag or file names, commit messages) that run something other than intended.
- Script injection in the webview through repository content.
- The local server of the Claude Code plugin being reachable or usable by other websites or other users on the machine.
- Network access that the user did not trigger.

Problems in Git, VS Code, Claude Code or Node.js themselves should be reported to those projects.
