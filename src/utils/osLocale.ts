import { execFile } from 'child_process';

// Regional format of the operating system (e.g. "de-DE").
// Inside VS Code, Intl and the webview only report the VS Code UI language (often en-US),
// so the OS setting is read directly. Result is cached; falls back to the Intl default.

// "de_DE.UTF-8" / "de_DE" -> "de-DE"; empty or "C"/"POSIX" -> undefined.
export const normalizeLocale = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim().split('.')[0]?.split('@')[0]?.replace(/_/g, '-');
  if (!trimmed || trimmed === 'C' || trimmed === 'POSIX') {
    return undefined;
  }
  try {
    // Only accept tags Intl understands.
    return Intl.DateTimeFormat.supportedLocalesOf(trimmed)[0];
  } catch {
    return undefined;
  }
};

// Run a small command and return stdout ('' on any error or after 3 s).
const run = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 3000, windowsHide: true }, (error, stdout) =>
      resolve(error ? '' : String(stdout)),
    );
  });

const detect = async (): Promise<string | undefined> => {
  if (process.platform === 'win32') {
    // "    LocaleName    REG_SZ    de-DE" (Settings > Time & language > Region > Regional format)
    const output = await run('reg', ['query', 'HKCU\\Control Panel\\International', '/v', 'LocaleName']);
    return normalizeLocale(/LocaleName\s+REG_SZ\s+(\S+)/.exec(output)?.[1]);
  }
  if (process.platform === 'darwin') {
    // "de_DE" or "de_DE@rg=dezzzz"
    return normalizeLocale(await run('defaults', ['read', '-g', 'AppleLocale']));
  }
  // Linux and others: standard locale environment variables.
  return normalizeLocale(process.env.LC_ALL || process.env.LC_TIME || process.env.LANG);
};

let cached: Promise<string> | undefined;

export const getOsLocale = (): Promise<string> => {
  cached ??= detect().then((locale) => locale ?? Intl.DateTimeFormat().resolvedOptions().locale);
  return cached;
};
