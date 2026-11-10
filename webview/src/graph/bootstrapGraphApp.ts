import type { CommitView } from './model';
import {
  bindCommitDetailFileActions,
  bindDetailsPanelActions,
  isDetailsVisible,
  setDetailsVisible,
  updateCommitDetails,
} from './renderCommitDetails';
import { createSearchController, type SearchController } from './searchController';
import {
  createWebviewMessageHandler,
  type WebviewIncomingMessage,
  type WebviewIncomingPayload,
} from './handleWebviewMessages';
import {
  createGraphOrchestrator,
  type GraphOrchestrator,
} from './graphOrchestrator';
import {
  createToolbarController,
  type ToolbarController,
} from './toolbarController';
import { createViewHelpers, type ViewHelpers } from './viewHelpers';
import { createFormDialog } from './formDialog';
import { createOperationBanner, type OperationState } from './operationBanner';
import { createRebaseDialog } from './rebaseDialog';
import { bindCommitHover } from './commitHover';
import { bindGraphScroll } from './graphScroll';
import { renderAppShell } from './renderShell';
import { createWebviewActions, type WebviewActions } from './webviewActions';
import { setupColumnResizeController } from './columnResizeController';
import { bindColumnVisibility } from './columnVisibility';
import { bindContextMenu } from './contextMenu';
import {
  dotSize,
  editorBackground,
  graphPaddingX,
  laneColor,
  laneToX,
  laneWidth,
  maxImmediateParentCurveDistance,
  showGraphDebugMeta,
  virtualRingRadius,
  virtualTrackColor,
  visualLaneCount,
} from './graphConfig';
import { onHostMessage } from './hostMessages';

type VsCodeApi = {
  postMessage: (message: unknown) => void;
};

type BootstrapContext = {
  actions: WebviewActions;
  viewHelpers: ViewHelpers;
  toolbarController: ToolbarController;
  graphOrchestrator: GraphOrchestrator;
  searchController: SearchController;
};

// Show/hide the details pane and re-sync the graph overlay with the new layout.
const showDetailsPane = (graphOrchestrator: GraphOrchestrator, visible: boolean): void => {
  setDetailsVisible(visible);
  window.requestAnimationFrame(() => graphOrchestrator.handleResize());
};

// Keep the sticky commit-header directly below the sticky toolbar.
const syncCommitHeaderStickyTop = (): void => {
  const toolbar = document.querySelector('.toolbar') as HTMLElement | null;
  const top = toolbar ? Math.ceil(toolbar.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--commit-head-sticky-top', `${top}px`);
};

// Resolve the lane index for a visible row in the graph area.
const commitLane = (commit: CommitView): number =>
  commit.lane;

// Mark rows that represent HEAD/current refs for node styling.
const isCurrentCommit = (commit: CommitView): boolean =>
  commit.refs.some((ref) => ref.isCurrent || ref.type === 'head');

// Create and wire the toolbar actions (refresh, filters, paging).
const setupToolbar = (actions: WebviewActions): ToolbarController =>
  createToolbarController({
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
    },
  });

// Create graph renderer/orchestrator and bind commit selection + resize updates.
const setupGraph = (actions: WebviewActions): GraphOrchestrator => {
  const commitItemsElement = document.getElementById('commit-items');
  const graphOverlay = document.getElementById('graph-overlay') as SVGSVGElement | null;
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
    laneToX,
  });

  // More lanes than fit into the graph column: it scrolls sideways (scrollbar in its header).
  const graphScroller = document.getElementById('graph-hscroll');
  if (commitItemsElement && graphOverlay && graphScroller) {
    bindGraphScroll({ overlay: graphOverlay, items: commitItemsElement, scroller: graphScroller });
  }

  // Hover over a commit dot: branches and tags that contain the commit, and HEAD.
  if (commitItemsElement && graphOverlay) {
    bindCommitHover({ items: commitItemsElement, overlay: graphOverlay, getCommits: graphOrchestrator.getRenderedCommits });
  }

  // Right-click menu: checkout, create branch, copy, terminal (also by keyboard, see below).
  const contextMenu = commitItemsElement
    ? bindContextMenu(
      commitItemsElement,
      (hash) => graphOrchestrator.getRenderedCommits().find((commit) => commit.hash === hash),
      actions,
    )
    : undefined;

  const openDetails = (hash: string): void => {
    showDetailsPane(graphOrchestrator, true);
    actions.selectCommit(hash);
  };

  graphOrchestrator.bindCommitSelection({
    // Mouse: the details pane opens. Keyboard: it only follows when it is already open,
    // so stepping through a narrow view does not keep opening it.
    onSelect: (hash, source) => {
      if (source === 'mouse' || isDetailsVisible()) {
        openDetails(hash);
      }
    },
    onOpenDetails: openDetails,
    onCloseDetails: () => showDetailsPane(graphOrchestrator, false),
    onContextMenu: (row) => {
      contextMenu?.openForRow(row);
    },
  });

  window.addEventListener('resize', () => {
    graphOrchestrator.handleResize();
  });

  return graphOrchestrator;
};

// Wire commit-detail panel file actions to extension commands.
const setupCommitDetails = (
  context: Pick<BootstrapContext, 'graphOrchestrator' | 'actions'>,
): void => {
  bindCommitDetailFileActions({
    getSelectedHash: context.graphOrchestrator.getSelectedHash,
    onOpenFile: (hash, path) => {
      context.actions.openFile(hash, path);
    },
    onOpenDiff: (hash, path) => {
      context.actions.openDiff(hash, path);
    },
  });

  bindDetailsPanelActions({
    onCopy: (text, label) => {
      context.actions.copyToClipboard(text, label);
    },
    // X or Esc: hide the pane; the selection stays so keyboard browsing can continue.
    onClose: () => {
      showDetailsPane(context.graphOrchestrator, false);
    },
  });
};

// Wire incoming messages to UI updates and graph rendering.
const setupMessageHandling = (
  context: Pick<
    BootstrapContext,
    'toolbarController' | 'viewHelpers' | 'graphOrchestrator' | 'searchController'
  >,
): void => {
  // Selection is gone (e.g. commit no longer listed): clear and hide the details pane.
  const resetDetails = (): void => {
    updateCommitDetails(undefined);
    showDetailsPane(context.graphOrchestrator, false);
  };

  const applyCommitList = (payload: WebviewIncomingPayload, append: boolean): void => {
    const commits = payload.commits ?? [];
    const result = context.graphOrchestrator.render(commits, append, payload.maxLanes);
    if (result.resetSelection) {
      resetDetails();
    }
    // Rows were rebuilt: re-apply search highlighting.
    context.searchController.refresh();
  };

  const renderEmptyCommitList = (): void => {
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
    updateCommitDetails,
  });

  onHostMessage((data) => {
    handleWebviewMessage(data as WebviewIncomingMessage);
  });
};

// Build strongly typed runtime context used by setup sub-steps.
const createBootstrapContext = (actions: WebviewActions): BootstrapContext => {
  const viewHelpers = createViewHelpers();
  viewHelpers.setGraphDebugEnabled(showGraphDebugMeta);
  // Copy symbol next to the shortened folder path: copies the full path.
  document.getElementById('repo-copy')?.addEventListener('click', () => {
    const fullPath = document.getElementById('repo')?.dataset.path;
    if (fullPath) {
      actions.copyToClipboard(fullPath, 'Path');
    }
  });

  const toolbarController = setupToolbar(actions);
  const graphOrchestrator = setupGraph(actions);
  const searchController = createSearchController({
    getCommits: graphOrchestrator.getRenderedCommits,
    items: document.getElementById('commit-items'),
    // Esc in the search field: continue in the list at the current match.
    onLeave: (currentHash) => {
      if (currentHash && graphOrchestrator.selectHash(currentHash) && isDetailsVisible()) {
        actions.selectCommit(currentHash);
      }
      graphOrchestrator.focusList();
    },
  });

  return {
    actions,
    viewHelpers,
    toolbarController,
    graphOrchestrator,
    searchController,
  };
};

// Bootstrap the complete webview app and connect all setup modules.
export const bootstrapGraphApp = (vscode: VsCodeApi): void => {
  const root = document.getElementById('app');
  const actions = createWebviewActions(vscode);

  renderAppShell(root);
  syncCommitHeaderStickyTop();
  setupColumnResizeController();
  // Narrow windows: hide Author/Date/Commit before the Description gets squeezed away.
  const commitList = document.getElementById('commit-list');
  if (commitList) {
    bindColumnVisibility(commitList);
  }
  window.addEventListener('resize', syncCommitHeaderStickyTop);
  // The toolbar wraps into two rows in narrow windows, also when selectors appear after loading.
  const toolbar = document.querySelector('.toolbar');
  if (toolbar && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncCommitHeaderStickyTop).observe(toolbar);
  }
  actions.ready();

  const context = createBootstrapContext(actions);

  setupCommitDetails(context);
  // Forms of the extension (add tag, create branch, rebase) answer through the actions.
  const formDialog = createFormDialog({ submit: actions.formSubmit, cancel: actions.formCancel });
  // Rebase view and the banner of a stopped operation (state comes with every commit list).
  const rebaseDialog = createRebaseDialog({ submit: actions.rebaseSubmit, cancel: actions.rebaseCancel });
  const banner = createOperationBanner(document.getElementById('operation-banner'), {
    act: actions.operationAction,
    openConflict: actions.openConflict,
  });
  onHostMessage((data) => {
    const message = data as { type?: string; payload?: Record<string, unknown> };
    if (formDialog.handle(message) || rebaseDialog.handle(message)) {
      return;
    }
    if ((message.type === 'init' || message.type === 'commits') && message.payload && 'operation' in message.payload) {
      banner.update(message.payload.operation as OperationState | null);
    }
    // A failed Continue/Skip/Abort: the error also goes into the banner, next to the buttons.
    if (message.type === 'error' && typeof message.payload?.message === 'string') {
      banner.showError(message.payload.message);
    } else if (message.type === 'status') {
      banner.settle();
    }
  });
  setupMessageHandling(context);
};
