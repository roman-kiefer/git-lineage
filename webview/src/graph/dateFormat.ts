// Date column formatting (setting gitLineage.dateFormat).
//   short    - "30 Sep 2026 18:20" in the viewer's time zone (default)
//   iso      - "2026-09-30 18:20" in the author's time zone (as recorded by git)
//   local    - date and time in the viewer's locale and time zone
//   relative - "3 days ago" style, in the viewer's locale
export type DateFormatMode = 'short' | 'iso' | 'local' | 'relative';

const MODES: readonly DateFormatMode[] = ['short', 'iso', 'local', 'relative'];

// Current mode for the commit list; set from the extension payload.
let currentMode: DateFormatMode = 'short';
// Locale for local/relative dates: the OS locale sent by the extension host.
// undefined = browser default (inside the webview that is the VS Code UI language).
let currentLocale: string | undefined;

// Accept only known modes, anything else falls back to the default (short).
export const toDateFormatMode = (value: unknown): DateFormatMode =>
  MODES.includes(value as DateFormatMode) ? (value as DateFormatMode) : 'short';

// Accept only locales Intl understands; anything else falls back to the browser default.
const toLocale = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(value)[0];
  } catch {
    return undefined;
  }
};

export const setDateFormat = (mode: unknown, locale?: unknown): void => {
  currentMode = toDateFormatMode(mode);
  currentLocale = toLocale(locale);
};

export const getDateFormat = (): DateFormatMode => currentMode;

// Author's wall-clock time straight from the ISO string (no time zone conversion).
const formatIso = (raw: string): string =>
  raw.includes('T') && raw.length >= 16 ? `${raw.slice(0, 10)} ${raw.slice(11, 16)}` : raw;

// Fixed English month abbreviations, so the column looks the same on every system.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Figure space: as wide as a digit; pads one-digit days so the month lines up (" 6 Nov").
const FIGURE_SPACE = ' ';

// "6 Nov 2026 13:41": day without leading zero (padded), 24-hour time, viewer's time zone.
const formatShort = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, FIGURE_SPACE);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${hours}:${minutes}`;
};

// Largest fitting unit first; values are rounded down ("1 hour ago" until 2 hours have passed).
const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const formatRelative = (date: Date, now: number, locale: string | undefined): string => {
  const seconds = Math.round((now - date.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      return format.format(-Math.trunc(seconds / size), unit);
    }
  }
  return format.format(0, 'minute');
};

// Format one commit date. now/locale are parameters for tests; defaults are the viewer's.
export const formatCommitDate = (
  raw: string,
  mode: DateFormatMode = currentMode,
  now: number = Date.now(),
  locale: string | undefined = currentLocale,
): string => {
  if (!raw) {
    return '';
  }
  if (mode === 'iso') {
    return formatIso(raw);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return formatIso(raw);
  }
  if (mode === 'short') {
    return formatShort(date);
  }
  if (mode === 'relative') {
    return formatRelative(date, now, locale);
  }
  return date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
};
