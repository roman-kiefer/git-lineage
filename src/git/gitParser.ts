import type { CommitFileChange, CommitSummary } from './gitTypes';

// Parse `git status --porcelain=v1 -z` into one entry per changed path.
// Entry: "XY path" (X = index, Y = working tree); renames/copies are followed by the old path.
// Status letter like `git show --name-status`: staged change first, else the working tree
// change; untracked files ("??") become "U".
export function parsePorcelainStatus(raw: string): CommitFileChange[] {
  const entries = raw.split('\0');
  const changes: CommitFileChange[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.length < 4) {
      continue;
    }
    const indexStatus = entry[0];
    const workTreeStatus = entry[1];
    const path = entry.slice(3);
    if (indexStatus === 'R' || indexStatus === 'C') {
      // Skip the old path that follows a rename/copy.
      index += 1;
    }
    let status: string;
    if (indexStatus === '?' && workTreeStatus === '?') {
      status = 'U';
    } else if (indexStatus !== ' ' && indexStatus !== '?') {
      status = indexStatus;
    } else {
      status = workTreeStatus;
    }
    changes.push({ status, path });
  }
  return changes;
}

const FIELD_SEPARATOR = '\u001f';
const COMMIT_START = '\u001d';
const COMMIT_END = '\u001e';

type ParsedRef = {
  name: string;
  type: 'local' | 'remote' | 'tag' | 'head' | 'stash' | 'other';
  isCurrent?: boolean;
};

function parseRefs(rawDecorations: string): ParsedRef[] {
  if (!rawDecorations.trim()) {
    return [];
  }

  const refs = rawDecorations
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .flatMap((entry): ParsedRef[] => {
      if (entry.startsWith('HEAD -> ')) {
        const branchName = entry.slice('HEAD -> '.length).trim();
        if (!branchName) {
          return [{ name: 'HEAD', type: 'head', isCurrent: true }];
        }
        return [
          { name: 'HEAD', type: 'head', isCurrent: true },
          { name: branchName, type: 'local', isCurrent: true },
        ];
      }

      if (entry === 'HEAD') {
        return [{ name: 'HEAD', type: 'head', isCurrent: true }];
      }

      if (entry.startsWith('tag: ')) {
        const tagName = entry.slice('tag: '.length).trim();
        return tagName ? [{ name: tagName, type: 'tag' }] : [];
      }

      if (entry.startsWith('stash@{') || entry.startsWith('refs/stash')) {
        return [{ name: entry.replace(/^refs\//, ''), type: 'stash' }];
      }

      if (entry.includes('/')) {
        return [{ name: entry, type: 'remote' }];
      }

      return [{ name: entry, type: 'local' }];
    });

  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.name}:${ref.isCurrent ? '1' : '0'}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function parseGitLog(raw: string): CommitSummary[] {
  if (!raw) {
    return [];
  }

  const commits: CommitSummary[] = [];
  let pendingConnectorPrefixes: string[] = [];
  raw.split('\n').forEach((line) => {
    const start = line.indexOf(COMMIT_START);
    const end = line.lastIndexOf(COMMIT_END);
    if (start < 0 || end < 0 || end <= start) {
      if (/[|\\/_*]/.test(line)) {
        pendingConnectorPrefixes.push(line);
      }
      return;
    }

    const graphPrefix = line.slice(0, start);
    const graphFlowPrefix =
      pendingConnectorPrefixes.length > 0
        ? pendingConnectorPrefixes[pendingConnectorPrefixes.length - 1]
        : graphPrefix;
    const graphConnectorPrefixes = [...pendingConnectorPrefixes];
    const payload = line.slice(start + COMMIT_START.length, end);
    const fields = payload.split(FIELD_SEPARATOR);
    if (fields.length < 7) {
      pendingConnectorPrefixes = [];
      return;
    }

    const [hash, shortHash, parentsField, authorName, authorDate, subject, refsField = ''] = fields;
    commits.push({
      hash,
      shortHash,
      parents: parentsField ? parentsField.split(' ').filter(Boolean) : [],
      authorName,
      authorDate,
      subject,
      refs: parseRefs(refsField),
      graphPrefix,
      graphFlowPrefix,
      graphConnectorPrefixes,
    });

    pendingConnectorPrefixes = [];
  });

  return commits;
}
