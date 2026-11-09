import type { CommitView } from './model';

// Normalize user input: trimmed and case-insensitive.
export const normalizeQuery = (query: string): string => query.trim().toLowerCase();

// True if a commit matches the (already normalized) query.
// Hashes match by prefix, everything else by substring.
export const commitMatches = (commit: CommitView, normalizedQuery: string): boolean => {
  if (!normalizedQuery || commit.isVirtual || commit.isUncommitted) {
    return false;
  }
  if (commit.hash.toLowerCase().startsWith(normalizedQuery)) {
    return true;
  }
  const haystacks = [
    commit.subject,
    commit.authorName,
    ...commit.refs.map((ref) => ref.name),
  ];
  return haystacks.some((text) => text.toLowerCase().includes(normalizedQuery));
};

// Hashes of all matching commits in list order.
export const findMatchingHashes = (commits: CommitView[], query: string): string[] => {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }
  return commits.filter((commit) => commitMatches(commit, normalized)).map((commit) => commit.hash);
};

// Index of the next/previous match, wrapping around; -1 if there are no matches.
export const stepMatchIndex = (current: number, count: number, direction: 1 | -1): number => {
  if (count === 0) {
    return -1;
  }
  if (current < 0) {
    return direction === 1 ? 0 : count - 1;
  }
  return (current + direction + count) % count;
};
