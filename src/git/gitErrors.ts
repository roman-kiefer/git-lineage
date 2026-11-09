// Error with a message that can be shown to the user as-is.
export class GitError extends Error {}

// Translate execFile failures (missing git, timeout, git error output) into a GitError.
export const toGitError = (
  error: { code?: string | number | null; killed?: boolean; signal?: string | null; message: string },
  stderr: string,
  args: string[],
  timeoutMs: number,
): GitError => {
  const command = `git ${args[0] ?? ''}`.trim();
  if (error.code === 'ENOENT') {
    return new GitError('Git was not found. Please install Git and make sure it is on the PATH.');
  }
  if (error.killed || error.signal === 'SIGTERM') {
    return new GitError(`${command} timed out after ${Math.round(timeoutMs / 1000)}s.`);
  }
  // Git writes the useful part to stderr; keep only the first line(s).
  const detail = (stderr || error.message).trim().split('\n').slice(0, 2).join(' ');
  return new GitError(`${command} failed: ${detail}`);
};

