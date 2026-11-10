// Git Lineage - local server for the Claude Code browser pane. Built by scripts/build-plugin.ts, do not edit.
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/standalone/server.ts
var server_exports = {};
__export(server_exports, {
  startServer: () => startServer
});
module.exports = __toCommonJS(server_exports);
var import_crypto = require("crypto");
var fs5 = __toESM(require("fs"));
var http = __toESM(require("http"));
var path6 = __toESM(require("path"));

// src/core/graphController.ts
var fs3 = __toESM(require("fs"));
var path4 = __toESM(require("path"));

// src/git/gitService.ts
var fs2 = __toESM(require("fs"));
var os = __toESM(require("os"));
var path3 = __toESM(require("path"));
var import_child_process = require("child_process");

// src/git/gitParser.ts
function parsePorcelainStatus(raw) {
  const entries = raw.split("\0");
  const changes = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.length < 4) {
      continue;
    }
    const indexStatus = entry[0];
    const workTreeStatus = entry[1];
    const path7 = entry.slice(3);
    if (indexStatus === "R" || indexStatus === "C") {
      index += 1;
    }
    let status;
    if (indexStatus === "?" && workTreeStatus === "?") {
      status = "U";
    } else if (indexStatus !== " " && indexStatus !== "?") {
      status = indexStatus;
    } else {
      status = workTreeStatus;
    }
    changes.push({ status, path: path7 });
  }
  return changes;
}
var FIELD_SEPARATOR = "";
var COMMIT_START = "";
var COMMIT_END = "";
function parseRefName(entry) {
  if (entry.startsWith("refs/heads/")) {
    return { name: entry.slice("refs/heads/".length), type: "local" };
  }
  if (entry.startsWith("refs/remotes/")) {
    return { name: entry.slice("refs/remotes/".length), type: "remote" };
  }
  if (entry.startsWith("refs/tags/")) {
    return { name: entry.slice("refs/tags/".length), type: "tag" };
  }
  if (entry.startsWith("refs/")) {
    return { name: entry.slice("refs/".length), type: "other" };
  }
  return { name: entry, type: entry.includes("/") ? "remote" : "local" };
}
function parseRefs(rawDecorations) {
  if (!rawDecorations.trim()) {
    return [];
  }
  const refs = rawDecorations.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0).flatMap((entry) => {
    if (entry.startsWith("HEAD -> ")) {
      const branchName = entry.slice("HEAD -> ".length).trim().replace(/^refs\/heads\//, "");
      if (!branchName) {
        return [{ name: "HEAD", type: "head", isCurrent: true }];
      }
      return [
        { name: "HEAD", type: "head", isCurrent: true },
        { name: branchName, type: "local", isCurrent: true }
      ];
    }
    if (entry === "HEAD") {
      return [{ name: "HEAD", type: "head", isCurrent: true }];
    }
    if (entry.startsWith("tag: ")) {
      const tagName = entry.slice("tag: ".length).trim().replace(/^refs\/tags\//, "");
      return tagName ? [{ name: tagName, type: "tag" }] : [];
    }
    if (entry.startsWith("stash@{") || entry.startsWith("refs/stash")) {
      return [{ name: entry.replace(/^refs\//, ""), type: "stash" }];
    }
    return [parseRefName(entry)];
  });
  const seen = /* @__PURE__ */ new Set();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.name}:${ref.isCurrent ? "1" : "0"}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
function parseGitLog(raw) {
  if (!raw) {
    return [];
  }
  const commits = [];
  let pendingConnectorPrefixes = [];
  raw.split("\n").forEach((line) => {
    const start = line.indexOf(COMMIT_START);
    const end = line.lastIndexOf(COMMIT_END);
    if (start < 0 || end < 0 || end <= start) {
      if (/[|\\/_*]/.test(line)) {
        pendingConnectorPrefixes.push(line);
      }
      return;
    }
    const graphPrefix = line.slice(0, start);
    const graphFlowPrefix = pendingConnectorPrefixes.length > 0 ? pendingConnectorPrefixes[pendingConnectorPrefixes.length - 1] : graphPrefix;
    const graphConnectorPrefixes = [...pendingConnectorPrefixes];
    const payload = line.slice(start + COMMIT_START.length, end);
    const fields = payload.split(FIELD_SEPARATOR);
    if (fields.length < 7) {
      pendingConnectorPrefixes = [];
      return;
    }
    const [hash, shortHash, parentsField, authorName, authorDate, subject, refsField = ""] = fields;
    commits.push({
      hash,
      shortHash,
      parents: parentsField ? parentsField.split(" ").filter(Boolean) : [],
      authorName,
      authorDate,
      subject,
      refs: parseRefs(refsField),
      graphPrefix,
      graphFlowPrefix,
      graphConnectorPrefixes
    });
    pendingConnectorPrefixes = [];
  });
  return commits;
}

// src/git/gitErrors.ts
var GitError = class extends Error {
};
var toGitError = (error, stderr, args, timeoutMs) => {
  const command = `git ${args[0] ?? ""}`.trim();
  if (error.code === "ENOENT") {
    return new GitError("Git was not found. Please install Git and make sure it is on the PATH.");
  }
  if (error.killed || error.signal === "SIGTERM") {
    return new GitError(`${command} timed out after ${Math.round(timeoutMs / 1e3)}s.`);
  }
  const detail = (stderr || error.message).trim().split("\n").slice(0, 2).join(" ");
  return new GitError(`${command} failed: ${detail}`);
};

// src/git/worktrees.ts
var path = __toESM(require("path"));
var parseWorktreeList = (raw) => {
  const worktrees = [];
  raw.replace(/\r\n/g, "\n").split(/\n\n+/).map((block) => block.trim()).filter(Boolean).forEach((block) => {
    const entry = {
      path: "",
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false,
      isMain: worktrees.length === 0
    };
    block.split("\n").forEach((line) => {
      const space = line.indexOf(" ");
      const key = space < 0 ? line : line.slice(0, space);
      const value = space < 0 ? "" : line.slice(space + 1);
      if (key === "worktree") {
        entry.path = path.resolve(value);
      } else if (key === "HEAD") {
        entry.head = value;
      } else if (key === "branch") {
        entry.branch = value.replace(/^refs\/heads\//, "");
      } else if (key === "bare") {
        entry.isBare = true;
      } else if (key === "detached") {
        entry.isDetached = true;
      } else if (key === "locked") {
        entry.isLocked = true;
      } else if (key === "prunable") {
        entry.isPrunable = true;
      }
    });
    if (entry.path) {
      worktrees.push(entry);
    }
  });
  return worktrees;
};
var samePath = (a, b) => {
  if (!a || !b) {
    return false;
  }
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
};
var worktreeName = (worktreePath) => path.basename(worktreePath) || worktreePath;
var defaultWorktreePath = (mainWorktree, name) => {
  const safe = name.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
  return path.join(path.dirname(mainWorktree), `${path.basename(mainWorktree)}.worktrees`, safe);
};

// src/git/rebase.ts
var fs = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var rebaseActions = ["pick", "reword", "edit", "squash", "fixup", "drop"];
var rebaseStepsProblem = (steps) => {
  if (steps.length === 0) {
    return "There are no commits to rebase.";
  }
  const kept = steps.filter((step) => step.action !== "drop");
  if (kept.length === 0) {
    return "Keep at least one commit (all are dropped).";
  }
  const first = kept[0];
  if (first.action === "squash" || first.action === "fixup") {
    return "The oldest kept commit cannot be squashed: there is no older commit to add it to.";
  }
  const emptyReword = steps.find((step) => step.action === "reword" && !(step.message ?? "").trim());
  if (emptyReword) {
    return `Enter a message for ${emptyReword.hash.slice(0, 8)}.`;
  }
  return void 0;
};
var shellPath = (file) => {
  if (file.includes("'")) {
    throw new Error(`Path not usable for git: ${file}`);
  }
  return `'${file.replace(/\\/g, "/")}'`;
};
var isObjectId = (value) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
var buildTodo = (steps, messageFile) => steps.map((step, index) => {
  if (!isObjectId(step.hash) || !rebaseActions.includes(step.action)) {
    throw new Error(`Not a valid rebase step: ${JSON.stringify(step.hash.slice(0, 80))} ${JSON.stringify(step.action)}`);
  }
  if (step.action === "reword") {
    return `pick ${step.hash}
exec git commit --amend --quiet -F ${shellPath(messageFile(index))}`;
  }
  return `${step.action} ${step.hash}`;
}).join("\n") + "\n";
var readTrimmed = (file) => {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return void 0;
  }
};
var readOperationState = (gitDir) => {
  for (const folder of ["rebase-merge", "rebase-apply"]) {
    const dir = path2.join(gitDir, folder);
    if (fs.existsSync(dir)) {
      const step = Number(readTrimmed(path2.join(dir, folder === "rebase-merge" ? "msgnum" : "next")));
      const total = Number(readTrimmed(path2.join(dir, folder === "rebase-merge" ? "end" : "last")));
      const stopped = readTrimmed(path2.join(dir, "stopped-sha"));
      const head = readTrimmed(path2.join(dir, "head-name"));
      return {
        kind: "rebase",
        step: Number.isFinite(step) && step > 0 ? step : void 0,
        total: Number.isFinite(total) && total > 0 ? total : void 0,
        stoppedAt: stopped ? stopped.slice(0, 8) : void 0,
        branch: head?.replace(/^refs\/heads\//, "")
      };
    }
  }
  const stoppedAt = (file) => readTrimmed(path2.join(gitDir, file))?.slice(0, 8);
  if (fs.existsSync(path2.join(gitDir, "CHERRY_PICK_HEAD"))) {
    return { kind: "cherry-pick", stoppedAt: stoppedAt("CHERRY_PICK_HEAD") };
  }
  if (fs.existsSync(path2.join(gitDir, "REVERT_HEAD"))) {
    return { kind: "revert", stoppedAt: stoppedAt("REVERT_HEAD") };
  }
  if (fs.existsSync(path2.join(gitDir, "MERGE_HEAD"))) {
    return { kind: "merge", stoppedAt: stoppedAt("MERGE_HEAD") };
  }
  return void 0;
};
var hasConflictMarkers = (text) => /^(<{7}|>{7})( |$)/m.test(text);

// src/git/gitService.ts
var GitService = class {
  constructor(options) {
    this.options = options;
  }
  // Remember the repository the user picked in the repo selector.
  setSelectedRepoRoot(repoRoot) {
    this.selectedRepoRoot = repoRoot;
  }
  // All Git repositories offered by the host, sorted by path.
  async getRepositories() {
    return this.options.locateRepositories();
  }
  // Repository picked in the repo selector: the selected one if it still exists, otherwise the first.
  async getRepositoryRoot() {
    const repositories = await this.getRepositories();
    if (this.selectedRepoRoot && repositories.includes(this.selectedRepoRoot)) {
      return this.selectedRepoRoot;
    }
    return repositories[0];
  }
  // Folder all commands run in: the chosen worktree of the repository, otherwise the repository.
  async getRepoRoot() {
    const repository = await this.getRepositoryRoot();
    if (repository && this.selectedWorktree && samePath(this.selectedWorktree.repository, repository)) {
      return this.selectedWorktree.worktree;
    }
    return repository;
  }
  // Switch to another worktree of the shown repository (undefined: back to the repository itself).
  // The caller checks that the folder is one of listWorktrees().
  async setSelectedWorktree(worktree) {
    const repository = await this.getRepositoryRoot();
    this.selectedWorktree = repository && worktree && !samePath(repository, worktree) ? { repository, worktree } : void 0;
  }
  // All worktrees of the shown repository (main worktree first).
  async listWorktrees() {
    const repository = await this.getRepositoryRoot();
    if (!repository) {
      return [];
    }
    return parseWorktreeList(await this.execGit(["worktree", "list", "--porcelain"], repository));
  }
  // New worktree at a commit; with a branch name the branch is created there, otherwise detached.
  async addWorktree(folder, hash, branch) {
    const args = branch ? ["worktree", "add", "-b", branch, folder, hash] : ["worktree", "add", "--detach", folder, hash];
    await this.execGit(args, await this.requireRepoRoot());
  }
  // Remove a worktree; force also discards its uncommitted changes.
  async removeWorktree(folder, force) {
    const repository = await this.getRepositoryRoot();
    if (!repository) {
      throw new GitError("No Git repository is open.");
    }
    await this.execGit(["worktree", "remove", ...force ? ["--force"] : [], folder], repository);
  }
  // Git directory (HEAD lives here) and common directory (refs live here; differs in worktrees).
  async getGitDirectories(repoRoot) {
    const output = await this.execGit(["rev-parse", "--absolute-git-dir", "--git-common-dir"], repoRoot);
    const [gitDir = "", commonDirRaw = ""] = output.split("\n").map((line) => line.trim());
    const commonDir = path3.isAbsolute(commonDirRaw) ? commonDirRaw : path3.resolve(repoRoot, commonDirRaw);
    return { gitDir, commonDir };
  }
  async getBranches(showRemoteBranches) {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return [];
    }
    const format = ["%(refname:short)", "%(refname)"].join("%1f");
    const output = await this.execGit(
      ["for-each-ref", "--format", format, "refs/heads", "refs/remotes"],
      repoRoot
    );
    const branches = output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map((line) => line.split("")).filter((parts) => parts.length >= 2).map(([name, fullName]) => {
      const type = fullName.startsWith("refs/remotes/") ? "remote" : "local";
      return { name, type };
    }).filter((branch) => !branch.name.endsWith("/HEAD")).filter((branch) => showRemoteBranches || branch.type === "local").sort((a, b) => a.name.localeCompare(b.name));
    return branches;
  }
  async getLogChunk(limit = 50, beforeHash, options) {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return [];
    }
    const selectedBranch = options?.selectedBranch ?? "__all__";
    const showRemoteBranches = options?.showRemoteBranches ?? true;
    const skip = Math.max(options?.skip ?? 0, 0);
    const sortMode = options?.sortMode ?? "date";
    const format = "%x1d%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%D%x1e";
    const args = [
      "log",
      `-n`,
      String(limit),
      "--skip",
      String(skip),
      "--graph",
      "--date=iso-strict",
      // Full ref names: only the prefix tells a local "feature/x" from a remote "origin/x".
      "--decorate=full",
      `--pretty=format:${format}`
    ];
    if (sortMode === "topo") {
      args.push("--topo-order");
    } else if (sortMode === "date") {
      args.push("--date-order");
    } else if (sortMode === "authorDate") {
      args.push("--author-date-order");
    }
    if (beforeHash && skip === 0) {
      args.splice(1, 0, `${beforeHash}^`);
    }
    if (selectedBranch && selectedBranch !== "__all__") {
      args.push(selectedBranch);
    } else if (showRemoteBranches) {
      args.push("--exclude=refs/stash", "--all");
    } else {
      const localBranches = (await this.getBranches(false)).map((branch) => branch.name);
      if (localBranches.length > 0) {
        args.push(...localBranches);
      }
    }
    const output = await this.execGit(args, repoRoot);
    return parseGitLog(output);
  }
  async getCommitDetails(hash) {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return void 0;
    }
    const format = ["%H", "%h", "%an", "%ae", "%ad", "%s", "%b"].join("%x1f");
    const args = [
      "show",
      "--name-status",
      "--date=iso-strict",
      `--pretty=format:${format}%x1e`,
      hash
    ];
    const output = await this.execGit(args, repoRoot);
    const [headerPart, filePart = ""] = output.split("");
    const headerFields = headerPart.split("");
    if (headerFields.length < 6) {
      return void 0;
    }
    const [fullHash, shortHash, authorName, authorEmail, authorDate, subject, body = ""] = headerFields;
    const files = filePart.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map((line) => {
      const [status, ...pathParts] = line.split("	");
      return {
        status,
        path: pathParts.join("	")
      };
    });
    return {
      hash: fullHash,
      shortHash,
      authorName,
      authorEmail,
      authorDate,
      subject,
      body,
      files
    };
  }
  // Changed files in the working tree and index (staged, unstaged, untracked), for the
  // "Uncommitted Changes" row. Empty when there is no repository or nothing changed.
  async getWorkingTreeChanges() {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return [];
    }
    return this.getWorkingTreeChangesAt(repoRoot);
  }
  // Changed files of one worktree folder (also another worktree than the shown one).
  async getWorkingTreeChangesAt(folder) {
    const output = await this.execGit(["status", "--porcelain=v1", "-z", "--untracked-files=normal"], folder);
    return parsePorcelainStatus(output);
  }
  // Full hash of HEAD, or undefined (e.g. empty repository without commits).
  async getHeadHash() {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return void 0;
    }
    try {
      return (await this.execGit(["rev-parse", "--verify", "--quiet", "HEAD"], repoRoot)).trim() || void 0;
    } catch {
      return void 0;
    }
  }
  // --- Actions (context menu). All run in the shown repository without a shell. ---
  // Switch to an existing local branch.
  async checkoutBranch(name) {
    await this.execGit(["checkout", name, "--"], await this.requireRepoRoot());
  }
  // Detached HEAD at a commit or tag.
  async checkoutDetached(target) {
    await this.execGit(["checkout", "--detach", target, "--"], await this.requireRepoRoot());
  }
  // New local branch that tracks the remote branch, checked out.
  async checkoutTrackingBranch(localName, remoteRef) {
    await this.execGit(["checkout", "-b", localName, "--track", remoteRef, "--"], await this.requireRepoRoot());
  }
  // Moves the checked-out branch forward to ref; fails instead of creating a merge commit.
  async fastForward(ref) {
    await this.execGit(["merge", "--ff-only", ref], await this.requireRepoRoot());
  }
  // New branch at a commit; optionally checked out right away.
  async createBranch(name, startPoint, checkout) {
    const args = checkout ? ["checkout", "-b", name, startPoint, "--"] : ["branch", name, startPoint];
    await this.execGit(args, await this.requireRepoRoot());
  }
  // Tag at a commit: annotated when a message is given, otherwise lightweight.
  async createTag(name, hash, message) {
    const args = message ? ["tag", "-a", name, "-m", message, hash] : ["tag", name, hash];
    await this.execGit(args, await this.requireRepoRoot());
  }
  // Upstream of every local branch with ahead/behind counts (local data, as of the last fetch).
  async branchTracking() {
    const format = ["%(refname:short)", "%(upstream:short)", "%(upstream:track,nobracket)"].join("%1f");
    const output = await this.execGit(["for-each-ref", "--format", format, "refs/heads"], await this.requireRepoRoot());
    const result = /* @__PURE__ */ new Map();
    output.split("\n").forEach((line) => {
      const [name, upstream, track = ""] = line.split("");
      if (!name || !upstream) {
        return;
      }
      const count = (word) => Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0);
      result.set(name, { upstream, ahead: count("ahead"), behind: count("behind"), gone: track.trim() === "gone" });
    });
    return result;
  }
  // All stashes, newest first. Empty when there are none.
  async getStashes() {
    const format = ["%gd", "%H", "%P", "%gs", "%aI"].join("%x1f");
    const output = await this.execGit(["stash", "list", `--format=${format}`], await this.requireRepoRoot());
    return output.split("\n").map((line) => line.split("")).filter((parts) => parts.length >= 5 && parts[0].startsWith("stash@{")).map(([selector, hash, parents, message, date]) => ({
      selector,
      hash,
      // First parent = the commit HEAD was on when the stash was made.
      base: parents.split(" ")[0] ?? "",
      message,
      date
    }));
  }
  // Apply a stash to the working tree; pop also removes it when that worked. index: restore
  // what was staged as staged (otherwise everything comes back unstaged).
  async applyStash(selector, pop, index) {
    const args = ["stash", pop ? "pop" : "apply", ...index ? ["--index"] : [], selector];
    await this.execGit(args, await this.requireRepoRoot());
  }
  async dropStash(selector) {
    await this.execGit(["stash", "drop", selector], await this.requireRepoRoot());
  }
  // Delete a local branch; without force git refuses one that is not merged.
  async deleteBranch(name, force) {
    await this.execGit(["branch", force ? "-D" : "-d", name], await this.requireRepoRoot());
  }
  // Delete a branch on a remote (network); also removes the local remote-tracking ref.
  async deleteRemoteBranch(remote, branch) {
    await this.execGit(["push", remote, "--delete", `refs/heads/${branch}`], await this.requireRepoRoot());
  }
  // Remove a remote-tracking ref whose branch no longer exists on the remote (no network).
  async deleteRemoteTrackingRef(remoteRef) {
    await this.execGit(["branch", "-r", "-d", remoteRef], await this.requireRepoRoot());
  }
  // Upstream of a local branch as "origin/feature", or undefined.
  async branchUpstream(name) {
    const output = await this.execGit(
      ["for-each-ref", "--format", "%(upstream:short)", `refs/heads/${name}`],
      await this.requireRepoRoot()
    );
    return output.split("\n")[0]?.trim() || void 0;
  }
  // True if every commit of ref is contained in target (target = commit-ish).
  async isMergedInto(ref, target) {
    try {
      await this.execGit(["merge-base", "--is-ancestor", ref, target], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }
  // Number of commits in ref that target does not contain.
  async countNotIn(ref, target) {
    const output = await this.execGit(["rev-list", "--count", `${target}..${ref}`, "--"], await this.requireRepoRoot());
    return Number(output.trim()) || 0;
  }
  // Commit a branch points to on a remote, asked live (network). undefined = not there;
  // throws when the remote cannot be reached.
  async remoteBranchCommit(remote, branch) {
    const output = await this.execGit(["ls-remote", "--", remote, `refs/heads/${branch}`], await this.requireRepoRoot());
    const line = output.split("\n").find((entry) => entry.trim().endsWith(`	refs/heads/${branch}`));
    return line?.split("	")[0]?.trim() || void 0;
  }
  // Names of the configured remotes (e.g. ["origin"]).
  async remotes() {
    const output = await this.execGit(["remote"], await this.requireRepoRoot());
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  // Push one tag to a remote (network; uses the user's git credentials, never prompts).
  async pushTag(remote, name) {
    await this.execGit(["push", remote, `refs/tags/${name}`], await this.requireRepoRoot());
  }
  async deleteTag(name) {
    await this.execGit(["tag", "-d", name], await this.requireRepoRoot());
  }
  // Remove a tag on a remote (network).
  async deleteRemoteTag(remote, name) {
    await this.execGit(["push", remote, "--delete", `refs/tags/${name}`], await this.requireRepoRoot());
  }
  async tagExists(name) {
    try {
      await this.execGit(["show-ref", "--verify", "--quiet", `refs/tags/${name}`], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }
  // Tag name check by git itself.
  async isValidTagName(name) {
    try {
      await this.execGit(["check-ref-format", `refs/tags/${name}`], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }
  // Local facts about one tag (no network): the commit it points to and, for annotated tags,
  // tagger, date and the first line of the message. undefined if the tag does not exist.
  async tagDetails(name) {
    const format = [
      "%(refname)",
      "%(objecttype)",
      "%(objectname)",
      "%(*objectname)",
      "%(taggername)",
      "%(taggerdate:iso-strict)",
      "%(contents:subject)"
    ].join("%1f");
    const output = await this.execGit(["for-each-ref", "--format", format, `refs/tags/${name}`], await this.requireRepoRoot());
    const line = output.split("\n").find((entry) => entry.split("")[0] === `refs/tags/${name}`);
    if (!line) {
      return void 0;
    }
    const [, type, object, peeled, tagger, date, subject] = line.split("");
    const annotated = type === "tag";
    return {
      name,
      // Annotated: the tag object points to the commit (*objectname); lightweight: the commit itself.
      commit: annotated ? peeled : object,
      annotated,
      tagger: annotated && tagger ? tagger : void 0,
      date: annotated && date ? date : void 0,
      message: annotated && subject ? subject : void 0
    };
  }
  // Remote used for tag checks: "origin" if configured, otherwise the first remote.
  async defaultRemote() {
    const remotes = await this.remotes();
    return remotes.includes("origin") ? "origin" : remotes[0];
  }
  // Commit a tag points to on a remote, asked live (network, one ls-remote for this tag only).
  // undefined = the remote has no such tag; throws when the remote cannot be reached.
  async remoteTagCommit(remote, name) {
    const ref = `refs/tags/${name}`;
    const output = await this.execGit(["ls-remote", "--", remote, ref, `${ref}^{}`], await this.requireRepoRoot());
    const entries = new Map(
      output.split("\n").map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 2).map(([hash, refName]) => [refName, hash])
    );
    return entries.get(`${ref}^{}`) ?? entries.get(ref);
  }
  // Number of parents (2+ = merge commit; cherry-pick/revert then need a mainline).
  async parentCount(hash) {
    const line = (await this.execGit(["rev-list", "--parents", "-n", "1", hash, "--"], await this.requireRepoRoot())).trim();
    return Math.max(0, line.split(/\s+/).length - 1);
  }
  // Apply a commit on top of HEAD; merge commits relative to their first parent.
  // recordOrigin: "(cherry picked from commit …)" in the message (-x); noCommit: only apply the changes.
  async cherryPick(hash, isMerge, options = {}) {
    const args = [
      "cherry-pick",
      ...isMerge ? ["-m", "1"] : [],
      ...options.recordOrigin ? ["-x"] : [],
      ...options.noCommit ? ["--no-commit"] : [],
      hash
    ];
    await this.execGit(args, await this.requireRepoRoot());
  }
  // New commit that undoes a commit; merge commits relative to their first parent.
  async revert(hash, isMerge) {
    await this.execGit(["revert", "--no-edit", ...isMerge ? ["-m", "1"] : [], hash], await this.requireRepoRoot());
  }
  // Merge a commit into the current branch. noFastForward: always a merge commit; squash: the
  // changes as one set in the index (no merge commit); noCommit: merge but stop before committing.
  async merge(hash, options = {}) {
    const args = [
      "merge",
      "--no-edit",
      ...options.squash ? ["--squash"] : options.noFastForward ? ["--no-ff"] : [],
      ...options.noCommit && !options.squash ? ["--no-commit"] : [],
      hash
    ];
    await this.execGit(args, await this.requireRepoRoot());
  }
  // Rebase the current branch onto a commit.
  // ignoreDate: author dates of the rewritten commits become the current time.
  async rebase(hash, ignoreDate = false) {
    await this.execGit(["rebase", ...ignoreDate ? ["--ignore-date"] : [], hash], await this.requireRepoRoot());
  }
  // Move the current branch to a commit (soft: keep index and files, mixed: keep files, hard: discard).
  async reset(hash, mode) {
    await this.execGit(["reset", `--${mode}`, hash, "--"], await this.requireRepoRoot());
  }
  // Commits an interactive rebase onto base rewrites: base..HEAD without merges (git rebase -i
  // makes the branch linear), oldest first. At most `limit` + 1 are read to detect "too many".
  // Commits are separated by NUL (-z), which a commit message cannot contain; the message is the
  // rest after the third field separator, so separators inside it cannot forge fields. Every hash
  // must be a full object name: these hashes end up in the rebase todo list.
  async rebaseCommits(base, limit) {
    const output = await this.execGit(
      ["log", "-z", "--no-merges", "--topo-order", "--reverse", `--max-count=${limit + 1}`, "--format=%H%x1f%h%x1f%an%x1f%B", `${base}..HEAD`, "--"],
      await this.requireRepoRoot()
    );
    return output.split("\0").map((entry) => entry.replace(/^\s+/, "")).filter(Boolean).map((entry) => {
      const [hash, shortHash, authorName, ...rest] = entry.split("");
      if (!isObjectId(hash)) {
        throw new GitError("Unexpected output of git log: the commits to rebase could not be read.");
      }
      const text = rest.join("").trim();
      return { hash, shortHash, authorName: authorName ?? "", message: text, subject: text.split("\n")[0] };
    });
  }
  // Interactive rebase with a prepared todo list (steps oldest first): git gets the list from
  // the "sequence editor" (a copy command) and needs no editor for messages (squash keeps the
  // combined message, reword amends with a prepared message file).
  async interactiveRebase(base, steps, ignoreDate) {
    const repoRoot = await this.requireRepoRoot();
    const folder = fs2.mkdtempSync(path3.join(os.tmpdir(), "git-lineage-rebase-"));
    try {
      const messageFile = (index) => path3.join(folder, `message-${index}.txt`);
      steps.forEach((step, index) => {
        if (step.action === "reword") {
          fs2.writeFileSync(messageFile(index), `${(step.message ?? "").trim()}
`, "utf8");
        }
      });
      const todo = path3.join(folder, "todo.txt");
      fs2.writeFileSync(todo, buildTodo(steps, messageFile), "utf8");
      await this.execGit(
        ["rebase", "-i", ...ignoreDate ? ["--ignore-date"] : [], base],
        repoRoot,
        { GIT_SEQUENCE_EDITOR: `cp ${shellPath(todo)}`, GIT_EDITOR: ":" }
      );
    } finally {
      if (!await this.operationState()) {
        fs2.rmSync(folder, { recursive: true, force: true });
      }
    }
  }
  // Merge/cherry-pick/revert/rebase that stopped and waits, with its conflicted files.
  async operationState() {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      return void 0;
    }
    const { gitDir } = await this.getGitDirectories(repoRoot);
    const state = readOperationState(gitDir);
    if (!state) {
      return void 0;
    }
    return { ...state, conflicts: await this.conflictedFiles().catch(() => []) };
  }
  // Continue the waiting operation. Conflicted files without conflict markers count as resolved
  // and are staged first; files that still contain markers stop it with a message.
  async continueOperation() {
    const repoRoot = await this.requireRepoRoot();
    const state = await this.operationState();
    if (!state) {
      throw new GitError("Nothing to continue: no merge, cherry-pick, revert or rebase is in progress.");
    }
    const unresolved = state.conflicts.filter((file) => {
      try {
        return hasConflictMarkers(fs2.readFileSync(path3.join(repoRoot, file), "utf8"));
      } catch {
        return false;
      }
    });
    if (unresolved.length > 0) {
      const list = `${unresolved.slice(0, 3).join(", ")}${unresolved.length > 3 ? ", \u2026" : ""}`;
      throw new GitError(`Conflicts are not resolved yet in ${list}: remove the conflict markers first.`);
    }
    if (state.conflicts.length > 0) {
      await this.execGit(["add", "-A", "--", ...state.conflicts], repoRoot);
    }
    await this.execGit([state.kind, "--continue"], repoRoot, { GIT_EDITOR: ":" });
  }
  // Skip the current commit (rebase, cherry-pick, revert) or abort the operation.
  async skipOperation() {
    const state = await this.operationState();
    if (!state || state.kind === "merge") {
      throw new GitError("Only a rebase, cherry-pick or revert can skip a commit.");
    }
    await this.execGit([state.kind, "--skip"], await this.requireRepoRoot(), { GIT_EDITOR: ":" });
  }
  async abortOperation() {
    const state = await this.operationState();
    if (!state) {
      throw new GitError("Nothing to abort.");
    }
    await this.execGit([state.kind, "--abort"], await this.requireRepoRoot());
  }
  // Files with unresolved conflicts (after a merge, cherry-pick, revert or rebase stopped).
  async conflictedFiles() {
    const output = await this.execGit(["diff", "--name-only", "--diff-filter=U"], await this.requireRepoRoot());
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  // Name of the checked-out branch, or undefined when HEAD is detached.
  async currentBranch() {
    try {
      return (await this.execGit(["symbolic-ref", "--quiet", "--short", "HEAD"], await this.requireRepoRoot())).trim() || void 0;
    } catch {
      return void 0;
    }
  }
  // Remote-tracking ref such as "origin/feature" known locally (as of the last fetch).
  async remoteRefExists(remoteRef) {
    try {
      await this.execGit(["show-ref", "--verify", "--quiet", `refs/remotes/${remoteRef}`], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }
  async localBranchExists(name) {
    try {
      await this.execGit(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }
  // Full name check by git itself (rules for "..", "~", "^", ":", ".lock", ...).
  async isValidBranchName(name) {
    try {
      await this.execGit(["check-ref-format", "--branch", name], await this.requireRepoRoot());
      return true;
    } catch {
      return false;
    }
  }
  async requireRepoRoot() {
    const repoRoot = await this.getRepoRoot();
    if (!repoRoot) {
      throw new GitError("No Git repository is open.");
    }
    return repoRoot;
  }
  // Content of a file (path relative to repoRoot, forward slashes) at a commit; empty when
  // the file does not exist there (added or deleted in the compared commit, or a root commit).
  async fileAtRef(repoRoot, ref, filePath) {
    if (ref.startsWith("-")) {
      throw new GitError(`Invalid ref: ${ref}`);
    }
    try {
      return await this.execGit(["show", `${ref}:${filePath}`], repoRoot);
    } catch {
      return "";
    }
  }
  // Run git with a timeout; failures are mapped to a readable GitError.
  execGit(args, cwd, extraEnv = {}) {
    const timeoutMs = this.getTimeoutMs();
    return new Promise((resolve6, reject) => {
      (0, import_child_process.execFile)(
        "git",
        args,
        {
          cwd,
          maxBuffer: 50 * 1024 * 1024,
          encoding: "utf8",
          timeout: timeoutMs,
          // Nobody can answer a password prompt here (no terminal): fail at once instead of
          // waiting for the timeout. Credential helpers (e.g. Git Credential Manager) still work.
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extraEnv }
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(toGitError(error, stderr, args, timeoutMs));
            return;
          }
          resolve6(stdout);
        }
      );
    });
  }
  // Timeout from the host, with a sane lower bound of 5 seconds.
  getTimeoutMs() {
    return Math.max(5e3, this.options.timeoutMs());
  }
  // Top-level folder of the repository containing dir (also for a worktree), or undefined.
  static async findRepoRoot(dir, timeoutMs = 3e4) {
    return new Promise((resolve6) => {
      (0, import_child_process.execFile)(
        "git",
        ["rev-parse", "--show-toplevel"],
        { cwd: dir, encoding: "utf8", timeout: timeoutMs },
        (error, stdout) => resolve6(error ? void 0 : path3.resolve(stdout.trim()))
      );
    });
  }
};

// src/git/refNames.ts
var localNameForRemote = (remoteRef) => {
  const slash = remoteRef.indexOf("/");
  if (slash <= 0 || slash === remoteRef.length - 1) {
    return void 0;
  }
  return remoteRef.slice(slash + 1);
};
var branchNameProblem = (name) => {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Enter a branch name.";
  }
  if (trimmed.startsWith("-")) {
    return 'A branch name must not start with "-".';
  }
  if (/\s/.test(trimmed)) {
    return "A branch name must not contain spaces.";
  }
  return void 0;
};

// src/utils/osLocale.ts
var import_child_process2 = require("child_process");
var normalizeLocale = (value) => {
  const trimmed = value?.trim().split(".")[0]?.split("@")[0]?.replace(/_/g, "-");
  if (!trimmed || trimmed === "C" || trimmed === "POSIX") {
    return void 0;
  }
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(trimmed)[0];
  } catch {
    return void 0;
  }
};
var run = (file, args) => new Promise((resolve6) => {
  (0, import_child_process2.execFile)(
    file,
    args,
    { timeout: 3e3, windowsHide: true },
    (error, stdout) => resolve6(error ? "" : String(stdout))
  );
});
var detect = async () => {
  if (process.platform === "win32") {
    const output = await run("reg", ["query", "HKCU\\Control Panel\\International", "/v", "LocaleName"]);
    return normalizeLocale(/LocaleName\s+REG_SZ\s+(\S+)/.exec(output)?.[1]);
  }
  if (process.platform === "darwin") {
    return normalizeLocale(await run("defaults", ["read", "-g", "AppleLocale"]));
  }
  return normalizeLocale(process.env.LC_ALL || process.env.LC_TIME || process.env.LANG);
};
var cached;
var getOsLocale = () => {
  cached ??= detect().then((locale) => locale ?? Intl.DateTimeFormat().resolvedOptions().locale);
  return cached;
};

// src/core/forms.ts
var formText = (values, id) => {
  const value = values[id];
  return typeof value === "string" ? value : "";
};
var formFlag = (values, id) => values[id] === true;

// src/core/graphController.ts
var MAX_REBASE_COMMITS = 200;
var splitRemoteRef = (remoteRef, remotes) => {
  const remote = remotes.filter((name) => remoteRef.startsWith(`${name}/`) && remoteRef.length > name.length + 1).sort((a, b) => b.length - a.length)[0];
  return remote ? { remote, branch: remoteRef.slice(remote.length + 1) } : void 0;
};
var NOTICE_KEEP_MS = 5e3;
var UNCOMMITTED_HASH = "__uncommitted__";
var OTHER_WORKTREE_PREFIX = `${UNCOMMITTED_HASH}:`;
var WORKTREE_POLL_MS = 1e4;
var WORKTREE_STATUS_CONCURRENCY = 6;
var MAX_RELOAD_COMMITS = 2e3;
var AUTO_REFRESH_DEBOUNCE_MS = 750;
var localIsoNow = () => {
  const now = /* @__PURE__ */ new Date();
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (value) => String(Math.abs(Math.trunc(value))).padStart(2, "0");
  const local = new Date(now.getTime() + offset * 6e4).toISOString().slice(0, 19);
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
};
var GraphController = class {
  constructor(host, gitService) {
    this.host = host;
    this.gitService = gitService;
    this.loadedCommits = [];
    this.selectedBranch = "__all__";
    this.selectedSortMode = "date";
    this.branchOptions = [{ value: "__all__", label: "Show All", type: "all" }];
    // Repositories offered in the repo selector and the currently shown one.
    this.repositories = [];
    // Set when the repo changed while the webview was hidden.
    this.autoRefreshPending = false;
    // Stashes of the repository (chips on the commit each one was made on).
    this.stashes = [];
    // Upstream and ahead/behind of the local branches (chip badge "↑2 ↓1").
    this.tracking = /* @__PURE__ */ new Map();
    // OS regional format (e.g. de-DE) for local/relative dates; read once before the first payload.
    this.dateLocale = "";
    // Working tree changes and HEAD, for the "Uncommitted Changes" row on top.
    this.workingTreeChanges = [];
    // Worktrees of the shown repository (only filled when there is more than the main one).
    this.worktrees = [];
    // Forms open in the webview, by id: how to check the values and whom to hand them to.
    this.openForms = /* @__PURE__ */ new Map();
    this.nextFormId = 1;
    this.showRemoteBranches = host.config("showRemoteBranches", true);
  }
  // Entry point for every webview message; failures end up in the webview's status line.
  receive(message) {
    return this.runSafely(() => this.handleMessage(message));
  }
  // Settings changed: re-create the watcher; a new date format redraws the list.
  onConfigurationChanged(change) {
    this.watchedRepoRoot = void 0;
    void this.updateWatchers(this.repoRoot);
    if (change.dateFormat) {
      void this.runSafely(() => this.handleAutoRefresh("Date format changed."));
    }
  }
  // The webview became visible again: catch up on changes made while it was hidden.
  onVisible() {
    if (this.autoRefreshPending) {
      this.autoRefreshPending = false;
      void this.runSafely(() => this.handleAutoRefresh());
    }
  }
  // The webview was closed: stop watching (a later "ready" starts again).
  onClosed() {
    this.disposeWatchers();
    this.openForms.forEach((form) => form.resolve(void 0));
    this.openForms.clear();
    this.openRebase = void 0;
  }
  // Dispatch one webview message to its handler.
  async handleMessage(message) {
    switch (message.type) {
      case "ready":
        await this.reload("init", void 0);
        return;
      case "refresh":
        await this.reload("commits", "Refreshed.");
        return;
      case "updateFilters":
        this.showRemoteBranches = message.payload.showRemoteBranches;
        this.selectedBranch = message.payload.selectedBranch || "__all__";
        this.selectedSortMode = "date";
        this.loadedCommits = [];
        await this.reload("commits", "Filters applied.");
        return;
      case "selectRepo":
        this.gitService.setSelectedRepoRoot(message.payload.repoRoot);
        await this.gitService.setSelectedWorktree(void 0);
        this.selectedBranch = "__all__";
        this.loadedCommits = [];
        await this.reload("commits", "Repository switched.");
        return;
      case "loadMore":
        await this.handleLoadMore(message.payload?.cursor);
        return;
      case "selectCommit":
        await this.handleSelectCommit(message.payload.hash);
        return;
      case "openDiff":
        await this.handleOpenDiff(message.payload.hash, message.payload.path);
        return;
      case "openFile":
        await this.handleOpenFile(message.payload.hash, message.payload.path);
        return;
      case "checkoutBranch":
        await this.handleCheckoutBranch(message.payload.name);
        return;
      case "checkoutRemoteBranch":
        await this.handleCheckoutRemoteBranch(message.payload.remoteRef);
        return;
      case "checkoutDetached":
        await this.handleCheckoutDetached(message.payload.target);
        return;
      case "createBranch":
        await this.handleCreateBranch(message.payload.hash);
        return;
      case "commitAction":
        await this.handleCommitAction(message.payload.action, message.payload.hash);
        return;
      case "selectWorktree":
        await this.switchWorktree(message.payload.path);
        return;
      case "worktreeAction":
        await this.handleWorktreeAction(message.payload.action, message.payload.path);
        return;
      case "tagAction":
        await this.handleTagAction(message.payload.action, message.payload.name);
        return;
      case "stashAction":
        await this.handleStashAction(message.payload.action, message.payload.selector, message.payload.hash);
        return;
      case "branchAction":
        if (message.payload.action === "delete") {
          await this.handleDeleteBranch(message.payload.name);
        } else {
          await this.handleDeleteRemoteBranch(message.payload.name);
        }
        return;
      case "tagInfo":
        await this.handleTagInfo(message.payload.requestId, message.payload.name);
        return;
      case "showInTerminal":
        await this.handleShowInTerminal(message.payload.hash);
        return;
      case "copyToClipboard":
        await this.host.copy(message.payload.text);
        await this.postStatus(`${message.payload.label} copied to clipboard.`);
        return;
      case "formSubmit":
        await this.handleFormSubmit(message.payload.id, message.payload.values ?? {});
        return;
      case "formCancel":
        this.closeForm(message.payload.id, void 0);
        return;
      case "rebaseSubmit":
        await this.handleRebaseSubmit(message.payload.id, message.payload.steps, message.payload.ignoreDate);
        return;
      case "rebaseCancel":
        if (this.openRebase?.id === message.payload.id) {
          this.openRebase = void 0;
        }
        return;
      case "operationAction":
        await this.handleOperationAction(message.payload.action);
        return;
      case "openConflict": {
        const state = await this.gitService.operationState();
        if (this.repoRoot && state?.conflicts.includes(message.payload.path)) {
          await this.host.openFile(this.repoRoot, message.payload.path, void 0);
        }
        return;
      }
    }
  }
  // --- Context menu actions ---
  async handleCheckoutBranch(name) {
    try {
      await this.gitService.checkoutBranch(name);
    } catch (error) {
      throw this.explainWorktreeConflict(error, name);
    }
    await this.afterAction(`Checked out ${name}.`);
  }
  // git refuses a branch that is checked out in another worktree; say where and what to do.
  explainWorktreeConflict(error, branch) {
    const message = error instanceof Error ? error.message : "";
    if (!/already (used by worktree|checked out)/i.test(message)) {
      return error;
    }
    const owner = this.worktrees.find((worktree) => worktree.branch === branch);
    return new GitError(
      `${branch} is checked out in worktree ${owner?.name ?? "(another folder)"}. Switch to that worktree instead (Worktree selector or context menu).`
    );
  }
  // Remote branch: use the local branch of the same name, create it (tracking) if missing.
  // When the local branch lags behind the remote branch, a form offers to fast-forward it
  // or to create a branch with another name at the remote branch instead.
  async handleCheckoutRemoteBranch(remoteRef) {
    const localName = localNameForRemote(remoteRef);
    if (!localName) {
      throw new GitError(`${remoteRef} is not a remote branch.`);
    }
    if (!await this.gitService.localBranchExists(localName)) {
      await this.gitService.checkoutTrackingBranch(localName, remoteRef);
      await this.afterAction(`Created ${localName} tracking ${remoteRef} and checked it out.`);
      return;
    }
    const behind = await this.gitService.countNotIn(remoteRef, localName);
    if (behind === 0) {
      await this.checkoutExistingBranch(localName, `Checked out existing local branch ${localName}.`);
      return;
    }
    const ahead = await this.gitService.countNotIn(localName, remoteRef);
    const values = await this.showForm(
      this.existingBranchForm(localName, remoteRef, ahead, behind),
      async (entered) => formText(entered, "mode") === "new" ? this.newBranchNameProblem(formText(entered, "name")) : void 0
    );
    if (!values) {
      return;
    }
    const mode = formText(values, "mode");
    if (mode === "new") {
      const branch = formText(values, "name").trim();
      await this.gitService.checkoutTrackingBranch(branch, remoteRef);
      await this.afterAction(`Created ${branch} tracking ${remoteRef} and checked it out.`);
    } else if (mode === "fastForward" && ahead === 0) {
      await this.checkoutExistingBranch(localName, void 0);
      await this.gitService.fastForward(remoteRef);
      await this.afterAction(`Checked out ${localName} and fast-forwarded it to ${remoteRef}.`);
    } else {
      await this.checkoutExistingBranch(localName, `Checked out existing local branch ${localName} (${behind} behind ${remoteRef}).`);
    }
  }
  existingBranchForm(localName, remoteRef, ahead, behind) {
    const commits = (count) => `${count} commit${count === 1 ? "" : "s"}`;
    const options = [{ value: "local", label: `Check out local ${localName} as it is` }];
    if (ahead === 0) {
      options.unshift({ value: "fastForward", label: `Check out ${localName} and fast-forward it to ${remoteRef}` });
    }
    options.push({ value: "new", label: `Create a new branch at ${remoteRef}` });
    return {
      title: `A local branch ${localName} already exists.`,
      detail: ahead === 0 ? `It is ${commits(behind)} behind ${remoteRef} (as of the last fetch).` : `It has diverged from ${remoteRef} (as of the last fetch): ${commits(ahead)} only local, ${commits(behind)} only on ${remoteRef}. Merge or rebase after the checkout to bring them together.`,
      submitLabel: "Check Out",
      fields: [
        {
          kind: "select",
          id: "mode",
          label: "Action",
          value: options[0].value,
          options,
          info: "Fast-forward moves the local branch to the remote branch without a merge commit (git merge --ff-only); nothing is lost because the local branch has no commits of its own."
        },
        {
          kind: "text",
          id: "name",
          label: "Name",
          required: true,
          placeholder: "e.g. feature/login",
          showWhen: { field: "mode", value: "new" },
          info: `Name of the new local branch; it tracks ${remoteRef}.`
        }
      ]
    };
  }
  // Checks out an existing local branch; explains a branch checked out in another worktree.
  async checkoutExistingBranch(name, notice) {
    try {
      await this.gitService.checkoutBranch(name);
    } catch (error) {
      throw this.explainWorktreeConflict(error, name);
    }
    if (notice) {
      await this.afterAction(notice);
    }
  }
  // Problem with the name for a new local branch (shown at the field), undefined if it is fine.
  async newBranchNameProblem(value) {
    const problem = branchNameProblem(value);
    if (problem) {
      return { field: "name", message: problem };
    }
    if (!await this.gitService.isValidBranchName(value.trim())) {
      return { field: "name", message: "Git does not accept this branch name." };
    }
    if (await this.gitService.localBranchExists(value.trim())) {
      return { field: "name", message: "A branch with this name already exists." };
    }
    return void 0;
  }
  // Detached HEAD is easy to lose work in, so it needs a confirmation.
  async handleCheckoutDetached(target) {
    const label = /^[0-9a-f]{40}$/i.test(target) ? target.slice(0, 8) : target;
    if (this.host.config("confirmDetachedCheckout", true)) {
      const values = await this.showForm(
        {
          title: `Check out ${label}? HEAD will be detached (not on a branch).`,
          detail: "New commits made there belong to no branch until you create one.",
          submitLabel: "Check Out",
          fields: [
            {
              kind: "checkbox",
              id: "always",
              label: "Always accept",
              info: "Do not ask again (setting gitLineage.confirmDetachedCheckout)."
            }
          ]
        },
        async () => void 0
      );
      if (!values) {
        return;
      }
      if (formFlag(values, "always")) {
        await this.host.updateConfig("confirmDetachedCheckout", false);
      }
    }
    await this.gitService.checkoutDetached(target);
    await this.afterAction(`Checked out ${label} (detached HEAD).`);
  }
  async handleCreateBranch(hash) {
    const values = await this.showForm(
      {
        title: `Create branch at commit ${hash.slice(0, 8)}`,
        submitLabel: "Create Branch",
        fields: [
          {
            kind: "text",
            id: "name",
            label: "Name",
            required: true,
            placeholder: "e.g. feature/login",
            info: 'Name of the new local branch; slashes group branches (feature/\u2026). No spaces, "..", "~", "^", ":" or "\\".'
          },
          {
            kind: "checkbox",
            id: "checkout",
            label: "Check out the new branch",
            info: "Switch to the new branch right away (git switch). Unchecked, the branch is only created and you stay where you are."
          }
        ]
      },
      async (entered) => this.newBranchNameProblem(formText(entered, "name"))
    );
    if (!values) {
      return;
    }
    const branch = formText(values, "name").trim();
    const checkout = formFlag(values, "checkout");
    await this.gitService.createBranch(branch, hash, checkout);
    await this.afterAction(checkout ? `Created and checked out ${branch}.` : `Created branch ${branch}.`);
  }
  // Repository-changing commit actions; each asks first. The hash must be a full or short hex id.
  async handleCommitAction(action, hash) {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
      return;
    }
    const short = hash.slice(0, 8);
    switch (action) {
      case "addTag":
        await this.handleAddTag(hash);
        return;
      case "addWorktree":
        await this.handleAddWorktree(hash);
        return;
      case "cherryPick": {
        const isMerge = await this.gitService.parentCount(hash) > 1;
        const values = await this.showForm(
          {
            title: `Cherry-pick commit ${short} onto ${await this.headLabel()}?`,
            detail: isMerge ? "This is a merge commit; its changes relative to the first parent are applied." : void 0,
            submitLabel: "Cherry-Pick",
            fields: [
              {
                kind: "checkbox",
                id: "recordOrigin",
                label: "Record origin",
                info: 'Add "(cherry picked from commit \u2026)" to the commit message (git cherry-pick -x).'
              },
              {
                kind: "checkbox",
                id: "noCommit",
                label: "No commit",
                info: "Only apply the changes to the index and working tree; you commit yourself (--no-commit)."
              }
            ]
          },
          async () => void 0
        );
        if (values) {
          const noCommit = formFlag(values, "noCommit");
          const options = { recordOrigin: formFlag(values, "recordOrigin"), noCommit };
          await this.runWithConflicts(
            "cherry-pick",
            () => this.gitService.cherryPick(hash, isMerge, options),
            noCommit ? `Applied the changes of ${short} (not committed).` : `Cherry-picked ${short}.`
          );
        }
        return;
      }
      case "revert": {
        const isMerge = await this.gitService.parentCount(hash) > 1;
        const values = await this.showForm(
          {
            title: `Revert commit ${short}?`,
            detail: `A new commit on ${await this.headLabel()} undoes its changes.` + (isMerge ? " It is a merge commit: reverted relative to its first parent." : ""),
            submitLabel: "Revert",
            fields: []
          },
          async () => void 0
        );
        if (values) {
          await this.runWithConflicts("revert", () => this.gitService.revert(hash, isMerge), `Reverted ${short}.`);
        }
        return;
      }
      case "merge": {
        const values = await this.showForm(
          {
            title: `Merge commit ${short} into ${await this.headLabel()}?`,
            submitLabel: "Merge",
            fields: [
              {
                kind: "checkbox",
                id: "noFastForward",
                label: "Create a merge commit even if fast-forward is possible",
                info: "Without this, git only moves the branch forward when it has no own commits (fast-forward). Checked, a merge commit always records the merge (--no-ff)."
              },
              {
                kind: "checkbox",
                id: "squash",
                label: "Squash commits",
                info: "Put all changes into the index as one set, without a merge commit (--squash); you commit yourself."
              },
              {
                kind: "checkbox",
                id: "noCommit",
                label: "No commit",
                info: "Merge, but stop before the merge commit (--no-commit)."
              }
            ]
          },
          async () => void 0
        );
        if (values) {
          const options = {
            noFastForward: formFlag(values, "noFastForward"),
            squash: formFlag(values, "squash"),
            noCommit: formFlag(values, "noCommit")
          };
          const done = options.squash || options.noCommit ? `Merged ${short} (not committed).` : `Merged ${short}.`;
          await this.runWithConflicts("merge", () => this.gitService.merge(hash, options), done);
        }
        return;
      }
      case "rebase":
        await this.handleRebase(hash);
        return;
      case "rebaseInteractive": {
        const branch = await this.gitService.currentBranch();
        if (!branch) {
          throw new GitError("HEAD is detached: check out a branch to rebase it.");
        }
        await this.showRebaseView(branch, hash, false);
        return;
      }
      case "reset":
        await this.handleReset(hash);
        return;
    }
  }
  // --- Worktrees ---
  // Show another worktree of the repository (all commands then run there).
  async switchWorktree(folder) {
    const target = (await this.gitService.listWorktrees()).find((worktree) => samePath(worktree.path, folder));
    if (!target || target.isBare || target.isPrunable) {
      throw new GitError(`${folder} is not a usable worktree of this repository.`);
    }
    await this.gitService.setSelectedWorktree(target.path);
    this.loadedCommits = [];
    await this.reload("commits", `Switched to worktree ${worktreeName(target.path)}.`);
  }
  async handleWorktreeAction(action, folder) {
    const target = (await this.gitService.listWorktrees()).find((worktree) => samePath(worktree.path, folder));
    if (!target) {
      throw new GitError(`${folder} is not a worktree of this repository.`);
    }
    const name = worktreeName(target.path);
    switch (action) {
      case "switch":
        await this.switchWorktree(target.path);
        return;
      case "openWindow":
        await this.host.openFolder(target.path);
        return;
      case "copyPath":
        await this.host.copy(target.path);
        await this.postStatus(`Path of worktree ${name} copied to clipboard.`);
        return;
      case "remove":
        await this.handleRemoveWorktree(target);
        return;
    }
  }
  async handleRemoveWorktree(target) {
    const name = worktreeName(target.path);
    if (target.isMain) {
      throw new GitError("The main worktree cannot be removed.");
    }
    if (samePath(target.path, this.repositoryRoot)) {
      throw new GitError(`Worktree ${name} is the folder this graph was opened for; it cannot be removed here.`);
    }
    const changes = await this.gitService.getWorkingTreeChangesAt(target.path).catch(() => []);
    const detachedAt = target.head ? ` (detached at ${target.head.slice(0, 7)})` : "";
    const branchText = target.branch ? `Branch ${target.branch} is kept.` : `No branch is checked out there${detachedAt}; the commit stays in the repository.`;
    const values = await this.showForm(
      {
        title: `Remove worktree ${name}?`,
        detail: changes.length > 0 ? `${target.path} - ${changes.length} uncommitted change(s) there are lost. ${branchText}` : `${target.path} - the folder is deleted. ${branchText}`,
        submitLabel: changes.length > 0 ? "Remove and Discard Changes" : "Remove",
        fields: []
      },
      async () => void 0
    );
    if (!values) {
      return;
    }
    await this.gitService.removeWorktree(target.path, changes.length > 0);
    if (samePath(target.path, this.repoRoot)) {
      await this.gitService.setSelectedWorktree(void 0);
      this.loadedCommits = [];
    }
    await this.afterAction(`Removed worktree ${name}.`);
  }
  // New worktree at a commit: one form with branch (empty = detached), folder (empty = next to
  // the repository) and whether to show it right away.
  async handleAddWorktree(hash) {
    const short = hash.slice(0, 8);
    const main = (await this.gitService.listWorktrees()).find((worktree) => worktree.isMain);
    const base = main?.path ?? this.repoRoot;
    if (!base) {
      return;
    }
    const folderFor = (entered) => {
      const typed = formText(entered, "folder").trim();
      return typed ? path4.resolve(typed) : defaultWorktreePath(base, formText(entered, "branch").trim() || short);
    };
    const values = await this.showForm(
      {
        title: `Add worktree at commit ${short}`,
        submitLabel: "Add Worktree",
        fields: [
          {
            kind: "text",
            id: "branch",
            label: "New branch",
            placeholder: "Empty: detached HEAD",
            info: "A worktree is a second working folder of this repository with its own checkout. Name a new branch for it, or leave it empty to check out the commit without a branch."
          },
          {
            kind: "text",
            id: "folder",
            label: "Folder",
            placeholder: `Empty: ${defaultWorktreePath(base, "<branch>")}`,
            info: "Full path of the new folder; it must not exist yet or be empty. Empty: a folder named after the branch next to the repository."
          },
          {
            kind: "checkbox",
            id: "switch",
            label: "Show the new worktree",
            value: true,
            info: "Switch the graph to the new worktree right away (commands then run there)."
          }
        ]
      },
      async (entered) => {
        const branch2 = formText(entered, "branch").trim();
        if (branch2) {
          const problem = branchNameProblem(branch2);
          if (problem) {
            return { field: "branch", message: problem };
          }
          if (!await this.gitService.isValidBranchName(branch2)) {
            return { field: "branch", message: "Git does not accept this branch name." };
          }
          if (await this.gitService.localBranchExists(branch2)) {
            return { field: "branch", message: "A branch with this name already exists." };
          }
        }
        const typed = formText(entered, "folder").trim();
        if (typed && !path4.isAbsolute(typed)) {
          return { field: "folder", message: "Please enter a full path." };
        }
        const folder2 = folderFor(entered);
        try {
          if (fs3.existsSync(folder2) && fs3.readdirSync(folder2).length > 0) {
            return { field: "folder", message: `${folder2} exists and is not empty.` };
          }
        } catch {
          return { field: "folder", message: `${folder2} cannot be used as a folder.` };
        }
        return void 0;
      }
    );
    if (!values) {
      return;
    }
    const branch = formText(values, "branch").trim() || void 0;
    const folder = folderFor(values);
    await this.gitService.addWorktree(folder, hash, branch);
    if (formFlag(values, "switch")) {
      await this.gitService.setSelectedWorktree(folder);
      this.loadedCommits = [];
    }
    await this.afterAction(`Added worktree ${worktreeName(folder)}.`);
  }
  // Stash chip actions. The selector must still name the stash the chip showed (numbers shift
  // when stashes are added or dropped); apply/pop can restore the staged state, drop asks first.
  async handleStashAction(action, selector, hash) {
    const stash = (await this.gitService.getStashes()).find((entry) => entry.selector === selector);
    if (!stash || stash.hash !== hash) {
      throw new GitError(`${selector} has changed in the meantime. Refresh and try again.`);
    }
    if (action === "drop") {
      const confirmed = await this.showForm(
        {
          title: `Drop ${selector}?`,
          detail: `"${stash.message}" is deleted. This cannot be undone from here.`,
          submitLabel: "Drop Stash",
          fields: []
        },
        async () => void 0
      );
      if (confirmed) {
        await this.gitService.dropStash(selector);
        await this.afterAction(`Dropped ${selector}.`);
      }
      return;
    }
    const pop = action === "pop";
    const values = await this.showForm(
      {
        title: `${pop ? "Pop" : "Apply"} ${selector}?`,
        detail: pop ? `"${stash.message}" is applied to the working tree and then removed from the stash list (it stays if there are conflicts).` : `"${stash.message}" is applied to the working tree; the stash stays in the list.`,
        submitLabel: pop ? "Pop Stash" : "Apply Stash",
        fields: [
          {
            kind: "checkbox",
            id: "index",
            label: "Restore staged changes as staged",
            info: "Without this, everything comes back as unstaged changes (git stash --index)."
          }
        ]
      },
      async () => void 0
    );
    if (!values) {
      return;
    }
    try {
      await this.gitService.applyStash(selector, pop, formFlag(values, "index"));
    } catch (error) {
      const conflicts = await this.gitService.conflictedFiles().catch(() => []);
      if (conflicts.length > 0) {
        await this.afterAction(
          `${selector} applied with conflicts in ${conflicts.join(", ")}. Resolve them${pop ? "; the stash was kept" : ""}.`
        );
        return;
      }
      throw error;
    }
    await this.afterAction(pop ? `Popped ${selector}.` : `Applied ${selector}.`);
  }
  // Delete a local branch. Not the checked-out one, not one checked out in another worktree.
  // Not merged: only with an extra confirmation (its commits would only be reachable by hash).
  // Its upstream on the remote is checked live and can be deleted in the same step.
  async handleDeleteBranch(name) {
    if (!name || name.startsWith("-") || !await this.gitService.isValidBranchName(name) || !await this.gitService.localBranchExists(name)) {
      throw new GitError(`Branch ${name} was not found.`);
    }
    const current = await this.gitService.currentBranch();
    if (name === current) {
      throw new GitError(`${name} is checked out. Check out another branch first.`);
    }
    const owner = this.worktrees.find((worktree) => worktree.branch === name);
    if (owner) {
      throw new GitError(`${name} is checked out in worktree ${owner.name}. Remove or switch that worktree first.`);
    }
    const ref = `refs/heads/${name}`;
    const upstream = await this.gitService.branchUpstream(name);
    const mergedHead = await this.gitService.isMergedInto(ref, "HEAD");
    const mergedUpstream = !!upstream && await this.gitService.isMergedInto(ref, `refs/remotes/${upstream}`);
    const target = current ?? "HEAD";
    const fields = [];
    const details = [];
    if (!mergedHead) {
      const count = await this.gitService.countNotIn(ref, "HEAD");
      const commits = count === 1 ? "1 commit" : `${count} commits`;
      details.push(
        mergedUpstream ? `Not merged into ${target}; ${count === 1 ? "its commit is" : `its ${count} commits are`} still on ${upstream}.` : `Not merged into ${target}: ${commits} would only be reachable by hash.`
      );
      fields.push({
        kind: "checkbox",
        id: "force",
        label: `Delete although not merged into ${target}`,
        info: "Deletes the branch anyway (git branch -D). Its commits stay in the repository for a while and can be found again via the reflog or their hash. Needed when the commits are on no other branch, also when the upstream is deleted too."
      });
    }
    const remotes = await this.gitService.remotes();
    const split = upstream ? splitRemoteRef(upstream, remotes) : void 0;
    let remoteTarget;
    if (split) {
      const state = await this.gitService.remoteBranchCommit(split.remote, split.branch).then(
        (commit) => commit ? "present" : "absent",
        () => "unreachable"
      );
      if (state === "absent") {
        details.push(`${upstream} no longer exists on ${split.remote}.`);
      } else {
        remoteTarget = split;
        fields.push({
          kind: "checkbox",
          id: "remote",
          label: `Also delete ${upstream} on ${split.remote}`,
          info: "Deletes the branch on the server as well (git push --delete), for everyone who uses it."
        });
        if (state === "unreachable") {
          details.push(`${split.remote} could not be reached to check ${upstream}.`);
        }
      }
    }
    const values = await this.showForm(
      {
        title: `Delete branch ${name}?`,
        detail: details.join(" ") || void 0,
        submitLabel: "Delete Branch",
        fields
      },
      async (entered) => !mergedHead && !formFlag(entered, "force") && (!mergedUpstream || !!remoteTarget && formFlag(entered, "remote")) ? { field: "force", message: `The branch is not merged into ${target}. Confirm to delete it anyway.` } : void 0
    );
    if (!values) {
      return;
    }
    if (remoteTarget && formFlag(values, "remote")) {
      await this.postStatus(`Deleting ${upstream} on ${remoteTarget.remote}\u2026`);
      await this.gitService.deleteRemoteBranch(remoteTarget.remote, remoteTarget.branch);
    }
    await this.gitService.deleteBranch(name, !mergedHead);
    await this.afterAction(
      remoteTarget && formFlag(values, "remote") ? `Deleted branch ${name} and ${upstream}.` : `Deleted branch ${name}.`
    );
  }
  // Delete a branch on its remote ("origin/feature"). If it is already gone there, only the
  // stale local remote-tracking ref is removed.
  async handleDeleteRemoteBranch(remoteRef) {
    const split = splitRemoteRef(remoteRef, await this.gitService.remotes());
    if (!split || remoteRef.startsWith("-") || !await this.gitService.remoteRefExists(remoteRef)) {
      throw new GitError(`${remoteRef} is not a remote branch.`);
    }
    const state = await this.gitService.remoteBranchCommit(split.remote, split.branch).then(
      (commit) => commit ? "present" : "absent",
      () => "unreachable"
    );
    if (state === "absent") {
      const confirmed = await this.showForm(
        {
          title: `Remove ${remoteRef}?`,
          detail: `The branch no longer exists on ${split.remote}. Only the outdated local reference is removed.`,
          submitLabel: "Remove Reference",
          fields: []
        },
        async () => void 0
      );
      if (confirmed) {
        await this.gitService.deleteRemoteTrackingRef(remoteRef);
        await this.afterAction(`Removed outdated reference ${remoteRef}.`);
      }
      return;
    }
    const local = await this.gitService.localBranchExists(split.branch) ? ` Your local branch ${split.branch} stays.` : "";
    const values = await this.showForm(
      {
        title: `Delete ${split.branch} on ${split.remote}?`,
        detail: `Deletes the branch on the server for everyone (git push --delete).${local}` + (state === "unreachable" ? ` ${split.remote} could not be reached to check it first.` : ""),
        submitLabel: "Delete Remote Branch",
        fields: []
      },
      async () => void 0
    );
    if (!values) {
      return;
    }
    await this.postStatus(`Deleting ${split.branch} on ${split.remote}\u2026`);
    await this.gitService.deleteRemoteBranch(split.remote, split.branch);
    await this.afterAction(`Deleted ${remoteRef}.`);
  }
  // Tag named by the webview: checked by git first (no option-like names), then its details.
  async validTagDetails(name) {
    const details = name && !name.startsWith("-") && await this.gitService.isValidTagName(name) ? await this.gitService.tagDetails(name) : void 0;
    if (!details) {
      throw new GitError(`Tag ${name} was not found.`);
    }
    return details;
  }
  // Live state of a tag on a remote compared with the local tag. Asked when needed and never
  // cached: someone else may have pushed or deleted the tag in the meantime.
  async remoteTagState(remote, details) {
    try {
      const remoteCommit = await this.gitService.remoteTagCommit(remote, details.name);
      if (!remoteCommit) {
        return { state: "absent" };
      }
      return remoteCommit === details.commit ? { state: "same" } : { state: "different", remoteCommit };
    } catch {
      return { state: "unreachable" };
    }
  }
  // Info line of a tag's context menu: the local details at once, then the state on the remote
  // in a second message (the network check can take a moment). Failures stay in the menu.
  async handleTagInfo(requestId, name) {
    const details = await this.validTagDetails(name).catch(() => void 0);
    if (!details) {
      await this.host.post({ type: "tagInfo", payload: { requestId, name, missing: true } });
      return;
    }
    const remote = await this.gitService.defaultRemote();
    const local = {
      requestId,
      name,
      annotated: details.annotated,
      tagger: details.tagger,
      date: details.date,
      message: details.message,
      remote
    };
    await this.host.post({ type: "tagInfo", payload: { ...local, remoteState: remote ? "checking" : "noRemote" } });
    if (!remote) {
      return;
    }
    const { state, remoteCommit } = await this.remoteTagState(remote, details);
    await this.host.post({
      type: "tagInfo",
      payload: { ...local, remoteState: state, remoteCommit: remoteCommit?.slice(0, 7) }
    });
  }
  // Tag chip actions. The name comes from the webview, so it is checked by git first.
  // Push and delete check the remote again right before they run.
  async handleTagAction(action, name) {
    const details = await this.validTagDetails(name);
    if (action === "push") {
      const remote = await this.chooseRemote(`Push tag ${name}`, "Push");
      if (!remote) {
        return;
      }
      const { state, remoteCommit } = await this.remoteTagState(remote, details);
      if (state === "same") {
        await this.postStatus(`Tag ${name} is already on ${remote}.`);
        return;
      }
      if (state === "different") {
        throw new GitError(
          `${remote} already has a tag ${name} on another commit (${remoteCommit.slice(0, 7)}). Not pushed.`
        );
      }
      await this.pushTag(remote, name);
      return;
    }
    const remotes = await this.gitService.remotes();
    const fields = [];
    let detail;
    if (remotes.length === 1) {
      const [remote] = remotes;
      const { state, remoteCommit } = await this.remoteTagState(remote, details);
      if (state === "absent") {
        detail = `The tag is not on ${remote}: only the local tag is deleted.`;
      } else {
        fields.push({
          kind: "checkbox",
          id: "remote",
          label: `Also delete on ${remote}`,
          info: "Removes the tag from the remote as well (git push --delete). Copies others already fetched stay in their repositories."
        });
        detail = state === "same" ? `The tag is also on ${remote}.` : state === "different" ? `${remote} has this tag on another commit (${remoteCommit.slice(0, 7)}).` : `${remote} could not be reached to check the tag.`;
      }
    } else if (remotes.length > 1) {
      fields.push({
        kind: "checkbox",
        id: "remote",
        label: "Also delete on a remote",
        info: "Removes the tag from the remote as well (git push --delete). Copies others already fetched stay in their repositories."
      });
    }
    if (remotes.length > 1) {
      fields.push({
        kind: "select",
        id: "remoteName",
        label: "Remote",
        value: remotes[0],
        options: remotes.map((remote) => ({ value: remote, label: remote })),
        showWhen: { field: "remote", value: true },
        info: "Remote the tag is deleted on."
      });
    }
    const values = await this.showForm(
      { title: `Delete tag ${name}?`, detail, submitLabel: "Delete Tag", fields },
      async (entered) => formFlag(entered, "remote") && remotes.length > 1 && !remotes.includes(formText(entered, "remoteName")) ? { field: "remoteName", message: "Please choose a remote." } : void 0
    );
    if (!values) {
      return;
    }
    if (formFlag(values, "remote") && fields.some((field) => field.id === "remote")) {
      const remote = remotes.length === 1 ? remotes[0] : formText(values, "remoteName");
      await this.gitService.deleteRemoteTag(remote, name);
    }
    await this.gitService.deleteTag(name);
    await this.afterAction(`Deleted tag ${name}.`);
  }
  // The only remote, or the one picked in a form; undefined = cancel.
  async chooseRemote(title, submitLabel) {
    const remotes = await this.gitService.remotes();
    if (remotes.length === 0) {
      throw new GitError("This repository has no remote.");
    }
    if (remotes.length === 1) {
      return remotes[0];
    }
    const values = await this.showForm(
      {
        title,
        submitLabel,
        fields: [{ kind: "select", id: "remote", label: "Remote", value: remotes[0], options: remotes.map((remote) => ({ value: remote, label: remote })) }]
      },
      async (entered) => remotes.includes(formText(entered, "remote")) ? void 0 : { field: "remote", message: "Please choose a remote." }
    );
    return values ? formText(values, "remote") : void 0;
  }
  async pushTag(remote, name) {
    await this.postStatus(`Pushing tag ${name} to ${remote}\u2026`);
    await this.gitService.pushTag(remote, name);
    await this.afterAction(`Pushed tag ${name} to ${remote}.`);
  }
  // Add tag: one form with name, type (annotated/lightweight), message and "push to remote".
  async handleAddTag(hash) {
    const short = hash.slice(0, 8);
    const remotes = await this.gitService.remotes();
    const spec = {
      title: `Add tag to commit ${short}`,
      submitLabel: "Add Tag",
      fields: [
        {
          kind: "text",
          id: "name",
          label: "Name",
          required: true,
          placeholder: "e.g. v1.2.0",
          info: 'Name of the tag, usually a version. No spaces, "..", "~", "^", ":" or "\\".'
        },
        {
          kind: "select",
          id: "type",
          label: "Type",
          value: "annotated",
          options: [
            { value: "annotated", label: "Annotated" },
            { value: "lightweight", label: "Lightweight" }
          ],
          info: "Annotated tags store a message, the tagger and the date. Lightweight tags are only a name for the commit."
        },
        {
          kind: "text",
          id: "message",
          label: "Message",
          placeholder: "Optional",
          showWhen: { field: "type", value: "annotated" },
          info: "Without a message the tag name is used as message."
        }
      ]
    };
    if (remotes.length > 0) {
      spec.fields.push({
        kind: "checkbox",
        id: "push",
        label: remotes.length === 1 ? `Push to ${remotes[0]}` : "Push to remote",
        info: "Push the new tag to the remote right away (uses your git credentials)."
      });
    }
    if (remotes.length > 1) {
      spec.fields.push({
        kind: "select",
        id: "remote",
        label: "Remote",
        value: remotes[0],
        options: remotes.map((remote2) => ({ value: remote2, label: remote2 })),
        showWhen: { field: "push", value: true },
        info: "Remote the tag is pushed to."
      });
    }
    const values = await this.showForm(spec, async (entered) => {
      const name = formText(entered, "name").trim();
      if (!name) {
        return { field: "name", message: "Please enter a name." };
      }
      if (/\s/.test(name)) {
        return { field: "name", message: "Tag names cannot contain spaces." };
      }
      if (!await this.gitService.isValidTagName(name)) {
        return { field: "name", message: "Git does not accept this tag name." };
      }
      if (await this.gitService.tagExists(name)) {
        return { field: "name", message: "A tag with this name already exists." };
      }
      if (formFlag(entered, "push") && remotes.length > 1 && !remotes.includes(formText(entered, "remote"))) {
        return { field: "remote", message: "Please choose a remote." };
      }
      return void 0;
    });
    if (!values) {
      return;
    }
    const tag = formText(values, "name").trim();
    const annotated = formText(values, "type") !== "lightweight";
    const message = annotated ? formText(values, "message").trim() || tag : void 0;
    const remote = formFlag(values, "push") && remotes.length > 0 ? remotes.length === 1 ? remotes[0] : formText(values, "remote") : void 0;
    await this.gitService.createTag(tag, hash, message);
    await this.afterAction(`Added tag ${tag}.`);
    if (remote) {
      await this.pushTag(remote, tag);
    }
  }
  // Rebase the current branch onto a commit: one form, optionally interactive (in a terminal,
  // the todo list is edited in the user's git editor) and with the author date set to now.
  async handleRebase(hash) {
    const short = hash.slice(0, 8);
    const branch = await this.gitService.currentBranch();
    if (!branch) {
      throw new GitError("HEAD is detached: check out a branch to rebase it.");
    }
    const values = await this.showForm(
      {
        title: `Rebase ${branch} (the current branch) onto commit ${short}?`,
        detail: "The commits of the branch are rewritten. Do not rebase commits others already have.",
        submitLabel: "Rebase",
        fields: [
          {
            kind: "checkbox",
            id: "interactive",
            label: "Interactive: choose what happens to each commit",
            info: "Opens the rebase view: reorder the commits and pick, reword, edit, squash, fixup or drop each one before the rebase starts."
          },
          {
            kind: "checkbox",
            id: "ignoreDate",
            label: "Ignore date",
            info: "Set the author date of the rewritten commits to now (git rebase --ignore-date)."
          }
        ]
      },
      async () => void 0
    );
    if (!values) {
      return;
    }
    const ignoreDate = formFlag(values, "ignoreDate");
    if (formFlag(values, "interactive")) {
      await this.showRebaseView(branch, hash, ignoreDate);
      return;
    }
    await this.runWithConflicts("rebase", () => this.gitService.rebase(hash, ignoreDate), `Rebased ${branch} onto ${short}.`);
  }
  // --- Interactive rebase (rebase view in the webview, see src/git/rebase.ts) ---
  async showRebaseView(branch, base, ignoreDate) {
    const running = await this.gitService.operationState();
    if (running) {
      throw new GitError(`A ${running.kind} is in progress: continue or abort it first.`);
    }
    const commits = await this.gitService.rebaseCommits(base, MAX_REBASE_COMMITS);
    if (commits.length === 0) {
      throw new GitError(`${branch} has no commits after ${base.slice(0, 8)}: nothing to rebase.`);
    }
    if (commits.length > MAX_REBASE_COMMITS) {
      throw new GitError(`More than ${MAX_REBASE_COMMITS} commits to rebase: use git rebase -i in a terminal.`);
    }
    const id = `rebase-${this.nextFormId++}`;
    this.openRebase = { id, branch, base, commits };
    await this.host.post({
      type: "showRebase",
      payload: {
        id,
        branch,
        base: base.slice(0, 8),
        ignoreDate,
        // Newest first, like the graph.
        commits: [...commits].reverse()
      }
    });
  }
  async handleRebaseSubmit(id, shown, ignoreDate) {
    const open = this.openRebase;
    if (!open || open.id !== id) {
      return;
    }
    const offered = new Set(open.commits.map((commit) => commit.hash));
    const valid = shown.length === offered.size && new Set(shown.map((step) => step.hash)).size === shown.length && shown.every((step) => offered.has(step.hash) && rebaseActions.includes(step.action));
    if (!valid) {
      await this.host.post({
        type: "rebaseError",
        payload: { id, message: "The list does not match the commits of the branch. Close the view and try again." }
      });
      return;
    }
    const steps = [...shown].reverse().map((step) => ({
      hash: step.hash,
      action: step.action,
      message: step.action === "reword" ? step.message : void 0
    }));
    const problem = rebaseStepsProblem(steps);
    if (problem) {
      await this.host.post({ type: "rebaseError", payload: { id, message: problem } });
      return;
    }
    this.openRebase = void 0;
    await this.host.post({ type: "rebaseClose", payload: { id } });
    try {
      await this.gitService.interactiveRebase(open.base, steps, ignoreDate);
    } catch (error) {
      if (!await this.gitService.operationState()) {
        throw error;
      }
    }
    await this.afterAction(await this.describeRebaseResult(open.branch));
  }
  // Status text after a rebase step: done, stopped for editing or stopped by conflicts.
  async describeRebaseResult(branch) {
    const state = await this.gitService.operationState();
    if (!state) {
      return `Rebased ${branch}.`;
    }
    if (state.conflicts.length > 0) {
      const files = state.conflicts.length === 1 ? "1 file" : `${state.conflicts.length} files`;
      return `Rebase stopped: conflicts in ${files}.`;
    }
    return `Rebase stopped at ${state.stoppedAt ?? "a commit"} for editing: change it, then Continue.`;
  }
  // Banner buttons: continue, skip or abort the waiting operation.
  async handleOperationAction(action) {
    const state = await this.gitService.operationState();
    if (!state) {
      await this.reload("commits", "Nothing is in progress any more.");
      return;
    }
    if (action === "abort") {
      await this.gitService.abortOperation();
      await this.afterAction(`Aborted the ${state.kind}.`);
      return;
    }
    try {
      if (action === "skip") {
        await this.gitService.skipOperation();
      } else {
        await this.gitService.continueOperation();
      }
    } catch (error) {
      const next2 = await this.gitService.operationState();
      const moved = next2 !== void 0 && next2.conflicts.length > 0 && (next2.step !== state.step || next2.stoppedAt !== state.stoppedAt);
      if (!moved) {
        await this.reload("commits", void 0, this.reloadLimit());
        throw error;
      }
    }
    if (state.kind === "rebase") {
      await this.afterAction(await this.describeRebaseResult(state.branch ?? "the branch"));
      return;
    }
    const next = await this.gitService.operationState();
    await this.afterAction(next ? `The ${state.kind} stopped again.` : `Finished the ${state.kind}.`);
  }
  // --- Forms (shown in the webview, see forms.ts) ---
  // Show a form; resolves with the values once validate accepts them, undefined on cancel.
  showForm(spec, validate) {
    const id = `form-${this.nextFormId++}`;
    return new Promise((resolve6) => {
      this.openForms.set(id, { validate, resolve: resolve6 });
      void this.host.post({ type: "showForm", payload: { id, ...spec } });
    });
  }
  // Values entered: a problem keeps the form open with a message, otherwise it closes.
  async handleFormSubmit(id, values) {
    const form = this.openForms.get(id);
    if (!form) {
      return;
    }
    const problem = await form.validate(values);
    if (problem) {
      await this.host.post({ type: "formError", payload: { id, ...problem } });
      return;
    }
    await this.host.post({ type: "formClose", payload: { id } });
    this.closeForm(id, values);
  }
  closeForm(id, values) {
    const form = this.openForms.get(id);
    this.openForms.delete(id);
    form?.resolve(values);
  }
  // Reset: the mode is chosen in the dialog; hard asks once more because files are lost.
  async handleReset(hash) {
    const short = hash.slice(0, 8);
    const target = await this.headLabel();
    const modes = ["soft", "mixed", "hard"];
    const values = await this.showForm(
      {
        title: `Reset ${target} to commit ${short}?`,
        submitLabel: "Reset",
        fields: [
          {
            kind: "select",
            id: "mode",
            label: "Mode",
            value: "mixed",
            info: "Moves the current branch to this commit. Soft keeps your staged changes, Mixed keeps the changed files but unstages them, Hard discards every uncommitted change.",
            options: [
              { value: "soft", label: "Soft - keep index and files" },
              { value: "mixed", label: "Mixed - keep files, unstage changes" },
              { value: "hard", label: "Hard - discard all uncommitted changes" }
            ]
          }
        ]
      },
      async (entered) => modes.includes(formText(entered, "mode")) ? void 0 : { field: "mode", message: "Please choose a mode." }
    );
    if (!values) {
      return;
    }
    const mode = formText(values, "mode");
    if (mode === "hard") {
      const sure = await this.showForm(
        {
          title: `Discard all uncommitted changes and reset ${target} to ${short}?`,
          detail: "Changed and staged files are overwritten. This cannot be undone.",
          submitLabel: "Reset Hard",
          fields: []
        },
        async () => void 0
      );
      if (!sure) {
        return;
      }
    }
    await this.gitService.reset(hash, mode);
    await this.afterAction(`Reset ${target} to ${short} (${mode}).`);
  }
  // Run a merge-like command. If it stops on conflicts, the state is kept (the user resolves it
  // in the editor or terminal) and the message says how to continue or abort.
  async runWithConflicts(command, run2, success) {
    try {
      await run2();
    } catch (error) {
      const conflicts = await this.gitService.conflictedFiles().catch(() => []);
      if (conflicts.length === 0) {
        throw error;
      }
      await this.afterAction(`${command} stopped with conflicts.`);
      const files = conflicts.length === 1 ? "1 file" : `${conflicts.length} files`;
      const list = `${conflicts.slice(0, 3).join(", ")}${conflicts.length > 3 ? ", \u2026" : ""}`;
      throw new GitError(
        `${command} stopped: conflicts in ${files} (${list}). Resolve them and run "git ${command} --continue", or "git ${command} --abort".`
      );
    }
    await this.afterAction(success);
  }
  // "branch main" or "detached HEAD" for dialog texts.
  async headLabel() {
    const branch = await this.gitService.currentBranch();
    return branch ? `branch ${branch}` : "detached HEAD";
  }
  // Terminal in the repository with "git show" for the commit (hash is checked to be hex).
  async handleShowInTerminal(hash) {
    if (!/^[0-9a-f]{4,40}$/i.test(hash) || !this.repoRoot) {
      return;
    }
    await this.host.openTerminal(this.repoRoot, `Git Lineage: ${hash.slice(0, 8)}`, `git show --stat ${hash}`);
  }
  // Reload after a git action (watchers would also fire, this is immediate).
  async afterAction(message) {
    this.lastNotice = { message, kind: "info", at: Date.now() };
    await this.reload("commits", message, this.reloadLimit());
  }
  // Run a handler and report any failure to the webview instead of failing silently.
  async runSafely(task) {
    try {
      await task();
    } catch (error) {
      const message = error instanceof GitError ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
      this.lastNotice = { message, kind: "error", at: Date.now() };
      await this.host.post({ type: "error", payload: { message } });
    }
  }
  // Commits per page from settings, clamped to a reasonable range.
  pageSize() {
    const value = this.host.config("pageSize", 120);
    return Math.min(Math.max(Math.round(value), 20), 1e3);
  }
  // Reload keeps roughly the amount of loaded commits.
  reloadLimit() {
    return Math.min(Math.max(this.pageSize(), this.loadedCommits.length), MAX_RELOAD_COMMITS);
  }
  // Fields every list message carries (repo, filters).
  basePayload(message) {
    return {
      message,
      repoRoot: this.repoRoot,
      repositories: this.repositories,
      branches: this.branchOptions,
      selectedBranch: this.selectedBranch,
      showRemoteBranches: this.showRemoteBranches,
      selectedSortMode: this.selectedSortMode,
      // Date column format (short | iso | local | relative), applied in the webview.
      dateFormat: this.host.config("dateFormat", "short"),
      // OS regional format; the webview itself only knows the host's UI language.
      dateLocale: this.dateLocale,
      // Stopped merge/cherry-pick/revert/rebase (banner with Continue/Skip/Abort), or null.
      operation: this.operation ?? null,
      // Repository of the repo selector (repoRoot may be one of its worktrees).
      repositoryRoot: this.repositoryRoot,
      // Worktree selector; empty when the repository has only its main worktree.
      worktrees: this.worktrees.length > 1 ? this.worktrees.map((worktree) => ({
        path: worktree.path,
        name: worktree.name,
        branch: worktree.branch,
        isCurrent: worktree.isCurrent,
        isMain: worktree.isMain,
        isPrunable: worktree.isPrunable,
        changeCount: worktree.changes.length
      })) : []
    };
  }
  // Reload repositories, branches and the first commits, then post them as init/commits.
  async reload(type, message, limit = this.pageSize()) {
    this.dateLocale = await getOsLocale();
    this.repositories = await this.gitService.getRepositories();
    this.repositoryRoot = await this.gitService.getRepositoryRoot();
    this.repoRoot = await this.gitService.getRepoRoot();
    await this.loadBranchOptions(this.repoRoot);
    const commits = this.repoRoot ? await this.gitService.getLogChunk(limit, void 0, {
      selectedBranch: this.selectedBranch,
      showRemoteBranches: this.showRemoteBranches,
      sortMode: this.selectedSortMode,
      skip: 0
    }) : [];
    this.loadedCommits = commits;
    this.operation = await this.gitService.operationState().catch(() => void 0);
    await this.loadWorkingTreeState();
    const { graphCommits, maxLanes } = buildGraphCommits(this.buildDisplayCommits());
    const text = this.repoRoot ? message ?? "Repository detected." : "No Git repository detected. Open a folder that contains a Git repository.";
    await this.host.post({
      type,
      payload: {
        ...this.basePayload(text),
        commits: graphCommits,
        nextCursor: commits.length ? commits[commits.length - 1].hash : void 0,
        hasMore: commits.length === limit,
        append: false,
        maxLanes
      }
    });
    await this.updateWatchers(this.repoRoot);
  }
  // Refresh after a repository change, keeping roughly the amount of loaded commits.
  async handleAutoRefresh(message) {
    if (!this.host.isOpen()) {
      return;
    }
    if (!this.host.isVisible()) {
      this.autoRefreshPending = true;
      return;
    }
    const notice = !message && this.lastNotice && Date.now() - this.lastNotice.at < NOTICE_KEEP_MS ? this.lastNotice : void 0;
    if (notice?.kind === "error") {
      await this.reload("commits", void 0, this.reloadLimit());
      await this.host.post({ type: "error", payload: { message: notice.message } });
      return;
    }
    await this.reload("commits", message ?? notice?.message ?? "Updated after repository change.", this.reloadLimit());
  }
  scheduleWorkingTreeCheck() {
    if (this.workingTreeTimer) {
      clearTimeout(this.workingTreeTimer);
    }
    this.workingTreeTimer = setTimeout(() => {
      this.workingTreeTimer = void 0;
      void this.runSafely(() => this.refreshWorkingTreeIfChanged());
    }, AUTO_REFRESH_DEBOUNCE_MS);
  }
  // Collapse bursts of file events into one refresh.
  scheduleAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
    }
    this.autoRefreshTimer = setTimeout(() => {
      this.autoRefreshTimer = void 0;
      void this.runSafely(() => this.handleAutoRefresh());
    }, AUTO_REFRESH_DEBOUNCE_MS);
  }
  // Watch HEAD, refs and index of the shown repository so commits, checkouts and fetches refresh the view.
  async updateWatchers(repoRoot) {
    const enabled = this.host.config("autoRefresh", true);
    const target = enabled ? repoRoot : void 0;
    if (target === this.watchedRepoRoot && (target === void 0 || this.watcher)) {
      return;
    }
    this.disposeWatchers();
    this.watchedRepoRoot = target;
    if (!target) {
      return;
    }
    try {
      const { gitDir, commonDir } = await this.gitService.getGitDirectories(target);
      this.watcher = this.host.watchRepository(
        { repoRoot: target, gitDir, commonDir },
        {
          onRepositoryChanged: () => this.scheduleAutoRefresh(),
          onWorkingTreeMaybeChanged: () => this.scheduleWorkingTreeCheck()
        }
      );
      this.worktreePollTimer = setInterval(() => {
        if (this.worktrees.length > 1) {
          this.scheduleWorkingTreeCheck();
        }
      }, WORKTREE_POLL_MS);
    } catch {
      this.disposeWatchers();
    }
  }
  disposeWatchers() {
    this.watcher?.dispose();
    this.watcher = void 0;
    if (this.worktreePollTimer) {
      clearInterval(this.worktreePollTimer);
      this.worktreePollTimer = void 0;
    }
    this.watchedRepoRoot = void 0;
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = void 0;
    }
    if (this.workingTreeTimer) {
      clearTimeout(this.workingTreeTimer);
      this.workingTreeTimer = void 0;
    }
  }
  // Short status line message in the webview footer.
  async postStatus(message) {
    await this.host.post({ type: "status", payload: { message } });
  }
  async handleLoadMore(cursor) {
    const repoRoot = await this.gitService.getRepoRoot();
    if (!repoRoot) {
      this.loadedCommits = [];
    }
    const limit = this.pageSize();
    const newCommits = repoRoot ? await this.gitService.getLogChunk(limit, cursor, {
      selectedBranch: this.selectedBranch,
      showRemoteBranches: this.showRemoteBranches,
      sortMode: this.selectedSortMode,
      skip: this.loadedCommits.length
    }) : [];
    if (newCommits.length > 0) {
      this.loadedCommits = [...this.loadedCommits, ...newCommits];
    }
    const nextCursor = newCommits.length ? newCommits[newCommits.length - 1].hash : cursor;
    const { graphCommits, maxLanes } = buildGraphCommits(this.buildDisplayCommits());
    const message = newCommits.length ? "Loaded more commits." : "No more commits.";
    await this.host.post({
      type: "commits",
      payload: {
        ...this.basePayload(message),
        commits: graphCommits,
        nextCursor,
        hasMore: newCommits.length === limit,
        append: false,
        maxLanes
      }
    });
  }
  async handleSelectCommit(hash) {
    if (hash.startsWith("__virtual__")) {
      await this.host.post({
        type: "commitDetails",
        payload: {
          message: "Virtual row selected.",
          details: void 0
        }
      });
      return;
    }
    if (hash === UNCOMMITTED_HASH || hash.startsWith(OTHER_WORKTREE_PREFIX)) {
      const other = hash === UNCOMMITTED_HASH ? void 0 : this.worktreeByPath(hash.slice(OTHER_WORKTREE_PREFIX.length));
      const files = hash === UNCOMMITTED_HASH ? this.workingTreeChanges : other?.changes ?? [];
      await this.host.post({
        type: "commitDetails",
        payload: {
          message: "Uncommitted changes loaded.",
          details: {
            hash,
            shortHash: "*",
            authorName: "*",
            authorEmail: "",
            authorDate: localIsoNow(),
            subject: other ? `Uncommitted Changes in ${other.name} (${files.length})` : `Uncommitted Changes (${files.length})`,
            body: other ? other.path : "",
            files
          }
        }
      });
      return;
    }
    const details = await this.gitService.getCommitDetails(hash);
    const message = details ? "Commit details loaded." : "Commit details not available.";
    await this.host.post({
      type: "commitDetails",
      payload: {
        message,
        details
      }
    });
  }
  // Folder a row's files live in, and whether the row is an uncommitted pseudo commit.
  async folderForHash(hash) {
    if (hash.startsWith(OTHER_WORKTREE_PREFIX)) {
      return { folder: this.worktreeByPath(hash.slice(OTHER_WORKTREE_PREFIX.length))?.path, uncommitted: true };
    }
    return { folder: await this.gitService.getRepoRoot(), uncommitted: hash === UNCOMMITTED_HASH };
  }
  async handleOpenDiff(hash, filePath) {
    const { folder, uncommitted } = await this.folderForHash(hash);
    if (!folder) {
      return;
    }
    if (uncommitted) {
      await this.host.openDiff(folder, filePath, "HEAD", void 0, `${filePath} (Working Tree)`);
      return;
    }
    await this.host.openDiff(folder, filePath, `${hash}~1`, hash, `${filePath} (${hash.slice(0, 7)})`);
  }
  async handleOpenFile(hash, filePath) {
    const { folder, uncommitted } = await this.folderForHash(hash);
    if (!folder) {
      return;
    }
    await this.host.openFile(folder, filePath, uncommitted ? void 0 : hash);
  }
  async loadBranchOptions(repoRoot) {
    if (!repoRoot) {
      this.branchOptions = [{ value: "__all__", label: "Show All", type: "all" }];
      this.selectedBranch = "__all__";
      return;
    }
    const branches = await this.gitService.getBranches(this.showRemoteBranches);
    this.branchOptions = [
      { value: "__all__", label: "Show All", type: "all" },
      ...branches.map((branch) => ({
        value: branch.name,
        label: branch.name,
        type: branch.type
      }))
    ];
    const selectedExists = this.branchOptions.some((option) => option.value === this.selectedBranch);
    if (!selectedExists) {
      this.selectedBranch = "__all__";
    }
  }
  // Rows for the webview: the shown worktree's uncommitted row on top, rows of other worktrees
  // with changes directly above their HEAD, refs marked with the worktree they are checked out in.
  buildDisplayCommits() {
    const rows = [];
    const top = this.buildUncommittedRow();
    if (top) {
      rows.push(top);
    }
    const others = this.worktrees.filter((worktree) => !worktree.isCurrent && worktree.head && worktree.changes.length > 0);
    this.loadedCommits.forEach((commit) => {
      others.filter((worktree) => worktree.head === commit.hash).forEach((worktree) => rows.push(this.otherWorktreeRow(worktree, commit)));
      rows.push(this.withTracking(this.withStashRefs(this.withWorktreeRefs(commit))));
    });
    return rows;
  }
  // Local branches get their upstream and ahead/behind counts (shown as a badge on the chip).
  withTracking(commit) {
    if (this.tracking.size === 0 || !commit.refs.some((ref) => ref.type === "local" && this.tracking.has(ref.name))) {
      return commit;
    }
    const refs = commit.refs.map((ref) => {
      const track = ref.type === "local" ? this.tracking.get(ref.name) : void 0;
      return track ? { ...ref, upstream: track.upstream, ahead: track.ahead, behind: track.behind, upstreamGone: track.gone || void 0 } : ref;
    });
    return { ...commit, refs };
  }
  // Stashes made on this commit as chips (newest first), with message and stash commit.
  withStashRefs(commit) {
    const here = this.stashes.filter((stash) => stash.base === commit.hash);
    if (here.length === 0) {
      return commit;
    }
    const refs = [
      ...commit.refs.filter((ref) => ref.type !== "stash"),
      ...here.map((stash) => ({ name: stash.selector, type: "stash", message: stash.message, stashHash: stash.hash }))
    ];
    return { ...commit, refs };
  }
  // Copy of the commit whose refs show the worktrees: branches checked out in a worktree get its
  // name (linked worktrees show it on the chip, also the shown one), a detached linked worktree
  // gets its own chip. Only other worktrees carry the path (menu: switch, open, remove).
  withWorktreeRefs(commit) {
    const usable = this.worktrees.filter((worktree) => !worktree.isBare && !worktree.isPrunable);
    if (usable.length <= 1) {
      return commit;
    }
    const mark = (worktree) => ({
      worktree: worktree.name,
      worktreePath: worktree.isCurrent ? void 0 : worktree.path,
      worktreeIsMain: worktree.isMain || void 0
    });
    const refs = commit.refs.map((ref) => {
      const owner = ref.type === "local" ? usable.find((worktree) => worktree.branch === ref.name) : void 0;
      return owner && !(owner.isCurrent && owner.isMain) ? { ...ref, ...mark(owner) } : ref;
    });
    usable.filter((worktree) => worktree.isDetached && worktree.head === commit.hash && !(worktree.isCurrent && worktree.isMain)).forEach((worktree) => refs.push({ name: worktree.name, type: "worktree", ...mark(worktree) }));
    return { ...commit, refs };
  }
  otherWorktreeRow(worktree, head) {
    return {
      hash: `${OTHER_WORKTREE_PREFIX}${worktree.path}`,
      shortHash: "*",
      parents: [head.hash],
      authorName: "*",
      authorDate: localIsoNow(),
      subject: `Uncommitted Changes in ${worktree.name} (${worktree.changes.length})`,
      refs: [],
      graphPrefix: head.graphPrefix,
      isUncommitted: true,
      worktreePath: worktree.path,
      worktreeName: worktree.name
    };
  }
  async loadWorkingTreeState() {
    if (!this.repoRoot) {
      this.workingTreeChanges = [];
      this.headHash = void 0;
      this.worktrees = [];
      return;
    }
    const [changes, head, list, stashes] = await Promise.all([
      this.gitService.getWorkingTreeChanges(),
      this.gitService.getHeadHash(),
      this.gitService.listWorktrees().catch(() => []),
      this.gitService.getStashes().catch(() => [])
    ]);
    this.stashes = stashes;
    this.tracking = await this.gitService.branchTracking().catch(() => /* @__PURE__ */ new Map());
    this.workingTreeChanges = changes;
    this.headHash = head;
    this.worktrees = await this.loadWorktrees(list, changes);
  }
  // Status of every worktree (a few at a time); the shown one reuses its already loaded changes.
  async loadWorktrees(list, currentChanges) {
    if (list.length <= 1) {
      return list.map((info) => ({ ...info, name: worktreeName(info.path), isCurrent: true, changes: currentChanges }));
    }
    const states = list.map((info) => ({
      ...info,
      name: worktreeName(info.path),
      isCurrent: samePath(info.path, this.repoRoot),
      changes: []
    }));
    const pending = states.filter((state) => !state.isCurrent && !state.isBare && !state.isPrunable);
    states.filter((state) => state.isCurrent).forEach((state) => {
      state.changes = currentChanges;
    });
    for (let start = 0; start < pending.length; start += WORKTREE_STATUS_CONCURRENCY) {
      await Promise.all(
        pending.slice(start, start + WORKTREE_STATUS_CONCURRENCY).map(async (state) => {
          state.changes = await this.gitService.getWorkingTreeChangesAt(state.path).catch(() => []);
        })
      );
    }
    return states;
  }
  worktreeByPath(folder) {
    return this.worktrees.find((worktree) => samePath(worktree.path, folder));
  }
  // Pseudo commit on top whose parent is HEAD, so the graph draws a line down to HEAD.
  // Only shown when something changed and HEAD is among the loaded commits (not filtered out).
  buildUncommittedRow() {
    const head = this.headHash ? this.loadedCommits.find((commit) => commit.hash === this.headHash) : void 0;
    if (!head || this.workingTreeChanges.length === 0) {
      return void 0;
    }
    return {
      hash: UNCOMMITTED_HASH,
      shortHash: "*",
      parents: [head.hash],
      authorName: "*",
      authorDate: localIsoNow(),
      subject: `Uncommitted Changes (${this.workingTreeChanges.length})`,
      refs: [],
      // Start in HEAD's column (lane hint for the layout).
      graphPrefix: head.graphPrefix,
      isUncommitted: true
    };
  }
  // After a file save or a poll: reload only if a worktree's changes, HEAD or branch differ.
  async refreshWorkingTreeIfChanged() {
    if (!this.host.isVisible() || !this.repoRoot) {
      return;
    }
    const changesKey = (list2) => list2.map((c) => `${c.status}:${c.path}`).join("|");
    const changes = await this.gitService.getWorkingTreeChanges();
    if (changesKey(changes) !== changesKey(this.workingTreeChanges)) {
      await this.handleAutoRefresh();
      return;
    }
    if (this.worktrees.length <= 1) {
      return;
    }
    const list = await this.gitService.listWorktrees().catch(() => []);
    const fresh = await this.loadWorktrees(list, changes);
    const key = (states) => states.map((state) => `${state.path}:${state.head}:${state.branch}:${changesKey(state.changes)}`).join("\n");
    if (key(fresh) !== key(this.worktrees)) {
      await this.handleAutoRefresh();
    }
  }
};
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
var activeLanesFromGraphPrefix = (prefix) => {
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
var buildGraphCommits = (displayCommits) => {
  let maxLaneIndex = 0;
  const graphCommits = displayCommits.map((commit) => {
    const lane = laneFromGraphPrefix(commit.graphPrefix);
    const activeLanes = activeLanesFromGraphPrefix(commit.graphPrefix);
    const normalizedActive = activeLanes.length > 0 ? activeLanes : [lane];
    normalizedActive.forEach((activeLane) => {
      if (activeLane > maxLaneIndex) {
        maxLaneIndex = activeLane;
      }
    });
    if (lane > maxLaneIndex) {
      maxLaneIndex = lane;
    }
    return {
      ...commit,
      lane,
      segments: [],
      entrySegments: [],
      incomingLanes: normalizedActive,
      outgoingLanes: normalizedActive
    };
  });
  return { graphCommits, maxLanes: Math.max(1, maxLaneIndex + 1) };
};

// src/standalone/standaloneHost.ts
var fs4 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var DEFAULT_SETTINGS = {
  pageSize: 120,
  showRemoteBranches: true,
  autoRefresh: true,
  gitTimeoutSeconds: 30,
  dateFormat: "short"
};
var WORKING_TREE_POLL_MS = 3e3;
var MAX_VIEW_BYTES = 2 * 1024 * 1024;
var StandaloneHost = class {
  constructor(settings = DEFAULT_SETTINGS, fileAtRef = async () => "") {
    this.settings = settings;
    this.fileAtRef = fileAtRef;
    this.clients = /* @__PURE__ */ new Set();
    this.pending = /* @__PURE__ */ new Map();
    this.nextRequestId = 1;
    // Called when the first page connects again / the last one closes.
    this.onFirstClient = () => void 0;
    this.onNoClients = () => void 0;
  }
  // --- connection handling (used by the server) ---
  addClient(response) {
    this.clients.add(response);
    if (this.clients.size === 1) {
      this.onFirstClient();
    }
    response.on("close", () => {
      this.clients.delete(response);
      if (this.clients.size === 0) {
        this.pending.forEach((resolve6) => resolve6(void 0));
        this.pending.clear();
        this.onNoClients();
      }
    });
  }
  // Answer from the page to a confirm/prompt/copy request.
  resolveRequest(id, value) {
    const resolve6 = this.pending.get(id);
    if (resolve6) {
      this.pending.delete(id);
      resolve6(typeof value === "string" ? value : void 0);
      void this.post({ type: "hostRequestClosed", payload: { id } });
    }
  }
  // --- GraphHost ---
  async post(message) {
    const frame = `data: ${JSON.stringify(message)}

`;
    this.clients.forEach((client) => client.write(frame));
  }
  config(key, fallback) {
    return key in this.settings ? this.settings[key] : fallback;
  }
  // Kept in memory: the server has no settings file.
  async updateConfig(key, value) {
    this.settings[key] = value;
  }
  isOpen() {
    return this.clients.size > 0;
  }
  isVisible() {
    return this.clients.size > 0;
  }
  confirm(options) {
    return this.request({ kind: "confirm", message: options.message, detail: options.detail, buttons: options.buttons });
  }
  // Asks again with the problem shown until the value is valid or the dialog is cancelled.
  async prompt(options) {
    let error;
    let value = options.value;
    for (; ; ) {
      value = await this.request({ kind: "prompt", title: options.title, prompt: options.prompt, value, error });
      if (value === void 0) {
        return void 0;
      }
      error = await options.validate(value);
      if (!error) {
        return value;
      }
    }
  }
  async copy(text) {
    await this.request({ kind: "copy", text });
  }
  async openDiff(repoRoot, filePath, leftRef, rightRef, title) {
    const [left, right] = await Promise.all([
      this.readSide(repoRoot, filePath, leftRef),
      this.readSide(repoRoot, filePath, rightRef)
    ]);
    await this.showFileView({ mode: "diff", path: filePath, title, left, right });
  }
  async openFile(repoRoot, filePath, ref) {
    const right = await this.readSide(repoRoot, filePath, ref);
    await this.showFileView({ mode: "file", path: filePath, title: `${filePath} (${right.label})`, right });
  }
  async openTerminal() {
    await this.onlyInVsCode("The terminal");
  }
  async openFolder() {
    await this.onlyInVsCode("Opening a worktree in a new window");
  }
  // fs.watch on the git directories plus a periodic working tree check.
  watchRepository(target, callbacks) {
    const watchers = [];
    const watch2 = (dir, recursive, accept) => {
      try {
        const watcher = fs4.watch(dir, { recursive }, (_event, name) => {
          if (accept(String(name ?? ""))) {
            callbacks.onRepositoryChanged();
          }
        });
        watcher.on("error", () => watcher.close());
        watchers.push(watcher);
      } catch {
      }
    };
    watch2(target.gitDir, false, (name) => name === "HEAD" || name === "index");
    watch2(target.commonDir, false, (name) => name === "packed-refs");
    watch2(path5.join(target.commonDir, "refs"), true, (name) => !name.endsWith(".lock"));
    const timer = setInterval(() => callbacks.onWorkingTreeMaybeChanged(), WORKING_TREE_POLL_MS);
    return {
      dispose: () => {
        clearInterval(timer);
        watchers.forEach((watcher) => watcher.close());
      }
    };
  }
  // A file at a commit, or on disk without ref. Missing files read as empty.
  async readSide(repoRoot, filePath, ref) {
    if (ref) {
      const label = ref.replace(/^([0-9a-f]{7})[0-9a-f]{33}/i, "$1");
      return { label, text: await this.fileAtRef(repoRoot, ref, filePath) };
    }
    return { label: "Working Tree", text: await readWorkingTreeFile(repoRoot, filePath) };
  }
  async showFileView(payload) {
    const sides = [payload.left, payload.right].filter((side) => side !== void 0);
    if (sides.some((side) => Buffer.byteLength(side.text, "utf8") > MAX_VIEW_BYTES)) {
      payload = { ...payload, left: payload.left && { ...payload.left, text: "" }, right: { ...payload.right, text: "" }, notice: `The file is larger than ${MAX_VIEW_BYTES / 1024 / 1024} MB and is not shown here.` };
    } else if (sides.some((side) => isBinary(side.text))) {
      payload = { ...payload, left: payload.left && { ...payload.left, text: "" }, right: { ...payload.right, text: "" }, notice: "Binary file, not shown." };
    }
    await this.post({ type: "showFileView", payload });
  }
  async onlyInVsCode(feature) {
    await this.post({ type: "status", payload: { message: `${feature} is only available in VS Code.` } });
  }
  // Send a question to the page and wait for its answer (undefined without a page).
  request(request) {
    if (this.clients.size === 0) {
      return Promise.resolve(void 0);
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve6) => {
      this.pending.set(id, resolve6);
      void this.post({ type: "hostRequest", payload: { id, ...request } });
    });
  }
};
var readWorkingTreeFile = async (repoRoot, filePath) => {
  const root = path5.resolve(repoRoot);
  const target = path5.resolve(root, filePath);
  const relative2 = path5.relative(root, target);
  if (!relative2 || relative2.startsWith("..") || path5.isAbsolute(relative2)) {
    return "";
  }
  try {
    return await fs4.promises.readFile(target, "utf8");
  } catch {
    return "";
  }
};
var isBinary = (text) => text.slice(0, 8e3).includes(String.fromCharCode(0));

// src/standalone/server.ts
var COOKIE_PREFIX = "ggn_token_";
var MAX_BODY_BYTES = 1024 * 1024;
var BUNDLED = fs5.existsSync(path6.join(__dirname, "webview", "main.js"));
var DIST_DIR = BUNDLED ? path6.join(__dirname, "webview") : path6.resolve(__dirname, "..", "..", "webview", "dist");
var ICON_FILE = BUNDLED ? path6.join(__dirname, "icon.png") : path6.resolve(__dirname, "..", "..", "media", "icon.png");
var STATIC_FILES = {
  "/dist/main.js": "application/javascript; charset=utf-8",
  "/dist/main.css": "text/css; charset=utf-8",
  "/dist/standaloneBridge.js": "application/javascript; charset=utf-8",
  "/dist/standaloneBridge.css": "text/css; charset=utf-8"
};
var PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Git Lineage</title>
    <!-- Browser tab icon, served as a file (see /favicon.png below). -->
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="stylesheet" href="/dist/standaloneBridge.css" />
    <link rel="stylesheet" href="/dist/main.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/dist/standaloneBridge.js"></script>
    <script src="/dist/main.js"></script>
  </body>
</html>`;
var sameToken = (given, token) => {
  if (!given) {
    return false;
  }
  const givenBytes = Buffer.from(given, "utf8");
  const tokenBytes = Buffer.from(token, "utf8");
  return givenBytes.length === tokenBytes.length && (0, import_crypto.timingSafeEqual)(givenBytes, tokenBytes);
};
var cookieToken = (request, name) => (request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=")).find(([key]) => key === name)?.[1];
var send = (response, status, body, type = "text/plain; charset=utf-8") => {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  response.end(body);
};
var startServer = async (options) => {
  const repoRoot = await GitService.findRepoRoot(options.repo);
  if (!repoRoot) {
    throw new Error(`${options.repo} is not inside a Git repository.`);
  }
  const settings = { ...DEFAULT_SETTINGS, ...options.settings };
  const gitService = new GitService({
    locateRepositories: async () => [repoRoot],
    timeoutMs: () => Number(settings.gitTimeoutSeconds) * 1e3
  });
  const host = new StandaloneHost(settings, (root, ref, filePath) => gitService.fileAtRef(root, ref, filePath));
  const controller = new GraphController(host, gitService);
  host.onFirstClient = () => controller.onVisible();
  host.onNoClients = () => controller.onClosed();
  const token = (0, import_crypto.randomBytes)(32).toString("hex");
  let port = options.port;
  const cookieName = () => `${COOKIE_PREFIX}${port}`;
  const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`];
  const allowedOrigins = () => allowedHosts().map((value) => `http://${value}`);
  const server = http.createServer((request, response) => {
    const url2 = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!allowedHosts().includes(request.headers.host ?? "")) {
      send(response, 421, "Unknown host.");
      return;
    }
    if (request.method === "GET" && url2.pathname === "/") {
      if (options.requireToken && !sameToken(url2.searchParams.get("token") ?? void 0, token)) {
        send(response, 403, "Token required: open the URL printed by the server.");
        return;
      }
      response.setHeader("Set-Cookie", `${cookieName()}=${token}; HttpOnly; SameSite=Strict; Path=/`);
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
      );
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      send(response, 200, PAGE, "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && (url2.pathname === "/favicon.png" || url2.pathname === "/favicon.ico")) {
      fs5.readFile(ICON_FILE, (error, data) => {
        if (error) {
          send(response, 404, "No icon.");
          return;
        }
        response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=3600", "X-Content-Type-Options": "nosniff" });
        response.end(data);
      });
      return;
    }
    if (!sameToken(cookieToken(request, cookieName()), token)) {
      send(response, 403, "Forbidden.");
      return;
    }
    if (request.method === "GET" && STATIC_FILES[url2.pathname]) {
      fs5.readFile(path6.join(DIST_DIR, path6.basename(url2.pathname)), (error, data) => {
        if (error) {
          send(response, 404, "Not built yet: run npm run esbuild.");
          return;
        }
        response.writeHead(200, {
          "Content-Type": STATIC_FILES[url2.pathname],
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        });
        response.end(data);
      });
      return;
    }
    if (request.method === "GET" && url2.pathname === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Content-Type-Options": "nosniff"
      });
      response.write(": connected\n\n");
      host.addClient(response);
      return;
    }
    if (request.method === "POST" && url2.pathname === "/message") {
      const type = String(request.headers["content-type"] ?? "").split(";")[0].trim();
      if (type !== "application/json" || !allowedOrigins().includes(String(request.headers.origin ?? ""))) {
        send(response, 403, "Forbidden.");
        return;
      }
      const chunks = [];
      let size = 0;
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          send(response, 413, "Too large.");
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        if (response.writableEnded) {
          return;
        }
        let message;
        try {
          message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          send(response, 400, "Invalid JSON.");
          return;
        }
        send(response, 204, "");
        if (message.type === "hostResponse") {
          host.resolveRequest(Number(message.payload?.id), message.payload?.value);
          return;
        }
        if (typeof message.type === "string") {
          void controller.receive(message);
        }
      });
      return;
    }
    send(response, 404, "Not found.");
  });
  await new Promise((resolve6, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve6());
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : options.port;
  const url = `http://127.0.0.1:${port}/${options.requireToken ? `?token=${token}` : ""}`;
  return {
    url,
    port,
    token,
    close: () => new Promise((resolve6) => {
      controller.onClosed();
      server.closeAllConnections();
      server.close(() => resolve6());
    })
  };
};
var parseArgs = (argv) => {
  const options = { repo: process.cwd(), port: 5179, requireToken: true, settings: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      options.repo = path6.resolve(argv[++index] ?? ".");
    } else if (arg === "--port") {
      options.port = Number(argv[++index]);
    } else if (arg === "--require-token") {
      options.requireToken = true;
    } else if (arg === "--no-require-token") {
      options.requireToken = false;
    } else if (arg === "--set") {
      const [key, ...rest] = (argv[++index] ?? "").split("=");
      const raw = rest.join("=");
      options.settings[key] = raw === "true" ? true : raw === "false" ? false : Number.isFinite(Number(raw)) && raw !== "" ? Number(raw) : raw;
    }
  }
  return options;
};
if (require.main === module) {
  startServer(parseArgs(process.argv.slice(2))).then((running) => {
    console.log(`Git Lineage: ${running.url}`);
  }).catch((error) => {
    console.error(`Git Lineage: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  startServer
});
