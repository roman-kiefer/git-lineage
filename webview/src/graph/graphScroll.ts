// Sideways scrolling of the graph column when there are more lanes than fit into it.
// renderSvg draws the whole graph and stores its full width on the overlay (data-content-width);
// scrolling only moves the SVG viewBox, nothing is redrawn. The scrollbar sits in the sticky
// "Graph" column header, so it stays visible while scrolling down; Shift+wheel (or a sideways
// wheel/touchpad gesture) over the graph column scrolls as well.

type GraphScrollOptions = {
  overlay: SVGSVGElement;
  items: HTMLElement;
  scroller: HTMLElement;
};

// Current offset of the graph (0 = leftmost lane visible); read by the dot hover.
export const graphScrollX = (overlay: SVGSVGElement): number => Number(overlay.dataset.scrollX) || 0;

export const bindGraphScroll = ({ overlay, items, scroller }: GraphScrollOptions): void => {
  const track = document.createElement('div');
  track.className = 'graph-hscroll__track';
  scroller.replaceChildren(track);

  const visibleWidth = (): number => Number(overlay.getAttribute('width')) || 0;
  const contentWidth = (): number => Number(overlay.dataset.contentWidth) || visibleWidth();

  // Move the visible part of the graph (clamped to the drawn width).
  const apply = (x: number): void => {
    const width = visibleWidth();
    const height = Number(overlay.getAttribute('height')) || 0;
    const clamped = Math.max(0, Math.min(x, contentWidth() - width));
    overlay.dataset.scrollX = String(clamped);
    overlay.setAttribute('viewBox', `${clamped} 0 ${width} ${height}`);
  };

  // After each render: show the scrollbar only when lanes overflow the column, sized to match.
  const sync = (): void => {
    const width = visibleWidth();
    const content = contentWidth();
    const overflow = content > width + 1;
    scroller.hidden = !overflow;
    scroller.style.width = `${width}px`;
    track.style.width = `${content}px`;
    const x = graphScrollX(overlay);
    if (overflow && Math.abs(scroller.scrollLeft - x) > 1) {
      scroller.scrollLeft = x;
    }
  };

  overlay.addEventListener('graph-extent', sync);
  scroller.addEventListener('scroll', () => apply(scroller.scrollLeft));

  // Wheel over the graph column: sideways gestures, or Shift+wheel, scroll the graph.
  items.addEventListener(
    'wheel',
    (event) => {
      if (scroller.hidden) {
        return;
      }
      const box = overlay.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.left + visibleWidth()) {
        return;
      }
      const dx = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (dx === 0) {
        return;
      }
      event.preventDefault();
      scroller.scrollLeft += dx;
    },
    { passive: false },
  );
};
