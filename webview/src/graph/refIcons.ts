import type { CommitRef } from './model';

export const createRefIcon = (type: CommitRef['type'] | 'paired-branch'): HTMLSpanElement => {
  const icon = document.createElement('span');
  icon.className = 'ref-chip__icon';
  icon.setAttribute('aria-hidden', 'true');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute(
    'viewBox',
    type === 'local' || type === 'remote' || type === 'paired-branch' || type === 'tag' || type === 'head' || type === 'stash' || type === 'worktree'
      ? '0 0 24 24'
      : '0 0 16 16',
  );

  const appendCircle = (cx: number, cy: number, r: number, fill = false): void => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(r));
    if (fill) {
      circle.classList.add('fill');
    }
    svg.appendChild(circle);
  };

  const appendLine = (x1: number, y1: number, x2: number, y2: number): void => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    svg.appendChild(line);
  };

  const appendPath = (d: string, fill = false): void => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    if (fill) {
      path.classList.add('fill');
    }
    svg.appendChild(path);
  };

  switch (type) {
    case 'head':
      // HEAD uses the provided circle-double glyph.
      appendPath('M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z', true);
      break;
    case 'tag':
      // Tag uses the provided outline glyph.
      appendPath(
        'M21.41 11.58L12.41 2.58A2 2 0 0 0 11 2H4A2 2 0 0 0 2 4V11A2 2 0 0 0 2.59 12.42L11.59 21.42A2 2 0 0 0 13 22A2 2 0 0 0 14.41 21.41L21.41 14.41A2 2 0 0 0 22 13A2 2 0 0 0 21.41 11.58M13 20L4 11V4H11L20 13M6.5 5A1.5 1.5 0 1 1 5 6.5A1.5 1.5 0 0 1 6.5 5Z',
        true,
      );
      break;
    case 'stash':
      // Stash uses the provided tray-full glyph.
      appendPath('M18 5H6V7H18M6 9H18V11H6M2 12H4V17H20V12H22V17A2 2 0 0 1 20 19H4A2 2 0 0 1 2 17M18 13H6V15H18Z', true);
      break;
    case 'local':
    case 'remote':
    case 'paired-branch':
      // Branch refs use the user-provided source-branch icon.
      appendPath(
        'M13,14C9.64,14 8.54,15.35 8.18,16.24C9.25,16.7 10,17.76 10,19A3,3 0 0,1 7,22A3,3 0 0,1 4,19C4,17.69 4.83,16.58 6,16.17V7.83C4.83,7.42 4,6.31 4,5A3,3 0 0,1 7,2A3,3 0 0,1 10,5C10,6.31 9.17,7.42 8,7.83V13.12C8.88,12.47 10.16,12 12,12C14.67,12 15.56,10.66 15.85,9.77C14.77,9.32 14,8.25 14,7A3,3 0 0,1 17,4A3,3 0 0,1 20,7C20,8.34 19.12,9.5 17.91,9.86C17.65,11.29 16.68,14 13,14M7,18A1,1 0 0,0 6,19A1,1 0 0,0 7,20A1,1 0 0,0 8,19A1,1 0 0,0 7,18M7,4A1,1 0 0,0 6,5A1,1 0 0,0 7,6A1,1 0 0,0 8,5A1,1 0 0,0 7,4M17,6A1,1 0 0,0 16,7A1,1 0 0,0 17,8A1,1 0 0,0 18,7A1,1 0 0,0 17,6Z',
        true,
      );
      break;
    case 'worktree':
      // Worktree: a folder outline with a small branch dot (own glyph).
      appendPath('M3 6A2 2 0 0 1 5 4H10L12 6H19A2 2 0 0 1 21 8V18A2 2 0 0 1 19 20H5A2 2 0 0 1 3 18ZM5 8V18H19V8Z', true);
      appendCircle(12, 13, 2.2, true);
      break;
    default:
      appendCircle(8, 8, 3.5);
      break;
  }

  icon.appendChild(svg);
  return icon;
};



