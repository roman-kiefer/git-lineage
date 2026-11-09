// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { bindGraphScroll, graphScrollX } from '../webview/src/graph/graphScroll';

// Graph column narrower than the drawn graph: scrollbar shown, scrolling moves the viewBox.
const setup = (contentWidth: number) => {
  document.body.innerHTML = '<div id="items"></div><div id="scroller" hidden></div>';
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(overlay);
  overlay.setAttribute('width', '220');
  overlay.setAttribute('height', '500');
  overlay.dataset.contentWidth = String(contentWidth);
  const scroller = document.getElementById('scroller')!;
  bindGraphScroll({ overlay, items: document.getElementById('items')!, scroller });
  overlay.dispatchEvent(new CustomEvent('graph-extent'));
  return { overlay, scroller };
};

describe('Graph column scrolls sideways', () => {
  it('shows the scrollbar only when the lanes do not fit', () => {
    expect(setup(220).scroller.hidden).toBe(true);
    const { scroller } = setup(400);
    expect(scroller.hidden).toBe(false);
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('400px');
  });

  it('scrolling moves only the visible part (viewBox), limited to the drawn width', () => {
    const { overlay, scroller } = setup(400);
    scroller.scrollLeft = 100;
    scroller.dispatchEvent(new Event('scroll'));
    expect(overlay.getAttribute('viewBox')).toBe('100 0 220 500');
    expect(graphScrollX(overlay)).toBe(100);
    scroller.scrollLeft = 999;
    scroller.dispatchEvent(new Event('scroll'));
    expect(graphScrollX(overlay)).toBe(180);
  });
});
