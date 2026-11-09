import type { CommitRef, CommitView } from './model';
import { createCommitGraphDebug, createCommitGraphDebugMeta } from './renderDebug';
import { createRefIcon } from './refIcons';
import { formatCommitDate } from './dateFormat';

export type RenderCommitItemOptions = {
  selectedHash?: string;
  maxLanes: number;
  graphPaddingX: number;
  laneWidth: number;
  visualLaneCount: (laneCount: number) => number;
  showGraphDebugMeta: boolean;
  commitLane: (commit: CommitView) => number;
  isCurrentCommit: (commit: CommitView) => boolean;
};

type SingleDisplayRef = {
  kind: 'single';
  ref: CommitRef;
};

type PairedBranchDisplayRef = {
  kind: 'paired-branch';
  local: CommitRef;
  remote: CommitRef;
  scope: string;
  label: string;
};

type DisplayRef = SingleDisplayRef | PairedBranchDisplayRef;

const createCommitGraphSpacer = (): HTMLDivElement => {
  const graphSpacer = document.createElement('div');
  graphSpacer.className = 'commit-graph-spacer';
  return graphSpacer;
};

const splitRemoteRefName = (name: string): { scope: string; label: string } | undefined => {
  const separatorIndex = name.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= name.length - 1) {
    return undefined;
  }

  return {
    scope: name.slice(0, separatorIndex),
    label: name.slice(separatorIndex + 1),
  };
};

const appendChipSegment = (
  chip: HTMLSpanElement,
  text: string,
  className: string,
): void => {
  const segment = document.createElement('span');
  segment.className = className;
  segment.textContent = text;
  chip.appendChild(segment);
};

const collectDisplayRefs = (refs: CommitRef[]): DisplayRef[] => {
  const usedIndices = new Set<number>();
  const displayRefs: DisplayRef[] = [];

  refs.forEach((ref, index) => {
    if (usedIndices.has(index)) {
      return;
    }

    if (ref.type === 'local') {
      const matchIndex = refs.findIndex((candidate, candidateIndex) => {
        if (candidateIndex === index || usedIndices.has(candidateIndex) || candidate.type !== 'remote') {
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
            kind: 'paired-branch',
            local: ref,
            remote,
            scope: parts.scope,
            label: ref.name,
          });
          return;
        }
      }
    }

    if (ref.type === 'remote') {
      const parts = splitRemoteRefName(ref.name);
      const matchIndex = parts
        ? refs.findIndex((candidate, candidateIndex) => {
            if (candidateIndex === index || usedIndices.has(candidateIndex) || candidate.type !== 'local') {
              return false;
            }
            return candidate.name === parts.label;
          })
        : -1;

      if (parts && matchIndex >= 0) {
        usedIndices.add(index);
        usedIndices.add(matchIndex);
        displayRefs.push({
          kind: 'paired-branch',
          local: refs[matchIndex],
          remote: ref,
          scope: parts.scope,
          label: parts.label,
        });
        return;
      }
    }

    usedIndices.add(index);
    displayRefs.push({ kind: 'single', ref });
  });

  return displayRefs;
};

// Branch checked out in a linked worktree: worktree icon + folder name after the label. The main
// worktree (normal checkout) gets no marker, so linked worktrees stand out. Other worktrees carry
// their path (tooltip; the context menu reads it to offer the worktree actions).
const markWorktree = (chip: HTMLSpanElement, ref: CommitRef): void => {
  if (!ref.worktree) {
    return;
  }
  if (ref.worktreePath) {
    chip.dataset.worktreePath = ref.worktreePath;
    chip.dataset.worktreeName = ref.worktree;
  }
  const kind = ref.worktreeIsMain ? 'Main worktree' : 'Worktree';
  chip.title = ref.worktreePath ? `${kind} ${ref.worktree}: ${ref.worktreePath}` : `${kind} ${ref.worktree} (shown)`;
  if (ref.type === 'worktree' || ref.worktreeIsMain) {
    return;
  }
  chip.classList.add('ref-chip--in-worktree');
  const marker = document.createElement('span');
  marker.className = 'ref-chip__worktree';
  marker.appendChild(createRefIcon('worktree'));
  appendChipSegment(marker, ref.worktree ?? '', 'ref-chip__worktree-name');
  chip.appendChild(marker);
};

// Local branch that differs from its upstream: "↑2 ↓1" after the name (commits to push / to pull,
// as of the last fetch), "gone" when the upstream was deleted on the remote; details on hover.
// Drawn arrow (up = to push, down = to pull): text arrows are too thin at chip size.
const trackArrow = (direction: 'up' | 'down'): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 8 10');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '10');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ref-chip__track-arrow');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', direction === 'up' ? 'M4 9V1.5M1 4.5L4 1.5L7 4.5' : 'M4 1V8.5M1 5.5L4 8.5L7 5.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
};

const markTracking = (chip: HTMLSpanElement, ref: CommitRef): void => {
  if (!ref.upstream) {
    return;
  }
  const ahead = ref.ahead ?? 0;
  const behind = ref.behind ?? 0;
  // Readable form of the badge for screen readers and tests ("↑2 ↓1", "gone").
  let text = '';
  let tip: string;
  if (ref.upstreamGone) {
    text = 'gone';
    tip = `${ref.upstream} no longer exists on the remote (as of the last fetch).`;
  } else {
    text = [ahead > 0 ? `↑${ahead}` : '', behind > 0 ? `↓${behind}` : ''].filter(Boolean).join(' ');
    const parts = [
      ahead > 0 ? `${ahead} ${ahead === 1 ? 'commit' : 'commits'} to push` : '',
      behind > 0 ? `${behind} ${behind === 1 ? 'commit' : 'commits'} to pull` : '',
    ].filter(Boolean);
    tip = parts.length > 0
      ? `${ref.name} vs ${ref.upstream}: ${parts.join(', ')} (as of the last fetch).`
      : `${ref.name} is up to date with ${ref.upstream} (as of the last fetch).`;
  }
  chip.title = chip.title ? `${chip.title}\n${tip}` : tip;
  if (!text) {
    return;
  }
  const badge = document.createElement('span');
  badge.className = `ref-chip__track${ref.upstreamGone ? ' ref-chip__track--gone' : ''}`;
  badge.dataset.track = text;
  badge.setAttribute('aria-label', tip);
  if (ref.upstreamGone) {
    badge.textContent = 'gone';
  } else {
    // One part per direction: drawn arrow + number.
    ([['up', ahead], ['down', behind]] as const).forEach(([direction, count]) => {
      if (count > 0) {
        const part = document.createElement('span');
        part.className = `ref-chip__track-part ref-chip__track-part--${direction}`;
        part.append(trackArrow(direction), String(count));
        badge.appendChild(part);
      }
    });
  }
  chip.appendChild(badge);
};

const createSingleRefChip = (ref: CommitRef): HTMLSpanElement => {
  const chip = document.createElement('span');
  chip.className = `ref-chip ref-chip--${ref.type}`;
  // Read by the context menu (checkout of this ref).
  chip.dataset.refName = ref.name;
  chip.dataset.refType = ref.type;
  if (ref.isCurrent) {
    chip.classList.add('ref-chip--current');
  }
  chip.appendChild(createRefIcon(ref.type));
  appendChipSegment(chip, ref.name, 'ref-chip__segment ref-chip__segment--label');
  markTracking(chip, ref);
  markWorktree(chip, ref);
  // Stash: its message on hover, its commit for the menu actions.
  if (ref.type === 'stash') {
    chip.title = ref.message ? `${ref.name}: ${ref.message}` : ref.name;
    if (ref.stashHash) {
      chip.dataset.stashHash = ref.stashHash;
    }
  }
  return chip;
};

const createPairedBranchChip = (
  displayRef: PairedBranchDisplayRef,
): HTMLSpanElement => {
  const chip = document.createElement('span');
  chip.className = 'ref-chip ref-chip--branch-pair';
  // Context menu: a paired chip checks out the local branch.
  chip.dataset.refName = displayRef.local.name;
  chip.dataset.refType = 'local';
  chip.dataset.remoteName = displayRef.remote.name;
  if (displayRef.local.isCurrent || displayRef.remote.isCurrent) {
    chip.classList.add('ref-chip--current');
  }
  chip.appendChild(createRefIcon('paired-branch'));
  appendChipSegment(chip, displayRef.label, 'ref-chip__segment ref-chip__segment--label');

  const divider = document.createElement('span');
  divider.className = 'ref-chip__divider';
  divider.setAttribute('aria-hidden', 'true');
  chip.appendChild(divider);

  appendChipSegment(chip, displayRef.scope, 'ref-chip__segment ref-chip__segment--scope');
  markTracking(chip, displayRef.local);
  markWorktree(chip, displayRef.local);
  return chip;
};

const createRefChip = (displayRef: DisplayRef): HTMLSpanElement => {
  if (displayRef.kind === 'paired-branch') {
    return createPairedBranchChip(displayRef);
  }
  return createSingleRefChip(displayRef.ref);
};

const createCommitHeading = (
  commit: CommitView,
): HTMLDivElement => {
  const title = document.createElement('div');
  title.className = 'commit-title';
  title.textContent = commit.subject;

  const heading = document.createElement('div');
  heading.className = 'commit-heading';

  if (commit.refs.length > 0) {
    const refList = document.createElement('div');
    refList.className = 'ref-list';
    collectDisplayRefs(commit.refs)
      .slice(0, 4)
      .forEach((displayRef) => {
        refList.appendChild(createRefChip(displayRef));
      });
    heading.appendChild(refList);
  }

  heading.appendChild(title);
  return heading;
};

const createCommitTableRow = (commit: CommitView): HTMLDivElement => {
  const row = document.createElement('div');
  row.className = 'commit-row';

  const heading = createCommitHeading(commit);
  heading.classList.add('commit-col', 'commit-col--description');

  const date = document.createElement('div');
  date.className = 'commit-col commit-col--date';
  // Format per setting; the tooltip always shows the full timestamp as recorded by git.
  date.textContent = formatCommitDate(commit.authorDate);
  date.title = commit.authorDate;

  const author = document.createElement('div');
  author.className = 'commit-col commit-col--author';
  author.textContent = commit.authorName;

  const hash = document.createElement('div');
  hash.className = 'commit-col commit-col--hash hash';
  hash.textContent = commit.shortHash;

  row.append(heading, date, author, hash);
  return row;
};

const createCommitInfo = (
  commit: CommitView,
  rowIndex: number,
  options: RenderCommitItemOptions,
): HTMLDivElement => {
  const info = document.createElement('div');
  info.className = 'commit-info';
  if (commit.isConnectorRow) {
    if (options.showGraphDebugMeta) {
      info.append(
        createCommitGraphDebugMeta(commit, rowIndex, {
          maxLanes: options.maxLanes,
          visualLaneCount: options.visualLaneCount,
          commitLane: options.commitLane,
        }),
      );
    }
    return info;
  }

  if (options.showGraphDebugMeta) {
    info.append(
      createCommitGraphDebugMeta(commit, rowIndex, {
        maxLanes: options.maxLanes,
        visualLaneCount: options.visualLaneCount,
        commitLane: options.commitLane,
      }),
    );
  }

  info.append(createCommitTableRow(commit));
  return info;
};

export const createCommitItem = (
  commit: CommitView,
  rowIndex: number,
  options: RenderCommitItemOptions,
): HTMLDivElement => {
  const item = document.createElement('div');
  item.className = 'commit';
  item.dataset.hash = commit.hash;
  if (commit.isConnectorRow) {
    item.classList.add('commit--connector');
  }
  if (commit.isVirtual) {
    item.classList.add('commit--virtual');
  }
  if (commit.isUncommitted) {
    item.classList.add('commit--uncommitted');
  }
  if (commit.hash === options.selectedHash) {
    item.classList.add('selected');
  }
  if (options.isCurrentCommit(commit)) {
    item.classList.add('commit--current');
  }
  item.style.setProperty('--commit-accent', 'transparent');

  item.append(createCommitGraphSpacer());
  if (options.showGraphDebugMeta) {
    item.append(
      createCommitGraphDebug(commit, {
        maxLanes: options.maxLanes,
        visualLaneCount: options.visualLaneCount,
        commitLane: options.commitLane,
      }),
    );
  }
  item.append(createCommitInfo(commit, rowIndex, options));
  return item;
};

export const createCommitItemsFragment = (
  commits: CommitView[],
  rowBase: number,
  options: RenderCommitItemOptions,
): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  commits.forEach((commit, offset) => {
    fragment.append(createCommitItem(commit, rowBase + offset, options));
  });
  return fragment;
};

