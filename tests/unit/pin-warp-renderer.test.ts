import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluatePinWarpMesh,
  pinWarpRectForImage,
  seedPinWarpPoints,
  type EvaluatedPinWarpMesh,
  type LayerVisualPart,
  type LayerVisualParts,
  type PinWarpPoint,
} from '../../src/domain';
import {
  drawPinWarpImage,
  isRestPinWarpMesh,
  pinWarpMeshDrawBounds,
  resolvePinWarpDrawBounds,
  resolvePinWarpDrawPlan,
  resolvePinWarpMesh,
  type PinWarpCanvas2D,
  type PinWarpDrawOptions,
  type PinWarpScratchCanvasFactory,
  type PinWarpScratchSurface,
} from '../../src/renderer/stage/pinWarpCanvas';

const IMAGE_RECT = pinWarpRectForImage(400, 300)!;

function restMesh(): EvaluatedPinWarpMesh {
  const restPins = seedPinWarpPoints(IMAGE_RECT);
  const result = evaluatePinWarpMesh({
    restPins,
    pins: restPins.map((pin) => ({ x: pin.x, y: pin.y })),
    mesh: { columns: 3, rows: 2 },
    rect: IMAGE_RECT,
  });
  if (result.status !== 'valid') throw new Error('expected a valid rest mesh');
  return result.mesh;
}

function deformedMesh(): EvaluatedPinWarpMesh {
  const restPins = seedPinWarpPoints(IMAGE_RECT);
  const pins = restPins.map((pin, index) =>
    index === 1 ? { x: pin.x + 24, y: pin.y + 60 } : pin,
  );
  const result = evaluatePinWarpMesh({
    restPins,
    pins,
    mesh: { columns: 3, rows: 2 },
    rect: IMAGE_RECT,
  });
  if (result.status !== 'valid') throw new Error('expected a valid mesh');
  return result.mesh;
}

/** Scaled-out mesh: the deformation expands beyond the rest rect on every side. */
function expandedMesh(): EvaluatedPinWarpMesh {
  const restPins = seedPinWarpPoints(IMAGE_RECT);
  const pins = restPins.map((pin) => ({ x: pin.x * 1.5, y: pin.y * 1.5 }));
  const result = evaluatePinWarpMesh({
    restPins,
    pins,
    mesh: { columns: 3, rows: 2 },
    rect: IMAGE_RECT,
  });
  if (result.status !== 'valid') throw new Error('expected a valid expanded mesh');
  return result.mesh;
}

function ordinaryVisual(
  overrides: Partial<LayerVisualPart> = {},
): Pick<LayerVisualParts, 'kind' | 'parts'> {
  return {
    kind: 'ordinary-image',
    parts: [
      {
        partId: 'layer:single',
        ownerLayerId: 'layer',
        slot: 'single',
        source: { kind: 'asset', assetId: 'asset' },
        assetId: 'asset',
        localRect: IMAGE_RECT,
        rotationDeg: 0,
        flipX: false,
        drawOrder: 0,
        ownerZIndex: 0,
        ...overrides,
      },
    ],
  };
}

interface FakeDrawImageRecord {
  readonly image: unknown;
  readonly args: readonly number[];
  readonly compositeOperation: GlobalCompositeOperation;
  readonly clip: readonly number[] | null;
}

/** Records Canvas 2D calls; the clip stack models save/restore faithfully. */
class FakeCanvas2D implements PinWarpCanvas2D {
  stack: string[] = [];
  saves = 0;
  restores = 0;
  clips = 0;
  transforms: number[][] = [];
  draws: FakeDrawImageRecord[] = [];
  clippedTriangles: number[][] = [];
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  private currentPath: number[] = [];
  private activeClip: number[] | null = null;
  private clipStack: (number[] | null)[] = [];

  constructor(
    private readonly deviceTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  ) {}

  save(): void {
    this.saves += 1;
    this.stack.push('save');
    this.clipStack.push(this.activeClip);
  }

  restore(): void {
    this.restores += 1;
    this.stack.pop();
    this.activeClip = this.clipStack.pop() ?? null;
  }

  beginPath(): void {
    this.currentPath = [];
  }

  moveTo(x: number, y: number): void {
    this.currentPath.push(x, y);
  }

  lineTo(x: number, y: number): void {
    this.currentPath.push(x, y);
  }

  closePath(): void {
    // no-op for the fake
  }

  clip(): void {
    this.clips += 1;
    this.activeClip = [...this.currentPath];
    this.clippedTriangles.push([...this.currentPath]);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transforms.push([a, b, c, d, e, f]);
  }

  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dWidth?: number,
    dHeight?: number,
  ): void {
    this.draws.push({
      image,
      args: dWidth === undefined ? [dx, dy] : [dx, dy, dWidth, dHeight ?? 0],
      compositeOperation: this.globalCompositeOperation,
      clip: this.activeClip ? [...this.activeClip] : null,
    });
  }

  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    return this.deviceTransform;
  }
}

class FakeScratchFactory {
  readonly surfaces: { canvas: CanvasImageSource; context: FakeCanvas2D }[] = [];
  readonly sizes: [number, number][] = [];

  readonly create: PinWarpScratchCanvasFactory = (width, height) => {
    const context = new FakeCanvas2D();
    const canvas = { scratchIndex: this.surfaces.length } as unknown as CanvasImageSource;
    this.surfaces.push({ canvas, context });
    this.sizes.push([width, height]);
    return { canvas, context } satisfies PinWarpScratchSurface;
  };
}

const fakeImage = { width: 400, height: 300 } as unknown as CanvasImageSource;

function pointInTriangle(
  point: { x: number; y: number },
  triangle: readonly number[],
): boolean {
  const x0 = triangle[0]!;
  const y0 = triangle[1]!;
  const x1 = triangle[2]!;
  const y1 = triangle[3]!;
  const x2 = triangle[4]!;
  const y2 = triangle[5]!;
  const side = (ax: number, ay: number, bx: number, by: number): number =>
    (point.x - bx) * (ay - by) - (ax - bx) * (point.y - by);
  const d1 = side(x0, y0, x1, y1);
  const d2 = side(x1, y1, x2, y2);
  const d3 = side(x2, y2, x0, y0);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

/** Models the alpha a destination pixel receives while replaying recorded clips. */
function simulateAlpha(
  draws: readonly FakeDrawImageRecord[],
  point: { x: number; y: number },
  sourceAlpha: number,
): number {
  let alpha = 0;
  for (const draw of draws) {
    if (!draw.clip || !pointInTriangle(point, draw.clip)) continue;
    alpha = draw.compositeOperation === 'copy'
      ? sourceAlpha
      : alpha + sourceAlpha * (1 - alpha);
  }
  return alpha;
}

/** Midpoints of mesh edges shared by exactly two triangles (interior seams). */
function seamPoints(mesh: EvaluatedPinWarpMesh): PinWarpPoint[] {
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (const triangle of mesh.triangles) {
    const pairs: [number, number][] = [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ];
    for (const [left, right] of pairs) {
      const a = Math.min(left, right);
      const b = Math.max(left, right);
      const key = `${a}:${b}`;
      const entry = edges.get(key) ?? { a, b, count: 0 };
      entry.count += 1;
      edges.set(key, entry);
    }
  }
  return [...edges.values()]
    .filter((edge) => edge.count === 2)
    .map(({ a, b }) => {
      const from = mesh.vertices[a]!;
      const to = mesh.vertices[b]!;
      return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    });
}

function scratchPoint(
  point: PinWarpPoint,
  bounds: { x: number; y: number },
  scaleX: number,
  scaleY: number,
): PinWarpPoint {
  return {
    x: (point.x - bounds.x) * scaleX,
    y: (point.y - bounds.y) * scaleY,
  };
}

function drawWarped(
  mesh: EvaluatedPinWarpMesh,
  options?: PinWarpDrawOptions,
): { target: FakeCanvas2D; factory: FakeScratchFactory } {
  const target = new FakeCanvas2D();
  const factory = new FakeScratchFactory();
  drawPinWarpImage(target, fakeImage, mesh, {
    createScratchCanvas: factory.create,
    ...options,
  });
  return { target, factory };
}

describe('pin-warp Canvas 2D renderer contract', () => {
  it('flattens the mesh into one scratch pass then blits once with exact affine triangles', () => {
    const mesh = deformedMesh();
    const { target, factory } = drawWarped(mesh);

    expect(mesh.triangles.length).toBe(3 * 2 * 2);
    expect(factory.surfaces).toHaveLength(1);
    const surface = factory.surfaces[0]!.context;
    // Every triangle is one clipped whole-image draw inside the scratch surface.
    expect(surface.draws).toHaveLength(mesh.triangles.length);
    expect(surface.clips).toBe(mesh.triangles.length);
    expect(surface.saves).toBe(mesh.triangles.length);
    expect(surface.restores).toBe(mesh.triangles.length);
    expect(surface.stack).toHaveLength(0);
    expect(
      surface.draws.every(
        (draw) => draw.image === fakeImage && draw.args[0] === 0 && draw.args[1] === 0,
      ),
    ).toBe(true);
    // 'copy' replaces instead of accumulating alpha in overlapping clips.
    expect(surface.draws.every((draw) => draw.compositeOperation === 'copy')).toBe(true);
    expect(surface.clippedTriangles.every((path) => path.length === 6)).toBe(true);
    expect(
      surface.transforms.every((values) => values.every(Number.isFinite)),
    ).toBe(true);
    // The target is written exactly once, by the scratch blit.
    expect(target.draws).toHaveLength(1);
    expect(target.draws[0]!.image).toBe(factory.surfaces[0]!.canvas);
    expect(target.draws[0]!.compositeOperation).toBe('source-over');
    expect(target.clips).toBe(0);
  });

  it('is deterministic: the same mesh paints identical records', () => {
    const mesh = deformedMesh();
    const first = drawWarped(mesh);
    const second = drawWarped(mesh);
    expect(second.factory.surfaces[0]!.context.draws).toEqual(
      first.factory.surfaces[0]!.context.draws,
    );
    expect(second.factory.surfaces[0]!.context.transforms).toEqual(
      first.factory.surfaces[0]!.context.transforms,
    );
    expect(second.target.draws).toEqual(first.target.draws);
  });

  it('draws a rest identity mesh as the plain bitmap path', () => {
    const mesh = restMesh();
    expect(isRestPinWarpMesh(mesh)).toBe(true);
    const { target, factory } = drawWarped(mesh);

    // No scratch, no clip, no transform: a single ordinary 1:1 image draw.
    expect(factory.surfaces).toHaveLength(0);
    expect(target.draws).toHaveLength(1);
    expect(target.draws[0]!.compositeOperation).toBe('source-over');
    expect(target.draws[0]!.clip).toBeNull();
    expect(target.draws[0]!.args).toEqual([IMAGE_RECT.x, IMAGE_RECT.y]);
    expect(target.clips).toBe(0);
    expect(target.transforms).toHaveLength(0);

    // Byte-identical to a plain image draw at the same rect.
    const plain = new FakeCanvas2D();
    plain.drawImage(fakeImage, IMAGE_RECT.x, IMAGE_RECT.y);
    expect(target.draws).toEqual(plain.draws);
  });

  it('routes a strict rest mesh to the plain image path in the shared draw plan', () => {
    const rest = restMesh();
    const evaluated = {
      pinWarp: {
        status: 'valid' as const,
        mesh: rest,
        pins: seedPinWarpPoints(IMAGE_RECT),
        mode: 'exact' as const,
      },
    };
    expect(resolvePinWarpDrawPlan(evaluated, ordinaryVisual())).toEqual({ kind: 'plain' });
    // Authoring still sees the mesh so the pin handles stay visible at rest.
    expect(resolvePinWarpMesh(evaluated, ordinaryVisual())).toBe(rest);
    expect(isRestPinWarpMesh(deformedMesh())).toBe(false);
    expect(resolvePinWarpDrawPlan(
      { pinWarp: { ...evaluated.pinWarp, mesh: deformedMesh() } },
      ordinaryVisual(),
    )).toMatchObject({ kind: 'pin-warp' });
  });

  it('keeps seam coverage after moving to single-write compositing', () => {
    const mesh = deformedMesh();
    const { factory } = drawWarped(mesh);
    const surface = factory.surfaces[0]!.context;
    const bounds = pinWarpMeshDrawBounds(mesh);
    const points = seamPoints(mesh).map((point) =>
      scratchPoint(point, bounds, 1, 1),
    );

    expect(points.length).toBeGreaterThan(0);
    // Every interior seam is covered by at least the two adjacent expanded clips.
    for (const point of points) {
      const covering = surface.draws.filter(
        (draw) => draw.clip && pointInTriangle(point, draw.clip),
      );
      expect(covering.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('writes a 50%-alpha warped image once per destination pixel (no 192 seam)', () => {
    const mesh = deformedMesh();
    const { target, factory } = drawWarped(mesh);
    const surface = factory.surfaces[0]!.context;
    const bounds = pinWarpMeshDrawBounds(mesh);
    const points = seamPoints(mesh).map((point) =>
      scratchPoint(point, bounds, 1, 1),
    );

    // The pre-#1471 source-over pass accumulates two 50% writes to ~192/255.
    for (const point of points) {
      expect(simulateAlpha(surface.draws, point, 0.5)).toBeCloseTo(0.5, 6);
    }
    const doubleBlended = points.map((point) =>
      simulateAlpha(
        surface.draws.map((draw) => ({ ...draw, compositeOperation: 'source-over' as const })),
        point,
        0.5,
      ),
    );
    expect(Math.max(...doubleBlended)).toBeCloseTo(0.75, 6);

    // Modeled per-pixel result across the whole deformed draw area: one write.
    let coveredSamples = 0;
    for (let y = bounds.y + 1; y < bounds.y + bounds.height; y += 6) {
      for (let x = bounds.x + 1; x < bounds.x + bounds.width; x += 6) {
        const point = { x: x - bounds.x, y: y - bounds.y };
        const covering = surface.draws.some((draw) => draw.clip && pointInTriangle(point, draw.clip));
        if (!covering) continue;
        coveredSamples += 1;
        expect(simulateAlpha(surface.draws, point, 0.5)).toBeCloseTo(0.5, 6);
      }
    }
    expect(coveredSamples).toBeGreaterThan(1000);
    // The target still receives exactly one (unclipped) blit.
    expect(target.draws).toHaveLength(1);
  });

  it('renders the scratch surface at device resolution when the context is scaled', () => {
    const mesh = deformedMesh();
    const target = new FakeCanvas2D({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    const factory = new FakeScratchFactory();
    drawPinWarpImage(target, fakeImage, mesh, { createScratchCanvas: factory.create });

    const bounds = pinWarpMeshDrawBounds(mesh);
    expect(factory.sizes[0]).toEqual([
      Math.ceil(bounds.width * 2),
      Math.ceil(bounds.height * 2),
    ]);
    expect(target.draws).toHaveLength(1);
    expect(target.draws[0]!.args).toEqual([
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    ]);
  });

  it('falls back to the direct per-triangle path when no scratch surface exists', () => {
    const mesh = deformedMesh();
    const target = new FakeCanvas2D();
    drawPinWarpImage(target, fakeImage, mesh, { createScratchCanvas: () => null });

    expect(target.draws).toHaveLength(mesh.triangles.length);
    expect(target.clips).toBe(mesh.triangles.length);
    expect(target.draws.every((draw) => draw.compositeOperation === 'source-over')).toBe(true);
  });

  it('reports deformed draw bounds and keeps plain bounds for non-warped layers', () => {
    const mesh = expandedMesh();
    const bounds = pinWarpMeshDrawBounds(mesh);
    // The scaled-out deformation leaves the rest rect on every side.
    expect(bounds.x).toBeLessThan(IMAGE_RECT.x);
    expect(bounds.y).toBeLessThan(IMAGE_RECT.y);
    expect(bounds.x + bounds.width).toBeGreaterThan(IMAGE_RECT.x + IMAGE_RECT.width);
    expect(bounds.y + bounds.height).toBeGreaterThan(IMAGE_RECT.y + IMAGE_RECT.height);
    for (const vertex of mesh.vertices) {
      expect(vertex.x).toBeGreaterThanOrEqual(bounds.x);
      expect(vertex.x).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(vertex.y).toBeGreaterThanOrEqual(bounds.y);
      expect(vertex.y).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
    // Rest mesh bounds are the plain image rect exactly.
    expect(pinWarpMeshDrawBounds(restMesh())).toEqual(IMAGE_RECT);
    // Non-warped layers reuse their existing combined bounds untouched.
    const plainBounds = { x: 5, y: 7, width: 120, height: 90 };
    expect(resolvePinWarpDrawBounds(plainBounds, null)).toBe(plainBounds);
    expect(resolvePinWarpDrawBounds(plainBounds, undefined)).toBe(plainBounds);
    expect(resolvePinWarpDrawBounds(plainBounds, mesh)).toEqual(bounds);
  });

  it('draws the plain image path when the Layer has no valid pin warp', () => {
    // The decision helper is what the shared Stage renderer consumes: only a
    // valid, non-rest warp on a single ordinary image part selects the triangle
    // painter.
    expect(
      resolvePinWarpDrawPlan({ pinWarp: undefined }, ordinaryVisual()),
    ).toEqual({ kind: 'plain' });
    expect(
      resolvePinWarpDrawPlan(
        {
          pinWarp: {
            status: 'invalid',
            reason: 'pin-count-mismatch',
          },
        },
        ordinaryVisual(),
      ),
    ).toEqual({ kind: 'plain' });
    expect(
      resolvePinWarpDrawPlan(
        {
          pinWarp: {
            status: 'valid',
            mesh: deformedMesh(),
            pins: seedPinWarpPoints(IMAGE_RECT),
            mode: 'exact',
          },
        },
        ordinaryVisual(),
      ),
    ).toMatchObject({ kind: 'pin-warp' });
    expect(
      resolvePinWarpDrawPlan(
        {
          pinWarp: {
            status: 'valid',
            mesh: deformedMesh(),
            pins: seedPinWarpPoints(IMAGE_RECT),
            mode: 'exact',
          },
        },
        ordinaryVisual(),
        { isBackground: true },
      ),
    ).toEqual({ kind: 'plain' });
    expect(
      resolvePinWarpDrawPlan(
        {
          pinWarp: {
            status: 'valid',
            mesh: deformedMesh(),
            pins: seedPinWarpPoints(IMAGE_RECT),
            mode: 'exact',
          },
        },
        { ...ordinaryVisual(), kind: 'composite-character' },
      ),
    ).toEqual({ kind: 'plain' });
    expect(
      resolvePinWarpDrawPlan(
        {
          pinWarp: {
            status: 'valid',
            mesh: deformedMesh(),
            pins: seedPinWarpPoints(IMAGE_RECT),
            mode: 'exact',
          },
        },
        ordinaryVisual({ flipX: true }),
      ),
    ).toEqual({ kind: 'plain' });
  });

  it('wires the shared Stage renderer, editor canvas, and draw module together', () => {
    const stage = readFileSync('src/renderer/stage/StageRenderer.tsx', 'utf8');
    const selectable = readFileSync(
      'src/renderer/features/canvas/SelectableLayer.tsx',
      'utf8',
    );
    const editorLayer = readFileSync(
      'src/renderer/features/canvas/PinWarpEditorLayer.tsx',
      'utf8',
    );
    const canvas = readFileSync(
      'src/renderer/features/canvas/CanvasStage.tsx',
      'utf8',
    );
    const drawModule = readFileSync(
      'src/renderer/stage/pinWarpCanvas.ts',
      'utf8',
    );

    // Shared Stage/Preview/Export: per-triangle path only when the evaluated
    // plan is `pin-warp`; the ordinary `KonvaImage` path stays for everything
    // else (including non-warped and strict rest Layers).
    expect(stage).toContain('resolvePinWarpDrawPlan');
    expect(stage).toContain('pinWarpPlan.kind === ');
    expect(stage).toContain('<PinWarpImage');
    expect(stage).toContain('if (pinWarp && orderedParts.length === 1)');
    expect(stage).toContain('image={image}');
    // Stage composite/effects bounds follow the deformed mesh (R3).
    expect(stage).toContain('pinWarpMeshDrawBounds');
    expect(stage).toContain('evaluatedPinWarp={layer.pinWarp ?? null}');
    // Editor canvas uses the same evaluated mesh for authoring (pins stay
    // visible at rest) and the same bounds helper (R3).
    expect(canvas).toContain('resolvePinWarpMesh');
    expect(canvas).toContain('setPinWarpPin');
    expect(canvas).toContain('pinWarpEditing');
    expect(selectable).toContain('PinWarpEditorLayer');
    expect(selectable).toContain('resolvePinWarpDrawBounds');
    expect(editorLayer).toContain('evaluatePinWarpMesh');
    expect(editorLayer).toContain('PinWarpImage');
    expect(editorLayer).toContain('PinWarpPins');
    expect(drawModule).toContain('drawImage(image, 0, 0)');
    expect(drawModule).toContain('context.clip()');
    expect(drawModule).toContain("'copy'");
  });
});
