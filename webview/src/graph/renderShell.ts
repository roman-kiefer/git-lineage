export const renderAppShell = (root: HTMLElement | null): void => {
  if (!root) {
    return;
  }

  root.innerHTML = `
    <div class="app">
      <header class="toolbar">
        <!-- Where am I: repository / worktree (selectors only when there is a choice), full path as
             tooltip, copy symbol for the full path. -->
        <div class="toolbar__group toolbar__group--context repo" id="repo">
          <span class="repo__path" id="repo-path">No repo</span>
          <select class="filter-select filter-select--repo" id="repo-select" aria-label="Repository" hidden></select>
          <select class="filter-select filter-select--worktree" id="worktree-select" aria-label="Worktree" hidden></select>
          <button class="repo__copy" id="repo-copy" type="button" title="Copy full path" aria-label="Copy full path" hidden>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="5" y="5" width="8.5" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 10.5h-.5A1 1 0 0 1 2 9.5V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
          </button>
        </div>
        <!-- What is shown: branch filter and remote branches. -->
        <div class="toolbar__group filters">
          <label class="filter-label" for="branch-select">Branches</label>
          <select class="filter-select filter-select--branch" id="branch-select"></select>
          <label class="filter-check" title="Show remote branches">
            <input type="checkbox" id="remote-toggle" checked />
            Remotes
          </label>
        </div>
        <!-- Find and refresh: the search box gives way first when space is short. -->
        <div class="toolbar__group toolbar__group--find">
          <div class="search" role="search">
            <input class="search-input" id="search-input" type="search" placeholder="Search loaded commits" title="Message, hash, author or ref (Ctrl+F). Enter: next, Shift+Enter: previous" aria-label="Search loaded commits" />
            <span class="search-count" id="search-count" aria-live="polite"></span>
            <button class="tool tool--icon tool--quiet" id="search-prev" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match">&#8593;</button>
            <button class="tool tool--icon tool--quiet" id="search-next" type="button" title="Next match (Enter)" aria-label="Next match">&#8595;</button>
          </div>
          <button class="tool tool--icon tool--quiet tool--refresh" type="button" data-action="refresh" title="Refresh" aria-label="Refresh">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.46-3.54" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12.2 1.8v3h-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </header>
      <!-- Stopped merge/cherry-pick/revert/rebase: what happened, conflicted files, Continue/Skip/Abort. -->
      <div class="operation-banner" id="operation-banner" role="status" hidden></div>
      <section class="content details-hidden" id="content">
        <div class="list-panel">
          <div class="list" id="commit-list">
            <div class="list-head" id="commit-head">
              <div class="list-head-graph" id="list-head-graph">
                Graph
                <!-- Scrollbar for lanes that do not fit into the column (graphScroll.ts). -->
                <div class="graph-hscroll" id="graph-hscroll" hidden></div>
              </div>
              <div class="list-head-row">
                <div class="list-head-col">
                  <span class="col-resize-handle" data-resize-col="graph" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize boundary before Description column"></span>
                  Description
                </div>
                <div class="list-head-col list-head-col--date">
                  Date
                  <span class="col-resize-handle" data-resize-col="date" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize boundary before Date column"></span>
                </div>
                <div class="list-head-col list-head-col--author">
                  Author
                  <span class="col-resize-handle" data-resize-col="author" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize boundary before Author column"></span>
                </div>
                <div class="list-head-col list-head-col--hash">
                  Commit
                  <span class="col-resize-handle" data-resize-col="hash" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize boundary before Commit column"></span>
                </div>
              </div>
            </div>
            <svg class="graph-overlay" id="graph-overlay" aria-hidden="true"></svg>
            <div class="list-items" id="commit-items">
              <div class="empty">No commits loaded yet.</div>
            </div>
          </div>
          <div class="list-footer" hidden>
            <button class="tool" id="load-more" type="button">Load more</button>
          </div>
        </div>
        <aside class="details" id="details" aria-label="Commit details">
          <div class="details-actions">
            <button class="file-action secondary" id="copy-hash" type="button">Copy hash</button>
            <button class="file-action secondary" id="copy-message" type="button">Copy message</button>
            <span class="spacer"></span>
            <button class="details-close" id="details-close" type="button" title="Close details (Esc)" aria-label="Close details">&#215;</button>
          </div>
          <div class="details-body">
            <div class="details-title" id="detail-subject">Select a commit</div>
            <div class="details-meta" id="detail-meta"></div>
            <div class="details-summary" id="detail-summary"></div>
            <div class="details-section">Message</div>
            <pre class="details-body-text" id="detail-body"></pre>
            <div class="details-section">Files</div>
            <div class="details-files" id="detail-files"></div>
          </div>
        </aside>
      </section>
      <footer class="status" id="status">Connecting...</footer>
    </div>
  `;
};
