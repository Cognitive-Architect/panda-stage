export interface FlaScale9Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface FlaScale9Slice {
  readonly source: FlaScale9Rect;
  readonly target: FlaScale9Rect;
}

/** XFL records the four grid edges in twips relative to the symbol registration. */
export function readFlaScale9Grid(attributes: Readonly<Record<string, string | undefined>>): FlaScale9Rect | undefined {
  if (attributes.scalingGrid !== 'true' && attributes.scalingGrid !== '1') return undefined;
  const edges = attributes.scalingGridRect?.trim().split(/\s+/u).map((item) => Number(item) / 20);
  if (!edges || edges.length !== 4 || !edges.every(Number.isFinite)) return undefined;
  const [left, top, right, bottom] = edges as [number, number, number, number];
  return left < right && top < bottom ? { left, top, right, bottom } : undefined;
}

function splitAxis(min: number, low: number, high: number, max: number, scale: number) {
  const source = [min, low, high, max] as const;
  if (!source.every(Number.isFinite) || !(min < low && low < high && high < max) ||
    !Number.isFinite(scale) || scale <= 0) return null;
  const size = (max - min) * scale;
  const leading = low - min;
  const trailing = max - high;
  if (!Number.isFinite(size) || size <= 0) return null;
  // Squeeze both margins proportionally when the target cannot fit fixed edges.
  const fit = Math.min(1, size / (leading + trailing));
  const destination = [0, leading * fit, Math.max(leading * fit, size - trailing * fit), size] as const;
  const anchorSegment = 0 < low ? 0 : 0 < high ? 1 : 2;
  const from = source[anchorSegment];
  const to = source[anchorSegment + 1]!;
  const mappedFrom = destination[anchorSegment];
  const mappedTo = destination[anchorSegment + 1]!;
  const anchor = mappedFrom - from * ((mappedTo - mappedFrom) / (to - from));
  const target = destination.map((coordinate) => coordinate - anchor);
  return target.every(Number.isFinite) ? { source, target } : null;
}

/** Map nine local rectangles into the scaled local space, keeping registration (0,0) fixed. */
export function planFlaScale9Slices(
  bounds: FlaScale9Rect,
  grid: FlaScale9Rect,
  scaleX: number,
  scaleY: number,
): readonly FlaScale9Slice[] | null {
  const x = splitAxis(bounds.left, grid.left, grid.right, bounds.right, scaleX);
  const y = splitAxis(bounds.top, grid.top, grid.bottom, bounds.bottom, scaleY);
  if (!x || !y) return null;
  const slices: FlaScale9Slice[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      slices.push({
        source: { left: x.source[col]!, top: y.source[row]!, right: x.source[col + 1]!, bottom: y.source[row + 1]! },
        target: { left: x.target[col]!, top: y.target[row]!, right: x.target[col + 1]!, bottom: y.target[row + 1]! },
      });
    }
  }
  return slices;
}
