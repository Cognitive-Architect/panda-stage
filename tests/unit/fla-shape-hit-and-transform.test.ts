// @vitest-environment happy-dom
import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import Konva from 'konva';
import { Stage, Layer as KonvaLayer } from 'react-konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  calculateViewportTransform,
  composeAffineMatrix,
  evaluateFlaGraphicVisual,
  isFlaGraphicEditableSubtreeShapeNode,
  isFlaGraphicNodeTransformable,
  migrateProject,
  unapplyFlaGraphicSubtreeViewBox,
  type FlaGraphicStructure,
} from '../../src/domain';
import {
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../src/shared/affine-matrix';
import exampleProject from '../../demo-project/project-v1.example.json';
import { FlaGraphicStructureProjection } from '../../src/renderer/features/canvas/FlaGraphicStructureProjection';
import {
  flaGraphicNodeCanTransform,
  resolveFlaGraphicEditTarget,
} from '../../src/renderer/features/canvas/flaGraphicEditScope';
import { parseFlaSvgShapeHitGeometry } from '../../src/renderer/features/canvas/flaSvgShapeHit';
import { renderFlaGraphicCanvas } from '../../src/renderer/features/canvas/flaGraphicCanvasRenderer';
import { CanvasToolbar } from '../../src/renderer/features/canvas/CanvasToolbar';
import { FlaGraphicStructureTree } from '../../src/renderer/features/properties/FlaGraphicStructureTree';
import { FlaGraphicChildTransform } from '../../src/renderer/features/properties/FlaGraphicChildTransform';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { renderToStaticMarkup } from 'react-dom/server';

const IDENTITY: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

const FRAME_ASSET_ID = 'd1000000-0000-4000-8000-000000000001';
const BG_ROOT_ASSET_ID = 'd1000000-0000-4000-8000-000000000002';
const RING_SHAPE_ASSET_ID = 'd1000000-0000-4000-8000-000000000003';
const UNDER_SIBLING_ASSET_ID = 'd1000000-0000-4000-8000-000000000004';
const FRAME_CROP_SHAPE_ASSET_ID = FRAME_ASSET_ID;
const CLIPPED_SHAPE_ASSET_ID = 'd1000000-0000-4000-8000-000000000005';
const GRAPHIC_ID = 'd2000000-0000-4000-8000-000000000001';

// Stage canvas center for a 200x200 graphic centered at anchor (0,0) on 1920x1080 Stage is (0, 0) in layer-local space;
// projection places root at tx = -anchor.x - canvas.width / 2 = -100, ty = -100.
const BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 260" width="320" height="260"><path d="M 0 0 L 320 0 L 320 260 L 0 260 Z" fill="#224466" stroke="none" fill-rule="nonzero"/></svg>`;

// Non-zero viewBox (40, 30, 220, 180):
// 1. Outer square [60..140, 50..130] CW + inner hole [85..115, 75..105] CCW (nonzero leaves center empty).
// 2. Disjoint second island [200..240, 160..200], leaving center void around (170, 120) inside bbox.
// 3. Explicit stroke path (155, 60) -> (195, 60) with stroke-width="8".
const RING_ISLAND_STROKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="40 30 220 180" width="220" height="180"><path d="M 60 50 L 140 50 L 140 130 L 60 130 Z M 85 75 L 85 105 L 115 105 L 115 75 Z M 200 160 L 240 160 L 240 200 L 200 200 Z" transform="matrix(1 0 0 1 0 0)" fill="#ff5533" fill-opacity="1" stroke="none" fill-rule="nonzero"/><path d="M 155 60 L 195 60" transform="matrix(1 0 0 1 0 0)" fill="none" stroke="#112233" stroke-opacity="1" stroke-width="8" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="3"/></svg>`;

const UNDER_SIBLING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="70 40 130 100" width="130" height="100"><path d="M 70 40 L 200 40 L 200 140 L 70 140 Z" fill="#33aa77" stroke="none" fill-rule="nonzero"/></svg>`;

const CLIPPED_SHAPE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><path d="M 0 0 L 120 0 L 120 120 L 0 120 Z" fill="#aa44ff" stroke="none" fill-rule="nonzero"/></svg>`;

export function createSyntheticFlaShapeHitFixture(options?: {
  readonly groupTransform?: AffineMatrix2D;
  readonly shapeLocalTransform?: AffineMatrix2D;
}) {
  const project = migrateProject(exampleProject);
  const frameDuration = 1_000 / 24;
  const groupTransform =
    options?.groupTransform ??
    composeAffineMatrix({ tx: 0, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 });
  const shapeLocalTransform = options?.shapeLocalTransform ?? IDENTITY;

  const structure: FlaGraphicStructure = {
    version: 1,
    frames: [
      {
        ordinal: 0,
        layers: [
          {
            name: '图层_1',
            nodes: [
              {
                type: 'opaque',
                id: 'bg-root',
                sourceAddress: 'graphic:Synthetic/layer-0-frame-0/0',
                drawOrder: 0,
                localTransform: IDENTITY,
                opaqueKind: 'shape',
                sourceRef: 'fla-shape-bg-root',
                fallbackScope: 'subtree',
                fallbackAssetId: BG_ROOT_ASSET_ID,
                fallbackViewBox: { x: 0, y: 0, width: 320, height: 260 },
              },
              {
                type: 'group',
                id: 'group-outfit',
                sourceAddress: 'graphic:Synthetic/layer-0-frame-0/1',
                drawOrder: 1,
                localTransform: groupTransform,
                groupId: 'outfit-group',
                children: [
                  {
                    type: 'opaque',
                    id: 'under-sibling',
                    sourceAddress: 'graphic:Synthetic/layer-0-frame-0/1/0',
                    drawOrder: 0,
                    localTransform: IDENTITY,
                    opaqueKind: 'shape',
                    sourceRef: 'fla-shape-under',
                    fallbackScope: 'subtree',
                    fallbackAssetId: UNDER_SIBLING_ASSET_ID,
                    fallbackViewBox: { x: 70, y: 40, width: 130, height: 100 },
                  },
                  {
                    type: 'opaque',
                    id: 'shape-ring-island',
                    sourceAddress: 'graphic:Synthetic/layer-0-frame-0/1/1',
                    drawOrder: 1,
                    localTransform: shapeLocalTransform,
                    opaqueKind: 'shape',
                    sourceRef: 'fla-shape-ring',
                    fallbackScope: 'subtree',
                    fallbackAssetId: RING_SHAPE_ASSET_ID,
                    fallbackViewBox: { x: 40, y: 30, width: 220, height: 180 },
                  },
                  {
                    type: 'opaque',
                    id: 'shape-frame-crop',
                    sourceAddress: 'graphic:Synthetic/layer-0-frame-0/1/2',
                    drawOrder: 2,
                    localTransform: IDENTITY,
                    opaqueKind: 'shape',
                    sourceRef: 'fla-shape-crop',
                    fallbackScope: 'frame-crop',
                    fallbackAssetId: FRAME_CROP_SHAPE_ASSET_ID,
                    fallbackViewBox: { x: 265, y: 20, width: 30, height: 30 },
                  },
                  {
                    type: 'opaque',
                    id: 'shape-filter',
                    sourceAddress: 'graphic:Synthetic/layer-0-frame-0/1/3',
                    drawOrder: 3,
                    localTransform: IDENTITY,
                    opaqueKind: 'filter',
                    reason: 'Blur filter remains read-only',
                  },
                ],
              },
              {
                type: 'opaque',
                id: 'shape-clipped',
                sourceAddress: 'graphic:Synthetic/layer-0-frame-0/2',
                drawOrder: 2,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 220, ty: 20 },
                clipPaths: [
                  {
                    shapes: [
                      {
                        shapeId: 'mask-1',
                        worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 220, ty: 20 },
                        pathData: ['M 20 20 L 60 20 L 60 60 L 20 60 Z'],
                      },
                    ],
                  },
                ],
                opaqueKind: 'shape',
                sourceRef: 'fla-shape-clipped',
                fallbackScope: 'subtree',
                fallbackAssetId: CLIPPED_SHAPE_ASSET_ID,
                fallbackViewBox: { x: 0, y: 0, width: 120, height: 120 },
              },
            ],
          },
        ],
      },
    ],
  };

  const definition = FlaGraphicDefinitionSchema.parse({
    id: GRAPHIC_ID,
    kind: 'fla-graphic',
    name: 'Synthetic Shape Graphic',
    source: {
      basename: 'synthetic.fla',
      sha256: 'a'.repeat(64),
      renderTargetId: 'synthetic-target',
      targetKind: 'graphic-symbol',
      targetName: 'SyntheticGraphic',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 320, height: 260 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    durationMs: frameDuration,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: FRAME_ASSET_ID,
        sha256: 'b'.repeat(64),
        sourceViewport: { x: 0, y: 0, width: 320, height: 260 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: frameDuration,
        createdBySequenceImport: false,
      },
    ],
    structure,
  });

  const svgMap = new Map<string, { svg: string; width: number; height: number; name: string }>([
    [FRAME_ASSET_ID, { svg: BG_SVG, width: 320, height: 260, name: 'frame-0.svg' }],
    [BG_ROOT_ASSET_ID, { svg: BG_SVG, width: 320, height: 260, name: 'bg-root.svg' }],
    [RING_SHAPE_ASSET_ID, { svg: RING_ISLAND_STROKE_SVG, width: 220, height: 180, name: 'ring-shape.svg' }],
    [UNDER_SIBLING_ASSET_ID, { svg: UNDER_SIBLING_SVG, width: 130, height: 100, name: 'under-sibling.svg' }],
    [CLIPPED_SHAPE_ASSET_ID, { svg: CLIPPED_SHAPE_SVG, width: 120, height: 120, name: 'clipped.svg' }],
  ]);

  for (const [id, info] of svgMap) {
    project.assets.push({
      id,
      kind: 'image',
      name: info.name,
      relativePath: `assets/${info.name}`,
      mimeType: 'image/svg+xml',
      width: info.width,
      height: info.height,
      sha256: 'c'.repeat(64),
      usage: 'prop',
      keywords: [],
    });
  }
  project.animations.push(definition);

  const shot = project.shots[0]!;
  const templateLayer = shot.layers[0]!;
  const primaryLayerId = 'e1000000-0000-4000-8000-000000000001';
  const siblingInstanceLayerId = 'e1000000-0000-4000-8000-000000000002';
  shot.layers.push(
    {
      ...templateLayer,
      id: primaryLayerId,
      name: '小师妹实例A',
      source: { kind: 'animation', animationId: definition.id },
      startTimeMs: 0,
      animationPlayback: { mode: 'loop', endBehavior: 'hold' },
      zIndex: shot.layers.length,
    },
    {
      ...templateLayer,
      id: siblingInstanceLayerId,
      name: '小师妹实例B',
      source: { kind: 'animation', animationId: definition.id },
      startTimeMs: 0,
      animationPlayback: { mode: 'loop', endBehavior: 'hold' },
      zIndex: shot.layers.length + 1,
    },
  );

  const images = new Map<string, HTMLImageElement>();
  const svgTexts = new Map<string, string>();
  const assets = new Map<string, { width: number; height: number }>();
  for (const [id, info] of svgMap) {
    svgTexts.set(id, info.svg);
    assets.set(id, { width: info.width, height: info.height });
    images.set(id, {
      naturalWidth: info.width,
      naturalHeight: info.height,
      width: info.width,
      height: info.height,
      src: `data:image/svg+xml;utf8,${encodeURIComponent(info.svg)}`,
    } as HTMLImageElement);
  }

  return {
    project: ProjectSchema.parse(project),
    shotId: shot.id,
    primaryLayerId,
    siblingInstanceLayerId,
    definition,
    images,
    svgTexts,
    assets,
  };
}

// ============================================================================
// Minimal vector-backed Canvas2D rasterizer for Konva hitCanvas in happy-dom
// ============================================================================
interface Pt {
  readonly x: number;
  readonly y: number;
}
type Subpath = Pt[];
interface ClipEntry {
  readonly subpaths: readonly Subpath[];
  readonly rule: 'nonzero' | 'evenodd';
}
interface DrawOp {
  readonly kind: 'fill' | 'stroke';
  readonly color: string;
  readonly subpaths: readonly Subpath[];
  readonly rule: 'nonzero' | 'evenodd';
  readonly strokeHalfWidth: number;
  readonly clips: readonly ClipEntry[];
}

function applyM(m: AffineMatrix2D, x: number, y: number): Pt {
  return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
}

function pointInSubpaths(
  px: number,
  py: number,
  subpaths: readonly Subpath[],
  rule: 'nonzero' | 'evenodd',
): boolean {
  let winding = 0;
  for (const poly of subpaths) {
    if (poly.length < 3) continue;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if (a.y <= py) {
        if (b.y > py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) > 0) {
          winding += 1;
        }
      } else if (b.y <= py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) < 0) {
        winding -= 1;
      }
    }
  }
  return rule === 'evenodd' ? (Math.abs(winding) % 2) === 1 : winding !== 0;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointNearStroke(
  px: number,
  py: number,
  subpaths: readonly Subpath[],
  halfWidth: number,
): boolean {
  for (const poly of subpaths) {
    for (let i = 0; i + 1 < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[i + 1]!;
      if (distToSegment(px, py, a.x, a.y, b.x, b.y) <= halfWidth) return true;
    }
  }
  return false;
}

function parseHexRgb(color: string): [number, number, number] | null {
  const m = color.trim().match(/^#([0-9a-f]{6})$/iu);
  if (!m) return null;
  const hex = m[1]!;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function installVectorHitCanvasMock(): () => void {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const contexts = new WeakMap<HTMLCanvasElement, unknown>();

  const makeContext = () => {
    let matrix: AffineMatrix2D = { ...IDENTITY };
    let clips: ClipEntry[] = [];
    const stack: Array<{ matrix: AffineMatrix2D; clips: ClipEntry[]; lineWidth: number }> = [];
    let currentSubpaths: Pt[][] = [];
    let currentPoly: Pt[] | null = null;
    const ops: DrawOp[] = [];
    const state = {
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
    };

    const cloneSubpaths = (): Subpath[] =>
      currentSubpaths.map((poly) => poly.map((p) => ({ ...p })));

    const api = {
      get fillStyle() { return state.fillStyle; },
      set fillStyle(v: string) { state.fillStyle = v; },
      get strokeStyle() { return state.strokeStyle; },
      set strokeStyle(v: string) { state.strokeStyle = v; },
      get lineWidth() { return state.lineWidth; },
      set lineWidth(v: number) { state.lineWidth = v; },
      get lineCap() { return state.lineCap; },
      set lineCap(v: string) { state.lineCap = v; },
      get lineJoin() { return state.lineJoin; },
      set lineJoin(v: string) { state.lineJoin = v; },
      get miterLimit() { return state.miterLimit; },
      set miterLimit(v: number) { state.miterLimit = v; },
      get globalAlpha() { return state.globalAlpha; },
      set globalAlpha(v: number) { state.globalAlpha = v; },
      get globalCompositeOperation() { return state.globalCompositeOperation; },
      set globalCompositeOperation(v: string) { state.globalCompositeOperation = v; },
      save() {
        stack.push({ matrix: { ...matrix }, clips: [...clips], lineWidth: state.lineWidth });
      },
      restore() {
        const prev = stack.pop();
        if (prev) {
          matrix = prev.matrix;
          clips = prev.clips;
          state.lineWidth = prev.lineWidth;
        }
      },
      setTransform(a: number, b: number, c: number, d: number, tx: number, ty: number) {
        matrix = { a, b, c, d, tx, ty };
      },
      transform(a: number, b: number, c: number, d: number, tx: number, ty: number) {
        matrix = multiplyAffineMatrices(matrix, { a, b, c, d, tx, ty });
      },
      translate(tx: number, ty: number) {
        matrix = multiplyAffineMatrices(matrix, { a: 1, b: 0, c: 0, d: 1, tx, ty });
      },
      scale(sx: number, sy: number) {
        matrix = multiplyAffineMatrices(matrix, { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 });
      },
      rotate(rad: number) {
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        matrix = multiplyAffineMatrices(matrix, { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 });
      },
      clearRect() {
        ops.length = 0;
      },
      beginPath() {
        currentSubpaths = [];
        currentPoly = null;
      },
      moveTo(x: number, y: number) {
        currentPoly = [applyM(matrix, x, y)];
        currentSubpaths.push(currentPoly);
      },
      lineTo(x: number, y: number) {
        if (!currentPoly) {
          this.moveTo(x, y);
          return;
        }
        currentPoly.push(applyM(matrix, x, y));
      },
      quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
        if (!currentPoly) return;
        const p0 = currentPoly[currentPoly.length - 1]!;
        const pc = applyM(matrix, cx, cy);
        const p1 = applyM(matrix, x, y);
        const steps = 16;
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const u = 1 - t;
          currentPoly.push({
            x: u * u * p0.x + 2 * u * t * pc.x + t * t * p1.x,
            y: u * u * p0.y + 2 * u * t * pc.y + t * t * p1.y,
          });
        }
      },
      bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
        if (!currentPoly) return;
        const p0 = currentPoly[currentPoly.length - 1]!;
        const p1 = applyM(matrix, c1x, c1y);
        const p2 = applyM(matrix, c2x, c2y);
        const p3 = applyM(matrix, x, y);
        const steps = 16;
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const u = 1 - t;
          currentPoly.push({
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
          });
        }
      },
      closePath() {
        if (currentPoly && currentPoly.length > 0) {
          currentPoly.push({ ...currentPoly[0]! });
        }
      },
      rect(x: number, y: number, w: number, h: number) {
        const poly = [
          applyM(matrix, x, y),
          applyM(matrix, x + w, y),
          applyM(matrix, x + w, y + h),
          applyM(matrix, x, y + h),
          applyM(matrix, x, y),
        ];
        currentSubpaths.push(poly);
        currentPoly = poly;
      },
      clip(rule: 'nonzero' | 'evenodd' = 'nonzero') {
        clips.push({ subpaths: cloneSubpaths(), rule });
      },
      fill(rule: 'nonzero' | 'evenodd' = 'nonzero') {
        ops.push({
          kind: 'fill',
          color: String(state.fillStyle),
          subpaths: cloneSubpaths(),
          rule: rule === 'evenodd' ? 'evenodd' : 'nonzero',
          strokeHalfWidth: 0,
          clips: [...clips],
        });
      },
      fillRect(x: number, y: number, w: number, h: number) {
        this.beginPath();
        this.rect(x, y, w, h);
        this.fill('nonzero');
      },
      stroke() {
        const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
        ops.push({
          kind: 'stroke',
          color: String(state.strokeStyle),
          subpaths: cloneSubpaths(),
          rule: 'nonzero',
          strokeHalfWidth: (state.lineWidth * scale) / 2,
          clips: [...clips],
        });
      },
      drawImage() {},
      getImageData(px: number, py: number) {
        for (let i = ops.length - 1; i >= 0; i -= 1) {
          const op = ops[i]!;
          if (!op.clips.every((c) => pointInSubpaths(px, py, c.subpaths, c.rule))) {
            continue;
          }
          const hit =
            op.kind === 'fill'
              ? pointInSubpaths(px, py, op.subpaths, op.rule)
              : pointNearStroke(px, py, op.subpaths, op.strokeHalfWidth);
          if (!hit) continue;
          const rgb = parseHexRgb(op.color);
          if (rgb) {
            return { data: new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]) };
          }
        }
        return { data: new Uint8ClampedArray([0, 0, 0, 0]) };
      },
      setLineDash() {},
    };
    return api;
  };

  HTMLCanvasElement.prototype.getContext = (function (
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    if (type !== '2d') return originalGetContext.call(this, type as never, ...(rest as [never]));
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = makeContext();
      contexts.set(this, ctx);
    }
    return ctx as never;
  }) as typeof HTMLCanvasElement.prototype.getContext;

  return () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function clickStageAt(stage: Konva.Stage, x: number, y: number): void {
  const internalStage = stage as Konva.Stage & {
    _pointerdown: (evt: Record<string, unknown>) => void;
    _pointerup: (evt: Record<string, unknown>) => void;
  };
  const rect = stage.container().getBoundingClientRect();
  const baseEvt = {
    clientX: rect.left + x,
    clientY: rect.top + y,
    button: 0,
    pointerId: 1,
    preventDefault() {},
  };
  internalStage._pointerdown({ ...baseEvt, type: 'mousedown', buttons: 1 });
  internalStage._pointerup({ ...baseEvt, type: 'mouseup', buttons: 0 });
}

describe('FLA Shape SVG hit geometry (S1) and whole-block transform closed loop (S2)', () => {
  let restoreCanvasMock: (() => void) | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    selectionStore.clear();
    timelineUiStore.setFlaGraphicInternalContext(null);
    restoreCanvasMock = installVectorHitCanvasMock();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container?.remove();
    container = null;
    restoreCanvasMock?.();
    restoreCanvasMock = null;
  });

  it('S1: picks filled contours & strokes through Konva Stage while piercing holes, bbox voids, clips, and Group scopes', () => {
    const fixture = createSyntheticFlaShapeHitFixture();
    const frame = fixture.definition.structure!.frames[0]!;
    const onSelect = vi.fn();
    const onEnter = vi.fn();
    const root = createRoot(container!);

    const renderProjection = (input: {
      scopePath: readonly string[];
      selectedNodePathKey?: string | null;
    }) => {
      act(() => {
        root.render(
          createElement(
            Stage,
            { width: 600, height: 500 },
            createElement(
              KonvaLayer,
              { listening: true },
              createElement(FlaGraphicStructureProjection, {
                definition: fixture.definition,
                frame,
                images: fixture.images,
                svgTexts: fixture.svgTexts,
                assets: fixture.assets,
                scopePath: input.scopePath,
                selectedNodePathKey: input.selectedNodePathKey ?? null,
                draftMatrices: {},
                layerLocked: false,
                scopeParentNodeRef: createRef<Konva.Group | null>(),
                selectedNodeRef: createRef<Konva.Group | null>(),
                onSelect,
                onEnter,
                onTransformPreview: vi.fn(),
                onCommitTransform: vi.fn(),
                onError: vi.fn(),
              }),
            ),
          ),
        );
      });
    };

    // Projection root shifts graphic (0, 0) to (-160, -130) inside the Layer.
    const toStage = (gx: number, gy: number) => ({ x: gx - 160 + 200, y: gy - 130 + 200 });
    // Actually projection root is at tx = -anchor.x - canvas.width/2 = -160, ty = -130 without any extra Stage offset:
    // Graphic coord (gx, gy) is at Stage pixel (gx - 160, gy - 130). Choose points with gx >= 160?
    // Wait: let's mount inside KonvaGroup or Stage? In Stage (600x500), positive points are x >= 160, y >= 130,
    // OR we wrap FlaGraphicStructureProjection in Stage with x=200, y=200!
    // Re-render inside a positioned Stage!
    const stageAt = (gx: number, gy: number) => ({ x: 200 + gx - 160, y: 200 + gy - 130 });
    const renderWithOffset = (input: {
      scopePath: readonly string[];
      selectedNodePathKey?: string | null;
    }) => {
      act(() => {
        root.render(
          createElement(
            Stage,
            { width: 600, height: 500, x: 200, y: 200 },
            createElement(
              KonvaLayer,
              { listening: true },
              createElement(FlaGraphicStructureProjection, {
                definition: fixture.definition,
                frame,
                images: fixture.images,
                svgTexts: fixture.svgTexts,
                assets: fixture.assets,
                scopePath: input.scopePath,
                selectedNodePathKey: input.selectedNodePathKey ?? null,
                draftMatrices: {},
                layerLocked: false,
                scopeParentNodeRef: createRef<Konva.Group | null>(),
                selectedNodeRef: createRef<Konva.Group | null>(),
                onSelect,
                onEnter,
                onTransformPreview: vi.fn(),
                onCommitTransform: vi.fn(),
                onError: vi.fn(),
              }),
            ),
          ),
        );
      });
    };
    void toStage;

    // 1. Outside group (`scopePath = []`): clicking painted fill of ring selects parent Group!
    renderWithOffset({ scopePath: [] });
    const stage = Konva.stages[Konva.stages.length - 1]!;
    stage.getLayers()[0]!.drawHit();

    onSelect.mockClear();
    const fillPt = stageAt(70, 90);
    clickStageAt(stage, fillPt.x, fillPt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['group-outfit']);

    // Clicking disjoint island also bubbles to parent Group.
    onSelect.mockClear();
    const islandPt = stageAt(220, 180);
    clickStageAt(stage, islandPt.x, islandPt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['group-outfit']);

    // Clicking inside the empty center of the bbox (180, 150) — outside both ring, island, and under-sibling — pierces to bg-root!
    onSelect.mockClear();
    const emptyBboxPt = stageAt(180, 150);
    clickStageAt(stage, emptyBboxPt.x, emptyBboxPt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['bg-root']);

    // 2. Tree-selected Shape while outside Group MUST NOT re-enable a giant Rect!
    renderWithOffset({
      scopePath: [],
      selectedNodePathKey: JSON.stringify(['group-outfit', 'shape-ring-island']),
    });
    stage.getLayers()[0]!.drawHit();

    onSelect.mockClear();
    clickStageAt(stage, emptyBboxPt.x, emptyBboxPt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['bg-root']);

    onSelect.mockClear();
    clickStageAt(stage, fillPt.x, fillPt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['group-outfit', 'shape-ring-island']);

    // 3. Inside `group-outfit` (`scopePath = ['group-outfit']`):
    renderWithOffset({ scopePath: ['group-outfit'] });
    stage.getLayers()[0]!.drawHit();

    // Fill wall hits `shape-ring-island`.
    onSelect.mockClear();
    clickStageAt(stage, fillPt.x, fillPt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['group-outfit', 'shape-ring-island']);

    // Empty hole at (100, 90) pierces `shape-ring-island` and selects `under-sibling` underneath!
    onSelect.mockClear();
    const holePt = stageAt(100, 90);
    clickStageAt(stage, holePt.x, holePt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['group-outfit', 'under-sibling']);

    // Stroke path at y=60, width=8 (y in [56, 64]):
    // Point at (175, 62) is inside stroke -> selects `shape-ring-island` (even though `under-sibling` is directly below!).
    onSelect.mockClear();
    const nearStrokePt = stageAt(175, 62);
    clickStageAt(stage, nearStrokePt.x, nearStrokePt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['group-outfit', 'shape-ring-island']);

    // Point at (175, 66) is outside stroke half-width 4 -> misses `shape-ring-island` and hits `under-sibling`!
    onSelect.mockClear();
    const outsideStrokePt = stageAt(175, 66);
    clickStageAt(stage, outsideStrokePt.x, outsideStrokePt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['group-outfit', 'under-sibling']);

    // 4. Graphic `clipPaths` also clip the hit region on `shape-clipped`:
    // `shape-clipped` covers [220..340, 20..140] but its clipPath covers only [240..280, 40..80].
    renderWithOffset({ scopePath: [] });
    stage.getLayers()[0]!.drawHit();

    onSelect.mockClear();
    const insideClipPt = stageAt(260, 60);
    clickStageAt(stage, insideClipPt.x, insideClipPt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['shape-clipped']);

    onSelect.mockClear();
    const outsideClipPt = stageAt(300, 100);
    clickStageAt(stage, outsideClipPt.x, outsideClipPt.y);
    expect(onSelect).toHaveBeenLastCalledWith(['bg-root']);

    void renderProjection;
    act(() => root.unmount());
  });

  it('S2: transforms a non-zero-viewBox Shape under parent 50% scale & rotation once without double-applying offsets and aligns UI hints', () => {
    const parentTransform = composeAffineMatrix({
      tx: 30,
      ty: 20,
      rotationDeg: 30,
      scaleX: 0.5,
      scaleY: 0.5,
    });
    const fixture = createSyntheticFlaShapeHitFixture({ groupTransform: parentTransform });
    const shapePath = ['group-outfit', 'shape-ring-island'];
    const cropPath = ['group-outfit', 'shape-frame-crop'];
    const filterPath = ['group-outfit', 'shape-filter'];

    const editor = editorProjectStore;
    editor.open('D:\\PandaStage-Acceptance\\shape-s2.pandastage', fixture.project);
    shotStore.select(fixture.shotId);
    selectionStore.select(fixture.primaryLayerId);
    const frame = fixture.definition.structure!.frames[0]!;
    const editTarget = resolveFlaGraphicEditTarget({
      project: editor.getSnapshot()!.project,
      projectRoot: editor.getSnapshot()!.projectRoot,
      projectInstanceId: editor.getProjectInstanceId(),
      shot: editor.getSnapshot()!.project.shots.find((s) => s.id === fixture.shotId)!,
      layerId: fixture.primaryLayerId,
    })!;
    selectionStore.setStructuredEditScope({
      targetKey: editTarget.key,
      sessionKey: editTarget.sessionKey,
      editMode: 'instance',
      frameOrdinal: 0,
      path: ['group-outfit'],
    });

    const ringNode = fixture.definition.structure!.frames[0]!.layers[0]!.nodes[1]!;
    if (ringNode.type !== 'group') throw new Error('Expected group node');
    const shapeLeaf = ringNode.children.find((n) => n.id === 'shape-ring-island')!;
    const cropLeaf = ringNode.children.find((n) => n.id === 'shape-frame-crop')!;
    const filterLeaf = ringNode.children.find((n) => n.id === 'shape-filter')!;

    expect(isFlaGraphicEditableSubtreeShapeNode(shapeLeaf)).toBe(true);
    expect(isFlaGraphicNodeTransformable(shapeLeaf)).toBe(true);
    expect(flaGraphicNodeCanTransform(shapeLeaf)).toBe(true);
    expect(flaGraphicNodeCanTransform(cropLeaf)).toBe(false);
    expect(flaGraphicNodeCanTransform(filterLeaf)).toBe(false);

    // 1. UI hint alignment: editable subtree shape omits LockKeyhole and adds concise tooltip;
    // truly read-only frame-crop & filter keep LockKeyhole, and CanvasToolbar clears readonly badge for subtree shape.
    const root = createRoot(container!);
    selectionStore.setSelectedStructuredNodePath(shapePath);
    act(() => root.render(createElement(FlaGraphicStructureTree)));
    const shapeRows = [...container!.querySelectorAll('[aria-label="形状"]')] as HTMLElement[];
    expect(shapeRows).toHaveLength(5);
    const ringRow = shapeRows[2]!;
    const cropRow = shapeRows[3]!;
    expect(ringRow.querySelector('[aria-label="当前对象只读"]')).toBeNull();
    expect(ringRow.querySelector('[title*="整块变换"]')).not.toBeNull();
    expect(cropRow.querySelector('[aria-label="当前对象只读"]')).not.toBeNull();
    expect(container!.querySelectorAll('[aria-label="当前对象只读"]')).toHaveLength(2);

    const toolbarShape = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        mode: 'fit',
        point: null,
        transform: calculateViewportTransform({ width: 960, height: 540 }, 'fit'),
        flaGraphicEditAvailable: true,
        flaGraphicEditActive: true,
        readOnlySelected: !flaGraphicNodeCanTransform(shapeLeaf),
      }),
    );
    expect(toolbarShape).not.toContain('当前对象只读');

    const toolbarCrop = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        mode: 'fit',
        point: null,
        transform: calculateViewportTransform({ width: 960, height: 540 }, 'fit'),
        flaGraphicEditAvailable: true,
        flaGraphicEditActive: true,
        readOnlySelected: !flaGraphicNodeCanTransform(cropLeaf),
      }),
    );
    expect(toolbarCrop).toContain('当前对象只读');

    // 2. Transform projection under parent 50% scale + 30deg rotation and non-zero viewBox (40, 30):
    // Move +15, -10, scale 1.4x, rotate +18deg in parent-local node space.
    const desiredNodeLocal = composeAffineMatrix({
      tx: 15,
      ty: -10,
      rotationDeg: 18,
      scaleX: 1.4,
      scaleY: 1.4,
    });
    const visualLocal = multiplyAffineMatrices(desiredNodeLocal, {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      tx: 40,
      ty: 30,
    });
    const absoluteTarget = multiplyAffineMatrices(parentTransform, visualLocal);
    const onCommitTransform = vi.fn();

    const projection = FlaGraphicStructureProjection({
      definition: fixture.definition,
      frame,
      images: fixture.images,
      svgTexts: fixture.svgTexts,
      assets: fixture.assets,
      scopePath: ['group-outfit'],
      selectedNodePathKey: JSON.stringify(shapePath),
      draftMatrices: {},
      layerLocked: false,
      scopeParentNodeRef: {
        current: {
          getAbsoluteTransform: () => ({
            getMatrix: () => [
              parentTransform.a,
              parentTransform.b,
              parentTransform.c,
              parentTransform.d,
              parentTransform.tx,
              parentTransform.ty,
            ],
          }),
        },
      } as never,
      selectedNodeRef: createRef(),
      onSelect: vi.fn(),
      onEnter: vi.fn(),
      onTransformPreview: vi.fn(),
      onCommitTransform,
      onError: vi.fn(),
    });
    const findNode = (node: unknown): { props: Record<string, unknown> } | null => {
      if (Array.isArray(node)) {
        for (const item of node) {
          const hit = findNode(item);
          if (hit) return hit;
        }
        return null;
      }
      if (!node || typeof node !== 'object' || !('props' in node)) return null;
      const el = node as { props: Record<string, unknown> };
      if (el.props.name === 'fla-structure-node-shape-ring-island') return el;
      return findNode(el.props.children);
    };
    const shapeGroup = findNode(projection);
    expect(shapeGroup?.props.draggable).toBe(true);
    const onTransformEnd = shapeGroup?.props.onTransformEnd as (e: {
      cancelBubble: boolean;
      target: {
        getAbsoluteTransform: () => { getMatrix: () => number[] };
        setAttrs: (a: Record<string, unknown>) => void;
      };
    }) => void;
    onTransformEnd({
      cancelBubble: false,
      target: {
        getAbsoluteTransform: () => ({
          getMatrix: () => [
            absoluteTarget.a,
            absoluteTarget.b,
            absoluteTarget.c,
            absoluteTarget.d,
            absoluteTarget.tx,
            absoluteTarget.ty,
          ],
        }),
        setAttrs: vi.fn(),
      },
    });
    expect(onCommitTransform).toHaveBeenCalledTimes(1);
    const committedMatrix = onCommitTransform.mock.calls[0]![1] as AffineMatrix2D;
    for (const k of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
      expect(committedMatrix[k]).toBeCloseTo(desiredNodeLocal[k], 8);
    }

    // 3. Apply committed transform via LayerStore and verify formal evaluator + renderFlaGraphicCanvas + FlaGraphicChildTransform parity:
    act(() => {
      layerStore.updateFlaGraphicInstanceTransform(
        fixture.primaryLayerId,
        0,
        shapePath,
        committedMatrix,
      );
    });
    const primaryLayer = editor
      .getSnapshot()!
      .project.shots[0]!.layers.find((l) => l.id === fixture.primaryLayerId)!;
    const siblingLayer = editor
      .getSnapshot()!
      .project.shots[0]!.layers.find((l) => l.id === fixture.siblingInstanceLayerId)!;

    const evalPrimary = evaluateFlaGraphicVisual({
      definition: fixture.definition,
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides: primaryLayer.flaGraphicInstanceTransformOverrides,
    })!;
    const evalSibling = evaluateFlaGraphicVisual({
      definition: fixture.definition,
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides: siblingLayer.flaGraphicInstanceTransformOverrides,
    })!;
    const primaryLeaf = evalPrimary.layers![0]!.nodes[1]!.children[1]!;
    const siblingLeaf = evalSibling.layers![0]!.nodes[1]!.children[1]!;

    // Primary matches exact target worldTransform (parent * desiredLocal * viewBox), NOT double-translated!
    for (const k of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
      expect(primaryLeaf.worldTransform[k]).toBeCloseTo(absoluteTarget[k], 8);
      expect(siblingLeaf.worldTransform[k]).toBeCloseTo(
        multiplyAffineMatrices(parentTransform, { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 30 })[k],
        8,
      );
    }

    // Inspector numeric form displays authored node-local (tx=15, ty=-10), NOT +viewBox(55, 20):
    expect(unapplyFlaGraphicSubtreeViewBox(shapeLeaf, primaryLeaf.localTransform).tx).toBeCloseTo(15, 6);
    expect(unapplyFlaGraphicSubtreeViewBox(shapeLeaf, primaryLeaf.localTransform).ty).toBeCloseTo(-10, 6);

    // Attempting to override frame-crop stays ignored:
    const beforeCropRev = editor.getSnapshot()!.revision;
    const service = new LayerService();
    const afterCropAttempt = service.updateFlaGraphicInstanceTransform(
      editor.getSnapshot()!.project,
      fixture.shotId,
      fixture.primaryLayerId,
      0,
      cropPath,
      desiredNodeLocal,
    );
    expect(afterCropAttempt).toBe(editor.getSnapshot()!.project);
    expect(editor.getSnapshot()!.revision).toBe(beforeCropRev);

    // Numeric FlaGraphicChildTransform renders enabled fieldset for shape:
    act(() => root.render(createElement(FlaGraphicChildTransform)));
    const fieldset = container!.querySelector('fieldset')!;
    expect(fieldset.disabled).toBe(false);
    expect(Number((container!.querySelector('input[name="x"]') as HTMLInputElement).value)).toBeCloseTo(15, 2);

    // Undo / Redo:
    expect(editor.history.getSnapshot().undoCount).toBe(1);
    act(() => { editor.undo(); });
    const afterUndoLayer = editor
      .getSnapshot()!
      .project.shots[0]!.layers.find((l) => l.id === fixture.primaryLayerId)!;
    expect(afterUndoLayer.flaGraphicInstanceTransformOverrides).toBeUndefined();
    act(() => { editor.redo(); });
    const afterRedoLayer = editor
      .getSnapshot()!
      .project.shots[0]!.layers.find((l) => l.id === fixture.primaryLayerId)!;
    expect(afterRedoLayer.flaGraphicInstanceTransformOverrides).toBeDefined();

    // Shared raster renderer produces a valid canvas with non-null rect.
    const raster = renderFlaGraphicCanvas(evalPrimary, fixture.images);
    expect(raster).not.toBeNull();
    expect(parseFlaSvgShapeHitGeometry(RING_ISLAND_STROKE_SVG).primitives).toHaveLength(2);

    void filterPath;
    void selectionStore;
    act(() => root.unmount());
  });
});
