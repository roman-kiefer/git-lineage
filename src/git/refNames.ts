// Small pure helpers for branch names (no git calls, testable without VS Code).

// "origin/feature/x" -> "feature/x" (local branch name for a remote-tracking branch).
// Returns undefined for names without a remote part ("origin", "/x").
export const localNameForRemote = (remoteRef: string): string | undefined => {
  const slash = remoteRef.indexOf('/');
  if (slash <= 0 || slash === remoteRef.length - 1) {
    return undefined;
  }
  return remoteRef.slice(slash + 1);
};

// Quick check before asking git (git check-ref-format --branch does the full validation).
// A leading "-" would be read as an option by git, so it is rejected here in any case.
export const branchNameProblem = (name: string): string | undefined => {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Enter a branch name.';
  }
  if (trimmed.startsWith('-')) {
    return 'A branch name must not start with "-".';
  }
  if (/\s/.test(trimmed)) {
    return 'A branch name must not contain spaces.';
  }
  return undefined;
};
