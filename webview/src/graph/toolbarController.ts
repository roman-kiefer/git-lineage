import type { WorktreeView } from './model';

type BranchFilterOption = {
  value: string;
  label: string;
  type: 'local' | 'remote' | 'all';
};

type ToolbarControllerOptions = {
  onRefresh: () => void;
  onUpdateFilters: (selectedBranch: string, showRemoteBranches: boolean) => void;
  onLoadMore: (cursor: string | undefined) => void;
  onSelectRepo: (repoRoot: string) => void;
  onSelectWorktree: (path: string) => void;
  minRefreshVisibleMs?: number;
};

export type ToolbarController = {
  setRefreshing: (isRefreshing: boolean) => void;
  renderFilters: (
    branches: BranchFilterOption[],
    selectedBranch: string,
    showRemoteBranches: boolean,
  ) => void;
  setPagingState: (nextCursor: string | undefined, hasMore: boolean) => void;
  // Fill the repo selector; it is only shown when there is more than one repository.
  renderRepositories: (repositories: string[], current: string | undefined) => void;
  // Fill the worktree selector; hidden when the repository has only one worktree.
  renderWorktrees: (worktrees: WorktreeView[]) => void;
  // Leave the "Loading..." state after a failed request.
  resetLoading: () => void;
};

export const createToolbarController = (options: ToolbarControllerOptions): ToolbarController => {
  const refreshButton = document.querySelector<HTMLButtonElement>('[data-action="refresh"]');
  const loadMoreButton = document.getElementById('load-more') as HTMLButtonElement | null;
  const branchSelect = document.getElementById('branch-select') as HTMLSelectElement | null;
  const remoteToggle = document.getElementById('remote-toggle') as HTMLInputElement | null;
  const repoSelect = document.getElementById('repo-select') as HTMLSelectElement | null;
  const worktreeSelect = document.getElementById('worktree-select') as HTMLSelectElement | null;

  const minRefreshVisibleMs = options.minRefreshVisibleMs ?? 320;
  const autoLoadPreloadPx = 500;

  let refreshVisibleUntil = 0;
  let refreshTimer: number | undefined;
  let nextCursor: string | undefined;
  let hasMore = false;
  let isLoadingMore = false;
  let autoLoadReady = true;

  const applyRefreshState = (isRefreshing: boolean): void => {
    if (!refreshButton) {
      return;
    }
    // Icon button: spins while refreshing (CSS), the label says what happens.
    refreshButton.disabled = isRefreshing;
    refreshButton.classList.toggle('is-refreshing', isRefreshing);
    refreshButton.title = isRefreshing ? 'Refreshing...' : 'Refresh';
    refreshButton.setAttribute('aria-label', refreshButton.title);
  };

  const setRefreshing = (isRefreshing: boolean): void => {
    if (isRefreshing) {
      refreshVisibleUntil = Date.now() + minRefreshVisibleMs;
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
      applyRefreshState(true);
      return;
    }

    const remaining = refreshVisibleUntil - Date.now();
    if (remaining > 0) {
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        applyRefreshState(false);
      }, remaining);
      return;
    }

    if (refreshTimer !== undefined) {
      window.clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
    applyRefreshState(false);
  };

  const updateLoadMore = (): void => {
    if (!loadMoreButton) {
      return;
    }
    loadMoreButton.disabled = isLoadingMore;
    loadMoreButton.textContent = isLoadingMore ? 'Loading...' : 'Load more';
    // Everything loaded: no button at all (the end of the list says that already).
    const footer = loadMoreButton.closest<HTMLElement>('.list-footer') ?? loadMoreButton;
    footer.hidden = !hasMore && !isLoadingMore;
  };

  // Trigger exactly one load request per "reached bottom" cycle.
  const requestLoadMore = (): void => {
    if (!hasMore || isLoadingMore) {
      return;
    }
    isLoadingMore = true;
    updateLoadMore();
    options.onLoadMore(nextCursor);
  };

  const isWithinPreloadRange = (): boolean => {
    if (!loadMoreButton) {
      return false;
    }
    const rect = loadMoreButton.getBoundingClientRect();
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight;
    return rect.top < viewportBottom + autoLoadPreloadPx && rect.bottom > 0;
  };

  const triggerAutoLoadIfNeeded = (): void => {
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

  const setPagingState = (nextCursorValue: string | undefined, hasMoreValue: boolean): void => {
    nextCursor = nextCursorValue;
    hasMore = hasMoreValue;
    isLoadingMore = false;
    updateLoadMore();
    if (!hasMore || !loadMoreButton) {
      return;
    }
    // Re-check immediately after each finished page load to keep a viewport buffer.
    window.requestAnimationFrame(() => {
      autoLoadReady = true;
      triggerAutoLoadIfNeeded();
    });
  };

  const renderFilters = (
    branches: BranchFilterOption[],
    selectedBranch: string,
    showRemoteBranches: boolean,
  ): void => {
    if (!branchSelect || !remoteToggle) {
      return;
    }

    branchSelect.innerHTML = '';
    branches.forEach((branch) => {
      const option = document.createElement('option');
      option.value = branch.value;
      option.textContent = branch.label;
      branchSelect.appendChild(option);
    });

    branchSelect.value = selectedBranch;
    if (branchSelect.value !== selectedBranch) {
      branchSelect.value = '__all__';
    }

    remoteToggle.checked = showRemoteBranches;
  };

  const sendFilterUpdate = (): void => {
    if (!branchSelect || !remoteToggle) {
      return;
    }
    setRefreshing(true);
    options.onUpdateFilters(branchSelect.value, remoteToggle.checked);
  };

  refreshButton?.addEventListener('click', () => {
    setRefreshing(true);
    options.onRefresh();
  });

  branchSelect?.addEventListener('change', () => {
    sendFilterUpdate();
  });

  remoteToggle?.addEventListener('change', () => {
    sendFilterUpdate();
  });

  // The plain folder name is only shown while no selector names the repository or worktree.
  const updateContextLabel = (): void => {
    const label = document.getElementById('repo-path');
    if (label) {
      label.hidden = !(repoSelect?.hidden ?? true) || !(worktreeSelect?.hidden ?? true);
    }
  };

  const renderRepositories = (repositories: string[], current: string | undefined): void => {
    if (!repoSelect) {
      return;
    }
    const showSelect = repositories.length > 1;
    repoSelect.hidden = !showSelect;
    updateContextLabel();
    if (!showSelect) {
      return;
    }
    repoSelect.innerHTML = '';
    repositories.forEach((repoRoot) => {
      const option = document.createElement('option');
      option.value = repoRoot;
      // Show the folder name, full path as tooltip.
      option.textContent = repoRoot.split(/[\\/]/).filter(Boolean).pop() ?? repoRoot;
      option.title = repoRoot;
      repoSelect.appendChild(option);
    });
    if (current) {
      repoSelect.value = current;
    }
  };

  // "name (branch) • 3": folder name, branch or "detached", number of uncommitted changes.
  const renderWorktrees = (worktrees: WorktreeView[]): void => {
    if (!worktreeSelect) {
      return;
    }
    worktreeSelect.hidden = worktrees.length <= 1;
    updateContextLabel();
    worktreeSelect.innerHTML = '';
    worktrees.forEach((worktree) => {
      const option = document.createElement('option');
      option.value = worktree.path;
      const branch = worktree.branch ?? 'detached';
      const changes = worktree.changeCount > 0 ? ` • ${worktree.changeCount}` : '';
      // The main worktree (normal checkout) is named as such; all others are linked worktrees.
      const main = worktree.isMain ? ' – main worktree' : '';
      option.textContent = `${worktree.name} (${branch})${main}${changes}`;
      option.title = worktree.path + (worktree.isMain ? ' (main worktree)' : '');
      option.disabled = worktree.isPrunable;
      worktreeSelect.appendChild(option);
      if (worktree.isCurrent) {
        worktreeSelect.value = worktree.path;
      }
    });
  };

  worktreeSelect?.addEventListener('change', () => {
    setRefreshing(true);
    options.onSelectWorktree(worktreeSelect.value);
  });

  const resetLoading = (): void => {
    isLoadingMore = false;
    updateLoadMore();
  };

  repoSelect?.addEventListener('change', () => {
    setRefreshing(true);
    options.onSelectRepo(repoSelect.value);
  });

  loadMoreButton?.addEventListener('click', () => {
    requestLoadMore();
  });

  if (loadMoreButton) {
    // Auto-load before the footer fully reaches viewport to keep scrolling fluid.
    if (typeof IntersectionObserver !== 'undefined') {
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
        rootMargin: `0px 0px ${autoLoadPreloadPx}px 0px`,
      });
      observer.observe(loadMoreButton);
    } else {
      // Fallback for environments without IntersectionObserver support.
      const onScroll = (): void => {
        triggerAutoLoadIfNeeded();
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
    }
  }

  return {
    setRefreshing,
    renderFilters,
    setPagingState,
    renderRepositories,
    renderWorktrees,
    resetLoading,
  };
};
