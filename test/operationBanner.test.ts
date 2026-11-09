// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createOperationBanner, type OperationState } from '../webview/src/graph/operationBanner';

// Banner of a stopped rebase: a failed button shows its error right in the banner.
const stopped: OperationState = { kind: 'rebase', step: 1, total: 4, stoppedAt: '4d1cb3a', branch: 'feature', conflicts: ['notes.txt'] };

const setup = () => {
  document.body.innerHTML = '<div id="banner"></div>';
  const element = document.getElementById('banner')!;
  const clicked: string[] = [];
  const banner = createOperationBanner(element, { act: (action) => clicked.push(action), openConflict: () => undefined });
  banner.update(stopped);
  const button = (label: string) =>
    Array.from(element.querySelectorAll('button')).find((entry) => entry.textContent === label)!;
  const errorText = () => element.querySelector('.operation-banner__error')?.textContent;
  return { element, banner, clicked, button, errorText };
};

describe('Banner: errors of its buttons inside the banner', () => {
  it('Continue with conflict markers: the message shows in the banner and stays across refreshes', () => {
    const { banner, clicked, button, errorText } = setup();
    button('Continue').click();
    expect(clicked).toEqual(['continue']);
    // The controller refreshes the list first, then reports the error.
    banner.update({ ...stopped });
    expect(banner.showError('Conflicts are not resolved yet in notes.txt')).toBe(true);
    expect(errorText()).toBe('Conflicts are not resolved yet in notes.txt');
    // Auto-refresh at the same stop (e.g. after saving the file): the error stays.
    banner.update({ ...stopped });
    expect(errorText()).toBe('Conflicts are not resolved yet in notes.txt');
    // Next attempt: the old error goes.
    button('Continue').click();
    expect(errorText()).toBeUndefined();
  });

  it('errors without a click before, or after the next stop, do not go into the banner', () => {
    const { banner, button, errorText } = setup();
    expect(banner.showError('Something else failed')).toBe(false);
    button('Continue').click();
    banner.update({ ...stopped, step: 2, stoppedAt: '2443c31' });
    expect(banner.showError('Unrelated error')).toBe(false);
    expect(errorText()).toBeUndefined();
  });
});
