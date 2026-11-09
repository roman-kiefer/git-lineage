import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGitLog } from '../../src/git/gitParser';
import { buildRows } from '../../webview/src/graph/buildRows';
import { activeLanesFromPrefix, laneFromGraphPrefix } from '../../webview/src/graph/layoutRows';
import type { CommitView } from '../../webview/src/graph/model';

// Names of the logs created by scripts/make-fixtures.sh.
export const fixtureNames = [
  'linear',
  'feature-merge',
  'parallel-branches',
  'staggered-merges',
  // Created with: npx tsx scripts/make-history.ts 300 7 test/fixtures/many-branches.log
  'many-branches',
] as const;

export type FixtureName = (typeof fixtureNames)[number];

// Read the raw `git log --graph` of a fixture.
export const readFixture = (name: FixtureName): string =>
  readFileSync(join(__dirname, '..', 'fixtures', `${name}.log`), 'utf8');

// Turn a fixture into CommitView[] the way the extension (buildGraphCommits) and
// the webview (buildRows) do at runtime.
export const loadCommitViews = (name: FixtureName): CommitView[] => {
  const summaries = parseGitLog(readFixture(name));
  const views: CommitView[] = summaries.map((commit) => {
    const lane = laneFromGraphPrefix(commit.graphPrefix);
    const active = activeLanesFromPrefix(commit.graphPrefix);
    const normalizedActive = active.length > 0 ? active : [lane];
    return {
      ...commit,
      lane,
      segments: [],
      entrySegments: [],
      incomingLanes: normalizedActive,
      outgoingLanes: normalizedActive,
    };
  });
  return buildRows(views);
};

// Commit subject -> row index, so tests can check by name instead of hash.
export const indexBySubject = (commits: CommitView[]): Map<string, number> =>
  new Map(commits.map((commit, index) => [commit.subject, index]));
