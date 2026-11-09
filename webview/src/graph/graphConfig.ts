export const laneWidth = 18;
export const graphPaddingX = 8;
export const dotSize = 9;
export const virtualTrackColor = '#b3b3b3';
export const virtualRingRadius = dotSize / 3 + 0.6;

export const showGraphDebugMeta = false;
export const maxImmediateParentCurveDistance = 2;

const lanePalette = [
  '#1ea8ff',
  '#ff2cc3',
  '#16d63f',
  '#f4a300',
  '#8a39ff',
  '#ff5252',
  '#00c2a8',
  '#a3e635',
];

// Number of lane colors (laneColors.ts picks one per lane).
export const lanePaletteSize = lanePalette.length;

export const laneColor = (lane: number): string => lanePalette[Math.abs(lane) % lanePalette.length];

export const visualLaneIndex = (lane: number): number => lane;
export const visualLaneCount = (laneCount: number): number => laneCount;

export const laneToX = (lane: number): number =>
  graphPaddingX + visualLaneIndex(lane) * laneWidth + laneWidth / 2;

export const editorBackground = (): string => {
  const value = getComputedStyle(document.body)
    .getPropertyValue('--vscode-editor-background')
    .trim();
  return value || '#1e1e1e';
};
