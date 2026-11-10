import { describe, expect, it } from 'vitest';
import { parseGitLog } from '../src/git/gitParser';

const line = (decorations: string): string =>
  `* \u001dabc123\u001fabc\u001f\u001fRoman\u001f2026-11-10T01:50:00+01:00\u001fSubject\u001f${decorations}\u001e`;

describe('parseGitLog refs', () => {
  it('tells local branches with a slash from remote branches by their full name', () => {
    const [commit] = parseGitLog(
      line(
        'HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, ' +
          'tag: refs/tags/v0.1.1, refs/heads/claude/code-cleanup-automation-828232',
      ),
    );
    expect(commit.refs).toEqual([
      { name: 'HEAD', type: 'head', isCurrent: true },
      { name: 'main', type: 'local', isCurrent: true },
      { name: 'origin/main', type: 'remote' },
      { name: 'origin/HEAD', type: 'remote' },
      { name: 'v0.1.1', type: 'tag' },
      { name: 'claude/code-cleanup-automation-828232', type: 'local' },
    ]);
  });

  it('keeps reading short names', () => {
    const [commit] = parseGitLog(line('HEAD -> main, origin/main, tag: v1'));
    expect(commit.refs.map((ref) => `${ref.type}:${ref.name}`)).toEqual([
      'head:HEAD',
      'local:main',
      'remote:origin/main',
      'tag:v1',
    ]);
  });
});
