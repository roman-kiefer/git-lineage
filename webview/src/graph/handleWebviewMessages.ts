import type { CommitView, WorktreeView } from './model';
import type { CommitDetailsView } from './renderCommitDetails';
import { setDateFormat } from './dateFormat';

export type BranchFilterOption = {
  value: string;
  label: string;
  type: 'local' | 'remote' | 'all';
};

export type WebviewIncomingPayload = {
  message?: string;
  repoRoot?: string;
  repositories?: string[];
  // Repository of the repo selector (repoRoot may be one of its worktrees).
  repositoryRoot?: string;
  worktrees?: WorktreeView[];
  branches?: BranchFilterOption[];
  selectedBranch?: string;
  showRemoteBranches?: boolean;
  selectedSortMode?: 'date';
  dateFormat?: string;
  dateLocale?: string;
  commits?: CommitView[];
  details?: CommitDetailsView;
  nextCursor?: string;
  hasMore?: boolean;
  maxLanes?: number;
  append?: boolean;
};

export type WebviewIncomingMessage = {
  type: string;
  payload?: WebviewIncomingPayload;
};

type WebviewMessageDeps = {
  setRefreshing: (isRefreshing: boolean) => void;
  setStatusText: (text: string, kind?: 'info' | 'error') => void;
  setRepoText: (repoRoot: string | undefined, force: boolean) => void;
  renderRepositories: (repositories: string[], current: string | undefined) => void;
  renderWorktrees: (worktrees: WorktreeView[]) => void;
  resetLoading: () => void;
  renderFilters: (
    branches: BranchFilterOption[],
    selectedBranch: string,
    showRemoteBranches: boolean,
  ) => void;
  applyPagingState: (nextCursor: string | undefined, hasMore: boolean) => void;
  applyCommitList: (payload: WebviewIncomingPayload, append: boolean) => void;
  renderEmptyCommitList: () => void;
  updateCommitDetails: (details?: CommitDetailsView) => void;
};

const applyFiltersFromPayload = (
  payload: WebviewIncomingPayload | undefined,
  deps: WebviewMessageDeps,
): void => {
  // Date format setting must be known before the rows are rendered.
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
    payload?.selectedBranch ?? '__all__',
    payload?.showRemoteBranches ?? true,
  );
};

const handleInitMessage = (
  payload: WebviewIncomingPayload | undefined,
  deps: WebviewMessageDeps,
): void => {
  deps.setRefreshing(false);
  deps.setStatusText(payload?.message ?? 'Connected.');
  deps.setRepoText(payload?.repoRoot, true);
  applyFiltersFromPayload(payload, deps);
  if (payload) {
    deps.applyCommitList(payload, false);
  } else {
    deps.renderEmptyCommitList();
  }
  deps.applyPagingState(payload?.nextCursor, payload?.hasMore ?? false);
  deps.updateCommitDetails(undefined);
};

const handleCommitsMessage = (
  payload: WebviewIncomingPayload | undefined,
  deps: WebviewMessageDeps,
): void => {
  deps.setRefreshing(false);
  deps.setStatusText(payload?.message ?? 'Refreshed.');
  deps.setRepoText(payload?.repoRoot, false);
  applyFiltersFromPayload(payload, deps);
  if (payload) {
    deps.applyCommitList(payload, payload.append ?? false);
  }
  deps.applyPagingState(payload?.nextCursor, payload?.hasMore ?? false);
};

const handleCommitDetailsMessage = (
  payload: WebviewIncomingPayload | undefined,
  deps: WebviewMessageDeps,
): void => {
  deps.setStatusText(payload?.message ?? 'Commit details loaded.');
  deps.updateCommitDetails(payload?.details);
};

// A request failed in the extension: stop spinners and show the reason.
const handleErrorMessage = (
  payload: WebviewIncomingPayload | undefined,
  deps: WebviewMessageDeps,
): void => {
  deps.setRefreshing(false);
  deps.resetLoading();
  deps.setStatusText(`Error: ${payload?.message ?? 'Unknown error.'}`, 'error');
};

export const createWebviewMessageHandler = (deps: WebviewMessageDeps) => {
  return (message: WebviewIncomingMessage): void => {
    if (message.type === 'init') {
      handleInitMessage(message.payload, deps);
      return;
    }
    if (message.type === 'commits') {
      handleCommitsMessage(message.payload, deps);
      return;
    }
    if (message.type === 'commitDetails') {
      handleCommitDetailsMessage(message.payload, deps);
      return;
    }
    if (message.type === 'error') {
      handleErrorMessage(message.payload, deps);
      return;
    }
    if (message.type === 'status') {
      deps.setStatusText(message.payload?.message ?? '');
    }
  };
};
