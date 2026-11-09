// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as config from '../webview/src/graph/graphConfig';
import { renderCommitGraphOverlay } from '../webview/src/graph/renderSvg';
import { fixtureNames, loadCommitViews, type FixtureName } from './helpers/fixtures';

const ROW_HEIGHT = 24;

// Minimal DOM as in renderShell: .list > .items > .commit*, plus the SVG overlay.
// happy-dom computes no layout, so offsetTop/offsetHeight are set by hand.
const buildDom = (rowCount: number): { items: HTMLElement; overlay: SVGSVGElement } => {
  const list = document.createElement('div');
  list.className = 'list';
  const items = document.createElement('div');
  items.className = 'items';
  Object.defineProperty(items, 'offsetTop', { value: 0 });
  for (let index = 0; index < rowCount; index += 1) {
    const row = document.createElement('div');
    row.className = 'commit';
    Object.defineProperty(row, 'offsetTop', { value: index * ROW_HEIGHT });
    Object.defineProperty(row, 'offsetHeight', { value: ROW_HEIGHT });
    items.appendChild(row);
  }
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  list.append(items, overlay);
  document.body.appendChild(list);
  return { items, overlay };
};

// Render the overlay and return the SVG elements line by line as stable strings.
// limit: only the first n commits (like the first page when paging).
const renderFixture = (name: FixtureName, limit?: number): { lines: string[]; nextMaxLanes: number } => {
  const commits = loadCommitViews(name).slice(0, limit);
  const { items, overlay } = buildDom(commits.length);
  const result = renderCommitGraphOverlay({
    items,
    overlay,
    commits,
    maxLanes: 1,
    graphPaddingX: config.graphPaddingX,
    laneWidth: config.laneWidth,
    dotSize: config.dotSize,
    virtualTrackColor: config.virtualTrackColor,
    virtualRingRadius: config.virtualRingRadius,
    maxImmediateParentCurveDistance: config.maxImmediateParentCurveDistance,
    visualLaneCount: config.visualLaneCount,
    laneColor: config.laneColor,
    editorBackground: '#1e1e1e',
    commitLane: (commit) => commit.lane,
    isCurrentCommit: (commit) => commit.refs.some((ref) => ref.isCurrent || ref.type === 'head'),
    laneToX: config.laneToX,
  });
  const lines = Array.from(overlay.children).map((element) => element.outerHTML);
  return { lines, nextMaxLanes: result.nextMaxLanes };
};

describe('renderCommitGraphOverlay (characterization)', () => {
  it.each(fixtureNames)('draws %s unchanged', (name) => {
    expect(renderFixture(name)).toMatchSnapshot();
  });
});
