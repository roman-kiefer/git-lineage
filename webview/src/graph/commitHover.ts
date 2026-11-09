import { graphScrollX } from './graphScroll';
import type { CommitRef, CommitView } from './model';

// Hover over a commit dot: which branches and tags contain the commit, and whether HEAD does.
// Computed from the loaded commits: git lists children before their parents, so every ref tip
// that contains a loaded commit is loaded as well (refs hidden by a filter are not counted).

export type Containment = {
  inHead: boolean;
  // Branch labels: a local branch and its remote of the same name are one entry.
  branches: Array<{ name: string; remote?: string }>;
  tags: string[];
};

// Children of each loaded commit (reverse of the parent links), cached per commit list.
const childrenCache = new WeakMap<CommitView[], Map<string, string[]>>();

const childrenOf = (commits: CommitView[]): Map<string, string[]> => {
  const cached = childrenCache.get(commits);
  if (cached) {
    return cached;
  }
  const children = new Map<string, string[]>();
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

// Refs on the commit itself and on every loaded descendant, in graph order (top row first).
export const computeContainment = (commits: CommitView[], hash: string): Containment => {
  const children = childrenOf(commits);
  const seen = new Set<string>([hash]);
  const queue = [hash];
  while (queue.length > 0) {
    const current = queue.pop()!;
    (children.get(current) ?? []).forEach((child) => {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    });
  }
  // The commit list is in graph order, so walking it keeps the rows' order.
  const refs: CommitRef[] = commits.filter((commit) => seen.has(commit.hash)).flatMap((commit) => commit.refs);

  const inHead = refs.some((ref) => ref.type === 'head' || ref.isCurrent);
  // Branches in graph order (first row where the branch or its remote appears). A remote branch
  // with a local branch of the same name is one entry with the remote as scope.
  const localNames = new Set(refs.filter((ref) => ref.type === 'local').map((ref) => ref.name));
  const branches: Containment['branches'] = [];
  refs.forEach((ref) => {
    if (ref.type !== 'local' && (ref.type !== 'remote' || ref.name.endsWith('/HEAD'))) {
      return;
    }
    const slash = ref.type === 'remote' ? ref.name.indexOf('/') : -1;
    const short = slash > 0 ? ref.name.slice(slash + 1) : ref.name;
    const paired = ref.type === 'remote' && localNames.has(short);
    const key = ref.type === 'local' || paired ? short : ref.name;
    let entry = branches.find((candidate) => candidate.name === key);
    if (!entry) {
      entry = { name: key };
      branches.push(entry);
    }
    if (paired && !entry.remote) {
      entry.remote = ref.name.slice(0, slash);
    }
  });
  const tags = [...new Set(refs.filter((ref) => ref.type === 'tag').map((ref) => ref.name))];
  return { inHead, branches, tags };
};

type HoverOptions = {
  items: HTMLElement;
  overlay: SVGSVGElement;
  getCommits: () => CommitView[];
};

// Pointer this close to the dot centre (px) counts as on the dot.
const DOT_HIT_RADIUS = 9;
const SHOW_DELAY_MS = 250;

const chip = (text: string, scope?: string): HTMLElement => {
  const element = document.createElement('span');
  element.className = 'commit-hover__chip';
  element.textContent = text;
  if (scope) {
    const remote = document.createElement('span');
    remote.className = 'commit-hover__scope';
    remote.textContent = scope;
    element.appendChild(remote);
  }
  return element;
};

const section = (label: string, chips: HTMLElement[]): HTMLElement => {
  const element = document.createElement('div');
  element.className = 'commit-hover__section';
  const title = document.createElement('span');
  title.className = 'commit-hover__label';
  title.textContent = label;
  element.appendChild(title);
  chips.forEach((entry) => element.appendChild(entry));
  return element;
};

export const bindCommitHover = ({ items, overlay, getCommits }: HoverOptions): void => {
  const popup = document.createElement('div');
  popup.className = 'commit-hover';
  popup.setAttribute('role', 'tooltip');
  popup.hidden = true;
  document.body.appendChild(popup);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownHash: string | undefined;

  const hide = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    popup.hidden = true;
    shownHash = undefined;
  };

  // Dot of a row in viewport coordinates (renderSvg stores its position on the row).
  const dotOf = (row: HTMLElement): { x: number; y: number } | undefined => {
    const x = Number(row.dataset.dotX);
    const y = Number(row.dataset.dotY);
    if (!row.dataset.dotX || Number.isNaN(x) || Number.isNaN(y)) {
      return undefined;
    }
    const box = overlay.getBoundingClientRect();
    // The graph may be scrolled sideways (graphScroll.ts); a dot outside the column has no popup.
    const left = box.left + x - graphScrollX(overlay);
    if (left < box.left || left > box.right) {
      return undefined;
    }
    return { x: left, y: box.top + y };
  };

  const show = (hash: string, dot: { x: number; y: number }, row: HTMLElement): void => {
    const commits = getCommits();
    const commit = commits.find((entry) => entry.hash === hash);
    if (!commit) {
      return;
    }
    const containment = computeContainment(commits, hash);
    popup.replaceChildren();
    const title = document.createElement('div');
    title.className = 'commit-hover__title';
    title.textContent = `Commit ${commit.shortHash}`;
    popup.appendChild(title);
    const head = document.createElement('div');
    head.className = 'commit-hover__section';
    head.textContent = containment.inHead ? 'Included in HEAD (the checked-out commit).' : 'Not included in HEAD.';
    popup.appendChild(head);
    popup.appendChild(
      section(
        'Branches:',
        containment.branches.length > 0
          ? containment.branches.map((entry) => chip(entry.name, entry.remote))
          : [chip('none (among the shown branches)')],
      ),
    );
    if (containment.tags.length > 0) {
      popup.appendChild(section('Tags:', containment.tags.map((tag) => chip(tag))));
    }

    // Border in the commit's lane color (renderSvg sets it on the row as --commit-accent).
    // The same color for the pointer to the dot (CSS: --commit-hover-accent).
    const accent = getComputedStyle(row).getPropertyValue('--commit-accent').trim();
    if (accent && accent !== 'transparent') {
      popup.style.setProperty('--commit-hover-accent', accent);
    } else {
      popup.style.removeProperty('--commit-hover-accent');
    }

    // Right of the dot (pointer on the left edge), flipped when there is no room; the pointer
    // stays level with the dot even when the popup is pushed up or down to fit the window.
    popup.hidden = false;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const gap = 13;
    const flipped = dot.x + gap + width > window.innerWidth - 8;
    const left = flipped ? Math.max(8, dot.x - gap - width) : dot.x + gap;
    const top = Math.max(8, Math.min(dot.y - 18, window.innerHeight - height - 8));
    popup.classList.toggle('commit-hover--left', flipped);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.setProperty('--commit-hover-pointer-y', `${Math.min(Math.max(dot.y - top, 10), height - 10)}px`);
    shownHash = hash;
  };

  items.addEventListener('mousemove', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.commit');
    const hash = row?.dataset.hash;
    const dot = row ? dotOf(row) : undefined;
    const commit = hash ? getCommits().find((entry) => entry.hash === hash) : undefined;
    const onDot = !!dot && !!commit && !commit.isUncommitted && !commit.isVirtual && !commit.isConnectorRow
      && Math.hypot(event.clientX - dot.x, event.clientY - dot.y) <= DOT_HIT_RADIUS;
    if (!onDot || !hash || !dot || !row) {
      hide();
      return;
    }
    if (shownHash === hash || timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      show(hash, dot, row);
    }, SHOW_DELAY_MS);
  });
  items.addEventListener('mouseleave', hide);
  // Anything that moves the rows or opens something else closes the popup.
  window.addEventListener('scroll', hide, true);
  window.addEventListener('contextmenu', hide, true);
  window.addEventListener('keydown', hide, true);
};
