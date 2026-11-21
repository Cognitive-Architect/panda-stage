// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  buildAdaptivePartsFromFlaGraphicSubtrees,
  buildSvgFromFlaEditableShapeRegions,
  characterPartSourceBounds,
  decomposeSvgToEditableShapeRegions,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  isFlaGraphicDefinition,
  listFlaShapeRegionVertices,
  migrateProject,
  moveFlaShapeRegionVertex,
  pickFlaShapeRegionAtPoint,
  resolveLayerVisualParts,
  type FlaEditableShapeRegion,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type Layer,
} from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';
import { resolveFlaGraphicEditTarget } from '../../src/renderer/features/canvas/flaGraphicEditScope';
import { renderFlaGraphicCanvas } from '../../src/renderer/features/canvas/flaGraphicCanvasRenderer';
import { drawFlaVectorVisualHitRegion } from '../../src/renderer/features/canvas/flaSvgShapeHit';
import { FlaGraphicStructureTree } from '../../src/renderer/features/properties/FlaGraphicStructureTree';
import { FlaGraphicChildTransform } from '../../src/renderer/features/properties/FlaGraphicChildTransform';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as const;
const FRAME_ASSET_ID = 'e1000000-0000-4000-8000-000000000001';
const RING_SHAPE_ASSET_ID = 'e1000000-0000-4000-8000-000000000002';
const GRAPHIC_ID = 'e2000000-0000-4000-8000-000000000001';
const PRIMARY_LAYER_ID = 'e3000000-0000-4000-8000-000000000001';
const CHAR_LAYER_ID = 'e3000000-0000-4000-8000-000000000002';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RING_ISLAND_STROKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="40 30 220 180" width="220" height="180"><path d="M 60 50 L 140 50 L 140 130 L 60 130 Z M 85 75 L 85 105 L 115 105 L 115 75 Z M 200 160 L 240 160 L 240 200 L 200 200 Z" transform="matrix(1 0 0 1 0 0)" fill="#ff5533" fill-opacity="1" stroke="none" fill-rule="nonzero"/><path d="M 155 60 L 195 60" transform="matrix(1 0 0 1 0 0)" fill="none" stroke="#112233" stroke-opacity="1" stroke-width="8" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="3"/></svg>`;

const MULTI_REGION_CLEAN_STROKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" width="240" height="200"><path d="M 20 20 L 100 20 L 100 100 L 20 100 Z M 45 45 L 45 75 L 75 75 L 75 45 Z" fill="#ff5533" fill-opacity="1" stroke="none" fill-rule="nonzero"/><path d="M 20 20 L 100 20" fill="none" stroke="#112233" stroke-opacity="1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="3"/><path d="M 140 110 Q 170 90 210 110 L 210 170 L 140 170 Z" fill="#3366cc" fill-opacity="1" stroke="none" fill-rule="nonzero"/></svg>`;

const AMBIGUOUS_AND_BITMAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" width="240" height="140"><defs><pattern id="bmp-pattern" width="10" height="10" patternUnits="userSpaceOnUse"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" width="10" height="10"/></pattern><linearGradient id="grad-1" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#112233"/><stop offset="1" stop-color="#44aaff"/></linearGradient></defs><path d="M 10 10 L 60 10 L 60 60 L 10 60 Z" fill="#aa2233" stroke="none" fill-rule="nonzero"/><path d="M 120 10 L 170 10 L 170 60 L 120 60 Z" fill="#22aa55" stroke="none" fill-rule="nonzero"/><path d="M 60 35 L 120 35" fill="none" stroke="#000000" stroke-width="4"/><path d="M 10 80 L 70 80 L 70 130 L 10 130 Z" fill="url(#bmp-pattern)" stroke="none" fill-rule="nonzero"/><path d="M 120 80 L 190 80 L 190 130 L 120 130 Z" fill="url(#grad-1)" stroke="none" fill-rule="nonzero"/><path d="M 195 20 L 230 20" fill="none" stroke="#9933ff" stroke-width="5"/></svg>`;

function buildShapeTestFixture() {
  const project = migrateProject(exampleProject);
  const frameDuration = 1_000 / 24;
  const ringPath = ['group-outfit', 'shape-ring-island'];
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
                type: 'group',
                id: 'group-outfit',
                sourceAddress: 'graphic:Synthetic/layer-0-frame-0/0',
                drawOrder: 0,
                localTransform: IDENTITY,
                groupId: 'outfit',
                children: [
                  {
                    type: 'opaque',
                    id: 'shape-ring-island',
                    sourceAddress: 'graphic:Synthetic/layer-0-frame-0/0/0',
                    drawOrder: 0,
                    localTransform: IDENTITY,
                    opaqueKind: 'shape',
                    sourceRef: 'fla-shape-ring',
                    fallbackScope: 'subtree',
                    fallbackAssetId: RING_SHAPE_ASSET_ID,
                    fallbackViewBox: { x: 40, y: 30, width: 220, height: 180 },
                  },
                ],
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
  project.assets.push(
    {
      id: FRAME_ASSET_ID,
      kind: 'image',
      name: 'frame.svg',
      relativePath: 'assets/frame.svg',
      mimeType: 'image/svg+xml',
      width: 320,
      height: 260,
      sha256: 'b'.repeat(64),
      usage: 'prop',
      keywords: [],
    },
    {
      id: RING_SHAPE_ASSET_ID,
      kind: 'image',
      name: 'ring.svg',
      relativePath: 'assets/ring.svg',
      mimeType: 'image/svg+xml',
      width: 220,
      height: 180,
      sha256: 'c'.repeat(64),
      usage: 'prop',
      keywords: [],
    },
  );
  project.animations.push(definition);
  const shot = project.shots[0]!;
  const templateLayer = shot.layers[0]!;
  const primaryLayerId = PRIMARY_LAYER_ID;
  shot.layers.push({
    ...templateLayer,
    id: primaryLayerId,
    name: '小师妹实例A',
    source: { kind: 'animation', animationId: definition.id },
    startTimeMs: 0,
    animationPlayback: { mode: 'loop', endBehavior: 'hold' },
    zIndex: shot.layers.length,
  });
  return {
    project: ProjectSchema.parse(project),
    shotId: shot.id,
    layerId: primaryLayerId,
    graphicId: definition.id,
    ringPath,
  };
}

function makeCanvas2dMock() {
  const ops: Array<{ op: string; args: unknown[] }> = [];
  const ctx = {
    save: () => ops.push({ op: 'save', args: [] }),
    restore: () => ops.push({ op: 'restore', args: [] }),
    setTransform: (...args: unknown[]) => ops.push({ op: 'setTransform', args }),
    translate: (...args: unknown[]) => ops.push({ op: 'translate', args }),
    beginPath: () => ops.push({ op: 'beginPath', args: [] }),
    moveTo: (...args: unknown[]) => ops.push({ op: 'moveTo', args }),
    lineTo: (...args: unknown[]) => ops.push({ op: 'lineTo', args }),
    quadraticCurveTo: (...args: unknown[]) => ops.push({ op: 'quadraticCurveTo', args }),
    bezierCurveTo: (...args: unknown[]) => ops.push({ op: 'bezierCurveTo', args }),
    closePath: () => ops.push({ op: 'closePath', args: [] }),
    fill: (...args: unknown[]) => ops.push({ op: 'fill', args }),
    stroke: (...args: unknown[]) => ops.push({ op: 'stroke', args }),
    clearRect: () => {},
    drawImage: (...args: unknown[]) => ops.push({ op: 'drawImage', args }),
    getImageData: () => ({ data: new Uint8ClampedArray(16) }),
    putImageData: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    globalCompositeOperation: 'source-over',
  };
  return { ctx, ops };
}

describe('FLA Shape S3-A / S3-B region extraction and vector editing', () => {
  const originalCreateElement = document.createElement.bind(document);
  const originalPath2D = globalThis.Path2D;
  let mountedContainer: HTMLDivElement | null = null;
  let mountedRoot: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    selectionStore.clear();
  });

  afterEach(() => {
    globalThis.Path2D = originalPath2D;
    document.createElement = originalCreateElement;
    if (mountedRoot) {
      act(() => {
        mountedRoot?.unmount();
      });
      mountedRoot = null;
    }
    if (mountedContainer) {
      mountedContainer.remove();
      mountedContainer = null;
    }
    selectionStore.clear();
  });

  it('decomposes outer+hole + disjoint island + adjacent strokes deterministically and detects BitmapFill / ambiguous strokes locally', () => {
    const first = decomposeSvgToEditableShapeRegions(RING_ISLAND_STROKE_SVG);
    const second = decomposeSvgToEditableShapeRegions(RING_ISLAND_STROKE_SVG);
    expect(first.regions).toHaveLength(2);
    expect(first.regions.map((r) => r.regionRef)).toEqual(
      second.regions.map((r) => r.regionRef),
    );
    expect(first.regions[0]!.contours).toHaveLength(2);
    expect(first.regions[0]!.bounds).toEqual({
      x: 60,
      y: 50,
      width: 80,
      height: 80,
    });
    expect(first.regions[1]!.contours).toHaveLength(1);
    expect(first.regions[1]!.bounds).toEqual({
      x: 200,
      y: 160,
      width: 40,
      height: 40,
    });

    expect(pickFlaShapeRegionAtPoint(first.regions, 70, 60)?.regionRef).toBe(
      first.regions[0]!.regionRef,
    );
    expect(pickFlaShapeRegionAtPoint(first.regions, 100, 90)).toBeNull();
    expect(pickFlaShapeRegionAtPoint(first.regions, 170, 120)).toBeNull();
    expect(pickFlaShapeRegionAtPoint(first.regions, 220, 180)?.regionRef).toBe(
      first.regions[1]!.regionRef,
    );

    const clean = decomposeSvgToEditableShapeRegions(MULTI_REGION_CLEAN_STROKE_SVG);
    expect(clean.regions).toHaveLength(2);
    expect(clean.ambiguousRegionRefs.size).toBe(0);
    expect(clean.regions[0]!.strokes).toHaveLength(1);
    expect(clean.regions[1]!.strokes).toHaveLength(0);

    expect(first.residueStrokes).toHaveLength(1);

    const mixed = decomposeSvgToEditableShapeRegions(AMBIGUOUS_AND_BITMAP_SVG);
    expect(mixed.regions).toHaveLength(4);
    expect(mixed.hasUnrenderableResidue).toBe(true);
    expect(mixed.residueStrokes).toHaveLength(2);
    expect(mixed.ambiguousRegionRefs.has(mixed.regions[0]!.regionRef)).toBe(true);
    expect(mixed.ambiguousRegionRefs.has(mixed.regions[1]!.regionRef)).toBe(true);
    expect(mixed.bitmapFillRegionRefs.has(mixed.regions[2]!.regionRef)).toBe(true);
    expect(mixed.regions[2]!.fill.kind).toBe('preserved');
    expect(mixed.regions[3]!.fill.kind).toBe('gradient-ref');
  });

  it('extracts a region independently per Layer with Undo/Redo, shared Definition isolation, and Layer duplication', () => {
    const fixture = buildShapeTestFixture();
    const service = new LayerService();
    const duplicated = service.duplicateAnimationLayer(
      fixture.project,
      fixture.shotId,
      fixture.layerId,
    );
    const layerA = fixture.layerId;
    const layerB = duplicated.layer.id;
    const regions = decomposeSvgToEditableShapeRegions(RING_ISLAND_STROKE_SVG).regions;
    const regionA = regions[0]!;
    const regionB = regions[1]!;

    editorProjectStore.open('C:\\dummy\\proj', duplicated.project);
    shotStore.select(fixture.shotId);
    selectionStore.selectExplicit(layerA);

    const extracted = layerStore.extractFlaGraphicShapeRegion({
      layerId: layerA,
      frameOrdinal: 0,
      nodePath: fixture.ringPath,
      regionRef: regionA.regionRef,
      mode: 'instance',
      svgText: RING_ISLAND_STROKE_SVG,
      displayName: '区域 1',
    });

    expect(extracted.extractedNodePath).toEqual([
      ...fixture.ringPath.slice(0, -1),
      `${fixture.ringPath.at(-1)}::${regionA.regionRef}`,
    ]);

    const afterProject = editorProjectStore.getSnapshot()!.project;
    const defAfter = afterProject.animations.find(
      (a): a is FlaGraphicDefinition => a.id === fixture.graphicId && isFlaGraphicDefinition(a),
    )!;
    const layerAData = afterProject.shots[0]!.layers.find((l) => l.id === layerA)!;
    const layerBData = afterProject.shots[0]!.layers.find((l) => l.id === layerB)!;

    expect(layerBData.flaGraphicInstanceShapeOverrides).toBeUndefined();
    const evalA = evaluateFlaGraphicVisual({
      definition: defAfter,
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides: layerAData.flaGraphicInstanceTransformOverrides,
      instanceShapeOverrides: layerAData.flaGraphicInstanceShapeOverrides,
    })!;
    const evalB = evaluateFlaGraphicVisual({
      definition: defAfter,
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides: layerBData.flaGraphicInstanceTransformOverrides,
      instanceShapeOverrides: layerBData.flaGraphicInstanceShapeOverrides,
    })!;
    const groupNodesA = evalA.layers![0]!.nodes[0]!.children;
    const sourceNodeA = groupNodesA.find(
      (n) => JSON.stringify(n.path) === JSON.stringify(fixture.ringPath),
    )!;
    const extractedNodeA = groupNodesA.find(
      (n) => JSON.stringify(n.path) === JSON.stringify(extracted.extractedNodePath),
    )!;
    expect(sourceNodeA.vectorVisual?.regions.map((r) => r.regionRef)).toEqual([
      regionB.regionRef,
    ]);
    expect(sourceNodeA.vectorVisual?.residueStrokes).toHaveLength(1);
    expect(extractedNodeA.vectorVisual?.regions.map((r) => r.regionRef)).toEqual([
      regionA.regionRef,
    ]);
    expect(extractedNodeA.vectorVisual?.residueStrokes).toBeUndefined();

    layerStore.updateFlaGraphicInstanceTransform(layerA, 0, extracted.extractedNodePath, {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      tx: 45,
      ty: -20,
    });
    const movedEvalA = evaluateFlaGraphicVisual({
      definition: defAfter,
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides:
        editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === layerA)!
          .flaGraphicInstanceTransformOverrides,
      instanceShapeOverrides:
        editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === layerA)!
          .flaGraphicInstanceShapeOverrides,
    })!;
    const movedExtracted = movedEvalA.layers![0]!.nodes[0]!.children.find(
      (n) => JSON.stringify(n.path) === JSON.stringify(extracted.extractedNodePath),
    )!;
    const unmovedSource = movedEvalA.layers![0]!.nodes[0]!.children.find(
      (n) => JSON.stringify(n.path) === JSON.stringify(fixture.ringPath),
    )!;
    expect(movedExtracted.authoredLocalTransform.tx).toBeCloseTo(45, 6);
    expect(movedExtracted.authoredLocalTransform.ty).toBeCloseTo(-20, 6);
    expect(unmovedSource.authoredLocalTransform.tx).toBe(0);

    const groupNodesB = evalB.layers![0]!.nodes[0]!.children;
    expect(
      groupNodesB.some(
        (n) => JSON.stringify(n.path) === JSON.stringify(extracted.extractedNodePath),
      ),
    ).toBe(false);

    const dupA = service.duplicateAnimationLayer(
      editorProjectStore.getSnapshot()!.project,
      fixture.shotId,
      layerA,
    );
    expect(dupA.layer.flaGraphicInstanceShapeOverrides).toEqual(
      editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === layerA)!
        .flaGraphicInstanceShapeOverrides,
    );

    expect(editorProjectStore.undo()).toBe(true);
    expect(editorProjectStore.undo()).toBe(true);
    expect(
      editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === layerA)!
        .flaGraphicInstanceShapeOverrides,
    ).toBeUndefined();
    expect(editorProjectStore.redo()).toBe(true);
    expect(
      editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === layerA)!
        .flaGraphicInstanceShapeOverrides,
    ).toBeDefined();
  });

  it('prevents silent drop of mixed BitmapFill / isolated-stroke residue by rejecting unsafe mixed writes before mutation while allowing clean gradient Shapes', () => {
    const fixture = buildShapeTestFixture();
    const service = new LayerService();
    const mixed = decomposeSvgToEditableShapeRegions(AMBIGUOUS_AND_BITMAP_SVG);
    editorProjectStore.open('C:\\dummy\\proj', fixture.project);
    shotStore.select(fixture.shotId);
    selectionStore.selectExplicit(fixture.layerId);
    const beforeSnap = editorProjectStore.getSnapshot()!;
    const beforeUndoCount = editorProjectStore.history.getSnapshot().undoCount;

    // 1. Ambiguous solid region extract rejected pre-write
    expect(() =>
      layerStore.extractFlaGraphicShapeRegion({
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: fixture.ringPath,
        regionRef: mixed.regions[0]!.regionRef,
        mode: 'instance',
        svgText: AMBIGUOUS_AND_BITMAP_SVG,
      }),
    ).toThrow(/选择更外层组合/u);

    // 2. BitmapFill region extract rejected pre-write
    expect(() =>
      layerStore.extractFlaGraphicShapeRegion({
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: fixture.ringPath,
        regionRef: mixed.regions[2]!.regionRef,
        mode: 'instance',
        svgText: AMBIGUOUS_AND_BITMAP_SVG,
      }),
    ).toThrow(/选择更外层组合/u);

    // 3. Other non-bitmap region inside a Shape WITH BitmapFill residue is ALSO rejected before any write (no silent BitmapFill/stroke drop!)
    expect(() =>
      layerStore.extractFlaGraphicShapeRegion({
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: fixture.ringPath,
        regionRef: mixed.regions[3]!.regionRef,
        mode: 'instance',
        svgText: AMBIGUOUS_AND_BITMAP_SVG,
      }),
    ).toThrow(/选择更外层组合/u);

    // 4. Solid fill color change & vertex edit on solid region in a BitmapFill mixed Shape are ALSO rejected before any write!
    expect(() =>
      layerStore.updateFlaGraphicShapeRegionFillColor({
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: fixture.ringPath,
        regionRef: mixed.regions[0]!.regionRef,
        mode: 'instance',
        color: '#00ff00',
        svgText: AMBIGUOUS_AND_BITMAP_SVG,
      }),
    ).toThrow(/选择更外层组合/u);
    expect(() =>
      layerStore.moveFlaGraphicShapeRegionVertex({
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: fixture.ringPath,
        regionRef: mixed.regions[0]!.regionRef,
        mode: 'instance',
        target: { contourIndex: 0, commandIndex: 0, pointKind: 'anchor' },
        x: 5,
        y: 5,
        svgText: AMBIGUOUS_AND_BITMAP_SVG,
      }),
    ).toThrow(/选择更外层组合/u);

    // Project, revision, History, and Layer overrides remain 100% unchanged!
    const afterSnap = editorProjectStore.getSnapshot()!;
    expect(afterSnap.revision).toBe(beforeSnap.revision);
    expect(afterSnap.project).toEqual(beforeSnap.project);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(beforeUndoCount);

    // Clean standalone gradient + isolated-stroke SVG (NO BitmapFill) extracts safely & keeps isolated stroke!
    const cleanGradSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" width="240" height="140"><defs><linearGradient id="grad-1" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#112233"/><stop offset="1" stop-color="#44aaff"/></linearGradient></defs><path d="M 120 80 L 190 80 L 190 130 L 120 130 Z" fill="url(#grad-1)" stroke="none" fill-rule="nonzero"/><path d="M 20 20 L 60 20" fill="none" stroke="#9933ff" stroke-width="5"/></svg>`;
    const cleanGrad = decomposeSvgToEditableShapeRegions(cleanGradSvg);
    const validResult = service.extractFlaGraphicShapeRegion(fixture.project, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      frameOrdinal: 0,
      nodePath: fixture.ringPath,
      regionRef: cleanGrad.regions[0]!.regionRef,
      mode: 'instance',
      svgText: cleanGradSvg,
    });
    expect(validResult.region.fill.kind).toBe('gradient-ref');
    const gradLayer = validResult.project.shots[0]!.layers.find((l) => l.id === fixture.layerId)!;
    const gradDef = validResult.project.animations.find(
      (a): a is FlaGraphicDefinition => a.id === fixture.graphicId && isFlaGraphicDefinition(a),
    )!;
    const evalGrad = evaluateFlaGraphicVisual({
      definition: gradDef,
      frameOrdinal: 0,
      mode: 'instance',
      instanceShapeOverrides: gradLayer.flaGraphicInstanceShapeOverrides,
    })!;
    expect(evalGrad.layers![0]!.nodes[0]!.children[0]!.vectorVisual?.residueStrokes).toHaveLength(1);
  });

  it('builds two independent Adaptive CharacterParts from two regions of the same Shape with tight bounds and distinct identities', () => {
    const fixture = buildShapeTestFixture();
    const def = fixture.project.animations.find(
      (a): a is FlaGraphicDefinition => a.id === fixture.graphicId && isFlaGraphicDefinition(a),
    )!;
    const regions = decomposeSvgToEditableShapeRegions(RING_ISLAND_STROKE_SVG).regions;
    const regA = regions[0]!;
    const regB = regions[1]!;

    const input = buildAdaptivePartsFromFlaGraphicSubtrees({
      project: fixture.project,
      definition: def,
      frameOrdinal: 0,
      selections: [
        {
          nodePath: fixture.ringPath,
          label: '区域甲',
          regionRef: regA.regionRef,
          regionVector: regA,
        },
        {
          nodePath: fixture.ringPath,
          label: '区域乙',
          regionRef: regB.regionRef,
          regionVector: regB,
        },
      ],
    });
    expect(input.parts).toHaveLength(2);
    expect(input.parts[0]!.partId).not.toBe(input.parts[1]!.partId);
    expect(input.parts[0]!.source.sourceId).not.toBe(input.parts[1]!.source.sourceId);

    const boundsA = characterPartSourceBounds(
      input.parts[0]!,
      fixture.project.animations,
      fixture.project.assets,
    )!;
    const boundsB = characterPartSourceBounds(
      input.parts[1]!,
      fixture.project.animations,
      fixture.project.assets,
    )!;
    expect(boundsA.width).toBeCloseTo(80, 6);
    expect(boundsA.height).toBeCloseTo(80, 6);
    expect(boundsB.width).toBeCloseTo(40, 6);
    expect(boundsB.height).toBeCloseTo(40, 6);

    expect(() =>
      buildAdaptivePartsFromFlaGraphicSubtrees({
        project: fixture.project,
        definition: def,
        frameOrdinal: 0,
        selections: [
          { nodePath: fixture.ringPath, regionRef: regA.regionRef, regionVector: regA },
          { nodePath: fixture.ringPath, regionRef: regA.regionRef, regionVector: regA },
        ],
      }),
    ).toThrow(/overlap/i);

    const projectWithChar = new CharacterService().createAdaptiveParts(
      fixture.project,
      input,
    );
    const createdChar = projectWithChar.characters.at(-1)!;
    const withCharLayer: Layer = {
      ...fixture.project.shots[0]!.layers[0]!,
      id: CHAR_LAYER_ID,
      name: '角色图层',
      source: { kind: 'character', characterId: createdChar.id },
      animationPlayback: undefined,
    };
    const fullProject = ProjectSchema.parse({
      ...projectWithChar,
      shots: [
        {
          ...projectWithChar.shots[0]!,
          layers: [...projectWithChar.shots[0]!.layers, withCharLayer],
        },
      ],
    });
    const evalShot = evaluateShotAtTime(fullProject.shots[0]!, 0, fullProject);
    const evalCharLayer = evalShot.layers.find((l) => l.id === CHAR_LAYER_ID)!;
    const resolved = resolveLayerVisualParts(
      fullProject,
      fullProject.shots[0]!,
      evalCharLayer,
    );
    expect(resolved.kind).toBe('adaptive-parts-character');
    expect(resolved.parts).toHaveLength(2);
    expect(resolved.parts[0]!.localRect.width).toBeCloseTo(80, 6);
    expect(resolved.parts[1]!.localRect.width).toBeCloseTo(40, 6);
  });

  it('edits solid fill color & closed-contour vertex with single-source canvas/SVG parity and Undo/Redo', () => {
    const fixture = buildShapeTestFixture();
    const regions = decomposeSvgToEditableShapeRegions(RING_ISLAND_STROKE_SVG).regions;
    const regA = regions[0]!;

    editorProjectStore.open('C:\\dummy\\proj', fixture.project);
    shotStore.select(fixture.shotId);
    selectionStore.selectExplicit(fixture.layerId);

    layerStore.updateFlaGraphicShapeRegionFillColor({
      layerId: fixture.layerId,
      frameOrdinal: 0,
      nodePath: fixture.ringPath,
      regionRef: regA.regionRef,
      mode: 'instance',
      color: '#00aa88',
      svgText: RING_ISLAND_STROKE_SVG,
    });

    const verticesBefore = listFlaShapeRegionVertices(regA);
    const startSeam = verticesBefore.find(
      (v) => v.contourIndex === 0 && v.commandIndex === 0 && v.pointKind === 'anchor',
    )!;
    expect(startSeam.x).toBe(60);
    expect(startSeam.y).toBe(50);

    layerStore.moveFlaGraphicShapeRegionVertex({
      layerId: fixture.layerId,
      frameOrdinal: 0,
      nodePath: fixture.ringPath,
      regionRef: regA.regionRef,
      mode: 'instance',
      target: {
        contourIndex: startSeam.contourIndex,
        commandIndex: startSeam.commandIndex,
        pointKind: startSeam.pointKind,
      },
      x: 22,
      y: 18,
      svgText: RING_ISLAND_STROKE_SVG,
    });

    const editedProject = editorProjectStore.getSnapshot()!.project;
    const def = editedProject.animations.find(
      (a): a is FlaGraphicDefinition => a.id === fixture.graphicId && isFlaGraphicDefinition(a),
    )!;
    const layer = editedProject.shots[0]!.layers.find((l) => l.id === fixture.layerId)!;
    const evaluated = evaluateFlaGraphicVisual({
      definition: def,
      frameOrdinal: 0,
      mode: 'instance',
      instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
    })!;
    const editedNode = evaluated.layers![0]!.nodes[0]!.children.find(
      (n) => JSON.stringify(n.path) === JSON.stringify(fixture.ringPath),
    )!;
    const editedRegA = editedNode.vectorVisual!.regions[0]!;
    expect(editedRegA.fill.color?.toLowerCase()).toBe('#00aa88');

    expect(editedRegA.contours[0]!.commands[0]).toEqual({ type: 'M', x: 22, y: 18 });
    expect(editedRegA.contours[0]!.commands.at(-1)).toEqual({ type: 'Z' });
    // Explicit repeated-closing-endpoint contour keeps start/end seam locked together
    const explicitClosingSvg = `<svg viewBox="0 0 100 100" width="100" height="100"><path d="M 10 10 L 90 10 L 90 90 L 10 10 Z" fill="#ff0000" stroke="none"/></svg>`;
    const closedReg = decomposeSvgToEditableShapeRegions(explicitClosingSvg).regions[0]!;
    const seamMoved = moveFlaShapeRegionVertex(
      closedReg,
      { contourIndex: 0, commandIndex: 0, pointKind: 'anchor' },
      5,
      6,
    )!;
    expect(seamMoved.contours[0]!.commands[0]).toEqual({ type: 'M', x: 5, y: 6 });
    expect(seamMoved.contours[0]!.commands.at(-2)).toEqual({ type: 'L', x: 5, y: 6 });
    expect(editedRegA.bounds.x).toBeCloseTo(22, 6);
    expect(editedRegA.bounds.y).toBeCloseTo(18, 6);
    expect(editedNode.vectorVisual!.baseViewBox).toEqual({
      x: 40,
      y: 30,
      width: 220,
      height: 180,
    });
    const emittedSvg = buildSvgFromFlaEditableShapeRegions({
      regions: editedNode.vectorVisual!.regions,
      residueStrokes: editedNode.vectorVisual!.residueStrokes,
      viewBox: editedNode.vectorVisual!.baseViewBox,
      defsSvg: editedNode.vectorVisual!.defsSvg,
    });
    expect(emittedSvg.toLowerCase()).toContain('#00aa88');
    expect(emittedSvg).toContain('M 22 18');
    expect(emittedSvg).toContain('M 155 60 L 195 60');

    const { ctx, ops } = makeCanvas2dMock();
    document.createElement = ((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ctx,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    }) as typeof document.createElement;
    const raster = renderFlaGraphicCanvas(evaluated, new Map(), 1);
    expect(raster).not.toBeNull();
    expect(ops.some((entry) => entry.op === 'fill')).toBe(true);
    expect(ops.some((entry) => entry.op === 'stroke')).toBe(true);

    // Hit region drawer ALSO paints both fill regions AND residueStrokes onto Konva hit canvas!
    const hitOps: Array<{ op: string }> = [];
    drawFlaVectorVisualHitRegion(
      {
        save: () => {},
        restore: () => {},
        translate: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        quadraticCurveTo: () => {},
        bezierCurveTo: () => {},
        closePath: () => {},
        setAttr: () => {},
        fill: () => hitOps.push({ op: 'fill' }),
        stroke: () => hitOps.push({ op: 'stroke' }),
      } as unknown as Parameters<typeof drawFlaVectorVisualHitRegion>[0],
      {
        colorKey: '#abcdef',
        getAbsoluteScale: () => ({ x: 1, y: 1 }),
      } as unknown as Parameters<typeof drawFlaVectorVisualHitRegion>[1],
      {
        vectorVisual: editedNode.vectorVisual!,
        nodeWorldTransform: editedNode.worldTransform,
        clipPaths: editedNode.clipPaths,
      },
    );
    expect(hitOps.some((e) => e.op === 'fill')).toBe(true);
    expect(hitOps.some((e) => e.op === 'stroke')).toBe(true);

    const bezierSvg = `<svg viewBox="0 0 100 100" width="100" height="100"><path d="M 10 50 Q 50 10 90 50 L 90 90 L 10 90 Z" fill="#123456" stroke="none"/></svg>`;
    const bezierReg: FlaEditableShapeRegion =
      decomposeSvgToEditableShapeRegions(bezierSvg).regions[0]!;
    const movedCtrl = moveFlaShapeRegionVertex(
      bezierReg,
      { contourIndex: 0, commandIndex: 1, pointKind: 'q-control' },
      50,
      -5,
    )!;
    expect(movedCtrl.contours[0]!.commands[1]).toEqual({
      type: 'Q',
      cx: 50,
      cy: -5,
      x: 90,
      y: 50,
    });

    const roundTripped = ProjectSchema.parse(JSON.parse(JSON.stringify(editedProject)));
    expect(roundTripped.shots[0]!.layers[0]!.flaGraphicInstanceShapeOverrides).toEqual(
      editedProject.shots[0]!.layers[0]!.flaGraphicInstanceShapeOverrides,
    );
    expect(editorProjectStore.undo()).toBe(true);
    expect(editorProjectStore.undo()).toBe(true);
    expect(
      editorProjectStore.getSnapshot()!.project.shots[0]!.layers[0]!
        .flaGraphicInstanceShapeOverrides,
    ).toBeUndefined();
  });

  it('mounts Inspector Tree + ChildTransform S3-A/S3-B UI controls and executes extract, fill change, and vertex edit', () => {
    const fixture = buildShapeTestFixture();
    const regions = decomposeSvgToEditableShapeRegions(RING_ISLAND_STROKE_SVG).regions;
    const regA = regions[0]!;

    editorProjectStore.open('C:\\dummy\\proj', fixture.project);
    shotStore.select(fixture.shotId);
    selectionStore.selectExplicit(fixture.layerId);
    layerStore.updateFlaGraphicShapeRegionFillColor({
      layerId: fixture.layerId,
      frameOrdinal: 0,
      nodePath: fixture.ringPath,
      regionRef: regA.regionRef,
      mode: 'instance',
      color: '#ff5533',
      svgText: RING_ISLAND_STROKE_SVG,
    });
    const targetSnap = editorProjectStore.getSnapshot()!;
    const realTarget = resolveFlaGraphicEditTarget({
      project: targetSnap.project,
      projectRoot: targetSnap.projectRoot,
      projectInstanceId: editorProjectStore.getProjectInstanceId(),
      shot: targetSnap.project.shots[0]!,
      layerId: fixture.layerId,
    })!;
    selectionStore.setStructuredEditScope({
      targetKey: realTarget.key,
      sessionKey: realTarget.sessionKey,
      editMode: 'instance',
      frameOrdinal: 0,
      path: [],
    });
    selectionStore.setSelectedStructuredNodeSelection(fixture.ringPath, regA.regionRef);

    mountedContainer = originalCreateElement('div');
    document.body.appendChild(mountedContainer);
    mountedRoot = createRoot(mountedContainer);
    act(() => {
      mountedRoot!.render(
        createElement(
          'div',
          null,
          createElement(FlaGraphicStructureTree),
          createElement(FlaGraphicChildTransform),
        ),
      );
    });

    const extractBtn = mountedContainer.querySelector<HTMLButtonElement>(
      '[data-testid="fla-shape-extract-region-button"]',
    );
    expect(extractBtn).not.toBeNull();
    const colorInput = mountedContainer.querySelector<HTMLInputElement>(
      '[data-testid="fla-shape-region-fill-color"]',
    );
    expect(colorInput?.value.toLowerCase()).toBe('#ff5533');

    const vertexToggle = mountedContainer.querySelector<HTMLButtonElement>(
      '[data-testid="fla-shape-vertex-edit-toggle"]',
    )!;
    act(() => {
      vertexToggle.click();
    });
    const vertexX = mountedContainer.querySelector<HTMLInputElement>(
      '[data-testid="fla-shape-vertex-x"]',
    );
    expect(vertexX).not.toBeNull();
    expect(Number(vertexX!.value)).toBe(60);

    act(() => {
      extractBtn!.click();
    });
    const selectedAfterExtract = selectionStore.getSelectedStructuredNodePath();
    expect(selectedAfterExtract?.at(-1)).toBe(
      `${fixture.ringPath.at(-1)}::${regA.regionRef}`,
    );
  });
});
