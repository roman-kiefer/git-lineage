"use strict";
(() => {
  // webview/src/graph/renderCommitDetails.ts
  var getDetailElements = () => {
    const subject = document.getElementById("detail-subject");
    const meta = document.getElementById("detail-meta");
    const summary = document.getElementById("detail-summary");
    const body = document.getElementById("detail-body");
    const files = document.getElementById("detail-files");
    if (!subject || !meta || !summary || !body || !files) {
      return void 0;
    }
    return { subject, meta, summary, body, files };
  };
  var statusKind = (status) => {
    switch (status.charAt(0)) {
      case "A":
        return "added";
      case "M":
      case "T":
        return "modified";
      case "D":
        return "deleted";
      case "R":
      case "C":
        return "renamed";
      case "U":
        return "untracked";
      default:
        return "other";
    }
  };
  var STATUS_TITLES = {
    added: "Added",
    modified: "Modified",
    deleted: "Deleted",
    renamed: "Renamed or copied",
    untracked: "Untracked",
    other: "Changed"
  };
  var OPEN_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7"/><path d="M13.5 2.5 7.5 8.5"/><path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/></svg>';
  var renderDetailFiles = (container, files) => {
    if (files.length === 0) {
      container.textContent = "No files changed.";
      return;
    }
    container.innerHTML = "";
    const list = document.createElement("ul");
    list.className = "file-list";
    files.forEach((file) => {
      const item = document.createElement("li");
      const kind = statusKind(file.status);
      const status = document.createElement("span");
      status.className = `file-status file-${kind}`;
      status.textContent = file.status.charAt(0);
      status.title = STATUS_TITLES[kind];
      const name = document.createElement("button");
      name.className = `file-name file-${kind}`;
      name.type = "button";
      name.dataset.action = "diff";
      name.dataset.path = file.path;
      name.title = `Show Diff of ${file.path}`;
      name.textContent = file.path;
      item.append(status, name);
      if (file.additions !== void 0 && file.deletions !== void 0) {
        const stats = document.createElement("span");
        stats.className = "file-stats";
        stats.title = `${file.additions} lines added, ${file.deletions} lines removed`;
        const added = document.createElement("span");
        added.className = "file-added";
        added.textContent = `+${file.additions}`;
        const removed = document.createElement("span");
        removed.className = "file-removed";
        removed.textContent = `-${file.deletions}`;
        stats.append("(", added, " | ", removed, ")");
        item.appendChild(stats);
      }
      if (kind !== "deleted") {
        const open = document.createElement("button");
        open.className = "file-open";
        open.type = "button";
        open.dataset.action = "open";
        open.dataset.path = file.path;
        open.title = "Open File";
        open.setAttribute("aria-label", `Open ${file.path}`);
        open.innerHTML = OPEN_ICON;
        item.appendChild(open);
      }
      list.appendChild(item);
    });
    container.appendChild(list);
  };
  var setEmptyCommitDetails = (elements) => {
    elements.subject.textContent = "Select a commit";
    elements.meta.textContent = "";
    elements.summary.textContent = "";
    elements.body.textContent = "No commit selected.";
    elements.files.textContent = "No files to display.";
  };
  var UNCOMMITTED_HASH = "__uncommitted__";
  var setCommitDetails = (elements, details) => {
    const formattedDate = new Date(details.authorDate).toLocaleString();
    elements.subject.textContent = details.subject;
    elements.summary.textContent = `Files changed: ${details.files.length}`;
    if (details.hash.startsWith(UNCOMMITTED_HASH)) {
      const other = details.hash !== UNCOMMITTED_HASH;
      elements.meta.textContent = other ? "Working tree and index of this worktree compared with its HEAD" : "Working tree and index compared with HEAD";
      elements.body.textContent = other ? `Not committed yet.
${details.body}` : "Not committed yet.";
      renderDetailFiles(elements.files, details.files);
      return;
    }
    elements.meta.textContent = `${details.shortHash} \u2022 ${details.authorName} <${details.authorEmail}> \u2022 ${formattedDate}`;
    elements.body.textContent = details.body?.trim() ? details.body : "No commit body.";
    renderDetailFiles(elements.files, details.files);
  };
  var currentDetails;
  var updateCommitDetails = (details) => {
    currentDetails = details;
    const elements = getDetailElements();
    if (!elements) {
      return;
    }
    if (!details) {
      setEmptyCommitDetails(elements);
      return;
    }
    setCommitDetails(elements, details);
  };
  var bindCommitDetailFileActions = (handlers) => {
    const filesElement = document.getElementById("detail-files");
    if (!filesElement) {
      return;
    }
    filesElement.addEventListener("click", (event) => {
      const target = event.target;
      const button = target?.closest("button[data-action]");
      const hash = handlers.getSelectedHash();
      if (!button || !hash) {
        return;
      }
      const path = button.dataset.path;
      if (!path) {
        return;
      }
      if (button.dataset.action === "open") {
        handlers.onOpenFile(hash, path);
      } else {
        handlers.onOpenDiff(hash, path);
      }
    });
  };
  var setDetailsVisible = (visible) => {
    document.getElementById("content")?.classList.toggle("details-hidden", !visible);
  };
  var isDetailsVisible = () => !document.getElementById("content")?.classList.contains("details-hidden");
  var formatCommitMessage = (details) => {
    const body = details.body?.trim();
    return body ? [details.subject, "", body].join("\n") : details.subject;
  };
  var bindDetailsPanelActions = (handlers) => {
    document.getElementById("copy-hash")?.addEventListener("click", () => {
      if (currentDetails) {
        handlers.onCopy(currentDetails.hash, "Commit hash");
      }
    });
    document.getElementById("copy-message")?.addEventListener("click", () => {
      if (currentDetails) {
        handlers.onCopy(formatCommitMessage(currentDetails), "Commit message");
      }
    });
    document.getElementById("details-close")?.addEventListener("click", () => {
      handlers.onClose();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isDetailsVisible()) {
        handlers.onClose();
      }
    });
  };

  // webview/src/graph/searchCommits.ts
  var normalizeQuery = (query) => query.trim().toLowerCase();
  var commitMatches = (commit, normalizedQuery) => {
    if (!normalizedQuery || commit.isVirtual || commit.isUncommitted) {
      return false;
    }
    if (commit.hash.toLowerCase().startsWith(normalizedQuery)) {
      return true;
    }
    const haystacks = [
      commit.subject,
      commit.authorName,
      ...commit.refs.map((ref) => ref.name)
    ];
    return haystacks.some((text) => text.toLowerCase().includes(normalizedQuery));
  };
  var findMatchingHashes = (commits, query) => {
    const normalized = normalizeQuery(query);
    if (!normalized) {
      return [];
    }
    return commits.filter((commit) => commitMatches(commit, normalized)).map((commit) => commit.hash);
  };
  var stepMatchIndex = (current, count, direction) => {
    if (count === 0) {
      return -1;
    }
    if (current < 0) {
      return direction === 1 ? 0 : count - 1;
    }
    return (current + direction + count) % count;
  };

  // webview/src/graph/searchController.ts
  var MATCH_CLASS = "search-match";
  var CURRENT_CLASS = "search-current";
  var INPUT_DEBOUNCE_MS = 150;
  var createSearchController = (options) => {
    const input = document.getElementById("search-input");
    const count = document.getElementById("search-count");
    const prevButton = document.getElementById("search-prev");
    const nextButton = document.getElementById("search-next");
    let matches = [];
    let currentIndex = -1;
    let debounceTimer;
    const rowsByHash = () => {
      const map = /* @__PURE__ */ new Map();
      options.items?.querySelectorAll(".commit").forEach((row) => {
        if (row.dataset.hash) {
          map.set(row.dataset.hash, row);
        }
      });
      return map;
    };
    const renderCount = () => {
      const hasQuery = Boolean(input?.value.trim());
      if (count) {
        count.textContent = !hasQuery ? "" : matches.length === 0 ? "No results" : `${currentIndex >= 0 ? currentIndex + 1 : 0} / ${matches.length}`;
      }
      const canStep = matches.length > 0;
      if (prevButton) {
        prevButton.disabled = !canStep;
      }
      if (nextButton) {
        nextButton.disabled = !canStep;
      }
    };
    const paint = (scrollToCurrent) => {
      const rows = rowsByHash();
      const matchSet = new Set(matches);
      const currentHash = matches[currentIndex];
      rows.forEach((row, hash) => {
        row.classList.toggle(MATCH_CLASS, matchSet.has(hash));
        row.classList.toggle(CURRENT_CLASS, hash === currentHash);
      });
      if (scrollToCurrent && currentHash) {
        rows.get(currentHash)?.scrollIntoView({ block: "center" });
      }
      renderCount();
    };
    const recompute = (scrollToCurrent) => {
      const previousHash = matches[currentIndex];
      matches = findMatchingHashes(options.getCommits(), input?.value ?? "");
      const keptIndex = previousHash ? matches.indexOf(previousHash) : -1;
      currentIndex = keptIndex >= 0 ? keptIndex : matches.length > 0 ? 0 : -1;
      paint(scrollToCurrent);
    };
    const step = (direction) => {
      currentIndex = stepMatchIndex(currentIndex, matches.length, direction);
      paint(true);
    };
    input?.addEventListener("input", () => {
      if (debounceTimer !== void 0) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = void 0;
        recompute(true);
      }, INPUT_DEBOUNCE_MS);
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.stopPropagation();
        const currentHash = currentIndex >= 0 ? matches[currentIndex] : void 0;
        input.value = "";
        recompute(false);
        options.onLeave?.(currentHash);
      }
    });
    prevButton?.addEventListener("click", () => step(-1));
    nextButton?.addEventListener("click", () => step(1));
    window.addEventListener("keydown", (event) => {
      const focused = document.activeElement;
      const typing = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement;
      const ctrlF = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
      const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !typing;
      if (ctrlF || slash) {
        event.preventDefault();
        input?.focus();
        input?.select();
      }
    });
    renderCount();
    return {
      refresh: () => recompute(false)
    };
  };

  // webview/src/graph/dateFormat.ts
  var MODES = ["short", "iso", "local", "relative"];
  var currentMode = "short";
  var currentLocale;
  var toDateFormatMode = (value) => MODES.includes(value) ? value : "short";
  var toLocale = (value) => {
    if (typeof value !== "string" || !value) {
      return void 0;
    }
    try {
      return Intl.DateTimeFormat.supportedLocalesOf(value)[0];
    } catch {
      return void 0;
    }
  };
  var setDateFormat = (mode, locale) => {
    currentMode = toDateFormatMode(mode);
    currentLocale = toLocale(locale);
  };
  var formatIso = (raw) => raw.includes("T") && raw.length >= 16 ? `${raw.slice(0, 10)} ${raw.slice(11, 16)}` : raw;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var FIGURE_SPACE = "\u2007";
  var formatShort = (date) => {
    const day = String(date.getDate()).padStart(2, FIGURE_SPACE);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${hours}:${minutes}`;
  };
  var RELATIVE_UNITS = [
    ["year", 365 * 24 * 3600],
    ["month", 30 * 24 * 3600],
    ["week", 7 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
    ["minute", 60]
  ];
  var formatRelative = (date, now, locale) => {
    const seconds = Math.round((now - date.getTime()) / 1e3);
    const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    for (const [unit, size] of RELATIVE_UNITS) {
      if (Math.abs(seconds) >= size) {
        return format.format(-Math.trunc(seconds / size), unit);
      }
    }
    return format.format(0, "minute");
  };
  var formatCommitDate = (raw, mode = currentMode, now = Date.now(), locale = currentLocale) => {
    if (!raw) {
      return "";
    }
    if (mode === "iso") {
      return formatIso(raw);
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return formatIso(raw);
    }
    if (mode === "short") {
      return formatShort(date);
    }
    if (mode === "relative") {
      return formatRelative(date, now, locale);
    }
    return date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  };

  // webview/src/graph/handleWebviewMessages.ts
  var applyFiltersFromPayload = (payload, deps) => {
    if (payload?.dateFormat) {
      setDateFormat(payload.dateFormat, payload.dateLocale);
    }
    if (payload?.repositories) {
      deps.renderRepositories(payload.repositories, payload.repositoryRoot ?? payload.repoRoot);
    }
    if (payload?.worktrees) {
      deps.renderWorktrees(payload.worktrees);
    }
    deps.renderFilters(
      payload?.branches ?? [],
      payload?.selectedBranch ?? "__all__",
      payload?.showRemoteBranches ?? true
    );
  };
  var handleInitMessage = (payload, deps) => {
    deps.setRefreshing(false);
    deps.setStatusText(payload?.message ?? "Connected.");
    deps.setRepoText(payload?.repoRoot, true);
    applyFiltersFromPayload(payload, deps);
    if (payload) {
      deps.applyCommitList(payload, false);
    } else {
      deps.renderEmptyCommitList();
    }
    deps.applyPagingState(payload?.nextCursor, payload?.hasMore ?? false);
    deps.updateCommitDetails(void 0);
  };
  var handleCommitsMessage = (payload, deps) => {
    deps.setRefreshing(false);
    deps.setStatusText(payload?.message ?? "Refreshed.");
    deps.setRepoText(payload?.repoRoot, false);
    applyFiltersFromPayload(payload, deps);
    if (payload) {
      deps.applyCommitList(payload, payload.append ?? false);
    }
    deps.applyPagingState(payload?.nextCursor, payload?.hasMore ?? false);
  };
  var handleCommitDetailsMessage = (payload, deps) => {
    deps.setStatusText(payload?.message ?? "Commit details loaded.");
    deps.updateCommitDetails(payload?.details);
  };
  var handleErrorMessage = (payload, deps) => {
    deps.setRefreshing(false);
    deps.resetLoading();
    deps.setStatusText(`Error: ${payload?.message ?? "Unknown error."}`, "error");
  };
  var createWebviewMessageHandler = (deps) => {
    return (message) => {
      if (message.type === "init") {
        handleInitMessage(message.payload, deps);
        return;
      }
      if (message.type === "commits") {
        handleCommitsMessage(message.payload, deps);
        return;
      }
      if (message.type === "commitDetails") {
        handleCommitDetailsMessage(message.payload, deps);
        return;
      }
      if (message.type === "error") {
        handleErrorMessage(message.payload, deps);
        return;
      }
      if (message.type === "status") {
        deps.setStatusText(message.payload?.message ?? "");
      }
    };
  };

  // webview/src/graph/buildRows.ts
  var buildRows = (commits) => commits.map((commit) => ({
    ...commit,
    graphConnectorPrefixes: []
  }));

  // webview/src/graph/layoutRows.ts
  var laneFromGraphPrefix = (prefix) => {
    if (!prefix) {
      return 0;
    }
    const starIndex = prefix.indexOf("*");
    if (starIndex < 0) {
      return 0;
    }
    return Math.max(0, Math.floor(starIndex / 2));
  };
  var activeLanesFromPrefix = (prefix) => {
    if (!prefix) {
      return [];
    }
    const lanes = /* @__PURE__ */ new Set();
    for (let idx = 0; idx < prefix.length; idx += 1) {
      const char = prefix[idx];
      if (char === "|" || char === "/" || char === "\\" || char === "*" || char === "_") {
        lanes.add(Math.max(0, Math.floor(idx / 2)));
      }
    }
    return [...lanes].sort((a, b) => a - b);
  };
  var laneCountFromGraphPrefix = (prefix) => Math.max(1, Math.ceil((prefix?.length ?? 0) / 2));
  var uniqueLaneEdges = (edges) => {
    const seen = /* @__PURE__ */ new Set();
    return edges.filter((edge) => {
      const key = `${edge.fromLane}->${edge.toLane}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  };
  var outgoingEdgesFromPrefix = (prefix) => {
    if (!prefix) {
      return [];
    }
    const edges = [];
    const laneCount = Math.ceil(prefix.length / 2);
    for (let lane = 0; lane < laneCount; lane += 1) {
      const headIndex = lane * 2;
      const head = prefix[headIndex] ?? " ";
      const gap = prefix[headIndex + 1] ?? " ";
      if (head === "|" || head === "*") {
        edges.push({ fromLane: lane, toLane: lane });
      }
      if (gap === "/" || head === "/") {
        edges.push({ fromLane: lane + 1, toLane: lane });
      }
      if (gap === "\\" || head === "\\") {
        edges.push({ fromLane: lane, toLane: lane + 1 });
      }
    }
    return uniqueLaneEdges(edges);
  };
  var composeLaneEdges = (left, right) => {
    if (left.length === 0 || right.length === 0) {
      return [];
    }
    const composed = [];
    left.forEach((source) => {
      right.forEach((target) => {
        if (source.toLane === target.fromLane) {
          composed.push({ fromLane: source.fromLane, toLane: target.toLane });
        }
      });
    });
    return uniqueLaneEdges(composed);
  };
  var transitionEdges = (startPrefix, connectors) => {
    let relation = outgoingEdgesFromPrefix(startPrefix);
    (connectors ?? []).forEach((connectorPrefix) => {
      const connectorEdges = outgoingEdgesFromPrefix(connectorPrefix);
      if (connectorEdges.length === 0 || relation.length === 0) {
        return;
      }
      const composed = composeLaneEdges(relation, connectorEdges);
      if (composed.length > 0) {
        relation = composed;
      }
    });
    return uniqueLaneEdges(relation);
  };
  var buildRowVisualLaneMaps = (commits) => {
    const maps = [];
    let nextVisualLane = 0;
    let maxVisualLane = 0;
    commits.forEach((commit, index) => {
      const map = /* @__PURE__ */ new Map();
      if (commit.isVirtual) {
        map.set(commit.lane, commit.lane);
        nextVisualLane = Math.max(nextVisualLane, commit.lane + 1);
        maxVisualLane = Math.max(maxVisualLane, commit.lane);
        maps.push(map);
        return;
      }
      const rawCommitLane = laneFromGraphPrefix(commit.graphPrefix);
      const activeRawLanes = activeLanesFromPrefix(commit.graphPrefix);
      if (activeRawLanes.length === 0) {
        activeRawLanes.push(rawCommitLane);
      }
      if (index > 0) {
        const previousCommit = commits[index - 1];
        const previousMap = maps[index - 1];
        const transitions = transitionEdges(
          previousCommit.graphPrefix,
          commit.graphConnectorPrefixes
        );
        transitions.forEach((edge) => {
          const fromVisual = previousMap?.get(edge.fromLane);
          if (fromVisual === void 0) {
            return;
          }
          if (!map.has(edge.toLane)) {
            map.set(edge.toLane, fromVisual);
          }
        });
      }
      activeRawLanes.forEach((rawLane) => {
        if (!map.has(rawLane)) {
          map.set(rawLane, nextVisualLane);
          nextVisualLane += 1;
        }
        const visualLane = map.get(rawLane) ?? 0;
        if (visualLane > maxVisualLane) {
          maxVisualLane = visualLane;
        }
      });
      maps.push(map);
    });
    return { maps, laneCount: Math.max(1, maxVisualLane + 1) };
  };
  var buildCommitIndexByHash = (commits) => {
    const indexByHash = /* @__PURE__ */ new Map();
    commits.forEach((commit, idx) => {
      indexByHash.set(commit.hash, idx);
    });
    return indexByHash;
  };

  // webview/src/graph/renderDebug.ts
  var createCommitGraphDebug = (commit, options) => {
    const debug = document.createElement("span");
    debug.className = "commit-graph-debug";
    const debugWidthChars = options.visualLaneCount(Math.max(options.maxLanes, 1)) * 2 + 2;
    debug.style.width = `${debugWidthChars}ch`;
    debug.textContent = "";
    debug.title = "";
    return debug;
  };
  var createCommitGraphDebugMeta = (commit, rowIndex, options) => {
    const meta = document.createElement("span");
    meta.className = "commit-graph-debug-meta";
    if (commit.isConnectorRow) {
      meta.textContent = "";
      return meta;
    }
    const parents = (commit.parents ?? []).map((hash) => hash.slice(0, 8)).join(",");
    meta.textContent = `P[${parents}]`;
    return meta;
  };

  // webview/src/graph/refIcons.ts
  var createRefIcon = (type) => {
    const icon = document.createElement("span");
    icon.className = "ref-chip__icon";
    icon.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute(
      "viewBox",
      type === "local" || type === "remote" || type === "paired-branch" || type === "tag" || type === "head" || type === "stash" || type === "worktree" ? "0 0 24 24" : "0 0 16 16"
    );
    const appendCircle = (cx, cy, r, fill = false) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", String(r));
      if (fill) {
        circle.classList.add("fill");
      }
      svg.appendChild(circle);
    };
    const appendLine = (x1, y1, x2, y2) => {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      svg.appendChild(line);
    };
    const appendPath = (d, fill = false) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      if (fill) {
        path.classList.add("fill");
      }
      svg.appendChild(path);
    };
    switch (type) {
      case "head":
        appendPath("M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z", true);
        break;
      case "tag":
        appendPath(
          "M21.41 11.58L12.41 2.58A2 2 0 0 0 11 2H4A2 2 0 0 0 2 4V11A2 2 0 0 0 2.59 12.42L11.59 21.42A2 2 0 0 0 13 22A2 2 0 0 0 14.41 21.41L21.41 14.41A2 2 0 0 0 22 13A2 2 0 0 0 21.41 11.58M13 20L4 11V4H11L20 13M6.5 5A1.5 1.5 0 1 1 5 6.5A1.5 1.5 0 0 1 6.5 5Z",
          true
        );
        break;
      case "stash":
        appendPath("M18 5H6V7H18M6 9H18V11H6M2 12H4V17H20V12H22V17A2 2 0 0 1 20 19H4A2 2 0 0 1 2 17M18 13H6V15H18Z", true);
        break;
      case "local":
      case "remote":
      case "paired-branch":
        appendPath(
          "M13,14C9.64,14 8.54,15.35 8.18,16.24C9.25,16.7 10,17.76 10,19A3,3 0 0,1 7,22A3,3 0 0,1 4,19C4,17.69 4.83,16.58 6,16.17V7.83C4.83,7.42 4,6.31 4,5A3,3 0 0,1 7,2A3,3 0 0,1 10,5C10,6.31 9.17,7.42 8,7.83V13.12C8.88,12.47 10.16,12 12,12C14.67,12 15.56,10.66 15.85,9.77C14.77,9.32 14,8.25 14,7A3,3 0 0,1 17,4A3,3 0 0,1 20,7C20,8.34 19.12,9.5 17.91,9.86C17.65,11.29 16.68,14 13,14M7,18A1,1 0 0,0 6,19A1,1 0 0,0 7,20A1,1 0 0,0 8,19A1,1 0 0,0 7,18M7,4A1,1 0 0,0 6,5A1,1 0 0,0 7,6A1,1 0 0,0 8,5A1,1 0 0,0 7,4M17,6A1,1 0 0,0 16,7A1,1 0 0,0 17,8A1,1 0 0,0 18,7A1,1 0 0,0 17,6Z",
          true
        );
        break;
      case "worktree":
        appendPath("M3 6A2 2 0 0 1 5 4H10L12 6H19A2 2 0 0 1 21 8V18A2 2 0 0 1 19 20H5A2 2 0 0 1 3 18ZM5 8V18H19V8Z", true);
        appendCircle(12, 13, 2.2, true);
        break;
      default:
        appendCircle(8, 8, 3.5);
        break;
    }
    icon.appendChild(svg);
    return icon;
  };

  // webview/src/graph/renderCommitColumns.ts
  var createCommitGraphSpacer = () => {
    const graphSpacer = document.createElement("div");
    graphSpacer.className = "commit-graph-spacer";
    return graphSpacer;
  };
  var splitRemoteRefName = (name) => {
    const separatorIndex = name.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex >= name.length - 1) {
      return void 0;
    }
    return {
      scope: name.slice(0, separatorIndex),
      label: name.slice(separatorIndex + 1)
    };
  };
  var appendChipSegment = (chip2, text, className) => {
    const segment = document.createElement("span");
    segment.className = className;
    segment.textContent = text;
    chip2.appendChild(segment);
  };
  var collectDisplayRefs = (refs) => {
    const usedIndices = /* @__PURE__ */ new Set();
    const displayRefs = [];
    refs.forEach((ref, index) => {
      if (usedIndices.has(index)) {
        return;
      }
      if (ref.type === "local") {
        const matchIndex = refs.findIndex((candidate, candidateIndex) => {
          if (candidateIndex === index || usedIndices.has(candidateIndex) || candidate.type !== "remote") {
            return false;
          }
          const parts = splitRemoteRefName(candidate.name);
          return parts?.label === ref.name;
        });
        if (matchIndex >= 0) {
          const remote = refs[matchIndex];
          const parts = splitRemoteRefName(remote.name);
          if (parts) {
            usedIndices.add(index);
            usedIndices.add(matchIndex);
            displayRefs.push({
              kind: "paired-branch",
              local: ref,
              remote,
              scope: parts.scope,
              label: ref.name
            });
            return;
          }
        }
      }
      if (ref.type === "remote") {
        const parts = splitRemoteRefName(ref.name);
        const matchIndex = parts ? refs.findIndex((candidate, candidateIndex) => {
          if (candidateIndex === index || usedIndices.has(candidateIndex) || candidate.type !== "local") {
            return false;
          }
          return candidate.name === parts.label;
        }) : -1;
        if (parts && matchIndex >= 0) {
          usedIndices.add(index);
          usedIndices.add(matchIndex);
          displayRefs.push({
            kind: "paired-branch",
            local: refs[matchIndex],
            remote: ref,
            scope: parts.scope,
            label: parts.label
          });
          return;
        }
      }
      usedIndices.add(index);
      displayRefs.push({ kind: "single", ref });
    });
    return displayRefs;
  };
  var markWorktree = (chip2, ref) => {
    if (!ref.worktree) {
      return;
    }
    if (ref.worktreePath) {
      chip2.dataset.worktreePath = ref.worktreePath;
      chip2.dataset.worktreeName = ref.worktree;
    }
    const kind = ref.worktreeIsMain ? "Main worktree" : "Worktree";
    chip2.title = ref.worktreePath ? `${kind} ${ref.worktree}: ${ref.worktreePath}` : `${kind} ${ref.worktree} (shown)`;
    if (ref.type === "worktree" || ref.worktreeIsMain) {
      return;
    }
    chip2.classList.add("ref-chip--in-worktree");
    const marker = document.createElement("span");
    marker.className = "ref-chip__worktree";
    marker.appendChild(createRefIcon("worktree"));
    appendChipSegment(marker, ref.worktree ?? "", "ref-chip__worktree-name");
    chip2.appendChild(marker);
  };
  var trackArrow = (direction) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 8 10");
    svg.setAttribute("width", "8");
    svg.setAttribute("height", "10");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("ref-chip__track-arrow");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", direction === "up" ? "M4 9V1.5M1 4.5L4 1.5L7 4.5" : "M4 1V8.5M1 5.5L4 8.5L7 5.5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  };
  var markTracking = (chip2, ref) => {
    if (!ref.upstream) {
      return;
    }
    const ahead = ref.ahead ?? 0;
    const behind = ref.behind ?? 0;
    let text = "";
    let tip;
    if (ref.upstreamGone) {
      text = "gone";
      tip = `${ref.upstream} no longer exists on the remote (as of the last fetch).`;
    } else {
      text = [ahead > 0 ? `\u2191${ahead}` : "", behind > 0 ? `\u2193${behind}` : ""].filter(Boolean).join(" ");
      const parts = [
        ahead > 0 ? `${ahead} ${ahead === 1 ? "commit" : "commits"} to push` : "",
        behind > 0 ? `${behind} ${behind === 1 ? "commit" : "commits"} to pull` : ""
      ].filter(Boolean);
      tip = parts.length > 0 ? `${ref.name} vs ${ref.upstream}: ${parts.join(", ")} (as of the last fetch).` : `${ref.name} is up to date with ${ref.upstream} (as of the last fetch).`;
    }
    chip2.title = chip2.title ? `${chip2.title}
${tip}` : tip;
    if (!text) {
      return;
    }
    const badge = document.createElement("span");
    badge.className = `ref-chip__track${ref.upstreamGone ? " ref-chip__track--gone" : ""}`;
    badge.dataset.track = text;
    badge.setAttribute("aria-label", tip);
    if (ref.upstreamGone) {
      badge.textContent = "gone";
    } else {
      [["up", ahead], ["down", behind]].forEach(([direction, count]) => {
        if (count > 0) {
          const part = document.createElement("span");
          part.className = `ref-chip__track-part ref-chip__track-part--${direction}`;
          part.append(trackArrow(direction), String(count));
          badge.appendChild(part);
        }
      });
    }
    chip2.appendChild(badge);
  };
  var createSingleRefChip = (ref) => {
    const chip2 = document.createElement("span");
    chip2.className = `ref-chip ref-chip--${ref.type}`;
    chip2.dataset.refName = ref.name;
    chip2.dataset.refType = ref.type;
    if (ref.isCurrent) {
      chip2.classList.add("ref-chip--current");
    }
    chip2.appendChild(createRefIcon(ref.type));
    appendChipSegment(chip2, ref.name, "ref-chip__segment ref-chip__segment--label");
    markTracking(chip2, ref);
    markWorktree(chip2, ref);
    if (ref.type === "stash") {
      chip2.title = ref.message ? `${ref.name}: ${ref.message}` : ref.name;
      if (ref.stashHash) {
        chip2.dataset.stashHash = ref.stashHash;
      }
    }
    return chip2;
  };
  var createPairedBranchChip = (displayRef) => {
    const chip2 = document.createElement("span");
    chip2.className = "ref-chip ref-chip--branch-pair";
    chip2.dataset.refName = displayRef.local.name;
    chip2.dataset.refType = "local";
    chip2.dataset.remoteName = displayRef.remote.name;
    if (displayRef.local.isCurrent || displayRef.remote.isCurrent) {
      chip2.classList.add("ref-chip--current");
    }
    chip2.appendChild(createRefIcon("paired-branch"));
    appendChipSegment(chip2, displayRef.label, "ref-chip__segment ref-chip__segment--label");
    const divider = document.createElement("span");
    divider.className = "ref-chip__divider";
    divider.setAttribute("aria-hidden", "true");
    chip2.appendChild(divider);
    appendChipSegment(chip2, displayRef.scope, "ref-chip__segment ref-chip__segment--scope");
    markTracking(chip2, displayRef.local);
    markWorktree(chip2, displayRef.local);
    return chip2;
  };
  var createRefChip = (displayRef) => {
    if (displayRef.kind === "paired-branch") {
      return createPairedBranchChip(displayRef);
    }
    return createSingleRefChip(displayRef.ref);
  };
  var createCommitHeading = (commit) => {
    const title = document.createElement("div");
    title.className = "commit-title";
    title.textContent = commit.subject;
    const heading = document.createElement("div");
    heading.className = "commit-heading";
    if (commit.refs.length > 0) {
      const refList = document.createElement("div");
      refList.className = "ref-list";
      collectDisplayRefs(commit.refs).slice(0, 4).forEach((displayRef) => {
        refList.appendChild(createRefChip(displayRef));
      });
      heading.appendChild(refList);
    }
    heading.appendChild(title);
    return heading;
  };
  var createCommitTableRow = (commit) => {
    const row = document.createElement("div");
    row.className = "commit-row";
    const heading = createCommitHeading(commit);
    heading.classList.add("commit-col", "commit-col--description");
    const date = document.createElement("div");
    date.className = "commit-col commit-col--date";
    date.textContent = formatCommitDate(commit.authorDate);
    date.title = commit.authorDate;
    const author = document.createElement("div");
    author.className = "commit-col commit-col--author";
    author.textContent = commit.authorName;
    const hash = document.createElement("div");
    hash.className = "commit-col commit-col--hash hash";
    hash.textContent = commit.shortHash;
    row.append(heading, date, author, hash);
    return row;
  };
  var createCommitInfo = (commit, rowIndex, options) => {
    const info = document.createElement("div");
    info.className = "commit-info";
    if (commit.isConnectorRow) {
      if (options.showGraphDebugMeta) {
        info.append(
          createCommitGraphDebugMeta(commit, rowIndex, {
            maxLanes: options.maxLanes,
            visualLaneCount: options.visualLaneCount,
            commitLane: options.commitLane
          })
        );
      }
      return info;
    }
    if (options.showGraphDebugMeta) {
      info.append(
        createCommitGraphDebugMeta(commit, rowIndex, {
          maxLanes: options.maxLanes,
          visualLaneCount: options.visualLaneCount,
          commitLane: options.commitLane
        })
      );
    }
    info.append(createCommitTableRow(commit));
    return info;
  };
  var createCommitItem = (commit, rowIndex, options) => {
    const item = document.createElement("div");
    item.className = "commit";
    item.dataset.hash = commit.hash;
    if (commit.isConnectorRow) {
      item.classList.add("commit--connector");
    }
    if (commit.isVirtual) {
      item.classList.add("commit--virtual");
    }
    if (commit.isUncommitted) {
      item.classList.add("commit--uncommitted");
    }
    if (commit.hash === options.selectedHash) {
      item.classList.add("selected");
    }
    if (options.isCurrentCommit(commit)) {
      item.classList.add("commit--current");
    }
    item.style.setProperty("--commit-accent", "transparent");
    item.append(createCommitGraphSpacer());
    if (options.showGraphDebugMeta) {
      item.append(
        createCommitGraphDebug(commit, {
          maxLanes: options.maxLanes,
          visualLaneCount: options.visualLaneCount,
          commitLane: options.commitLane
        })
      );
    }
    item.append(createCommitInfo(commit, rowIndex, options));
    return item;
  };
  var createCommitItemsFragment = (commits, rowBase, options) => {
    const fragment = document.createDocumentFragment();
    commits.forEach((commit, offset) => {
      fragment.append(createCommitItem(commit, rowBase + offset, options));
    });
    return fragment;
  };

  // webview/src/graph/graphLayout.ts
  var computeGraphLayout = (commits, rows, commitLane2, rowVisualLaneMaps = buildRowVisualLaneMaps(commits), options = {}) => {
    const primitives = [];
    const yMids = rows.map((row) => row.top + row.height / 2);
    const indexByHash = buildCommitIndexByHash(commits);
    const ownerLaneByCommitIndex = /* @__PURE__ */ new Map();
    const currentVisualLaneByLaneId = /* @__PURE__ */ new Map();
    const commitVisualLaneByCommitIndex = /* @__PURE__ */ new Map();
    const branchSourceByRowAndLane = /* @__PURE__ */ new Set();
    const freedByShiftRowAndLane = /* @__PURE__ */ new Set();
    const freedByShiftRowLaneAndOwner = /* @__PURE__ */ new Set();
    const rowLaneOccupancy = /* @__PURE__ */ new Map();
    const rowShiftBudgetByLaneId = /* @__PURE__ */ new Map();
    let laneCountByRules = 0;
    const recordRowOccupancy = (rowIndex, laneId, visualLane) => {
      const rowMap = rowLaneOccupancy.get(rowIndex) ?? /* @__PURE__ */ new Map();
      const lanesAtVisual = rowMap.get(visualLane) ?? /* @__PURE__ */ new Set();
      lanesAtVisual.add(laneId);
      rowMap.set(visualLane, lanesAtVisual);
      rowLaneOccupancy.set(rowIndex, rowMap);
    };
    const recordShiftBudget = (rowIndex, laneId, budget) => {
      const rowMap = rowShiftBudgetByLaneId.get(rowIndex) ?? /* @__PURE__ */ new Map();
      const existing = rowMap.get(laneId) ?? 0;
      if (budget > existing) {
        rowMap.set(laneId, budget);
      }
      rowShiftBudgetByLaneId.set(rowIndex, rowMap);
    };
    const candidateIndices = commits.map((commit, index) => ({ commit, index })).filter(({ commit }) => !commit.isVirtual && !commit.isConnectorRow).map(({ index }) => index);
    const isPlacedLast = (index) => commits[index]?.isUncommitted === true;
    const remaining = /* @__PURE__ */ new Set([
      ...candidateIndices.filter((index) => !isPlacedLast(index)),
      ...candidateIndices.filter(isPlacedLast)
    ]);
    const isVisualLaneOccupiedByOtherLane = (laneId, visualLane, rowIndex) => {
      const laneOwners = rowLaneOccupancy.get(rowIndex)?.get(visualLane);
      if (!laneOwners || laneOwners.size === 0) {
        return false;
      }
      for (const ownerLaneId of laneOwners) {
        if (freedByShiftRowLaneAndOwner.has(`${rowIndex}:${visualLane}:${ownerLaneId}`)) {
          continue;
        }
        if (ownerLaneId !== laneId) {
          return true;
        }
      }
      return false;
    };
    const leftLaneFreeReasonAtRow = (rowIndex, leftVisualLane) => {
      if (rowIndex <= 0 || leftVisualLane < 0) {
        return "none";
      }
      if (branchSourceByRowAndLane.has(`${rowIndex - 1}:${leftVisualLane}`)) {
        return "branch";
      }
      if (freedByShiftRowAndLane.has(`${rowIndex}:${leftVisualLane}`)) {
        return "shift";
      }
      return "none";
    };
    const resolveInitialVisualLaneAtRow = (rowIndex, laneId, preferredVisualLane) => {
      let candidate = Math.max(0, preferredVisualLane);
      while (isVisualLaneOccupiedByOtherLane(laneId, candidate, rowIndex)) {
        candidate += 1;
      }
      return candidate;
    };
    const canShiftLeftThisRow = (rowIndex, laneId, visualLane, allowShiftFreed) => {
      if (visualLane <= 0) {
        return "none";
      }
      const leftVisualLane = visualLane - 1;
      const freeReason = leftLaneFreeReasonAtRow(rowIndex, leftVisualLane);
      if (freeReason === "none") {
        return "none";
      }
      if (freeReason === "shift" && !allowShiftFreed) {
        return "none";
      }
      if (isVisualLaneOccupiedByOtherLane(laneId, leftVisualLane, rowIndex)) {
        return "none";
      }
      return freeReason;
    };
    const resolveLeftShiftTargetLane = (rowIndex, laneId, visualLane) => {
      if (visualLane <= 0) {
        return visualLane;
      }
      let targetLane = visualLane;
      let usedShiftFreedStep = false;
      let movedSteps = 0;
      while (targetLane > 0) {
        const freeReason = canShiftLeftThisRow(rowIndex, laneId, targetLane, !usedShiftFreedStep);
        if (freeReason === "none") {
          break;
        }
        if (freeReason === "shift") {
          usedShiftFreedStep = true;
        }
        targetLane -= 1;
        movedSteps += 1;
      }
      recordShiftBudget(rowIndex, laneId, movedSteps);
      return targetLane;
    };
    const emitVerticalSegment = (laneId, visualLane, rowIndex, yStart, yEnd, source = "lane") => {
      if (yEnd <= yStart) {
        return;
      }
      primitives.push({ kind: "line", laneId, visualLane, rowIndex, y1: yStart, y2: yEnd, source });
      recordRowOccupancy(rowIndex, laneId, visualLane);
    };
    const emitShiftLeftCurve = (laneId, fromVisualLane, toVisualLane, rowIndex) => {
      const row = rows[rowIndex];
      if (!row) {
        return;
      }
      primitives.push({
        kind: "shift",
        laneId,
        fromLane: fromVisualLane,
        toLane: toVisualLane,
        yTop: row.top,
        yBottom: row.top + row.height
      });
      recordRowOccupancy(rowIndex, laneId, fromVisualLane);
      recordRowOccupancy(rowIndex, laneId, toVisualLane);
      freedByShiftRowAndLane.add(`${rowIndex}:${fromVisualLane}`);
      freedByShiftRowLaneAndOwner.add(`${rowIndex}:${fromVisualLane}:${laneId}`);
    };
    const walkRow = (laneId, rowIndex, allowShift) => {
      let visualLane = currentVisualLaneByLaneId.get(laneId) ?? laneId;
      const shiftTarget = allowShift && visualLane > 0 ? resolveLeftShiftTargetLane(rowIndex, laneId, visualLane) : visualLane;
      if (shiftTarget < visualLane) {
        emitShiftLeftCurve(laneId, visualLane, shiftTarget, rowIndex);
        visualLane = shiftTarget;
        currentVisualLaneByLaneId.set(laneId, visualLane);
        return { visualLane, shifted: true };
      }
      return { visualLane, shifted: false };
    };
    const emitOpenEnd = (laneId, firstRow, startY, allowShift) => {
      for (let rowIndex = firstRow; rowIndex <= rows.length - 1; rowIndex += 1) {
        const row = rows[rowIndex];
        if (!row) {
          continue;
        }
        const { visualLane, shifted } = walkRow(laneId, rowIndex, allowShift && rowIndex > firstRow);
        if (shifted) {
          continue;
        }
        const yStart = rowIndex === firstRow ? startY : row.top;
        emitVerticalSegment(laneId, visualLane, rowIndex, yStart, row.top + row.height, "tail");
      }
    };
    const emitLaneOpenEnd = (laneId, fromRowIndex) => {
      const yMid = yMids[fromRowIndex];
      if (yMid !== void 0) {
        emitOpenEnd(laneId, fromRowIndex, yMid, true);
      }
    };
    const emitBranchCurve = (laneId, sourceVisualLane, parentVisualLane, parentRowIndex) => {
      const row = rows[parentRowIndex];
      const yMid = yMids[parentRowIndex];
      if (!row || yMid === void 0) {
        return;
      }
      const sourceRowIndex = Math.max(0, parentRowIndex - 1);
      primitives.push({
        kind: "branch",
        laneId,
        fromLane: sourceVisualLane,
        toLane: parentVisualLane,
        yFrom: yMids[sourceRowIndex] ?? row.top,
        yTo: yMid
      });
      branchSourceByRowAndLane.add(`${sourceRowIndex}:${sourceVisualLane}`);
      recordRowOccupancy(sourceRowIndex, laneId, sourceVisualLane);
      recordRowOccupancy(parentRowIndex, laneId, parentVisualLane);
    };
    const emitMergeEntryCurve = (colorLaneId, sourceVisualLane, routeColumn, sourceRowIndex) => {
      const row = rows[sourceRowIndex];
      const yMid = yMids[sourceRowIndex];
      if (!row || yMid === void 0) {
        return void 0;
      }
      const nextRow = rows[sourceRowIndex + 1];
      const nextMid = yMids[sourceRowIndex + 1];
      if (sourceVisualLane === routeColumn) {
        emitVerticalSegment(colorLaneId, routeColumn, sourceRowIndex, yMid, row.top + row.height, "merge");
        return nextRow?.top;
      }
      primitives.push({
        kind: "branch",
        laneId: colorLaneId,
        fromLane: sourceVisualLane,
        toLane: routeColumn,
        yFrom: yMid,
        // Last loaded row: only half a row is available.
        yTo: nextMid ?? row.top + row.height
      });
      recordRowOccupancy(sourceRowIndex, colorLaneId, sourceVisualLane);
      if (nextRow) {
        recordRowOccupancy(sourceRowIndex + 1, colorLaneId, routeColumn);
      }
      return nextMid;
    };
    const emitMergeParentPath = (colorLaneId, sourceVisualLane, targetVisualLane, sourceRowIndex, parentRowIndex, reservedPath) => {
      const firstColumn = reservedPath?.[0] ?? findFreeMergeColumn(colorLaneId, targetVisualLane, sourceRowIndex + 1, parentRowIndex - 1);
      const columnAt = (rowIndex) => reservedPath?.[Math.min(rowIndex - sourceRowIndex - 1, reservedPath.length - 1)] ?? firstColumn;
      const continueY = emitMergeEntryCurve(colorLaneId, sourceVisualLane, firstColumn, sourceRowIndex);
      for (let rowIndex = sourceRowIndex + 1; rowIndex <= parentRowIndex; rowIndex += 1) {
        const row = rows[rowIndex];
        const yMid = yMids[rowIndex];
        if (!row || yMid === void 0) {
          continue;
        }
        const yStart = rowIndex === sourceRowIndex + 1 && continueY !== void 0 ? continueY : row.top;
        const routeColumn = rowIndex === sourceRowIndex + 1 ? firstColumn : columnAt(rowIndex - 1);
        if (rowIndex < parentRowIndex && columnAt(rowIndex) !== routeColumn) {
          emitShiftLeftCurve(colorLaneId, routeColumn, columnAt(rowIndex), rowIndex);
        } else if (rowIndex < parentRowIndex) {
          emitVerticalSegment(colorLaneId, routeColumn, rowIndex, yStart, row.top + row.height, "merge");
        } else if (routeColumn === targetVisualLane) {
          emitVerticalSegment(colorLaneId, routeColumn, rowIndex, yStart, yMid, "merge");
        } else {
          primitives.push({
            kind: "branch",
            laneId: colorLaneId,
            fromLane: routeColumn,
            toLane: targetVisualLane,
            yFrom: row.top,
            yTo: yMid
          });
          recordRowOccupancy(rowIndex, colorLaneId, routeColumn);
          recordRowOccupancy(rowIndex, colorLaneId, targetVisualLane);
        }
      }
    };
    const isColumnFreeForLane = (laneId, column, fromRow, toRow) => {
      for (let rowIndex = fromRow; rowIndex <= toRow; rowIndex += 1) {
        if (isVisualLaneOccupiedByOtherLane(laneId, column, rowIndex)) {
          return false;
        }
      }
      return true;
    };
    const findFreeMergeColumn = (laneId, preferred, fromRow, toRow) => {
      if (toRow < fromRow) {
        return preferred;
      }
      for (let distance = 0; ; distance += 1) {
        const candidates = distance === 0 ? [preferred] : [preferred + distance, preferred - distance];
        for (const column of candidates) {
          if (column >= 0 && isColumnFreeForLane(laneId, column, fromRow, toRow)) {
            return column;
          }
        }
      }
    };
    const emitMergeOpenEnd = (commitIndex) => {
      const sourceColumn = commitVisualLaneByCommitIndex.get(commitIndex);
      if (sourceColumn === void 0 || commitIndex + 1 > rows.length - 1) {
        return;
      }
      const laneId = laneCountByRules;
      laneCountByRules += 1;
      const column = findFreeMergeColumn(laneId, sourceColumn + 1, commitIndex + 1, rows.length - 1);
      currentVisualLaneByLaneId.set(laneId, column);
      const continueY = emitMergeEntryCurve(laneId, sourceColumn, column, commitIndex);
      if (continueY !== void 0) {
        emitOpenEnd(laneId, commitIndex + 1, continueY, true);
      }
    };
    const reservedRouteByEdge = /* @__PURE__ */ new Map();
    const routeColumnByParentIndex = /* @__PURE__ */ new Map();
    let nextReservationOwner = -1;
    const reserveMergeRoute = (commitIndex, parentIndex, edgeKey) => {
      const sourceColumn = commitVisualLaneByCommitIndex.get(commitIndex);
      if (sourceColumn === void 0 || parentIndex <= commitIndex + 1) {
        return;
      }
      const parentOwner = ownerLaneByCommitIndex.get(parentIndex);
      const parentColumn = parentOwner === void 0 ? void 0 : commitVisualLaneByCommitIndex.get(parentIndex);
      const owner = parentOwner ?? nextReservationOwner--;
      let column = findFreeMergeColumn(owner, parentColumn ?? sourceColumn + 1, commitIndex + 1, parentIndex - 1);
      const path = [];
      for (let rowIndex = commitIndex + 1; rowIndex < parentIndex; rowIndex += 1) {
        if (rowIndex > commitIndex + 1 && rowIndex < parentIndex - 1) {
          let target = column;
          while (target - 1 >= (parentColumn ?? 0) && leftLaneFreeReasonAtRow(rowIndex, target - 1) !== "none" && isColumnFreeForLane(owner, target - 1, rowIndex, parentIndex - 1)) {
            target -= 1;
          }
          if (target < column) {
            recordRowOccupancy(rowIndex, owner, column);
            freedByShiftRowAndLane.add(`${rowIndex}:${column}`);
            freedByShiftRowLaneAndOwner.add(`${rowIndex}:${column}:${owner}`);
            column = target;
          }
        }
        recordRowOccupancy(rowIndex, owner, column);
        path.push(column);
      }
      reservedRouteByEdge.set(edgeKey, path);
      if (!routeColumnByParentIndex.has(parentIndex)) {
        routeColumnByParentIndex.set(parentIndex, column);
      }
    };
    const firstParentChildren = /* @__PURE__ */ new Map();
    commits.forEach((commit, index) => {
      const parentIndex = commit.parents?.[0] ? indexByHash.get(commit.parents[0]) : void 0;
      if (parentIndex !== void 0 && parentIndex > index) {
        const children = firstParentChildren.get(parentIndex) ?? [];
        children.push(index);
        firstParentChildren.set(parentIndex, children);
      }
    });
    const findYieldColumn = (parentIndex, childIndex, laneId) => {
      const laneColumn = currentVisualLaneByLaneId.get(laneId) ?? laneId;
      let best;
      (firstParentChildren.get(parentIndex) ?? []).forEach((otherChild) => {
        if (otherChild === childIndex || ownerLaneByCommitIndex.has(otherChild)) {
          return;
        }
        const column = routeColumnByParentIndex.get(otherChild);
        if (column !== void 0 && column < laneColumn && (best === void 0 || column < best)) {
          best = column;
        }
      });
      return best;
    };
    const pendingMerges = [];
    const flushMergeOpenEnds = (beforeRow) => {
      pendingMerges.sort((a, b) => a.commitIndex - b.commitIndex);
      while (pendingMerges.length > 0 && pendingMerges[0].commitIndex < beforeRow) {
        const { commitIndex, parentIndex, edgeKey } = pendingMerges.shift();
        if (parentIndex === void 0) {
          emitMergeOpenEnd(commitIndex);
        } else {
          reserveMergeRoute(commitIndex, parentIndex, edgeKey);
        }
      }
    };
    while (remaining.size > 0) {
      const startIndex = remaining.values().next().value;
      flushMergeOpenEnds(isPlacedLast(startIndex) ? commits.length : startIndex);
      const laneId = laneCountByRules;
      laneCountByRules += 1;
      const preferredVisualLane = Math.max(
        0,
        routeColumnByParentIndex.get(startIndex) ?? commits[startIndex]?.lane ?? laneId
      );
      currentVisualLaneByLaneId.set(
        laneId,
        resolveInitialVisualLaneAtRow(startIndex, laneId, preferredVisualLane)
      );
      let currentIndex = startIndex;
      while (currentIndex !== void 0) {
        if (!ownerLaneByCommitIndex.has(currentIndex)) {
          ownerLaneByCommitIndex.set(currentIndex, laneId);
        }
        if (!commitVisualLaneByCommitIndex.has(currentIndex)) {
          commitVisualLaneByCommitIndex.set(
            currentIndex,
            currentVisualLaneByLaneId.get(laneId) ?? laneId
          );
        }
        remaining.delete(currentIndex);
        if (ownerLaneByCommitIndex.get(currentIndex) === laneId) {
          const mergeIndex = currentIndex;
          (commits[mergeIndex]?.parents ?? []).slice(1).forEach((mergeParent, extraParentIndex) => {
            const mergeParentIndex = indexByHash.get(mergeParent);
            if (mergeParentIndex === void 0 || mergeParentIndex > mergeIndex) {
              pendingMerges.push({
                commitIndex: mergeIndex,
                parentIndex: mergeParentIndex,
                edgeKey: `${mergeIndex}:${extraParentIndex}`
              });
            }
          });
        }
        const parentHash = commits[currentIndex]?.parents?.[0];
        if (!parentHash) {
          break;
        }
        const parentIndex = indexByHash.get(parentHash);
        if (parentIndex === void 0 || parentIndex <= currentIndex) {
          emitLaneOpenEnd(laneId, currentIndex);
          break;
        }
        const parentOwnerLane = ownerLaneByCommitIndex.get(parentIndex);
        const yieldColumn = parentOwnerLane === void 0 ? findYieldColumn(parentIndex, currentIndex, laneId) : void 0;
        if (yieldColumn !== void 0) {
          commitVisualLaneByCommitIndex.set(parentIndex, yieldColumn);
        }
        const branchesToExistingParent = yieldColumn !== void 0 || parentOwnerLane !== void 0 && parentOwnerLane !== laneId;
        for (let rowIndex = currentIndex; rowIndex <= parentIndex; rowIndex += 1) {
          const row = rows[rowIndex];
          const yMid = yMids[rowIndex];
          if (!row || yMid === void 0) {
            continue;
          }
          const rowTop = row.top;
          const rowBottom = row.top + row.height;
          const { visualLane, shifted } = walkRow(
            laneId,
            rowIndex,
            rowIndex > currentIndex && rowIndex < parentIndex
          );
          if (shifted) {
            continue;
          }
          if (rowIndex === currentIndex) {
            if (branchesToExistingParent && parentIndex === currentIndex + 1) {
              continue;
            }
            emitVerticalSegment(laneId, visualLane, rowIndex, yMid, rowBottom);
            continue;
          }
          if (rowIndex < parentIndex) {
            const yEnd = branchesToExistingParent && rowIndex === parentIndex - 1 ? yMid : rowBottom;
            emitVerticalSegment(laneId, visualLane, rowIndex, rowTop, yEnd);
            continue;
          }
          if (branchesToExistingParent) {
            const parentVisualLane = commitVisualLaneByCommitIndex.get(parentIndex) ?? currentVisualLaneByLaneId.get(parentOwnerLane ?? laneId) ?? parentOwnerLane ?? laneId;
            emitBranchCurve(laneId, visualLane, parentVisualLane, parentIndex);
          } else {
            emitVerticalSegment(laneId, visualLane, rowIndex, rowTop, yMid);
            if (!ownerLaneByCommitIndex.has(parentIndex)) {
              ownerLaneByCommitIndex.set(parentIndex, laneId);
              commitVisualLaneByCommitIndex.set(parentIndex, visualLane);
              remaining.delete(parentIndex);
            }
          }
        }
        if (branchesToExistingParent) {
          break;
        }
        currentIndex = parentIndex;
      }
    }
    flushMergeOpenEnds(Number.POSITIVE_INFINITY);
    const resolveDisplayedCommitVisualLane = (commitIndex) => {
      const commit = commits[commitIndex];
      if (!commit) {
        return 0;
      }
      const rawLane = commitLane2(commit);
      return commitVisualLaneByCommitIndex.get(commitIndex) ?? rowVisualLaneMaps.maps[commitIndex]?.get(rawLane) ?? ownerLaneByCommitIndex.get(commitIndex) ?? rawLane;
    };
    commits.forEach((commit, commitIndex) => {
      (commit.parents ?? []).slice(1).forEach((parentHash, extraParentIndex) => {
        const parentIndex = indexByHash.get(parentHash);
        if (parentIndex === void 0 || parentIndex <= commitIndex) {
          return;
        }
        const mergeSegment = commit.segments[extraParentIndex + 1];
        const sourceRawLane = mergeSegment?.fromLane ?? commitLane2(commit);
        const targetRawLane = mergeSegment?.toLane ?? commitLane2(commits[parentIndex]);
        const sourceVisualLane = commitVisualLaneByCommitIndex.get(commitIndex) ?? rowVisualLaneMaps.maps[commitIndex]?.get(sourceRawLane) ?? resolveDisplayedCommitVisualLane(commitIndex);
        const colorLaneId = ownerLaneByCommitIndex.get(parentIndex) ?? targetRawLane;
        const targetVisualLane = commitVisualLaneByCommitIndex.get(parentIndex) ?? rowVisualLaneMaps.maps[parentIndex]?.get(targetRawLane) ?? resolveDisplayedCommitVisualLane(parentIndex);
        emitMergeParentPath(
          colorLaneId,
          sourceVisualLane,
          targetVisualLane,
          commitIndex,
          parentIndex,
          reservedRouteByEdge.get(`${commitIndex}:${extraParentIndex}`)
        );
      });
    });
    ownerLaneByCommitIndex.forEach((laneId, commitIndex) => {
      const yMid = yMids[commitIndex];
      if (yMid === void 0) {
        return;
      }
      const visualLane = commitVisualLaneByCommitIndex.get(commitIndex) ?? laneId;
      primitives.push({ kind: "dot", laneId, visualLane, rowIndex: commitIndex, y: yMid });
      recordRowOccupancy(commitIndex, laneId, visualLane);
    });
    return {
      primitives: options.compact === false ? primitives : compactLanesRepeatedly(primitives, rows, rowLaneOccupancy),
      laneCount: laneCountByRules,
      ownerLaneByCommitIndex,
      commitVisualLaneByCommitIndex,
      rowLaneOccupancy,
      rowShiftBudgetByLaneId
    };
  };
  var COMPACT_MIN_ROWS = 5;
  var rowIndexAt = (rows, y) => {
    let low = 0;
    let high = rows.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (rows[middle].top <= y) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  };
  var compactLanes = (primitives, rows, occupancy, onlyLanes) => {
    const movedLanes = /* @__PURE__ */ new Set();
    if (rows.length === 0) {
      return { primitives, movedLanes };
    }
    const key = (laneId, column, rowIndex) => (laneId * 4096 + column) * 1048576 + rowIndex;
    const fullRowLines = /* @__PURE__ */ new Map();
    const touched = /* @__PURE__ */ new Set();
    primitives.forEach((primitive) => {
      if (onlyLanes && !onlyLanes.has(primitive.laneId)) {
        return;
      }
      switch (primitive.kind) {
        case "line": {
          const row = rows[primitive.rowIndex];
          const isFullRow = row && primitive.y1 === row.top && primitive.y2 === row.top + row.height;
          const cell = key(primitive.laneId, primitive.visualLane, primitive.rowIndex);
          if (isFullRow && !fullRowLines.has(cell)) {
            fullRowLines.set(cell, primitive);
          } else {
            touched.add(cell);
          }
          return;
        }
        case "dot":
          touched.add(key(primitive.laneId, primitive.visualLane, primitive.rowIndex));
          return;
        case "branch":
          touched.add(key(primitive.laneId, primitive.fromLane, rowIndexAt(rows, primitive.yFrom)));
          touched.add(key(primitive.laneId, primitive.toLane, rowIndexAt(rows, Math.max(primitive.yTo - 1e-3, 0))));
          return;
        case "shift": {
          const rowIndex = rowIndexAt(rows, primitive.yTop);
          touched.add(key(primitive.laneId, primitive.fromLane, rowIndex));
          touched.add(key(primitive.laneId, primitive.toLane, rowIndex));
          return;
        }
      }
    });
    const cellsByLaneColumn = /* @__PURE__ */ new Map();
    fullRowLines.forEach((line, cell) => {
      if (touched.has(cell)) {
        return;
      }
      const groupKey = line.laneId * 4096 + line.visualLane;
      const bucket = cellsByLaneColumn.get(groupKey);
      if (bucket) {
        bucket.push(line);
      } else {
        cellsByLaneColumn.set(groupKey, [line]);
      }
    });
    const runs = [];
    cellsByLaneColumn.forEach((lines) => {
      const sorted = [...lines].sort((a, b) => a.rowIndex - b.rowIndex);
      let current;
      sorted.forEach((line) => {
        if (current && line.rowIndex === current.last + 1) {
          current.last = line.rowIndex;
          current.lines.push(line);
          return;
        }
        current = { laneId: line.laneId, column: line.visualLane, first: line.rowIndex, last: line.rowIndex, lines: [line] };
        runs.push(current);
      });
    });
    runs.sort((a, b) => a.column - b.column || a.first - b.first);
    const isFreeFor = (laneId, column, rowIndex) => {
      const owners = occupancy.get(rowIndex)?.get(column);
      if (!owners) {
        return true;
      }
      for (const owner of owners) {
        if (owner !== laneId) {
          return false;
        }
      }
      return true;
    };
    const occupy = (laneId, column, rowIndex) => {
      const rowMap = occupancy.get(rowIndex) ?? /* @__PURE__ */ new Map();
      rowMap.set(column, (rowMap.get(column) ?? /* @__PURE__ */ new Set()).add(laneId));
      occupancy.set(rowIndex, rowMap);
    };
    const replaced = /* @__PURE__ */ new Set();
    const insertBefore = /* @__PURE__ */ new Map();
    const isStretchFree = (laneId, column, first, last) => {
      for (let rowIndex = first; rowIndex <= last; rowIndex += 1) {
        if (!isFreeFor(laneId, column, rowIndex)) {
          return false;
        }
      }
      return true;
    };
    const moveStretch = (run, first, last) => {
      let target = run.column;
      while (target > 0 && isStretchFree(run.laneId, target - 1, first, last)) {
        target -= 1;
      }
      if (target === run.column) {
        return;
      }
      const runsToListEnd = last === rows.length - 1;
      const lastInTarget = runsToListEnd ? last : last - 1;
      const stretchLines = run.lines.filter((line) => line.rowIndex >= first && line.rowIndex <= last);
      const firstRow = rows[first];
      const replacement = [
        {
          kind: "shift",
          laneId: run.laneId,
          fromLane: run.column,
          toLane: target,
          yTop: firstRow.top,
          yBottom: firstRow.top + firstRow.height
        }
      ];
      stretchLines.forEach((line) => {
        replaced.add(line);
        if (line.rowIndex > first && line.rowIndex <= lastInTarget) {
          replacement.push({ ...line, visualLane: target });
        }
      });
      if (!runsToListEnd) {
        const lastRow = rows[last];
        replacement.push({
          kind: "shift",
          laneId: run.laneId,
          fromLane: target,
          toLane: run.column,
          yTop: lastRow.top,
          yBottom: lastRow.top + lastRow.height
        });
      }
      insertBefore.set(stretchLines[0], replacement);
      movedLanes.add(run.laneId);
      for (let rowIndex = first; rowIndex <= last; rowIndex += 1) {
        occupy(run.laneId, target, rowIndex);
        if (rowIndex > first && rowIndex <= lastInTarget) {
          occupancy.get(rowIndex)?.get(run.column)?.delete(run.laneId);
        }
      }
    };
    runs.forEach((run) => {
      if (run.column === 0 || run.last !== rows.length - 1) {
        return;
      }
      if (!isFreeFor(run.laneId, run.column - 1, run.last)) {
        return;
      }
      let first = run.last;
      while (first - 1 >= run.first && isFreeFor(run.laneId, run.column - 1, first - 1)) {
        first -= 1;
      }
      if (run.last - first + 1 >= COMPACT_MIN_ROWS) {
        moveStretch(run, first, run.last);
      }
    });
    if (replaced.size === 0) {
      return { primitives, movedLanes };
    }
    const result = [];
    primitives.forEach((primitive) => {
      if (primitive.kind === "line" && replaced.has(primitive)) {
        result.push(...insertBefore.get(primitive) ?? []);
        return;
      }
      result.push(primitive);
    });
    return { primitives: result, movedLanes };
  };
  var MAX_COMPACT_PASSES = 8;
  var compactLanesRepeatedly = (primitives, rows, occupancy) => {
    let current = primitives;
    let candidates;
    for (let pass = 0; pass < MAX_COMPACT_PASSES; pass += 1) {
      const { primitives: next, movedLanes } = compactLanes(current, rows, occupancy, candidates);
      current = next;
      if (movedLanes.size === 0) {
        break;
      }
      candidates = movedLanes;
    }
    return current;
  };
  var coalesceLines = (primitives) => {
    const result = [];
    const openLineByKey = /* @__PURE__ */ new Map();
    primitives.forEach((primitive) => {
      if (primitive.kind !== "line") {
        result.push(primitive);
        return;
      }
      const key = `${primitive.laneId}:${primitive.visualLane}:${primitive.source}`;
      const open = openLineByKey.get(key);
      if (open && open.y2 === primitive.y1) {
        open.y2 = primitive.y2;
        return;
      }
      const copy = { ...primitive };
      openLineByKey.set(key, copy);
      result.push(copy);
    });
    return result;
  };

  // webview/src/graph/laneColors.ts
  var WEIGHT_BY_DISTANCE = [10, 10, 1];
  var rowAt = (rowMids, y) => {
    let low = 0;
    let high = rowMids.length - 1;
    while (low < high) {
      const mid = low + high >> 1;
      if (rowMids[mid] < y) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    if (low > 0 && Math.abs(rowMids[low - 1] - y) <= Math.abs(rowMids[low] - y)) {
      return low - 1;
    }
    return low;
  };
  var assignLaneColors = (primitives, rowMids, paletteSize, skipLanes = /* @__PURE__ */ new Set(), remember) => {
    const cells = /* @__PURE__ */ new Map();
    const firstRow = /* @__PURE__ */ new Map();
    const dotRows = /* @__PURE__ */ new Map();
    const occupy = (row, laneId, column) => {
      if (skipLanes.has(laneId)) {
        return;
      }
      const list = cells.get(row);
      if (list) {
        list.push({ laneId, column });
      } else {
        cells.set(row, [{ laneId, column }]);
      }
      firstRow.set(laneId, Math.min(firstRow.get(laneId) ?? row, row));
    };
    if (rowMids.length === 0) {
      return /* @__PURE__ */ new Map();
    }
    primitives.forEach((primitive) => {
      switch (primitive.kind) {
        case "dot":
          if (!skipLanes.has(primitive.laneId)) {
            const rows = dotRows.get(primitive.laneId) ?? /* @__PURE__ */ new Set();
            rows.add(primitive.rowIndex);
            dotRows.set(primitive.laneId, rows);
          }
          occupy(primitive.rowIndex, primitive.laneId, primitive.visualLane);
          return;
        case "line":
          occupy(primitive.rowIndex, primitive.laneId, primitive.visualLane);
          return;
        case "branch":
          occupy(rowAt(rowMids, primitive.yFrom), primitive.laneId, primitive.fromLane);
          occupy(rowAt(rowMids, primitive.yTo), primitive.laneId, primitive.toLane);
          return;
        case "shift": {
          const row = rowAt(rowMids, (primitive.yTop + primitive.yBottom) / 2);
          occupy(row, primitive.laneId, primitive.fromLane);
          occupy(row, primitive.laneId, primitive.toLane);
          return;
        }
      }
    });
    const weights = /* @__PURE__ */ new Map();
    const addWeight = (a, b, weight) => {
      const map = weights.get(a) ?? /* @__PURE__ */ new Map();
      map.set(b, (map.get(b) ?? 0) + weight);
      weights.set(a, map);
    };
    cells.forEach((list) => {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i];
          const b = list[j];
          if (a.laneId === b.laneId) {
            continue;
          }
          const weight = WEIGHT_BY_DISTANCE[Math.abs(a.column - b.column)];
          if (weight) {
            addWeight(a.laneId, b.laneId, weight);
            addWeight(b.laneId, a.laneId, weight);
          }
        }
      }
    });
    const startColumns = /* @__PURE__ */ new Map();
    firstRow.forEach((row, laneId) => {
      const columns = (cells.get(row) ?? []).filter((cell) => cell.laneId === laneId).map((cell) => cell.column);
      startColumns.set(laneId, [...new Set(columns)].sort((a, b) => a - b));
    });
    const lanes = [...firstRow.keys()].sort(
      (a, b) => firstRow.get(a) - firstRow.get(b) || startColumns.get(a)[0] - startColumns.get(b)[0] || a - b
    );
    const columnsIn = (row, laneId) => [...new Set((cells.get(row) ?? []).filter((cell) => cell.laneId === laneId).map((cell) => cell.column))].sort((a, b) => a - b).join(",");
    const keyOf = (laneId) => {
      const row = firstRow.get(laneId);
      const commit = remember?.rowKey(row);
      if (commit === void 0) {
        return void 0;
      }
      return dotRows.get(laneId)?.has(row) ? `${commit}:dot` : `${commit}:${columnsIn(row, laneId)}>${columnsIn(row + 1, laneId)}`;
    };
    const colors = /* @__PURE__ */ new Map();
    lanes.forEach((laneId) => {
      const key = keyOf(laneId);
      const known = key === void 0 ? void 0 : remember?.memory.get(key);
      if (known !== void 0 && known < paletteSize) {
        colors.set(laneId, known);
      }
    });
    lanes.forEach((laneId, order) => {
      if (colors.has(laneId)) {
        return;
      }
      const preferred = order % paletteSize;
      const clash = new Array(paletteSize).fill(0);
      (weights.get(laneId) ?? /* @__PURE__ */ new Map()).forEach((weight, other) => {
        const color = colors.get(other);
        if (color !== void 0) {
          clash[color] += weight;
        }
      });
      let best = preferred;
      for (let step = 1; step < paletteSize; step += 1) {
        const color = (preferred + step) % paletteSize;
        if (clash[color] < clash[best]) {
          best = color;
        }
      }
      colors.set(laneId, best);
    });
    if (remember) {
      const current = /* @__PURE__ */ new Map();
      lanes.forEach((laneId) => {
        const key = keyOf(laneId);
        if (key !== void 0) {
          current.set(key, colors.get(laneId));
        }
      });
      if (remember.memory.size > Math.max(2e4, current.size * 4)) {
        remember.memory.clear();
      }
      current.forEach((color, key) => remember.memory.set(key, color));
    }
    return colors;
  };

  // webview/src/graph/graphConfig.ts
  var laneWidth = 18;
  var graphPaddingX = 8;
  var dotSize = 9;
  var virtualTrackColor = "#b3b3b3";
  var virtualRingRadius = dotSize / 3 + 0.6;
  var showGraphDebugMeta = false;
  var maxImmediateParentCurveDistance = 2;
  var lanePalette = [
    "#1ea8ff",
    "#ff2cc3",
    "#16d63f",
    "#f4a300",
    "#8a39ff",
    "#ff5252",
    "#00c2a8",
    "#a3e635"
  ];
  var lanePaletteSize = lanePalette.length;
  var laneColor = (lane) => lanePalette[Math.abs(lane) % lanePalette.length];
  var visualLaneIndex = (lane) => lane;
  var visualLaneCount = (laneCount) => laneCount;
  var laneToX = (lane) => graphPaddingX + visualLaneIndex(lane) * laneWidth + laneWidth / 2;
  var editorBackground = () => {
    const value = getComputedStyle(document.body).getPropertyValue("--vscode-editor-background").trim();
    return value || "#1e1e1e";
  };

  // webview/src/graph/renderSvg.ts
  var svgNamespace = "http://www.w3.org/2000/svg";
  var laneColorMemory = /* @__PURE__ */ new WeakMap();
  var createCurve = (d, stroke) => {
    const path = document.createElementNS(svgNamespace, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "graph-line graph-line--main");
    path.setAttribute("stroke", stroke);
    return path;
  };
  var createPrimitiveElement = (primitive, ctx, uncommitted = false) => {
    const hollow = uncommitted && primitive.kind === "dot";
    const stroke = uncommitted ? ctx.virtualTrackColor : ctx.laneColor(primitive.laneId);
    switch (primitive.kind) {
      case "line": {
        const x = ctx.laneToX(primitive.visualLane);
        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", `${x}`);
        line.setAttribute("y1", `${primitive.y1}`);
        line.setAttribute("x2", `${x}`);
        line.setAttribute("y2", `${primitive.y2}`);
        line.setAttribute("class", "graph-line graph-line--track");
        line.setAttribute("stroke", stroke);
        return line;
      }
      case "branch": {
        const xFrom = ctx.laneToX(primitive.fromLane);
        const xTo = ctx.laneToX(primitive.toLane);
        const { yFrom, yTo } = primitive;
        return createCurve(`M ${xFrom} ${yFrom} C ${xFrom} ${yTo}, ${xTo} ${yFrom}, ${xTo} ${yTo}`, stroke);
      }
      case "shift": {
        const xFrom = ctx.laneToX(primitive.fromLane);
        const xTo = ctx.laneToX(primitive.toLane);
        const { yTop, yBottom } = primitive;
        return createCurve(`M ${xFrom} ${yTop} C ${xFrom} ${yBottom}, ${xTo} ${yTop}, ${xTo} ${yBottom}`, stroke);
      }
      case "dot": {
        const dot = document.createElementNS(svgNamespace, "circle");
        dot.setAttribute("cx", `${ctx.laneToX(primitive.visualLane)}`);
        dot.setAttribute("cy", `${primitive.y}`);
        if (hollow) {
          dot.setAttribute("r", `${ctx.dotSize / 2 - 1}`);
          dot.setAttribute("fill", ctx.editorBackground);
          dot.setAttribute("stroke", stroke);
          dot.setAttribute("stroke-width", "2");
          dot.setAttribute("class", "graph-dot graph-dot--uncommitted");
          return dot;
        }
        dot.setAttribute("r", `${ctx.dotSize / 2}`);
        dot.setAttribute("fill", stroke);
        dot.setAttribute("stroke", ctx.editorBackground);
        dot.setAttribute("stroke-width", "1.2");
        return dot;
      }
    }
  };
  var isLinkedWorktreeHead = (commit) => !!commit && commit.refs.some((ref) => ref.worktree && !ref.worktreeIsMain);
  var createWorktreeRing = (primitive, ctx) => {
    const ring = document.createElementNS(svgNamespace, "circle");
    ring.setAttribute("cx", `${ctx.laneToX(primitive.visualLane)}`);
    ring.setAttribute("cy", `${primitive.y}`);
    ring.setAttribute("r", `${ctx.dotSize / 2 + 3}`);
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", ctx.laneColor(primitive.laneId));
    ring.setAttribute("stroke-width", "1.5");
    ring.setAttribute("class", "graph-dot-worktree");
    return ring;
  };
  var writeDebugMeta = (rows, layout) => {
    rows.forEach((rowEl, rowIndex) => {
      const metaEl = rowEl.querySelector(".commit-graph-debug-meta");
      if (!metaEl) {
        return;
      }
      const baseText = (metaEl.textContent ?? "").replace(/\s(?:O|B)\[[^\]]*\]/g, "");
      const occupancy = layout.rowLaneOccupancy.get(rowIndex);
      const budget = layout.rowShiftBudgetByLaneId.get(rowIndex);
      const parts = [baseText];
      if (occupancy && occupancy.size > 0) {
        const occupancyText = [...occupancy.entries()].sort((a, b) => a[0] - b[0]).map(([visualLane, laneIds]) => `${visualLane}:${[...laneIds].sort((a, b) => a - b).join("|")}`).join(",");
        parts.push(`O[${occupancyText}]`);
      }
      if (budget && budget.size > 0) {
        const budgetText = [...budget.entries()].sort((a, b) => a[0] - b[0]).map(([laneId, steps]) => `${laneId}:${steps}`).join(",");
        parts.push(`B[${budgetText}]`);
      }
      metaEl.textContent = parts.join(" ");
    });
  };
  var renderCommitGraphOverlay = (options) => {
    const { items, overlay, commits, maxLanes } = options;
    const ctx = options;
    const rows = Array.from(items.querySelectorAll(".commit"));
    overlay.style.top = `${items.offsetTop}px`;
    const rowVisualLaneMaps = buildRowVisualLaneMaps(commits);
    const laneCount = Math.max(maxLanes, rowVisualLaneMaps.laneCount, 1);
    const listElement = items.closest(".list");
    const configuredGraphWidth = listElement ? Number.parseFloat(
      getComputedStyle(listElement).getPropertyValue("--graph-col-width").replace("px", "").trim()
    ) : Number.NaN;
    const width = Number.isFinite(configuredGraphWidth) && configuredGraphWidth > 0 ? configuredGraphWidth : ctx.graphPaddingX * 2 + ctx.visualLaneCount(laneCount) * ctx.laneWidth;
    const height = rows.length > 0 ? rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight : 0;
    overlay.innerHTML = "";
    overlay.setAttribute("width", `${width}`);
    overlay.setAttribute("height", `${height}`);
    const setExtent = (contentWidth) => {
      const scrollX = Math.max(0, Math.min(Number(overlay.dataset.scrollX) || 0, contentWidth - width));
      overlay.dataset.scrollX = String(scrollX);
      overlay.dataset.contentWidth = String(contentWidth);
      overlay.setAttribute("viewBox", `${scrollX} 0 ${width} ${height}`);
      overlay.dispatchEvent(new CustomEvent("graph-extent"));
    };
    if (rows.length === 0 || commits.length === 0) {
      setExtent(width);
      return { nextMaxLanes: laneCount };
    }
    const layout = computeGraphLayout(
      commits,
      rows.map((row) => ({ top: row.offsetTop, height: row.offsetHeight })),
      ctx.commitLane,
      rowVisualLaneMaps
    );
    const rightmost = layout.primitives.reduce(
      (max, primitive) => Math.max(max, "visualLane" in primitive ? primitive.visualLane : Math.max(primitive.fromLane, primitive.toLane)),
      0
    );
    setExtent(Math.max(width, ctx.laneToX(rightmost) + ctx.laneWidth / 2 + ctx.graphPaddingX));
    const uncommittedLanes = /* @__PURE__ */ new Set();
    commits.forEach((commit, index) => {
      const lane = commit.isUncommitted ? layout.ownerLaneByCommitIndex.get(index) : void 0;
      if (lane !== void 0) {
        uncommittedLanes.add(lane);
      }
    });
    const rowMids = rows.map((row) => row.offsetTop + row.offsetHeight / 2);
    let memory = laneColorMemory.get(overlay);
    if (!memory) {
      memory = /* @__PURE__ */ new Map();
      laneColorMemory.set(overlay, memory);
    }
    const colorIndex = assignLaneColors(layout.primitives, rowMids, lanePaletteSize, uncommittedLanes, {
      rowKey: (row) => commits[row]?.hash,
      memory
    });
    const drawCtx = { ...ctx, laneColor: (laneId) => ctx.laneColor(colorIndex.get(laneId) ?? laneId) };
    coalesceLines(layout.primitives).forEach((primitive) => {
      const uncommitted = uncommittedLanes.has(primitive.laneId);
      if (primitive.kind === "dot") {
        const row = rows[primitive.rowIndex];
        if (row) {
          row.dataset.dotX = `${ctx.laneToX(primitive.visualLane)}`;
          row.dataset.dotY = `${primitive.y}`;
        }
        rows[primitive.rowIndex]?.style.setProperty(
          "--commit-accent",
          uncommitted ? ctx.virtualTrackColor : drawCtx.laneColor(primitive.laneId)
        );
      }
      overlay.appendChild(createPrimitiveElement(primitive, drawCtx, uncommitted));
      if (primitive.kind === "dot" && !uncommitted && isLinkedWorktreeHead(commits[primitive.rowIndex])) {
        overlay.appendChild(createWorktreeRing(primitive, drawCtx));
      }
    });
    writeDebugMeta(rows, layout);
    return { nextMaxLanes: Math.max(laneCount, layout.laneCount, 1) };
  };

  // webview/src/graph/renderCommitTable.ts
  var laneCountFor = (commit) => Math.max(laneCountFromGraphPrefix(commit.graphPrefix), commit.lane + 1);
  var renderCommitTable = (options) => {
    const { items, overlay, commits, append } = options;
    let renderedCommits = append ? options.renderedCommits : [];
    let maxLanes = append ? options.maxLanes : 1;
    if (!append) {
      items.innerHTML = "";
      renderedCommits = [];
      maxLanes = 1;
    }
    const rows = buildRows(commits);
    if (rows.length === 0 && renderedCommits.length === 0) {
      items.innerHTML = '<div class="empty">No commits found.</div>';
      if (overlay) {
        overlay.innerHTML = "";
      }
      return {
        renderedCommits,
        maxLanes,
        resetSelection: !append
      };
    }
    const laneCount = Math.max(
      1,
      ...commits.map((commit) => laneCountFor(commit)),
      ...rows.map((commit) => laneCountFor(commit)),
      ...renderedCommits.map((commit) => laneCountFor(commit))
    );
    const projectedRenderedCommits = append ? [...renderedCommits, ...rows] : [...rows];
    const projectedVisualLaneCount = buildRowVisualLaneMaps(projectedRenderedCommits).laneCount;
    maxLanes = Math.max(maxLanes, laneCount, projectedVisualLaneCount);
    const rowBase = append ? renderedCommits.length : 0;
    items.append(
      createCommitItemsFragment(rows, rowBase, {
        selectedHash: options.graphOptions.selectedHash,
        maxLanes,
        graphPaddingX: options.graphOptions.graphPaddingX,
        laneWidth: options.graphOptions.laneWidth,
        visualLaneCount: options.graphOptions.visualLaneCount,
        showGraphDebugMeta: options.graphOptions.showGraphDebugMeta,
        commitLane: options.graphOptions.commitLane,
        isCurrentCommit: options.graphOptions.isCurrentCommit
      })
    );
    renderedCommits = projectedRenderedCommits;
    if (overlay) {
      const result = renderCommitGraphOverlay({
        items,
        overlay,
        commits: renderedCommits,
        maxLanes,
        graphPaddingX: options.graphOptions.graphPaddingX,
        laneWidth: options.graphOptions.laneWidth,
        dotSize: options.graphOptions.dotSize,
        virtualTrackColor: options.graphOptions.virtualTrackColor,
        virtualRingRadius: options.graphOptions.virtualRingRadius,
        maxImmediateParentCurveDistance: options.graphOptions.maxImmediateParentCurveDistance,
        visualLaneCount: options.graphOptions.visualLaneCount,
        laneColor: options.graphOptions.laneColor,
        editorBackground: options.graphOptions.editorBackground,
        commitLane: options.graphOptions.commitLane,
        isCurrentCommit: options.graphOptions.isCurrentCommit,
        laneToX: options.graphOptions.laneToX
      });
      maxLanes = result.nextMaxLanes;
    }
    return {
      renderedCommits,
      maxLanes,
      resetSelection: !append
    };
  };

  // webview/src/graph/graphOrchestrator.ts
  var createGraphOrchestrator = (options) => {
    let selectedHash;
    let maxLanes = 1;
    let renderedCommits = [];
    const render = (commits, append, maxLanesHint) => {
      const items = options.commitItemsElement;
      if (!items) {
        return { resetSelection: !append };
      }
      maxLanes = maxLanesHint ?? maxLanes;
      const result = renderCommitTable({
        items,
        overlay: options.graphOverlay,
        commits,
        renderedCommits,
        append,
        maxLanes,
        graphOptions: {
          selectedHash,
          graphPaddingX: options.graphPaddingX,
          laneWidth: options.laneWidth,
          dotSize: options.dotSize,
          virtualTrackColor: options.virtualTrackColor,
          virtualRingRadius: options.virtualRingRadius,
          maxImmediateParentCurveDistance: options.maxImmediateParentCurveDistance,
          visualLaneCount: options.visualLaneCount,
          laneColor: options.laneColor,
          editorBackground: options.editorBackground(),
          commitLane: options.commitLane,
          isCurrentCommit: options.isCurrentCommit,
          showGraphDebugMeta: options.showGraphDebugMeta,
          laneToX: options.laneToX
        }
      });
      renderedCommits = result.renderedCommits;
      maxLanes = result.maxLanes;
      const selectionStillListed = selectedHash !== void 0 && renderedCommits.some((commit) => commit.hash === selectedHash);
      const resetSelection = result.resetSelection && !selectionStillListed;
      if (resetSelection) {
        selectedHash = void 0;
      }
      return { resetSelection };
    };
    const renderEmpty = () => render([], false);
    const handleResize = () => {
      const items = options.commitItemsElement;
      const overlay = options.graphOverlay;
      if (!items || !overlay) {
        return;
      }
      const result = renderCommitGraphOverlay({
        items,
        overlay,
        commits: renderedCommits,
        maxLanes,
        graphPaddingX: options.graphPaddingX,
        laneWidth: options.laneWidth,
        dotSize: options.dotSize,
        virtualTrackColor: options.virtualTrackColor,
        virtualRingRadius: options.virtualRingRadius,
        maxImmediateParentCurveDistance: options.maxImmediateParentCurveDistance,
        visualLaneCount: options.visualLaneCount,
        laneColor: options.laneColor,
        editorBackground: options.editorBackground(),
        commitLane: options.commitLane,
        isCurrentCommit: options.isCurrentCommit,
        laneToX: options.laneToX
      });
      maxLanes = result.nextMaxLanes;
    };
    const isTyping = () => {
      const focused = document.activeElement;
      return focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement || focused instanceof HTMLElement && focused.isContentEditable;
    };
    const selectableRows = () => Array.from(
      options.commitItemsElement?.querySelectorAll(".commit:not(.commit--connector):not(.commit--virtual)") ?? []
    );
    const markSelected = (commitEl) => {
      const hash = commitEl.dataset.hash;
      if (!hash || hash.startsWith("__virtual__")) {
        return void 0;
      }
      options.commitItemsElement?.querySelector(".commit.selected")?.classList.remove("selected");
      commitEl.classList.add("selected");
      selectedHash = hash;
      return hash;
    };
    const bindCommitSelection = (handlers) => {
      const items = options.commitItemsElement;
      if (!items) {
        return;
      }
      items.tabIndex = 0;
      items.setAttribute("role", "listbox");
      items.setAttribute("aria-label", "Commits");
      items.addEventListener("click", (event) => {
        const target = event.target;
        const commitEl = target?.closest(".commit");
        const hash = commitEl ? markSelected(commitEl) : void 0;
        if (hash) {
          handlers.onSelect(hash, "mouse");
        }
      });
      const move = (target) => {
        const rows = selectableRows();
        if (rows.length === 0) {
          return;
        }
        const current = rows.findIndex((row) => row.dataset.hash === selectedHash);
        let next;
        if (target === "first") {
          next = 0;
        } else if (target === "last") {
          next = rows.length - 1;
        } else if (current < 0) {
          next = target > 0 ? 0 : rows.length - 1;
        } else {
          next = Math.min(rows.length - 1, Math.max(0, current + target));
        }
        if (next === current) {
          return;
        }
        const hash = markSelected(rows[next]);
        rows[next].scrollIntoView?.({ block: "nearest" });
        if (hash) {
          handlers.onSelect(hash, "keyboard");
        }
      };
      const pageSize = () => {
        const rowHeight = selectableRows()[0]?.offsetHeight || 24;
        return Math.max(1, Math.floor((window.innerHeight || 600) / rowHeight) - 3);
      };
      items.addEventListener("keydown", (event) => {
        const ctrl = event.ctrlKey || event.metaKey;
        const plain = !ctrl && !event.altKey && !event.shiftKey;
        const selectedRow = items.querySelector(".commit.selected");
        let handled = true;
        if (plain && event.key === "ArrowDown") {
          move(1);
        } else if (plain && event.key === "ArrowUp") {
          move(-1);
        } else if (plain && event.key === "Home") {
          move("first");
        } else if (plain && event.key === "End") {
          move("last");
        } else if (plain && event.key === "PageDown") {
          move(pageSize());
        } else if (plain && event.key === "PageUp") {
          move(-pageSize());
        } else if (plain && event.key === "Enter" || ctrl && event.key === "ArrowRight") {
          if (selectedHash) {
            handlers.onOpenDetails(selectedHash);
          }
        } else if (ctrl && event.key === "ArrowLeft") {
          handlers.onCloseDetails();
        } else if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
          if (selectedRow) {
            handlers.onContextMenu(selectedRow);
          }
        } else {
          handled = false;
        }
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
      window.addEventListener("keydown", (event) => {
        const ctrl = event.ctrlKey || event.metaKey;
        if (!ctrl && !event.altKey && !event.shiftKey && event.key === "g" && !isTyping()) {
          event.preventDefault();
          focusList();
          return;
        }
        if (!ctrl || event.altKey || event.shiftKey) {
          return;
        }
        if (event.key.toLowerCase() === "g") {
          event.preventDefault();
          focusList();
          return;
        }
        const direction = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        if (direction === 0) {
          return;
        }
        const focused = document.activeElement;
        if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement) {
          return;
        }
        event.preventDefault();
        move(direction);
      });
    };
    const focusList = () => {
      options.commitItemsElement?.focus({ preventScroll: true });
    };
    const selectHash = (hash) => {
      const row = selectableRows().find((entry) => entry.dataset.hash === hash);
      if (!row || !markSelected(row)) {
        return false;
      }
      row.scrollIntoView?.({ block: "nearest" });
      return true;
    };
    return {
      render,
      renderEmpty,
      handleResize,
      bindCommitSelection,
      focusList,
      selectHash,
      getSelectedHash: () => selectedHash,
      clearSelection: () => {
        options.commitItemsElement?.querySelector(".commit.selected")?.classList.remove("selected");
        selectedHash = void 0;
      },
      getRenderedCommits: () => renderedCommits
    };
  };

  // webview/src/graph/toolbarController.ts
  var createToolbarController = (options) => {
    const refreshButton = document.querySelector('[data-action="refresh"]');
    const loadMoreButton = document.getElementById("load-more");
    const branchSelect = document.getElementById("branch-select");
    const remoteToggle = document.getElementById("remote-toggle");
    const repoSelect = document.getElementById("repo-select");
    const worktreeSelect = document.getElementById("worktree-select");
    const minRefreshVisibleMs = options.minRefreshVisibleMs ?? 320;
    const autoLoadPreloadPx = 500;
    let refreshVisibleUntil = 0;
    let refreshTimer;
    let nextCursor;
    let hasMore = false;
    let isLoadingMore = false;
    let autoLoadReady = true;
    const applyRefreshState = (isRefreshing) => {
      if (!refreshButton) {
        return;
      }
      refreshButton.disabled = isRefreshing;
      refreshButton.classList.toggle("is-refreshing", isRefreshing);
      refreshButton.title = isRefreshing ? "Refreshing..." : "Refresh";
      refreshButton.setAttribute("aria-label", refreshButton.title);
    };
    const setRefreshing = (isRefreshing) => {
      if (isRefreshing) {
        refreshVisibleUntil = Date.now() + minRefreshVisibleMs;
        if (refreshTimer !== void 0) {
          window.clearTimeout(refreshTimer);
          refreshTimer = void 0;
        }
        applyRefreshState(true);
        return;
      }
      const remaining = refreshVisibleUntil - Date.now();
      if (remaining > 0) {
        if (refreshTimer !== void 0) {
          window.clearTimeout(refreshTimer);
        }
        refreshTimer = window.setTimeout(() => {
          refreshTimer = void 0;
          applyRefreshState(false);
        }, remaining);
        return;
      }
      if (refreshTimer !== void 0) {
        window.clearTimeout(refreshTimer);
        refreshTimer = void 0;
      }
      applyRefreshState(false);
    };
    const updateLoadMore = () => {
      if (!loadMoreButton) {
        return;
      }
      loadMoreButton.disabled = isLoadingMore;
      loadMoreButton.textContent = isLoadingMore ? "Loading..." : "Load more";
      const footer = loadMoreButton.closest(".list-footer") ?? loadMoreButton;
      footer.hidden = !hasMore && !isLoadingMore;
    };
    const requestLoadMore = () => {
      if (!hasMore || isLoadingMore) {
        return;
      }
      isLoadingMore = true;
      updateLoadMore();
      options.onLoadMore(nextCursor);
    };
    const isWithinPreloadRange = () => {
      if (!loadMoreButton) {
        return false;
      }
      const rect = loadMoreButton.getBoundingClientRect();
      const viewportBottom = window.innerHeight || document.documentElement.clientHeight;
      return rect.top < viewportBottom + autoLoadPreloadPx && rect.bottom > 0;
    };
    const triggerAutoLoadIfNeeded = () => {
      if (!isWithinPreloadRange()) {
        autoLoadReady = true;
        return;
      }
      if (!autoLoadReady) {
        return;
      }
      autoLoadReady = false;
      requestLoadMore();
    };
    const setPagingState = (nextCursorValue, hasMoreValue) => {
      nextCursor = nextCursorValue;
      hasMore = hasMoreValue;
      isLoadingMore = false;
      updateLoadMore();
      if (!hasMore || !loadMoreButton) {
        return;
      }
      window.requestAnimationFrame(() => {
        autoLoadReady = true;
        triggerAutoLoadIfNeeded();
      });
    };
    const renderFilters = (branches, selectedBranch, showRemoteBranches) => {
      if (!branchSelect || !remoteToggle) {
        return;
      }
      branchSelect.innerHTML = "";
      branches.forEach((branch) => {
        const option = document.createElement("option");
        option.value = branch.value;
        option.textContent = branch.label;
        branchSelect.appendChild(option);
      });
      branchSelect.value = selectedBranch;
      if (branchSelect.value !== selectedBranch) {
        branchSelect.value = "__all__";
      }
      remoteToggle.checked = showRemoteBranches;
    };
    const sendFilterUpdate = () => {
      if (!branchSelect || !remoteToggle) {
        return;
      }
      setRefreshing(true);
      options.onUpdateFilters(branchSelect.value, remoteToggle.checked);
    };
    refreshButton?.addEventListener("click", () => {
      setRefreshing(true);
      options.onRefresh();
    });
    branchSelect?.addEventListener("change", () => {
      sendFilterUpdate();
    });
    remoteToggle?.addEventListener("change", () => {
      sendFilterUpdate();
    });
    const updateContextLabel = () => {
      const label = document.getElementById("repo-path");
      if (label) {
        label.hidden = !(repoSelect?.hidden ?? true) || !(worktreeSelect?.hidden ?? true);
      }
    };
    const renderRepositories = (repositories, current) => {
      if (!repoSelect) {
        return;
      }
      const showSelect = repositories.length > 1;
      repoSelect.hidden = !showSelect;
      updateContextLabel();
      if (!showSelect) {
        return;
      }
      repoSelect.innerHTML = "";
      repositories.forEach((repoRoot) => {
        const option = document.createElement("option");
        option.value = repoRoot;
        option.textContent = repoRoot.split(/[\\/]/).filter(Boolean).pop() ?? repoRoot;
        option.title = repoRoot;
        repoSelect.appendChild(option);
      });
      if (current) {
        repoSelect.value = current;
      }
    };
    const renderWorktrees = (worktrees) => {
      if (!worktreeSelect) {
        return;
      }
      worktreeSelect.hidden = worktrees.length <= 1;
      updateContextLabel();
      worktreeSelect.innerHTML = "";
      worktrees.forEach((worktree) => {
        const option = document.createElement("option");
        option.value = worktree.path;
        const branch = worktree.branch ?? "detached";
        const changes = worktree.changeCount > 0 ? ` \u2022 ${worktree.changeCount}` : "";
        const main = worktree.isMain ? " \u2013 main worktree" : "";
        option.textContent = `${worktree.name} (${branch})${main}${changes}`;
        option.title = worktree.path + (worktree.isMain ? " (main worktree)" : "");
        option.disabled = worktree.isPrunable;
        worktreeSelect.appendChild(option);
        if (worktree.isCurrent) {
          worktreeSelect.value = worktree.path;
        }
      });
    };
    worktreeSelect?.addEventListener("change", () => {
      setRefreshing(true);
      options.onSelectWorktree(worktreeSelect.value);
    });
    const resetLoading = () => {
      isLoadingMore = false;
      updateLoadMore();
    };
    repoSelect?.addEventListener("change", () => {
      setRefreshing(true);
      options.onSelectRepo(repoSelect.value);
    });
    loadMoreButton?.addEventListener("click", () => {
      requestLoadMore();
    });
    if (loadMoreButton) {
      if (typeof IntersectionObserver !== "undefined") {
        const observer = new IntersectionObserver((entries) => {
          const entry = entries[0];
          if (!entry) {
            return;
          }
          if (!entry.isIntersecting) {
            autoLoadReady = true;
            return;
          }
          triggerAutoLoadIfNeeded();
        }, {
          threshold: 0,
          rootMargin: `0px 0px ${autoLoadPreloadPx}px 0px`
        });
        observer.observe(loadMoreButton);
      } else {
        const onScroll = () => {
          triggerAutoLoadIfNeeded();
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
      }
    }
    return {
      setRefreshing,
      renderFilters,
      setPagingState,
      renderRepositories,
      renderWorktrees,
      resetLoading
    };
  };

  // webview/src/graph/viewHelpers.ts
  var folderName = (fullPath) => fullPath.split(/[\\/]/).filter(Boolean).pop() ?? fullPath;
  var createViewHelpers = () => {
    const status = document.getElementById("status");
    const repo = document.getElementById("repo");
    const repoPath = document.getElementById("repo-path");
    const repoCopy = document.getElementById("repo-copy");
    const appElement = document.querySelector(".app");
    const setStatusText = (text, kind = "info") => {
      if (status) {
        status.textContent = text;
        status.classList.toggle("status--error", kind === "error");
      }
    };
    const setRepoText = (repoRoot, force) => {
      if (!repo) {
        return;
      }
      if (!force && repoRoot === void 0) {
        return;
      }
      repo.dataset.path = repoRoot ?? "";
      repo.title = repoRoot ?? "";
      if (repoPath) {
        repoPath.textContent = repoRoot ? folderName(repoRoot) : "No repo";
      }
      if (repoCopy) {
        repoCopy.hidden = !repoRoot;
      }
    };
    const setGraphDebugEnabled = (enabled) => {
      if (!appElement) {
        return;
      }
      appElement.classList.toggle("app--graph-debug", enabled);
    };
    return {
      setStatusText,
      setRepoText,
      setGraphDebugEnabled
    };
  };

  // webview/src/graph/formDialog.ts
  var createInfo = (text, hint) => {
    const info = document.createElement("button");
    info.type = "button";
    info.className = "form-dialog__info";
    info.textContent = "i";
    info.title = text;
    info.setAttribute("aria-label", `About this option: ${text}`);
    info.setAttribute("aria-expanded", "false");
    hint.textContent = text;
    info.addEventListener("click", () => {
      hint.hidden = !hint.hidden;
      info.setAttribute("aria-expanded", String(!hint.hidden));
    });
    return info;
  };
  var createHint = () => {
    const hint = document.createElement("div");
    hint.className = "form-dialog__hint";
    hint.hidden = true;
    return hint;
  };
  var createFormDialog = (answers) => {
    let open;
    let previousFocus = null;
    const close = () => {
      open?.backdrop.remove();
      open = void 0;
      const target = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : document.getElementById("commit-items");
      target?.focus({ preventScroll: true });
      previousFocus = null;
    };
    const show = (request) => {
      close();
      previousFocus = document.activeElement;
      const backdrop = document.createElement("div");
      backdrop.className = "form-dialog-backdrop";
      const dialog = document.createElement("form");
      dialog.className = "form-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.noValidate = true;
      const title = document.createElement("div");
      title.className = "form-dialog__title";
      title.id = `${request.id}-title`;
      title.textContent = request.title;
      dialog.setAttribute("aria-labelledby", title.id);
      dialog.appendChild(title);
      if (request.detail) {
        const detail = document.createElement("div");
        detail.className = "form-dialog__detail";
        detail.textContent = request.detail;
        dialog.appendChild(detail);
      }
      const grid = document.createElement("div");
      grid.className = "form-dialog__fields";
      dialog.appendChild(grid);
      const controls = /* @__PURE__ */ new Map();
      const rows = [];
      const errors = /* @__PURE__ */ new Map();
      request.fields.forEach((field) => {
        const controlId = `${request.id}-${field.id}`;
        const elements = [];
        let control;
        if (field.kind === "checkbox") {
          const spacer = document.createElement("span");
          const wrap = document.createElement("label");
          wrap.className = "form-dialog__check";
          const box = document.createElement("input");
          box.type = "checkbox";
          box.id = controlId;
          box.checked = field.value === true;
          wrap.append(box, document.createTextNode(field.label));
          const cell = document.createElement("div");
          cell.className = "form-dialog__control form-dialog__control--check";
          cell.appendChild(wrap);
          const hint = createHint();
          if (field.info) {
            cell.appendChild(createInfo(field.info, hint));
          }
          elements.push(spacer, cell, hint);
          control = box;
        } else {
          const label = document.createElement("label");
          label.className = "form-dialog__label";
          label.htmlFor = controlId;
          label.textContent = `${field.label}:`;
          const cell = document.createElement("div");
          cell.className = "form-dialog__control";
          if (field.kind === "select") {
            const select = document.createElement("select");
            select.className = "form-dialog__input";
            field.options.forEach((option) => {
              const element2 = document.createElement("option");
              element2.value = option.value;
              element2.textContent = option.label;
              select.appendChild(element2);
            });
            if (field.value !== void 0) {
              select.value = field.value;
            }
            control = select;
          } else {
            const input = document.createElement("input");
            input.type = "text";
            input.className = "form-dialog__input";
            input.value = field.value ?? "";
            input.placeholder = field.placeholder ?? "";
            input.spellcheck = false;
            input.autocomplete = "off";
            control = input;
          }
          control.id = controlId;
          cell.appendChild(control);
          const hint = createHint();
          if (field.info) {
            cell.appendChild(createInfo(field.info, hint));
          }
          elements.push(label, cell, hint);
        }
        const error = document.createElement("div");
        error.className = "form-dialog__error";
        error.hidden = true;
        error.setAttribute("role", "alert");
        elements.push(error);
        errors.set(field.id, error);
        elements.forEach((element2) => grid.appendChild(element2));
        controls.set(field.id, control);
        rows.push({ field, elements });
      });
      const generalError = document.createElement("div");
      generalError.className = "form-dialog__error form-dialog__error--general";
      generalError.hidden = true;
      generalError.setAttribute("role", "alert");
      dialog.appendChild(generalError);
      const buttons = document.createElement("div");
      buttons.className = "form-dialog__buttons";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "form-dialog__button form-dialog__button--primary";
      submit.textContent = request.submitLabel;
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "form-dialog__button";
      cancel.textContent = "Cancel";
      buttons.append(submit, cancel);
      dialog.appendChild(buttons);
      const valueOf = (id) => {
        const control = controls.get(id);
        if (!control) {
          return void 0;
        }
        return control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked : control.value;
      };
      const isShown = (field) => !field.showWhen || valueOf(field.showWhen.field) === field.showWhen.value;
      let busy = false;
      const update = () => {
        rows.forEach(({ field, elements }) => {
          const shown = isShown(field);
          elements.forEach((element2) => {
            const ownState = element2.classList.contains("form-dialog__error") || element2.classList.contains("form-dialog__hint");
            if (!ownState) {
              element2.hidden = !shown;
            } else if (!shown) {
              element2.hidden = true;
            }
          });
        });
        const missing = request.fields.some(
          (field) => field.kind === "text" && field.required && isShown(field) && !String(valueOf(field.id) ?? "").trim()
        );
        submit.disabled = busy || missing;
      };
      const clearErrors = () => {
        errors.forEach((error) => {
          error.hidden = true;
          error.textContent = "";
        });
        generalError.hidden = true;
      };
      controls.forEach((control) => {
        control.addEventListener("input", () => {
          clearErrors();
          update();
        });
        control.addEventListener("change", update);
      });
      dialog.addEventListener("submit", (event) => {
        event.preventDefault();
        update();
        if (submit.disabled) {
          return;
        }
        const values = {};
        request.fields.filter(isShown).forEach((field) => {
          const value = valueOf(field.id);
          if (value !== void 0) {
            values[field.id] = value;
          }
        });
        open?.setBusy(true);
        answers.submit(request.id, values);
      });
      const doCancel = () => {
        close();
        answers.cancel(request.id);
      };
      cancel.addEventListener("click", doCancel);
      dialog.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          doCancel();
        }
      });
      backdrop.addEventListener("mousedown", (event) => {
        if (event.target === backdrop) {
          doCancel();
        }
      });
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      open = {
        id: request.id,
        backdrop,
        submit,
        setError: (field, message) => {
          const target = field && errors.get(field) || generalError;
          target.textContent = message;
          target.hidden = false;
          const control = field ? controls.get(field) : void 0;
          control?.focus({ preventScroll: true });
        },
        setBusy: (value) => {
          busy = value;
          update();
        }
      };
      update();
      controls.values().next().value?.focus({ preventScroll: true });
    };
    const handle = (message) => {
      const payload = message.payload ?? {};
      switch (message.type) {
        case "showForm":
          show(payload);
          return true;
        case "formError":
          if (open && open.id === payload.id) {
            open.setBusy(false);
            open.setError(payload.field, String(payload.message ?? ""));
          }
          return true;
        case "formClose":
          if (open && open.id === payload.id) {
            close();
          }
          return true;
        default:
          return false;
      }
    };
    return { handle };
  };

  // webview/src/graph/operationBanner.ts
  var NAMES = {
    rebase: "Rebase",
    merge: "Merge",
    "cherry-pick": "Cherry-pick",
    revert: "Revert"
  };
  var describeOperation = (state) => {
    const name = state.kind === "rebase" && state.branch ? `Rebase of ${state.branch}` : NAMES[state.kind];
    const step = state.step && state.total ? ` at step ${state.step} of ${state.total}` : "";
    const commit = state.stoppedAt ? ` (${state.stoppedAt})` : "";
    if (state.conflicts.length > 0) {
      const files = state.conflicts.length === 1 ? "1 file" : `${state.conflicts.length} files`;
      return `${name} stopped${step}${commit}: conflicts in ${files}. Resolve them, then Continue.`;
    }
    if (state.kind === "rebase") {
      return `${name} stopped${step}${commit} for editing: change the commit (e.g. amend), then Continue.`;
    }
    return `${name} waits${commit}: Continue to commit the result.`;
  };
  var stopKey = (state) => `${state.kind}:${state.step ?? ""}:${state.stoppedAt ?? ""}`;
  var createOperationBanner = (element2, actions) => {
    let current;
    let awaiting = false;
    let error;
    const update = (state) => {
      if (awaiting && (!state || !current || stopKey(state) !== stopKey(current))) {
        awaiting = false;
      }
      current = state;
      if (!element2) {
        return;
      }
      element2.replaceChildren();
      element2.hidden = !state;
      if (!state) {
        error = void 0;
        return;
      }
      if (error && error.key !== stopKey(state)) {
        error = void 0;
      }
      const icon = document.createElement("span");
      icon.className = "operation-banner__icon";
      icon.textContent = "\u26A0";
      icon.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "operation-banner__text";
      text.textContent = describeOperation(state);
      const files = document.createElement("span");
      files.className = "operation-banner__files";
      state.conflicts.slice(0, 8).forEach((file) => {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "operation-banner__file";
        link.textContent = file;
        link.title = `Open ${file}`;
        link.addEventListener("click", () => actions.openConflict(file));
        files.appendChild(link);
      });
      if (state.conflicts.length > 8) {
        files.append(` +${state.conflicts.length - 8} more`);
      }
      const buttons = document.createElement("span");
      buttons.className = "operation-banner__buttons";
      const button = (label, action, title) => {
        const element3 = document.createElement("button");
        element3.type = "button";
        element3.className = `operation-banner__button${action === "continue" ? " operation-banner__button--primary" : ""}`;
        element3.textContent = label;
        element3.title = title;
        element3.addEventListener("click", () => {
          error = void 0;
          awaiting = true;
          update(current);
          actions.act(action);
        });
        return element3;
      };
      buttons.append(button("Continue", "continue", "Mark the resolved files as resolved and go on"));
      if (state.kind !== "merge") {
        buttons.append(button("Skip", "skip", "Leave out this commit and go on"));
      }
      buttons.append(button("Abort", "abort", `Cancel the ${state.kind} and go back to where it started`));
      element2.append(icon, text, files, buttons);
      if (error) {
        const problem = document.createElement("div");
        problem.className = "operation-banner__error";
        problem.setAttribute("role", "alert");
        problem.textContent = error.message;
        element2.append(problem);
      }
    };
    const showError = (message) => {
      if (!awaiting || !current) {
        return false;
      }
      awaiting = false;
      error = { message, key: stopKey(current) };
      update(current);
      return true;
    };
    const settle = () => {
      awaiting = false;
    };
    return { update, showError, settle };
  };

  // webview/src/graph/rebaseDialog.ts
  var ACTIONS = [
    { action: "pick", label: "Pick", key: "p", info: "Keep the commit as it is." },
    { action: "reword", label: "Reword", key: "r", info: "Keep the changes, change the message." },
    { action: "edit", label: "Edit", key: "e", info: "Stop after this commit to change it; then Continue." },
    { action: "squash", label: "Squash \u2193", key: "s", info: "Add to the older commit below; both messages are kept." },
    { action: "fixup", label: "Fixup \u2193", key: "f", info: "Add to the older commit below; this message is dropped." },
    { action: "drop", label: "Drop", key: "d", info: "Leave the commit out." }
  ];
  var createRebaseDialog = (answers) => {
    let backdrop;
    let openId;
    let showError = () => void 0;
    let previousFocus = null;
    const close = () => {
      backdrop?.remove();
      backdrop = void 0;
      openId = void 0;
      const target = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : document.getElementById("commit-items");
      target?.focus({ preventScroll: true });
      previousFocus = null;
    };
    const show = (request) => {
      close();
      previousFocus = document.activeElement;
      openId = request.id;
      backdrop = document.createElement("div");
      backdrop.className = "form-dialog-backdrop";
      const dialog = document.createElement("form");
      dialog.className = "form-dialog rebase-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.noValidate = true;
      const title = document.createElement("div");
      title.className = "form-dialog__title";
      title.id = `${request.id}-title`;
      title.textContent = `Interactive rebase of ${request.branch} onto ${request.base}`;
      dialog.setAttribute("aria-labelledby", title.id);
      const detail = document.createElement("div");
      detail.className = "form-dialog__detail";
      detail.textContent = "Newest commit on top, like in the graph. Drag a row or use Alt+\u2191/\u2193 to move it; keys p, r, e, s, f, d choose the action of the selected row. Merge commits are left out (the branch becomes linear).";
      dialog.append(title, detail);
      const list = document.createElement("div");
      list.className = "rebase-list";
      list.setAttribute("role", "list");
      dialog.appendChild(list);
      const rows = request.commits.map((commit) => ({
        commit,
        action: "pick",
        message: commit.message,
        element: document.createElement("div")
      }));
      const summary = document.createElement("span");
      summary.className = "rebase-summary";
      const render = () => {
        const focusedHash = document.activeElement?.closest(".rebase-row")?.dataset.hash;
        const focusedPart = document.activeElement?.dataset.part;
        list.replaceChildren(...rows.map((row, index) => renderRow(row, index)));
        const kept = rows.filter((row) => row.action !== "drop");
        const result = kept.filter((row) => row.action !== "squash" && row.action !== "fixup").length;
        summary.textContent = `${rows.length} commit${rows.length === 1 ? "" : "s"} \u2192 ${result}`;
        if (focusedHash) {
          const row = list.querySelector(`.rebase-row[data-hash="${focusedHash}"]`);
          const part = focusedPart ? row?.querySelector(`[data-part="${focusedPart}"]`) : row;
          (part ?? row)?.focus({ preventScroll: true });
        }
      };
      const move = (from, to) => {
        if (to < 0 || to >= rows.length || from === to) {
          return;
        }
        const [row] = rows.splice(from, 1);
        rows.splice(to, 0, row);
        clearError();
        render();
      };
      const setAction = (row, action) => {
        row.action = action;
        clearError();
        render();
      };
      let dragFrom;
      const renderRow = (row, index) => {
        const element2 = document.createElement("div");
        row.element = element2;
        element2.className = `rebase-row rebase-row--${row.action}`;
        element2.dataset.hash = row.commit.hash;
        element2.tabIndex = 0;
        element2.setAttribute("role", "listitem");
        element2.setAttribute("aria-label", `${row.action} ${row.commit.shortHash} ${row.commit.subject}`);
        element2.draggable = true;
        const grip = document.createElement("span");
        grip.className = "rebase-row__grip";
        grip.textContent = "\u22EE\u22EE";
        grip.title = "Drag to move";
        grip.setAttribute("aria-hidden", "true");
        const select = document.createElement("select");
        select.className = "form-dialog__input rebase-row__action";
        select.dataset.part = "action";
        select.setAttribute("aria-label", `Action for ${row.commit.shortHash}`);
        ACTIONS.forEach((entry) => {
          const option = document.createElement("option");
          option.value = entry.action;
          option.textContent = entry.label;
          option.title = entry.info;
          select.appendChild(option);
        });
        select.value = row.action;
        select.title = ACTIONS.find((entry) => entry.action === row.action)?.info ?? "";
        select.addEventListener("change", () => setAction(row, select.value));
        const hash = document.createElement("code");
        hash.className = "rebase-row__hash";
        hash.textContent = row.commit.shortHash;
        hash.title = `${row.commit.hash} by ${row.commit.authorName}`;
        const text = document.createElement("div");
        text.className = "rebase-row__text";
        if (row.action === "reword") {
          const input = document.createElement("textarea");
          input.className = "form-dialog__input rebase-row__message";
          input.dataset.part = "message";
          input.value = row.message;
          input.rows = Math.min(6, Math.max(2, row.message.split("\n").length));
          input.spellcheck = false;
          input.setAttribute("aria-label", `New message for ${row.commit.shortHash}`);
          input.addEventListener("input", () => {
            row.message = input.value;
            clearError();
          });
          text.appendChild(input);
        } else {
          const subject = document.createElement("span");
          subject.className = "rebase-row__subject";
          subject.textContent = row.action === "squash" || row.action === "fixup" ? `\u21B3 ${row.commit.subject}` : row.commit.subject;
          subject.title = row.commit.message;
          text.appendChild(subject);
        }
        element2.append(grip, select, hash, text);
        element2.addEventListener("dragstart", (event) => {
          dragFrom = index;
          element2.classList.add("rebase-row--dragging");
          event.dataTransfer?.setData("text/plain", row.commit.hash);
        });
        element2.addEventListener("dragend", () => {
          dragFrom = void 0;
          element2.classList.remove("rebase-row--dragging");
        });
        element2.addEventListener("dragover", (event) => {
          if (dragFrom !== void 0) {
            event.preventDefault();
          }
        });
        element2.addEventListener("drop", (event) => {
          event.preventDefault();
          if (dragFrom !== void 0) {
            move(dragFrom, index);
          }
        });
        return element2;
      };
      list.addEventListener("keydown", (event) => {
        const rowElement = event.target.closest(".rebase-row");
        if (!rowElement) {
          return;
        }
        const index = rows.findIndex((row) => row.commit.hash === rowElement.dataset.hash);
        const inField = event.target !== rowElement;
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          move(index, index + (event.key === "ArrowUp" ? -1 : 1));
          return;
        }
        if (inField) {
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const next = list.children[index + (event.key === "ArrowUp" ? -1 : 1)];
          next?.focus();
          return;
        }
        const entry = ACTIONS.find((candidate) => candidate.key === event.key.toLowerCase());
        if (entry && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          setAction(rows[index], entry.action);
          if (entry.action === "reword") {
            list.querySelector(`.rebase-row[data-hash="${rows[index].commit.hash}"] textarea`)?.focus();
          }
        }
      });
      const error = document.createElement("div");
      error.className = "form-dialog__error form-dialog__error--general";
      error.hidden = true;
      error.setAttribute("role", "alert");
      const clearError = () => {
        error.hidden = true;
        error.textContent = "";
      };
      const footer = document.createElement("div");
      footer.className = "rebase-footer";
      const dateLabel = document.createElement("label");
      dateLabel.className = "form-dialog__check";
      const ignoreDate = document.createElement("input");
      ignoreDate.type = "checkbox";
      ignoreDate.checked = request.ignoreDate;
      dateLabel.title = "Set the author date of the rewritten commits to now (git rebase --ignore-date).";
      dateLabel.append(ignoreDate, document.createTextNode("Ignore date"));
      footer.append(dateLabel, summary);
      const buttons = document.createElement("div");
      buttons.className = "form-dialog__buttons";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "form-dialog__button form-dialog__button--primary";
      submit.textContent = "Start Rebase";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "form-dialog__button";
      cancel.textContent = "Cancel";
      buttons.append(submit, cancel);
      dialog.append(error, footer, buttons);
      showError = (message) => {
        error.textContent = message;
        error.hidden = false;
        submit.disabled = false;
      };
      const doCancel = () => {
        const id = openId;
        close();
        if (id) {
          answers.cancel(id);
        }
      };
      dialog.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!openId || submit.disabled) {
          return;
        }
        submit.disabled = true;
        answers.submit(
          openId,
          rows.map((row) => ({
            hash: row.commit.hash,
            action: row.action,
            message: row.action === "reword" ? row.message : void 0
          })),
          ignoreDate.checked
        );
      });
      cancel.addEventListener("click", doCancel);
      backdrop.addEventListener("mousedown", (event) => {
        if (event.target === backdrop) {
          doCancel();
        }
      });
      dialog.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          doCancel();
        }
      });
      render();
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      list.firstElementChild?.focus({ preventScroll: true });
    };
    const handle = (message) => {
      const payload = message.payload ?? {};
      switch (message.type) {
        case "showRebase":
          show(payload);
          return true;
        case "rebaseError":
          if (payload.id === openId) {
            showError(String(payload.message ?? "The rebase cannot start."));
          }
          return true;
        case "rebaseClose":
          if (payload.id === openId) {
            close();
          }
          return true;
        default:
          return false;
      }
    };
    return { handle };
  };

  // webview/src/graph/lineDiff.ts
  var splitLines = (text) => {
    if (text === "") {
      return [];
    }
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  };
  var shortestEdit = (a, b, maxEdits) => {
    const n = a.length;
    const m = b.length;
    const max = n + m;
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    const limit = Math.min(max, maxEdits);
    for (let d = 0; d <= limit; d += 1) {
      trace.push(v.slice(offset - d - 1, offset + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || k !== d && v[offset + k - 1] < v[offset + k + 1] ? v[offset + k + 1] : v[offset + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) {
          x += 1;
          y += 1;
        }
        v[offset + k] = x;
        if (x >= n && y >= m) {
          return backtrack(trace, d, n, m);
        }
      }
    }
    return void 0;
  };
  var backtrack = (trace, edits, n, m) => {
    const ops = [];
    let x = n;
    let y = m;
    for (let d = edits; d > 0; d -= 1) {
      const before = trace[d];
      const at = (k2) => before[k2 + d + 1];
      const k = x - y;
      const down = k === -d || k !== d && at(k - 1) < at(k + 1);
      const prevK = down ? k + 1 : k - 1;
      const prevX = at(prevK);
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        ops.push("same");
        x -= 1;
        y -= 1;
      }
      ops.push(down ? "add" : "del");
      x = prevX;
      y = prevY;
    }
    while (x > 0 && y > 0) {
      ops.push("same");
      x -= 1;
      y -= 1;
    }
    return ops.reverse();
  };
  var diffLines = (oldText, newText, maxEdits = 4e3) => {
    const a = splitLines(oldText);
    const b = splitLines(newText);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) {
      start += 1;
    }
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA -= 1;
      endB -= 1;
    }
    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    const middle = shortestEdit(midA, midB, maxEdits) ?? [...midA.map(() => "del"), ...midB.map(() => "add")];
    const ops = [...Array(start).fill("same"), ...middle, ...Array(a.length - endA).fill("same")];
    const lines = [];
    let i = 0;
    let j = 0;
    ops.forEach((op) => {
      if (op === "same") {
        lines.push({ kind: "same", text: b[j], oldNo: i + 1, newNo: j + 1 });
        i += 1;
        j += 1;
      } else if (op === "del") {
        lines.push({ kind: "del", text: a[i], oldNo: i + 1 });
        i += 1;
      } else {
        lines.push({ kind: "add", text: b[j], newNo: j + 1 });
        j += 1;
      }
    });
    return lines;
  };
  var groupHunks = (lines, context = 3) => {
    const visible = new Array(lines.length).fill(false);
    lines.forEach((line, index2) => {
      if (line.kind !== "same") {
        for (let near = Math.max(0, index2 - context); near <= Math.min(lines.length - 1, index2 + context); near += 1) {
          visible[near] = true;
        }
      }
    });
    const segments = [];
    let index = 0;
    while (index < lines.length) {
      const shown = visible[index];
      let end = index;
      while (end < lines.length && visible[end] === shown) {
        end += 1;
      }
      segments.push({ type: shown ? "lines" : "gap", start: index, end });
      index = end;
    }
    return segments;
  };
  var countChanges = (lines) => ({
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "del").length
  });

  // webview/src/graph/fileViewer.ts
  var element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== void 0) {
      node.textContent = text;
    }
    return node;
  };
  var MARKS = { same: " ", del: "\u2212", add: "+" };
  var renderDiffLine = (line) => {
    const row = element("div", `file-view__line file-view__line--${line.kind}`);
    row.append(
      element("span", "file-view__no", line.oldNo === void 0 ? "" : String(line.oldNo)),
      element("span", "file-view__no", line.newNo === void 0 ? "" : String(line.newNo)),
      element("span", "file-view__mark", MARKS[line.kind]),
      element("span", "file-view__text", line.text)
    );
    return row;
  };
  var renderFileLine = (text, index) => {
    const row = element("div", "file-view__line file-view__line--file");
    row.append(element("span", "file-view__no", String(index + 1)), element("span", "file-view__text", text));
    return row;
  };
  var renderGap = (lines, start, end) => {
    const count = end - start;
    const gap = element("button", "file-view__gap", `\u22EF ${count} unchanged line${count === 1 ? "" : "s"}`);
    gap.type = "button";
    gap.title = "Show these lines";
    gap.addEventListener("click", () => {
      const fragment = document.createDocumentFragment();
      lines.slice(start, end).forEach((line) => fragment.appendChild(renderDiffLine(line)));
      gap.replaceWith(fragment);
    });
    return gap;
  };
  var renderDiff = (request, body, summary) => {
    const lines = diffLines(request.left?.text ?? "", request.right.text);
    const { added, removed } = countChanges(lines);
    summary.append(element("span", "file-view__added", `+${added}`), element("span", "file-view__removed", `\u2212${removed}`));
    if (added === 0 && removed === 0) {
      body.appendChild(element("div", "file-view__notice", "No changes in this file."));
      return;
    }
    const fragment = document.createDocumentFragment();
    groupHunks(lines).forEach((segment) => {
      if (segment.type === "gap") {
        fragment.appendChild(renderGap(lines, segment.start, segment.end));
      } else {
        lines.slice(segment.start, segment.end).forEach((line) => fragment.appendChild(renderDiffLine(line)));
      }
    });
    body.appendChild(fragment);
  };
  var renderFile = (request, body) => {
    const lines = splitLines(request.right.text);
    if (lines.length === 0) {
      body.appendChild(element("div", "file-view__notice", "The file is empty or does not exist here."));
      return;
    }
    const fragment = document.createDocumentFragment();
    lines.forEach((text, index) => fragment.appendChild(renderFileLine(text, index)));
    body.appendChild(fragment);
  };
  var createFileViewer = () => {
    let open;
    const close = () => {
      if (!open) {
        return;
      }
      const { backdrop, returnFocus } = open;
      open = void 0;
      backdrop.remove();
      if (returnFocus instanceof HTMLElement) {
        returnFocus.focus();
      }
    };
    const show = (request) => {
      const returnFocus = open?.returnFocus ?? document.activeElement;
      close();
      const backdrop = element("div", "file-view-backdrop");
      const dialog = element("div", "file-view");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      const header = element("div", "file-view__header");
      const title = element("div", "file-view__title", request.title);
      title.id = "file-view-title";
      dialog.setAttribute("aria-labelledby", title.id);
      const sides = element("div", "file-view__sides");
      sides.textContent = request.mode === "diff" && request.left ? `${request.left.label} \u2192 ${request.right.label}` : request.right.label;
      const summary = element("div", "file-view__summary");
      const closeButton = element("button", "file-view__close", "\xD7");
      closeButton.type = "button";
      closeButton.title = "Close (Esc)";
      closeButton.setAttribute("aria-label", "Close");
      closeButton.addEventListener("click", close);
      const heading = element("div", "file-view__heading");
      heading.append(title, sides);
      header.append(heading, summary, closeButton);
      const body = element("div", "file-view__body");
      body.tabIndex = 0;
      body.setAttribute("aria-label", request.mode === "diff" ? "Changes" : "File content");
      if (request.notice) {
        body.appendChild(element("div", "file-view__notice", request.notice));
      } else if (request.mode === "diff") {
        renderDiff(request, body, summary);
      } else {
        body.classList.add("file-view__body--file");
        renderFile(request, body);
      }
      dialog.append(header, body);
      dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      });
      backdrop.addEventListener("mousedown", (event) => {
        if (event.target === backdrop) {
          close();
        }
      });
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      open = { backdrop, returnFocus };
      body.focus();
    };
    return {
      handle: (message) => {
        if (message.type !== "showFileView" || !message.payload) {
          return false;
        }
        show(message.payload);
        return true;
      },
      close
    };
  };

  // webview/src/graph/graphScroll.ts
  var graphScrollX = (overlay) => Number(overlay.dataset.scrollX) || 0;
  var bindGraphScroll = ({ overlay, items, scroller }) => {
    const track = document.createElement("div");
    track.className = "graph-hscroll__track";
    scroller.replaceChildren(track);
    const visibleWidth = () => Number(overlay.getAttribute("width")) || 0;
    const contentWidth = () => Number(overlay.dataset.contentWidth) || visibleWidth();
    const apply = (x) => {
      const width = visibleWidth();
      const height = Number(overlay.getAttribute("height")) || 0;
      const clamped = Math.max(0, Math.min(x, contentWidth() - width));
      overlay.dataset.scrollX = String(clamped);
      overlay.setAttribute("viewBox", `${clamped} 0 ${width} ${height}`);
    };
    const sync = () => {
      const width = visibleWidth();
      const content = contentWidth();
      const overflow = content > width + 1;
      scroller.hidden = !overflow;
      scroller.style.width = `${width}px`;
      track.style.width = `${content}px`;
      const x = graphScrollX(overlay);
      if (overflow && Math.abs(scroller.scrollLeft - x) > 1) {
        scroller.scrollLeft = x;
      }
    };
    overlay.addEventListener("graph-extent", sync);
    scroller.addEventListener("scroll", () => apply(scroller.scrollLeft));
    items.addEventListener(
      "wheel",
      (event) => {
        if (scroller.hidden) {
          return;
        }
        const box = overlay.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.left + visibleWidth()) {
          return;
        }
        const dx = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
        if (dx === 0) {
          return;
        }
        event.preventDefault();
        scroller.scrollLeft += dx;
      },
      { passive: false }
    );
  };

  // webview/src/graph/commitHover.ts
  var childrenCache = /* @__PURE__ */ new WeakMap();
  var childrenOf = (commits) => {
    const cached = childrenCache.get(commits);
    if (cached) {
      return cached;
    }
    const children = /* @__PURE__ */ new Map();
    commits.forEach((commit) => {
      if (commit.isUncommitted || commit.isVirtual || commit.isConnectorRow) {
        return;
      }
      (commit.parents ?? []).forEach((parent) => {
        const list = children.get(parent);
        if (list) {
          list.push(commit.hash);
        } else {
          children.set(parent, [commit.hash]);
        }
      });
    });
    childrenCache.set(commits, children);
    return children;
  };
  var computeContainment = (commits, hash) => {
    const children = childrenOf(commits);
    const seen = /* @__PURE__ */ new Set([hash]);
    const queue = [hash];
    while (queue.length > 0) {
      const current = queue.pop();
      (children.get(current) ?? []).forEach((child) => {
        if (!seen.has(child)) {
          seen.add(child);
          queue.push(child);
        }
      });
    }
    const refs = commits.filter((commit) => seen.has(commit.hash)).flatMap((commit) => commit.refs);
    const inHead = refs.some((ref) => ref.type === "head" || ref.isCurrent);
    const localNames = new Set(refs.filter((ref) => ref.type === "local").map((ref) => ref.name));
    const branches = [];
    refs.forEach((ref) => {
      if (ref.type !== "local" && (ref.type !== "remote" || ref.name.endsWith("/HEAD"))) {
        return;
      }
      const slash = ref.type === "remote" ? ref.name.indexOf("/") : -1;
      const short = slash > 0 ? ref.name.slice(slash + 1) : ref.name;
      const paired = ref.type === "remote" && localNames.has(short);
      const key = ref.type === "local" || paired ? short : ref.name;
      let entry = branches.find((candidate) => candidate.name === key);
      if (!entry) {
        entry = { name: key };
        branches.push(entry);
      }
      if (paired && !entry.remote) {
        entry.remote = ref.name.slice(0, slash);
      }
    });
    const tags = [...new Set(refs.filter((ref) => ref.type === "tag").map((ref) => ref.name))];
    return { inHead, branches, tags };
  };
  var DOT_HIT_RADIUS = 9;
  var SHOW_DELAY_MS = 250;
  var chip = (text, scope) => {
    const element2 = document.createElement("span");
    element2.className = "commit-hover__chip";
    element2.textContent = text;
    if (scope) {
      const remote = document.createElement("span");
      remote.className = "commit-hover__scope";
      remote.textContent = scope;
      element2.appendChild(remote);
    }
    return element2;
  };
  var section = (label, chips) => {
    const element2 = document.createElement("div");
    element2.className = "commit-hover__section";
    const title = document.createElement("span");
    title.className = "commit-hover__label";
    title.textContent = label;
    element2.appendChild(title);
    chips.forEach((entry) => element2.appendChild(entry));
    return element2;
  };
  var bindCommitHover = ({ items, overlay, getCommits }) => {
    const popup = document.createElement("div");
    popup.className = "commit-hover";
    popup.setAttribute("role", "tooltip");
    popup.hidden = true;
    document.body.appendChild(popup);
    let timer;
    let shownHash;
    const hide = () => {
      if (timer) {
        clearTimeout(timer);
        timer = void 0;
      }
      popup.hidden = true;
      shownHash = void 0;
    };
    const dotOf = (row) => {
      const x = Number(row.dataset.dotX);
      const y = Number(row.dataset.dotY);
      if (!row.dataset.dotX || Number.isNaN(x) || Number.isNaN(y)) {
        return void 0;
      }
      const box = overlay.getBoundingClientRect();
      const left = box.left + x - graphScrollX(overlay);
      if (left < box.left || left > box.right) {
        return void 0;
      }
      return { x: left, y: box.top + y };
    };
    const show = (hash, dot, row) => {
      const commits = getCommits();
      const commit = commits.find((entry) => entry.hash === hash);
      if (!commit) {
        return;
      }
      const containment = computeContainment(commits, hash);
      popup.replaceChildren();
      const title = document.createElement("div");
      title.className = "commit-hover__title";
      title.textContent = `Commit ${commit.shortHash}`;
      popup.appendChild(title);
      const head = document.createElement("div");
      head.className = "commit-hover__section";
      head.textContent = containment.inHead ? "Included in HEAD (the checked-out commit)." : "Not included in HEAD.";
      popup.appendChild(head);
      popup.appendChild(
        section(
          "Branches:",
          containment.branches.length > 0 ? containment.branches.map((entry) => chip(entry.name, entry.remote)) : [chip("none (among the shown branches)")]
        )
      );
      if (containment.tags.length > 0) {
        popup.appendChild(section("Tags:", containment.tags.map((tag) => chip(tag))));
      }
      const accent = getComputedStyle(row).getPropertyValue("--commit-accent").trim();
      if (accent && accent !== "transparent") {
        popup.style.setProperty("--commit-hover-accent", accent);
      } else {
        popup.style.removeProperty("--commit-hover-accent");
      }
      popup.hidden = false;
      const width = popup.offsetWidth;
      const height = popup.offsetHeight;
      const gap = 13;
      const flipped = dot.x + gap + width > window.innerWidth - 8;
      const left = flipped ? Math.max(8, dot.x - gap - width) : dot.x + gap;
      const top = Math.max(8, Math.min(dot.y - 18, window.innerHeight - height - 8));
      popup.classList.toggle("commit-hover--left", flipped);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      popup.style.setProperty("--commit-hover-pointer-y", `${Math.min(Math.max(dot.y - top, 10), height - 10)}px`);
      shownHash = hash;
    };
    items.addEventListener("mousemove", (event) => {
      const row = event.target.closest(".commit");
      const hash = row?.dataset.hash;
      const dot = row ? dotOf(row) : void 0;
      const commit = hash ? getCommits().find((entry) => entry.hash === hash) : void 0;
      const onDot = !!dot && !!commit && !commit.isUncommitted && !commit.isVirtual && !commit.isConnectorRow && Math.hypot(event.clientX - dot.x, event.clientY - dot.y) <= DOT_HIT_RADIUS;
      if (!onDot || !hash || !dot || !row) {
        hide();
        return;
      }
      if (shownHash === hash || timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = void 0;
        show(hash, dot, row);
      }, SHOW_DELAY_MS);
    });
    items.addEventListener("mouseleave", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("contextmenu", hide, true);
    window.addEventListener("keydown", hide, true);
  };

  // webview/src/graph/renderShell.ts
  var renderAppShell = (root) => {
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

  // webview/src/graph/webviewActions.ts
  var createWebviewActions = (vscode2) => {
    const send = (message) => {
      vscode2.postMessage(message);
    };
    return {
      ready: () => {
        send({ type: "ready" });
      },
      refresh: () => {
        send({ type: "refresh" });
      },
      updateFilters: (selectedBranch, showRemoteBranches) => {
        send({
          type: "updateFilters",
          payload: {
            selectedBranch,
            showRemoteBranches
          }
        });
      },
      loadMore: (cursor) => {
        send({ type: "loadMore", payload: { cursor } });
      },
      selectCommit: (hash) => {
        send({ type: "selectCommit", payload: { hash } });
      },
      openFile: (hash, path) => {
        send({ type: "openFile", payload: { hash, path } });
      },
      openDiff: (hash, path) => {
        send({ type: "openDiff", payload: { hash, path } });
      },
      selectRepo: (repoRoot) => {
        send({ type: "selectRepo", payload: { repoRoot } });
      },
      copyToClipboard: (text, label) => {
        send({ type: "copyToClipboard", payload: { text, label } });
      },
      checkoutBranch: (name) => {
        send({ type: "checkoutBranch", payload: { name } });
      },
      checkoutRemoteBranch: (remoteRef) => {
        send({ type: "checkoutRemoteBranch", payload: { remoteRef } });
      },
      checkoutDetached: (target) => {
        send({ type: "checkoutDetached", payload: { target } });
      },
      createBranch: (hash) => {
        send({ type: "createBranch", payload: { hash } });
      },
      showInTerminal: (hash) => {
        send({ type: "showInTerminal", payload: { hash } });
      },
      commitAction: (action, hash) => {
        send({ type: "commitAction", payload: { action, hash } });
      },
      tagAction: (action, name) => {
        send({ type: "tagAction", payload: { action, name } });
      },
      stashAction: (action, selector, hash) => {
        send({ type: "stashAction", payload: { action, selector, hash } });
      },
      branchAction: (action, name) => {
        send({ type: "branchAction", payload: { action, name } });
      },
      tagInfo: (requestId, name) => {
        send({ type: "tagInfo", payload: { requestId, name } });
      },
      selectWorktree: (path) => {
        send({ type: "selectWorktree", payload: { path } });
      },
      worktreeAction: (action, path) => {
        send({ type: "worktreeAction", payload: { action, path } });
      },
      formSubmit: (id, values) => {
        send({ type: "formSubmit", payload: { id, values } });
      },
      formCancel: (id) => {
        send({ type: "formCancel", payload: { id } });
      },
      rebaseSubmit: (id, steps, ignoreDate) => {
        send({ type: "rebaseSubmit", payload: { id, steps, ignoreDate } });
      },
      rebaseCancel: (id) => {
        send({ type: "rebaseCancel", payload: { id } });
      },
      operationAction: (action) => {
        send({ type: "operationAction", payload: { action } });
      },
      openConflict: (path) => {
        send({ type: "openConflict", payload: { path } });
      }
    };
  };

  // webview/src/graph/columnResizeController.ts
  var STORAGE_KEY = "git-lineage.column-widths.v1";
  var DEFAULT_WIDTHS = {
    graph: 220,
    date: 140,
    author: 140,
    hash: 90
  };
  var MIN_WIDTHS = {
    graph: 120,
    date: 90,
    author: 90,
    hash: 70
  };
  var MAX_WIDTHS = {
    graph: 520,
    date: 380,
    author: 380,
    hash: 220
  };
  var clampWidth = (key, value) => Math.max(MIN_WIDTHS[key], Math.min(MAX_WIDTHS[key], value));
  var loadPersistedWidths = () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...DEFAULT_WIDTHS };
      }
      const parsed = JSON.parse(raw);
      return {
        graph: clampWidth("graph", Number(parsed.graph ?? DEFAULT_WIDTHS.graph)),
        date: clampWidth("date", Number(parsed.date ?? DEFAULT_WIDTHS.date)),
        author: clampWidth("author", Number(parsed.author ?? DEFAULT_WIDTHS.author)),
        hash: clampWidth("hash", Number(parsed.hash ?? DEFAULT_WIDTHS.hash))
      };
    } catch {
      return { ...DEFAULT_WIDTHS };
    }
  };
  var savePersistedWidths = (widths) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {
    }
  };
  var applyWidths = (listElement, widths) => {
    listElement.style.setProperty("--graph-col-width", `${widths.graph}px`);
    listElement.style.setProperty("--col-date-width", `${widths.date}px`);
    listElement.style.setProperty("--col-author-width", `${widths.author}px`);
    listElement.style.setProperty("--col-hash-width", `${widths.hash}px`);
  };
  var setupColumnResizeController = () => {
    const listElement = document.getElementById("commit-list");
    if (!listElement) {
      return;
    }
    let resizeQueued = false;
    const scheduleGraphResize = () => {
      if (resizeQueued) {
        return;
      }
      resizeQueued = true;
      window.requestAnimationFrame(() => {
        resizeQueued = false;
        window.dispatchEvent(new Event("resize"));
      });
    };
    const handles = Array.from(
      listElement.querySelectorAll(".col-resize-handle[data-resize-col]")
    );
    if (handles.length === 0) {
      return;
    }
    let widths = loadPersistedWidths();
    applyWidths(listElement, widths);
    handles.forEach((handle) => {
      const key = handle.dataset.resizeCol;
      if (!key || !(key in DEFAULT_WIDTHS)) {
        return;
      }
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = widths[key];
        const onPointerMove = (moveEvent) => {
          const deltaX = moveEvent.clientX - startX;
          const nextWidth = key === "graph" ? startWidth + deltaX : startWidth - deltaX;
          widths = {
            ...widths,
            [key]: clampWidth(key, nextWidth)
          };
          applyWidths(listElement, widths);
          scheduleGraphResize();
        };
        const onPointerUp = () => {
          document.body.classList.remove("is-resizing-columns");
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          savePersistedWidths(widths);
          scheduleGraphResize();
        };
        document.body.classList.add("is-resizing-columns");
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
      });
    });
  };

  // webview/src/graph/columnVisibility.ts
  var MIN_DESCRIPTION_WIDTH = 180;
  var COLUMN_GAP = 10;
  var HIDE_ORDER = ["author", "date", "hash"];
  var columnsToHide = (rowWidth, widths) => {
    const hidden = [];
    const description = () => rowWidth - HIDE_ORDER.filter((key) => !hidden.includes(key)).reduce((sum, key) => sum + widths[key] + COLUMN_GAP, 0);
    for (const key of HIDE_ORDER) {
      if (description() >= MIN_DESCRIPTION_WIDTH) {
        break;
      }
      hidden.push(key);
    }
    return hidden;
  };
  var cssWidth = (element2, name, fallback) => {
    const value = Number.parseFloat(getComputedStyle(element2).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  var bindColumnVisibility = (list) => {
    const update = () => {
      const graph = cssWidth(list, "--graph-col-width", 220);
      const rowWidth = list.clientWidth - graph - COLUMN_GAP - 4;
      if (rowWidth <= 0) {
        return;
      }
      const hidden = columnsToHide(rowWidth, {
        author: cssWidth(list, "--col-author-width", 140),
        date: cssWidth(list, "--col-date-width", 140),
        hash: cssWidth(list, "--col-hash-width", 90)
      });
      HIDE_ORDER.forEach((key) => list.classList.toggle(`list--hide-${key}`, hidden.includes(key)));
      const columns = ["minmax(0, 1fr)"];
      ["date", "author", "hash"].forEach((key) => {
        if (!hidden.includes(key)) {
          columns.push(`var(--col-${key}-width)`);
        }
      });
      const value = columns.join(" ");
      if (list.style.getPropertyValue("--row-columns") !== value) {
        list.style.setProperty("--row-columns", value);
      }
    };
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(update).observe(list);
    }
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(update).observe(list, { attributes: true, attributeFilter: ["style"] });
    }
    update();
  };

  // webview/src/graph/hostMessages.ts
  var isHostMessage = (event) => !window.gitLineageStandalone || event.source === null;
  var onHostMessage = (listener) => {
    window.addEventListener("message", (event) => {
      if (isHostMessage(event)) {
        listener(event.data);
      }
    });
  };

  // webview/src/graph/contextMenu.ts
  var CHECKING_DELAY_MS = 400;
  var describeTagInfo = (info) => {
    if (info.missing) {
      return { lines: [`Tag ${info.name}`], remoteLine: "Tag not found.", state: "different", pushBlocked: true };
    }
    const kind = info.annotated ? "Annotated" : "Lightweight";
    const who = [info.tagger, info.date?.slice(0, 10)].filter(Boolean).join(", ");
    const lines = [`Tag ${info.name}`, who ? `${kind} \xB7 ${who}` : kind];
    if (info.message && info.message !== info.name) {
      lines.push(`"${info.message}"`);
    }
    const remote = info.remote ?? "remote";
    const remoteLines = {
      checking: `Checking ${remote}\u2026`,
      noRemote: "No remote configured.",
      same: `\u2713 On ${remote}`,
      absent: `\u2191 Only local, not on ${remote}`,
      different: `\u26A0 ${remote} has this tag on another commit (${info.remoteCommit ?? "?"})`,
      unreachable: `${remote} could not be reached`
    };
    const state = info.remoteState ?? "checking";
    return {
      lines,
      remoteLine: remoteLines[state],
      state,
      pushBlocked: state === "same" || state === "different" || state === "noRemote"
    };
  };
  var buildContextMenuItems = (commit, ref, actions) => {
    if (commit.isVirtual || commit.isConnectorRow) {
      return [];
    }
    if (commit.isUncommitted) {
      return commit.worktreePath ? worktreeItems(commit.worktreePath, commit.worktreeName ?? "", actions) : [];
    }
    const items = [];
    if (ref?.worktreePath) {
      items.push(...worktreeItems(ref.worktreePath, ref.worktreeName ?? ref.name, actions), { separator: true });
    } else if (ref && !ref.isCurrent) {
      if (ref.type === "local") {
        items.push(
          { label: `Check Out Branch "${ref.name}"`, run: () => actions.checkoutBranch(ref.name) },
          { label: `Delete Branch "${ref.name}"\u2026`, run: () => actions.branchAction("delete", ref.name) }
        );
        const remoteName = ref.remoteName;
        if (remoteName) {
          items.push({
            label: `Delete Remote Branch "${remoteName}"\u2026`,
            run: () => actions.branchAction("deleteRemote", remoteName)
          });
        }
      } else if (ref.type === "remote") {
        items.push(
          { label: `Check Out "${ref.name}" as Local Branch`, run: () => actions.checkoutRemoteBranch(ref.name) },
          { label: `Delete Remote Branch "${ref.name}"\u2026`, run: () => actions.branchAction("deleteRemote", ref.name) }
        );
      } else if (ref.type === "stash" && ref.stashHash) {
        const stashHash = ref.stashHash;
        items.push(
          { label: `Apply Stash "${ref.name}"\u2026`, run: () => actions.stashAction("apply", ref.name, stashHash) },
          { label: `Pop Stash "${ref.name}"\u2026`, run: () => actions.stashAction("pop", ref.name, stashHash) },
          { label: `Drop Stash "${ref.name}"\u2026`, run: () => actions.stashAction("drop", ref.name, stashHash) }
        );
      } else if (ref.type === "tag") {
        items.push(
          { label: `Check Out Tag "${ref.name}" (Detached)\u2026`, run: () => actions.checkoutDetached(ref.name) },
          { label: `Push Tag "${ref.name}"\u2026`, run: () => actions.tagAction("push", ref.name), key: "tagPush" },
          { label: `Delete Tag "${ref.name}"\u2026`, run: () => actions.tagAction("delete", ref.name) }
        );
      }
      if (items.length > 0) {
        items.push({ separator: true });
      }
    }
    const isHead = commit.refs.some((entry) => entry.isCurrent || entry.type === "head");
    const hash = commit.hash;
    items.push(
      { label: "Add Tag\u2026", run: () => actions.commitAction("addTag", hash) },
      { label: "Create Branch\u2026", run: () => actions.createBranch(hash) },
      { label: "Add Worktree\u2026", run: () => actions.commitAction("addWorktree", hash) },
      { separator: true }
    );
    if (!isHead) {
      items.push(
        { label: "Check Out (Detached)\u2026", run: () => actions.checkoutDetached(hash) },
        { label: "Cherry-Pick onto Current Branch\u2026", run: () => actions.commitAction("cherryPick", hash) }
      );
    }
    items.push({ label: "Revert\u2026", run: () => actions.commitAction("revert", hash) }, { separator: true });
    if (!isHead) {
      items.push(
        { label: "Merge into Current Branch\u2026", run: () => actions.commitAction("merge", hash) },
        { label: "Rebase Current Branch onto This Commit\u2026", run: () => actions.commitAction("rebase", hash) },
        { label: "Reset Current Branch to This Commit\u2026", run: () => actions.commitAction("reset", hash) },
        { separator: true }
      );
    }
    items.push(
      { label: "Copy Hash", run: () => actions.copyToClipboard(hash, "Commit hash") },
      { label: "Copy Subject", run: () => actions.copyToClipboard(commit.subject, "Commit subject") },
      { label: "Show in Terminal", run: () => actions.showInTerminal(hash) }
    );
    return items;
  };
  var worktreeItems = (folder, name, actions) => [
    { label: `Switch to Worktree "${name}"`, run: () => actions.worktreeAction("switch", folder) },
    { label: "Open Worktree in New Window", run: () => actions.worktreeAction("openWindow", folder) },
    { label: "Copy Worktree Path", run: () => actions.worktreeAction("copyPath", folder) },
    { label: `Remove Worktree "${name}"\u2026`, run: () => actions.worktreeAction("remove", folder) }
  ];
  var refFromChip = (chip2) => {
    const name = chip2?.dataset.refName;
    const type = chip2?.dataset.refType;
    if (!chip2 || !name || !type) {
      return void 0;
    }
    return {
      name,
      type,
      remoteName: chip2.dataset.remoteName,
      isCurrent: chip2.classList.contains("ref-chip--current"),
      worktreePath: chip2.dataset.worktreePath,
      worktreeName: chip2.dataset.worktreeName,
      stashHash: chip2.dataset.stashHash
    };
  };
  var bindContextMenu = (items, findCommit, actions) => {
    let menu;
    let tagRequest;
    let requestCounter = 0;
    let targetRow;
    let returnFocus;
    const close = () => {
      menu?.remove();
      menu = void 0;
      tagRequest = void 0;
      targetRow?.classList.remove("context-target");
      targetRow = void 0;
    };
    const closeAndRestoreFocus = () => {
      close();
      if (returnFocus?.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
      returnFocus = void 0;
    };
    const addTagInfoBlock = (name) => {
      const block = document.createElement("div");
      block.className = "context-menu__info";
      block.setAttribute("role", "presentation");
      menu.append(block);
      const line = document.createElement("div");
      line.className = "context-menu__separator";
      line.setAttribute("role", "separator");
      menu.append(line);
      requestCounter += 1;
      lastState = "checking";
      checkingText = "Checking\u2026";
      const request = `tag-${requestCounter}`;
      tagRequest = request;
      const title = document.createElement("div");
      title.className = "context-menu__info-title";
      title.textContent = `Tag ${name}`;
      const remote = document.createElement("div");
      remote.className = "context-menu__info-remote";
      remote.textContent = "\xA0";
      block.append(title, remote);
      actions.tagInfo(request, name);
      window.setTimeout(() => {
        const line2 = menu?.querySelector(".context-menu__info-remote");
        if (tagRequest === request && line2 && lastState === "checking") {
          line2.textContent = checkingText;
        }
      }, CHECKING_DELAY_MS);
    };
    let lastState = "checking";
    let checkingText = "Checking\u2026";
    const showTagInfo = (info) => {
      const block = menu?.querySelector(".context-menu__info");
      if (!menu || !block || info.requestId !== tagRequest) {
        return;
      }
      const { lines, remoteLine, state, pushBlocked } = describeTagInfo(info);
      lastState = state;
      block.replaceChildren();
      lines.forEach((text, index) => {
        const line = document.createElement("div");
        line.className = index === 0 ? "context-menu__info-title" : "context-menu__info-line";
        line.textContent = text;
        block.append(line);
      });
      const remote = document.createElement("div");
      remote.className = `context-menu__info-remote context-menu__info-remote--${state}`;
      if (state === "checking") {
        checkingText = remoteLine;
        remote.textContent = "\xA0";
      } else {
        remote.textContent = remoteLine;
      }
      block.append(remote);
      const push = menu.querySelector('[data-key="tagPush"]');
      if (push) {
        const hadFocus = document.activeElement === push;
        push.disabled = pushBlocked && state !== "checking";
        if (push.disabled && hadFocus) {
          menu.querySelector(".context-menu__item:not(:disabled)")?.focus();
        }
      }
    };
    onHostMessage((data) => {
      const message = data;
      if (message?.type === "tagInfo" && message.payload) {
        showTagInfo(message.payload);
      }
    });
    const open = (entries, x, y, row, tagName) => {
      close();
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement && active !== document.body ? active : void 0;
      menu = document.createElement("div");
      menu.className = "context-menu";
      menu.setAttribute("role", "menu");
      if (tagName) {
        addTagInfoBlock(tagName);
      }
      entries.forEach((entry) => {
        if ("separator" in entry) {
          const line = document.createElement("div");
          line.className = "context-menu__separator";
          line.setAttribute("role", "separator");
          menu.appendChild(line);
          return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "context-menu__item";
        button.setAttribute("role", "menuitem");
        button.textContent = entry.label;
        if (entry.key) {
          button.dataset.key = entry.key;
        }
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          closeAndRestoreFocus();
          entry.run();
        });
        menu.appendChild(button);
      });
      document.body.appendChild(menu);
      const { offsetWidth, offsetHeight } = menu;
      menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - offsetWidth - 4))}px`;
      menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - offsetHeight - 4))}px`;
      targetRow = row;
      row.classList.add("context-target");
      menu.querySelector(".context-menu__item")?.focus();
    };
    const openForRow = (row) => {
      const commit = row.dataset.hash ? findCommit(row.dataset.hash) : void 0;
      const entries = commit ? buildContextMenuItems(commit, void 0, actions) : [];
      if (entries.length === 0) {
        return false;
      }
      const anchor = row.querySelector(".commit-title") ?? row;
      const rect = anchor.getBoundingClientRect();
      open(entries, rect.left, rect.bottom, row);
      return true;
    };
    items.addEventListener("contextmenu", (event) => {
      const target = event.target;
      const row = target?.closest(".commit");
      if (!row && target === items) {
        const selected = items.querySelector(".commit.selected");
        if (selected && openForRow(selected)) {
          event.preventDefault();
        }
        return;
      }
      const commit = row?.dataset.hash ? findCommit(row.dataset.hash) : void 0;
      if (!row || !commit) {
        return;
      }
      const ref = refFromChip(target.closest(".ref-chip"));
      const entries = buildContextMenuItems(commit, ref, actions);
      if (entries.length === 0) {
        return;
      }
      event.preventDefault();
      open(entries, event.clientX, event.clientY, row, ref?.type === "tag" ? ref.name : void 0);
    });
    window.addEventListener("contextmenu", (event) => {
      if (menu && menu.contains(event.target)) {
        event.preventDefault();
      }
    });
    window.addEventListener("mousedown", (event) => {
      if (menu && !menu.contains(event.target)) {
        close();
      }
    });
    window.addEventListener(
      "keydown",
      (event) => {
        if (!menu) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeAndRestoreFocus();
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          closeAndRestoreFocus();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          const buttons = Array.from(menu.querySelectorAll(".context-menu__item:not(:disabled)"));
          const index = buttons.indexOf(document.activeElement);
          const step = event.key === "ArrowDown" ? 1 : -1;
          buttons[(index + step + buttons.length) % buttons.length]?.focus();
        }
      },
      true
    );
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return { openForRow };
  };

  // webview/src/graph/bootstrapGraphApp.ts
  var showDetailsPane = (graphOrchestrator, visible) => {
    setDetailsVisible(visible);
    window.requestAnimationFrame(() => graphOrchestrator.handleResize());
  };
  var syncCommitHeaderStickyTop = () => {
    const toolbar = document.querySelector(".toolbar");
    const top = toolbar ? Math.ceil(toolbar.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--commit-head-sticky-top", `${top}px`);
  };
  var commitLane = (commit) => commit.lane;
  var isCurrentCommit = (commit) => commit.refs.some((ref) => ref.isCurrent || ref.type === "head");
  var setupToolbar = (actions) => createToolbarController({
    onRefresh: () => {
      actions.refresh();
    },
    onUpdateFilters: (selectedBranch, showRemoteBranches) => {
      actions.updateFilters(selectedBranch, showRemoteBranches);
    },
    onLoadMore: (cursor) => {
      actions.loadMore(cursor);
    },
    onSelectRepo: (repoRoot) => {
      actions.selectRepo(repoRoot);
    },
    onSelectWorktree: (path) => {
      actions.selectWorktree(path);
    }
  });
  var setupGraph = (actions) => {
    const commitItemsElement = document.getElementById("commit-items");
    const graphOverlay = document.getElementById("graph-overlay");
    const graphOrchestrator = createGraphOrchestrator({
      commitItemsElement,
      graphOverlay,
      graphPaddingX,
      laneWidth,
      dotSize,
      virtualTrackColor,
      virtualRingRadius,
      maxImmediateParentCurveDistance,
      visualLaneCount,
      laneColor,
      editorBackground,
      commitLane,
      isCurrentCommit,
      showGraphDebugMeta,
      laneToX
    });
    const graphScroller = document.getElementById("graph-hscroll");
    if (commitItemsElement && graphOverlay && graphScroller) {
      bindGraphScroll({ overlay: graphOverlay, items: commitItemsElement, scroller: graphScroller });
    }
    if (commitItemsElement && graphOverlay) {
      bindCommitHover({ items: commitItemsElement, overlay: graphOverlay, getCommits: graphOrchestrator.getRenderedCommits });
    }
    const contextMenu = commitItemsElement ? bindContextMenu(
      commitItemsElement,
      (hash) => graphOrchestrator.getRenderedCommits().find((commit) => commit.hash === hash),
      actions
    ) : void 0;
    const openDetails = (hash) => {
      showDetailsPane(graphOrchestrator, true);
      actions.selectCommit(hash);
    };
    graphOrchestrator.bindCommitSelection({
      // Mouse: the details pane opens. Keyboard: it only follows when it is already open,
      // so stepping through a narrow view does not keep opening it.
      onSelect: (hash, source) => {
        if (source === "mouse" || isDetailsVisible()) {
          openDetails(hash);
        }
      },
      onOpenDetails: openDetails,
      onCloseDetails: () => showDetailsPane(graphOrchestrator, false),
      onContextMenu: (row) => {
        contextMenu?.openForRow(row);
      }
    });
    window.addEventListener("resize", () => {
      graphOrchestrator.handleResize();
    });
    return graphOrchestrator;
  };
  var setupCommitDetails = (context) => {
    bindCommitDetailFileActions({
      getSelectedHash: context.graphOrchestrator.getSelectedHash,
      onOpenFile: (hash, path) => {
        context.actions.openFile(hash, path);
      },
      onOpenDiff: (hash, path) => {
        context.actions.openDiff(hash, path);
      }
    });
    bindDetailsPanelActions({
      onCopy: (text, label) => {
        context.actions.copyToClipboard(text, label);
      },
      // X or Esc: hide the pane; the selection stays so keyboard browsing can continue.
      onClose: () => {
        showDetailsPane(context.graphOrchestrator, false);
      }
    });
  };
  var setupMessageHandling = (context) => {
    const resetDetails = () => {
      updateCommitDetails(void 0);
      showDetailsPane(context.graphOrchestrator, false);
    };
    const applyCommitList = (payload, append) => {
      const commits = payload.commits ?? [];
      const result = context.graphOrchestrator.render(commits, append, payload.maxLanes);
      if (result.resetSelection) {
        resetDetails();
      }
      context.searchController.refresh();
    };
    const renderEmptyCommitList = () => {
      const result = context.graphOrchestrator.renderEmpty();
      if (result.resetSelection) {
        resetDetails();
      }
      context.searchController.refresh();
    };
    const handleWebviewMessage = createWebviewMessageHandler({
      setRefreshing: context.toolbarController.setRefreshing,
      setStatusText: context.viewHelpers.setStatusText,
      setRepoText: context.viewHelpers.setRepoText,
      renderRepositories: context.toolbarController.renderRepositories,
      renderWorktrees: context.toolbarController.renderWorktrees,
      resetLoading: context.toolbarController.resetLoading,
      renderFilters: context.toolbarController.renderFilters,
      applyPagingState: context.toolbarController.setPagingState,
      applyCommitList,
      renderEmptyCommitList,
      updateCommitDetails
    });
    onHostMessage((data) => {
      handleWebviewMessage(data);
    });
  };
  var createBootstrapContext = (actions) => {
    const viewHelpers = createViewHelpers();
    viewHelpers.setGraphDebugEnabled(showGraphDebugMeta);
    document.getElementById("repo-copy")?.addEventListener("click", () => {
      const fullPath = document.getElementById("repo")?.dataset.path;
      if (fullPath) {
        actions.copyToClipboard(fullPath, "Path");
      }
    });
    const toolbarController = setupToolbar(actions);
    const graphOrchestrator = setupGraph(actions);
    const searchController = createSearchController({
      getCommits: graphOrchestrator.getRenderedCommits,
      items: document.getElementById("commit-items"),
      // Esc in the search field: continue in the list at the current match.
      onLeave: (currentHash) => {
        if (currentHash && graphOrchestrator.selectHash(currentHash) && isDetailsVisible()) {
          actions.selectCommit(currentHash);
        }
        graphOrchestrator.focusList();
      }
    });
    return {
      actions,
      viewHelpers,
      toolbarController,
      graphOrchestrator,
      searchController
    };
  };
  var bootstrapGraphApp = (vscode2) => {
    const root = document.getElementById("app");
    const actions = createWebviewActions(vscode2);
    renderAppShell(root);
    syncCommitHeaderStickyTop();
    setupColumnResizeController();
    const commitList = document.getElementById("commit-list");
    if (commitList) {
      bindColumnVisibility(commitList);
    }
    window.addEventListener("resize", syncCommitHeaderStickyTop);
    const toolbar = document.querySelector(".toolbar");
    if (toolbar && typeof ResizeObserver !== "undefined") {
      new ResizeObserver(syncCommitHeaderStickyTop).observe(toolbar);
    }
    actions.ready();
    const context = createBootstrapContext(actions);
    setupCommitDetails(context);
    const formDialog = createFormDialog({ submit: actions.formSubmit, cancel: actions.formCancel });
    const rebaseDialog = createRebaseDialog({ submit: actions.rebaseSubmit, cancel: actions.rebaseCancel });
    const fileViewer = createFileViewer();
    const banner = createOperationBanner(document.getElementById("operation-banner"), {
      act: actions.operationAction,
      openConflict: actions.openConflict
    });
    onHostMessage((data) => {
      const message = data;
      if (formDialog.handle(message) || rebaseDialog.handle(message) || fileViewer.handle(message)) {
        return;
      }
      if ((message.type === "init" || message.type === "commits") && message.payload && "operation" in message.payload) {
        banner.update(message.payload.operation);
      }
      if (message.type === "error" && typeof message.payload?.message === "string") {
        banner.showError(message.payload.message);
      } else if (message.type === "status") {
        banner.settle();
      }
    });
    setupMessageHandling(context);
  };

  // webview/src/main.ts
  var vscode = acquireVsCodeApi();
  bootstrapGraphApp(vscode);
})();
//# sourceMappingURL=main.js.map
