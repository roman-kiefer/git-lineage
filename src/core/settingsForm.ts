import { formFlag, formText, type FormProblem, type FormSpec, type FormValues } from './forms';

// Settings dialog of the browser pane (gear in the toolbar). VS Code opens its own settings
// instead (GraphHost.openSettings). Same keys and defaults as the extension's gitLineage.*
// settings in package.json.

export type Settings = {
  dateFormat: string;
  authorDisplay: string;
  avatarSource: string;
  pageSize: number;
  autoRefresh: boolean;
  confirmDetachedCheckout: boolean;
  gitTimeoutSeconds: number;
  showRemoteBranches: boolean;
  showForkRemotes: boolean;
  showOtherRefs: boolean;
};

export const SETTING_DEFAULTS: Settings = {
  dateFormat: 'short',
  authorDisplay: 'name',
  avatarSource: 'initials',
  pageSize: 120,
  autoRefresh: true,
  confirmDetachedCheckout: true,
  gitTimeoutSeconds: 30,
  showRemoteBranches: true,
  showForkRemotes: true,
  showOtherRefs: false,
};

const PAGE_SIZE = { min: 20, max: 1000 };
const MIN_TIMEOUT = 5;

export const readSettings = (config: <T>(key: string, fallback: T) => T): Settings => {
  const entries = Object.entries(SETTING_DEFAULTS).map(([key, fallback]) => [key, config(key, fallback)]);
  return Object.fromEntries(entries) as Settings;
};

export const settingsForm = (current: Settings): FormSpec => ({
  title: 'Git Lineage settings',
  detail: 'Saved for the next start too.',
  submitLabel: 'Save',
  fields: [
    {
      id: 'dateFormat',
      kind: 'select',
      label: 'Date column',
      value: current.dateFormat,
      options: [
        { value: 'short', label: 'Short (6 Nov 2026 13:41, your time zone)' },
        { value: 'iso', label: "ISO (2026-09-30 18:20, the author's time)" },
        { value: 'local', label: 'Your regional format' },
        { value: 'relative', label: 'Relative (3 days ago)' },
      ],
    },
    {
      id: 'authorDisplay',
      kind: 'select',
      label: 'Author column',
      value: current.authorDisplay,
      options: [
        { value: 'name', label: 'Name' },
        { value: 'avatarName', label: 'Avatar and name' },
        { value: 'avatar', label: 'Avatar only' },
      ],
    },
    {
      id: 'avatarSource',
      kind: 'select',
      label: 'Avatars',
      value: current.avatarSource,
      info: 'GitHub: the authors\' GitHub pictures for repositories on github.com, initials when there is none. Asks GitHub once per author, signed in through GITHUB_TOKEN, GH_TOKEN or the GitHub CLI if available.',
      options: [
        { value: 'initials', label: 'Initials (nothing is sent anywhere)' },
        { value: 'github', label: 'GitHub pictures' },
      ],
    },
    { id: 'showRemoteBranches', kind: 'checkbox', label: 'Show remote branches', value: current.showRemoteBranches },
    { id: 'showForkRemotes', kind: 'checkbox', label: 'Show branches of forks', value: current.showForkRemotes, info: 'Remotes besides origin. The Forks checkbox only appears when there are such remotes.' },
    { id: 'showOtherRefs', kind: 'checkbox', label: 'Show other refs', value: current.showOtherRefs, info: 'Refs outside branches, remotes and tags, e.g. snapshots of tools such as Codex under refs/codex/.' },
    { id: 'autoRefresh', kind: 'checkbox', label: 'Refresh automatically on repository changes', value: current.autoRefresh },
    { id: 'confirmDetachedCheckout', kind: 'checkbox', label: 'Ask before a detached checkout', value: current.confirmDetachedCheckout },
    { id: 'pageSize', kind: 'text', label: 'Commits per page', value: String(current.pageSize), info: `${PAGE_SIZE.min} to ${PAGE_SIZE.max}.` },
    { id: 'gitTimeoutSeconds', kind: 'text', label: 'Git timeout (seconds)', value: String(current.gitTimeoutSeconds), info: `At least ${MIN_TIMEOUT}.` },
  ],
});

const whole = (text: string): number | undefined => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined);

export const settingsProblem = (values: FormValues): FormProblem | undefined => {
  const pageSize = whole(formText(values, 'pageSize'));
  if (pageSize === undefined || pageSize < PAGE_SIZE.min || pageSize > PAGE_SIZE.max) {
    return { field: 'pageSize', message: `Please enter a number from ${PAGE_SIZE.min} to ${PAGE_SIZE.max}.` };
  }
  const timeout = whole(formText(values, 'gitTimeoutSeconds'));
  if (timeout === undefined || timeout < MIN_TIMEOUT) {
    return { field: 'gitTimeoutSeconds', message: `Please enter a number of at least ${MIN_TIMEOUT}.` };
  }
  return undefined;
};

// Entered values; anything unexpected in a select keeps the current value.
export const settingsFromForm = (values: FormValues, current: Settings): Settings => {
  const choice = (id: keyof Settings, allowed: string[]): string => {
    const value = formText(values, id);
    return allowed.includes(value) ? value : (current[id] as string);
  };
  return {
    dateFormat: choice('dateFormat', ['short', 'iso', 'local', 'relative']),
    authorDisplay: choice('authorDisplay', ['name', 'avatarName', 'avatar']),
    avatarSource: choice('avatarSource', ['initials', 'github']),
    pageSize: whole(formText(values, 'pageSize')) ?? current.pageSize,
    gitTimeoutSeconds: whole(formText(values, 'gitTimeoutSeconds')) ?? current.gitTimeoutSeconds,
    autoRefresh: formFlag(values, 'autoRefresh'),
    confirmDetachedCheckout: formFlag(values, 'confirmDetachedCheckout'),
    showRemoteBranches: formFlag(values, 'showRemoteBranches'),
    showForkRemotes: formFlag(values, 'showForkRemotes'),
    showOtherRefs: formFlag(values, 'showOtherRefs'),
  };
};

// Values from a settings file: only known keys, each with the type of its default.
export const sanitizeSettings = (raw: unknown): Partial<Settings> => {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const result: Record<string, unknown> = {};
  Object.entries(SETTING_DEFAULTS).forEach(([key, fallback]) => {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === typeof fallback) {
      result[key] = value;
    }
  });
  return result as Partial<Settings>;
};
