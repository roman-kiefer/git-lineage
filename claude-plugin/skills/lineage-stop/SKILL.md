---
description: Stop the Git Lineage server that this session started and close its tab in the browser pane. Use when the user asks to stop Git Lineage, close the git graph, or runs /git-lineage:lineage-stop.
argument-hint: "[repository folder or name]"
---

Stop the Git Lineage server(s) this session started with `/git-lineage:lineage-start` and close their browser tabs.

1. Find the servers: the Git Lineage servers this session started are background commands running `server/server.js` (from `/git-lineage:lineage-start`), each with its repository folder and URL `http://127.0.0.1:<port>/?token=...`. Only these count; never stop processes this session did not start.
   - The arguments ($ARGUMENTS) may name a repository (a path or a folder name): stop only the server for that repository.
   - No arguments: stop all Git Lineage servers of this session.
   - None found (or none for the named repository): say so in one sentence and stop. Do not look for or kill other `node` processes.
2. Close the browser tabs: if the built-in browser pane is open, list its tabs (tabs_context) and close (tabs_close) each tab whose origin is `http://127.0.0.1:<port>` of a server being stopped. Leave all other tabs open. Without a browser pane, skip this step.
3. Stop the server: stop its background command (TaskStop with the background command's ID, or the equivalent for stopping a background command in this session).
4. Tell the user in one sentence which repository's graph was closed and that the server is stopped.
