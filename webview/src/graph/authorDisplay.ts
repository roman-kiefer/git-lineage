// Author column (setting gitLineage.authorDisplay).
//   name         - the author's name (default)
//   avatarName   - avatar and name
//   avatar       - avatar only, the name on hover; the column shrinks to the avatar
// Avatars show the initials on a color derived from the name. With avatarSource = github the
// extension looks up the authors' GitHub pictures and sends them here (setAvatarPictures); the
// page itself requests nothing. They fit into the normal row height (16 px).
export type AuthorDisplayMode = 'name' | 'avatarName' | 'avatar';

const MODES: readonly AuthorDisplayMode[] = ['name', 'avatarName', 'avatar'];

let currentMode: AuthorDisplayMode = 'name';

export const toAuthorDisplayMode = (value: unknown): AuthorDisplayMode =>
  MODES.includes(value as AuthorDisplayMode) ? (value as AuthorDisplayMode) : 'name';

// Mode for the rows; the commit list gets a class so the column width can follow it.
export const setAuthorDisplay = (mode: unknown): void => {
  currentMode = toAuthorDisplayMode(mode);
  const list = document.getElementById('commit-list');
  MODES.forEach((each) => list?.classList.toggle(`list--author-${each}`, each === currentMode));
};

export const getAuthorDisplay = (): AuthorDisplayMode => currentMode;

// "Roman Kiefer" -> "RK", "github-actions[bot]" -> "GA", "Tekenochichi" -> "T".
export const authorInitials = (name: string): string => {
  const parts = name
    .replace(/\[bot\]$/i, '')
    .split(/[\s._-]+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
};

// Same name, same color (hue from a simple string hash).
export const authorHue = (name: string): number => {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % 360;
};

// GitHub pictures by author mail in lower case (setting avatarSource = github), as data URLs
// from the extension. They arrive after the rows; showAvatarPicture swaps them in.
const pictures = new Map<string, string>();

const showAvatarPicture = (avatar: HTMLElement, url: string): void => {
  avatar.classList.add('author-avatar--picture');
  avatar.style.backgroundImage = `url("${url}")`;
  avatar.textContent = '';
};

// New pictures: remember them and update the avatars already on screen.
export const setAvatarPictures = (byEmail: Record<string, string> | undefined): void => {
  Object.entries(byEmail ?? {}).forEach(([email, url]) => {
    if (typeof url === 'string' && url.startsWith('data:image/')) {
      pictures.set(email.toLowerCase(), url);
    }
  });
  document.querySelectorAll<HTMLElement>('.author-avatar[data-email]').forEach((avatar) => {
    const url = pictures.get(avatar.dataset.email ?? '');
    if (url && !avatar.classList.contains('author-avatar--picture')) {
      showAvatarPicture(avatar, url);
    }
  });
};

const createAvatar = (name: string, email: string | undefined): HTMLSpanElement => {
  const avatar = document.createElement('span');
  avatar.className = 'author-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.style.setProperty('--author-hue', String(authorHue(name)));
  avatar.textContent = authorInitials(name);
  const key = email?.trim().toLowerCase();
  if (key) {
    avatar.dataset.email = key;
    const url = pictures.get(key);
    if (url) {
      showAvatarPicture(avatar, url);
    }
  }
  return avatar;
};

// Content of the author cell for the current mode.
export const fillAuthorCell = (cell: HTMLElement, name: string, email?: string): void => {
  cell.textContent = '';
  // "*": rows of uncommitted changes have no author, so no avatar either.
  if (currentMode === 'name' || name === '*') {
    cell.textContent = name;
    return;
  }
  cell.classList.add('commit-col--author-with-avatar');
  cell.appendChild(createAvatar(name, email));
  if (currentMode === 'avatar') {
    cell.title = name;
    cell.setAttribute('aria-label', name);
    return;
  }
  const label = document.createElement('span');
  label.className = 'author-name';
  label.textContent = name;
  cell.appendChild(label);
};
