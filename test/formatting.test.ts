import { describe, expect, it } from 'vitest';
import { GitError, toGitError } from '../src/git/gitErrors';
import { parsePorcelainStatus } from '../src/git/gitParser';
import { formatCommitMessage } from '../webview/src/graph/renderCommitDetails';
import { findMatchingHashes, stepMatchIndex } from '../webview/src/graph/searchCommits';
import { formatCommitDate, setDateFormat, toDateFormatMode } from '../webview/src/graph/dateFormat';
import { normalizeLocale } from '../src/utils/osLocale';
import { loadCommitViews } from './helpers/fixtures';

describe('System language (normalizeLocale)', () => {
  it('turns registry, macOS and LANG values into BCP 47', () => {
    expect(normalizeLocale('de-DE')).toBe('de-DE');
    expect(normalizeLocale('de_DE')).toBe('de-DE');
    expect(normalizeLocale('de_DE.UTF-8')).toBe('de-DE');
    expect(normalizeLocale('de_DE@rg=dezzzz')).toBe('de-DE');
  });

  it('ignores empty and neutral values', () => {
    expect(normalizeLocale(undefined)).toBeUndefined();
    expect(normalizeLocale('')).toBeUndefined();
    expect(normalizeLocale('C')).toBeUndefined();
    expect(normalizeLocale('POSIX.UTF-8')).toBeUndefined();
  });
});

describe('Search (findMatchingHashes)', () => {
  const commits = loadCommitViews('feature-merge');
  const subjectsFor = (query: string): string[] => {
    const hashes = new Set(findMatchingHashes(commits, query));
    return commits.filter((commit) => hashes.has(commit.hash)).map((commit) => commit.subject);
  };

  it('finds messages regardless of case', () => {
    expect(subjectsFor('MERGE')).toEqual(['merge feature']);
  });

  it('finds hashes only by prefix', () => {
    const target = commits[3];
    expect(findMatchingHashes(commits, target.hash.slice(0, 7).toUpperCase())).toEqual([target.hash]);
    expect(findMatchingHashes(commits, target.hash.slice(5, 12))).not.toContain(target.hash);
  });

  it('finds author and ref names', () => {
    expect(subjectsFor('fixture')).toHaveLength(commits.length);
    expect(subjectsFor('feature')).toContain('f2');
  });

  it('returns nothing for empty input', () => {
    expect(findMatchingHashes(commits, '   ')).toEqual([]);
  });

  it('cycles through the matches', () => {
    expect(stepMatchIndex(-1, 3, 1)).toBe(0);
    expect(stepMatchIndex(-1, 3, -1)).toBe(2);
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
    expect(stepMatchIndex(0, 0, 1)).toBe(-1);
  });
});

describe('formatCommitMessage', () => {
  it('joins subject and body with an empty line', () => {
    expect(formatCommitMessage({ subject: 'Fix bug', body: 'Details\n' })).toBe('Fix bug\n\nDetails');
  });

  it('returns only the subject without a body', () => {
    expect(formatCommitMessage({ subject: 'Fix bug', body: '  ' })).toBe('Fix bug');
  });
});

describe('toGitError', () => {
  it('explains a missing Git', () => {
    const error = toGitError({ code: 'ENOENT', message: 'spawn git ENOENT' }, '', ['log'], 30000);
    expect(error).toBeInstanceOf(GitError);
    expect(error.message).toMatch(/Git was not found/);
  });

  it('reports timeouts in seconds', () => {
    const error = toGitError({ killed: true, signal: 'SIGTERM', message: '' }, '', ['log'], 30000);
    expect(error.message).toBe('git log timed out after 30s.');
  });

  it('uses the first stderr line', () => {
    const error = toGitError(
      { code: 128, message: 'Command failed' },
      'fatal: not a git repository\nmore\nand more',
      ['rev-parse'],
      30000,
    );
    expect(error.message).toBe('git rev-parse failed: fatal: not a git repository more');
  });
});

describe('Date format (formatCommitDate)', () => {
  const raw = '2026-09-30T18:20:05+02:00';
  // Fixed "now" two days and a bit later, so relative output is stable.
  const now = new Date('2026-10-02T19:00:00+02:00').getTime();

  it('iso: the author\'s time, not converted', () => {
    expect(formatCommitDate(raw, 'iso')).toBe('2026-09-30 18:20');
  });

  it('relative: largest fitting unit, rounded down', () => {
    expect(formatCommitDate(raw, 'relative', now, 'en')).toBe('2 days ago');
    expect(formatCommitDate(raw, 'relative', new Date(raw).getTime() + 30_000, 'en')).toBe('this minute');
    expect(formatCommitDate(raw, 'relative', now, 'de')).toBe('vorgestern');
  });

  it('local: date and time in the regional format', () => {
    const text = formatCommitDate(raw, 'local', now, 'de-DE');
    expect(text).toMatch(/\d{2}\.\d{2}\.\d{2}/);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });

  it('short (default): day, month, year and 24-hour time in your time zone', () => {
    // Built from local time, so the test does not depend on the machine's time zone.
    const localRaw = new Date(2026, 10, 6, 13, 41, 30).toISOString();
    expect(formatCommitDate(localRaw, 'short')).toBe(' 6 Nov 2026 13:41');
    expect(formatCommitDate(new Date(2026, 0, 15, 9, 5).toISOString(), 'short')).toBe('15 Jan 2026 09:05');
  });

  it('the extension host\'s language applies to local and relative', () => {
    setDateFormat('relative', 'de-DE');
    expect(formatCommitDate(raw, undefined, now)).toBe('vorgestern');
    setDateFormat('relative', 'kein-gueltiges-gebietsschema-!!');
    expect(formatCommitDate(raw, undefined, now, 'en')).toBe('2 days ago');
    setDateFormat('short');
  });

  it('unknown values and empty dates', () => {
    expect(toDateFormatMode('fancy')).toBe('short');
    expect(formatCommitDate('', 'relative')).toBe('');
    expect(formatCommitDate('kein datum', 'local')).toBe('kein datum');
  });
});

describe('Working tree (parsePorcelainStatus)', () => {
  it('reads changed, staged, new and renamed files', () => {
    // -z output: entries separated by NUL, a rename is followed by its old path.
    const raw = [' M src/a.ts', 'M  src/b.ts', 'A  new.txt', '?? open.txt', 'R  target.ts', 'source.ts', ' D gone.md', ''].join('\0');
    expect(parsePorcelainStatus(raw)).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'M', path: 'src/b.ts' },
      { status: 'A', path: 'new.txt' },
      { status: 'U', path: 'open.txt' },
      { status: 'R', path: 'target.ts' },
      { status: 'D', path: 'gone.md' },
    ]);
  });

  it('empty output means no changes', () => {
    expect(parsePorcelainStatus('')).toEqual([]);
  });
});
