import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluatePinWarpMesh,
  pinWarpRectForImage,
  seedPinWarpPoints,
  type EvaluatedPinWarpMesh,
  type LayerVisualPart,
  type LayerVisualParts,
} from '../../src/domain';
import {
  drawPinWarpImage,
  resolvePinWarpDrawPlan,
  type PinWarpCanvas2D,
} from '../../src/renderer/stage/pinWarpCanvas';

const IMAGE_RECT = pinWarpRectForImage(400, 300)!;

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

class FakeCanvas2D implements PinWarpCanvas2D {
  stack: string[] = [];
  saves = 0;
  restores = 0;
  clips = 0;
  transforms: number[][] = [];
  draws: { image: unknown; sx: number; sy: number }[] = [];
  clippedTriangles: number[][] = [];
  private currentPath: number[] = [];

  save(): void {
    this.saves += 1;
    this.stack.push('save');
  }

  restore(): void {
    this.restores += 1;
    this.stack.pop();
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
    this.clippedTriangles.push([...this.currentPath]);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transforms.push([a, b, c, d, e, f]);
  }

  drawImage(image: CanvasImageSource, sx: number, sy: number): void {
    this.draws.push({ image, sx, sy });
  }
}

const fakeImage = { width: 400, height: 300 } as unknown as CanvasImageSource;

describe('pin-warp Canvas 2D renderer contract', () => {
  it('paints one clipped affine drawImage per mesh triangle', () => {
    const mesh = deformedMesh();
    const context = new FakeCanvas2D();

    drawPinWarpImage(context, fakeImage, mesh);

    expect(mesh.triangles.length).toBe(3 * 2 * 2);
    expect(context.draws).toHaveLength(mesh.triangles.length);
    expect(context.clips).toBe(mesh.triangles.length);
    // One save/restore pair per triangle; nothing leaks.
    expect(context.saves).toBe(mesh.triangles.length);
    expect(context.restores).toBe(mesh.triangles.length);
    expect(context.stack).toHaveLength(0);
    expect(
      context.draws.every(
        (draw) => draw.image === fakeImage && draw.sx === 0 && draw.sy === 0,
      ),
    ).toBe(true);
    expect(
      context.transforms.every((values) => values.every(Number.isFinite)),
    ).toBe(true);
    // Every clipped path is a 3-point triangle.
    expect(
      context.clippedTriangles.every((path) => path.length === 6),
    ).toBe(true);
  });

  it('is deterministic: the same mesh paints identical records', () => {
    const mesh = deformedMesh();
    const first = new FakeCanvas2D();
    const second = new FakeCanvas2D();
    drawPinWarpImage(first, fakeImage, mesh);
    drawPinWarpImage(second, fakeImage, mesh);
    expect(second.draws).toEqual(first.draws);
    expect(second.transforms).toEqual(first.transforms);
    expect(second.clippedTriangles).toEqual(first.clippedTriangles);
  });

  it('draws the plain image path when the Layer has no valid pin warp', () => {
    // The decision helper is what the shared Stage renderer consumes: only a
    // valid warp on a single ordinary image part selects the triangle painter.
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
    // else (including non-warped Layers).
    expect(stage).toContain('resolvePinWarpDrawPlan');
    expect(stage).toContain('pinWarpPlan.kind === ');
    expect(stage).toContain('<PinWarpImage');
    expect(stage).toContain('if (pinWarp && orderedParts.length === 1)');
    expect(stage).toContain('image={image}');
    // Editor canvas consumes the same decision + the same evaluated mesh.
    expect(canvas).toContain('resolvePinWarpDrawPlan');
    expect(canvas).toContain('setPinWarpPin');
    expect(canvas).toContain('pinWarpEditing');
    expect(selectable).toContain('PinWarpEditorLayer');
    expect(editorLayer).toContain('evaluatePinWarpMesh');
    expect(editorLayer).toContain('PinWarpImage');
    expect(editorLayer).toContain('PinWarpPins');
    expect(drawModule).toContain('drawImage(image, 0, 0)');
    expect(drawModule).toContain('context.clip()');
  });
});
