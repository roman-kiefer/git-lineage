import { describe, expect, it } from 'vitest';
import { computeContainment } from '../webview/src/graph/commitHover';
import type { CommitRef, CommitView } from '../webview/src/graph/model';

// Loaded commits, newest first:
//   m2 (HEAD, main, origin/main, origin/HEAD)  merge of m1 and f1
//   f1 (feature, tag v2)
//   x1 (origin/hotfix)                          parent m0, not merged
//   m1
//   m0 (tag v1)
const commit = (hash: string, parents: string[], refs: CommitRef[] = []): CommitView => ({
  hash,
  shortHash: hash,
  parents,
  lane: 0,
  segments: [],
  refs,
  authorName: 't',
  authorDate: '2026-01-01T00:00:00Z',
  subject: hash,
});

const commits: CommitView[] = [
  { ...commit('__uncommitted__', ['m2']), isUncommitted: true },
  commit('m2', ['m1', 'f1'], [
    { name: 'HEAD', type: 'head' },
    { name: 'main', type: 'local', isCurrent: true },
    { name: 'origin/main', type: 'remote' },
    { name: 'origin/HEAD', type: 'remote' },
  ]),
  commit('f1', ['m0'], [{ name: 'feature', type: 'local' }, { name: 'v2', type: 'tag' }]),
  commit('x1', ['m0'], [{ name: 'origin/hotfix', type: 'remote' }]),
  commit('m1', ['m0']),
  commit('m0', [], [{ name: 'v1', type: 'tag' }]),
];

describe('Hover on a commit dot: containing branches', () => {
  it('old commit: all branches/tags that reach it, in graph order (top first); local + remote of the same name as one entry', () => {
    expect(computeContainment(commits, 'm0')).toEqual({
      inHead: true,
      branches: [{ name: 'main', remote: 'origin' }, { name: 'feature' }, { name: 'origin/hotfix' }],
      tags: ['v2', 'v1'],
    });
  });

  it('commit only on a remote branch: not in HEAD', () => {
    expect(computeContainment(commits, 'x1')).toEqual({ inHead: false, branches: [{ name: 'origin/hotfix' }], tags: [] });
  });

  it('merged feature commit: in feature and main', () => {
    expect(computeContainment(commits, 'f1').branches).toEqual([{ name: 'main', remote: 'origin' }, { name: 'feature' }]);
  });
});
