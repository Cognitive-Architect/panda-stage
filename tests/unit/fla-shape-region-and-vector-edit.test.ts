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
  hasRenderableFlaGraphicSubtree,
  isFlaGraphicDefinition,
  listFlaShapeRegionVertices,
  migrateProject,
  moveFlaShapeRegionVertex,
  pickFlaShapeRegionAtPoint,
  resolveLayerVisualParts,
  selectFlaGraphicSubtreeVisual,
  type FlaEditableShapeRegion,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type Layer,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import {
  adaptiveCharacterSourceAnchor,
  resolveShotVisualParts,
  visualPartRenderTransform,
} from '../../src/domain/selectors/visualParts';
import { assessFlaGraphicSubtreeCandidate } from '../../src/domain/services/flaGraphicSubtreeParts';
import { createCharacterPartAnimationClip } from '../../src/domain/character-part-animation';
import { buildAdaptivePartsAssemblyPreviewVisual } from '../../src/renderer/features/characters/characterAssemblyPreview';
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

  it('aligns overlapping Fill/Stroke draw order (fill pass -> stroke pass) across Canvas, SVG, and click picking', () => {
    // Original SVG order emits ALL fills before ALL strokes:
    // Region 1 fill [20..100, 20..100] (#ff5533), Region 2 fill [80..160, 40..120] (#3366cc),
    // then Region 1 edge stroke (100, 20) -> (100, 100) crossing inside Region 2 [80..160].
    const overlappingSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160" width="200" height="160"><path d="M 20 20 L 100 20 L 100 100 L 20 100 Z" fill="#ff5533" stroke="none" fill-rule="nonzero"/><path d="M 80 40 L 160 40 L 160 120 L 80 120 Z" fill="#3366cc" stroke="none" fill-rule="nonzero"/><path d="M 100 20 L 100 100" fill="none" stroke="#112233" stroke-width="6" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="3"/></svg>`;
    const decomposed = decomposeSvgToEditableShapeRegions(overlappingSvg);
    expect(decomposed.regions).toHaveLength(2);
    const reg1 = decomposed.regions[0]!;
    const reg2 = decomposed.regions[1]!;
    expect(reg1.strokes).toHaveLength(1);
    expect(reg2.strokes).toHaveLength(0);

    // Clicking on Region 1's visible stroke inside Region 2 (100, 60) picks Region 1 (stroke pass above fill pass);
    // clicking inside Region 2 away from Region 1's stroke (120, 60) picks Region 2.
    expect(pickFlaShapeRegionAtPoint(decomposed.regions, 100, 60)?.regionRef).toBe(reg1.regionRef);
    expect(pickFlaShapeRegionAtPoint(decomposed.regions, 120, 60)?.regionRef).toBe(reg2.regionRef);

    // Edit Region 2 solid color inside a Shape and check Canvas draw ops order & SVG element order:
    const fixture = buildShapeTestFixture();
    editorProjectStore.open('C:\\dummy\\proj', fixture.project);
    shotStore.select(fixture.shotId);
    selectionStore.selectExplicit(fixture.layerId);
    layerStore.updateFlaGraphicShapeRegionFillColor({
      layerId: fixture.layerId,
      frameOrdinal: 0,
      nodePath: fixture.ringPath,
      regionRef: reg2.regionRef,
      mode: 'instance',
      color: '#22aa66',
      svgText: overlappingSvg,
    });
    const projectAfter = editorProjectStore.getSnapshot()!.project;
    const defAfter = projectAfter.animations.find(
      (a): a is FlaGraphicDefinition => a.id === fixture.graphicId && isFlaGraphicDefinition(a),
    )!;
    const layerAfter = projectAfter.shots[0]!.layers.find((l) => l.id === fixture.layerId)!;
    const evaluated = evaluateFlaGraphicVisual({
      definition: defAfter,
      frameOrdinal: 0,
      mode: 'instance',
      instanceShapeOverrides: layerAfter.flaGraphicInstanceShapeOverrides,
    })!;
    const nodeVector = evaluated.layers![0]!.nodes[0]!.children[0]!.vectorVisual!;

    // Single-source SVG output must place all fills before all strokes (never Region1 fill -> Region1 stroke -> Region2 fill)
    const emittedSvg = buildSvgFromFlaEditableShapeRegions({
      regions: nodeVector.regions,
      residueStrokes: nodeVector.residueStrokes,
      viewBox: nodeVector.baseViewBox,
    });
    const firstStrokeIdx = emittedSvg.indexOf('stroke="#112233"');
    const secondFillIdx = emittedSvg.indexOf('fill="#22AA66"');
    expect(secondFillIdx).toBeGreaterThan(-1);
    expect(firstStrokeIdx).toBeGreaterThan(secondFillIdx);

    // Canvas2D draw sequence must execute ALL fill ops before ANY stroke op!
    const { ctx, ops } = makeCanvas2dMock();
    document.createElement = ((tag: string) => {
      if (tag === 'canvas') {
        return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    }) as typeof document.createElement;
    renderFlaGraphicCanvas(evaluated, new Map(), 1);
    const drawSequence = ops
      .filter((entry) => entry.op === 'fill' || entry.op === 'stroke')
      .map((entry) => entry.op);
    expect(drawSequence).toEqual(['fill', 'fill', 'stroke']);
  });

  it('fails closed on regionRef-only / mismatched / no-nodePath Adaptive CharacterParts without falling back to whole Shape or whole Graphic', () => {
    const fixture = buildShapeTestFixture();
    const decomposed = decomposeSvgToEditableShapeRegions(RING_ISLAND_STROKE_SVG);
    const regA = decomposed.regions[0]!;
    const regB = decomposed.regions[1]!;

    // Seed sharedShapeOverrides on the FLA Graphic Definition so regB IS recoverable by regionRef alone from formal data.
    const baseDef = fixture.project.animations.find(
      (a): a is FlaGraphicDefinition => a.id === fixture.graphicId && isFlaGraphicDefinition(a),
    )!;
    const defWithSharedOverride: FlaGraphicDefinition = {
      ...baseDef,
      flaGraphicSharedShapeOverrides: {
        '0': {
          [JSON.stringify(fixture.ringPath)]: {
            baseViewBox: { x: 40, y: 30, width: 220, height: 180 },
            regions: [regB],
            excludedRegionRefs: [],
            extractedRegions: [],
          },
        },
      },
    };
    const projectWithShared = ProjectSchema.parse({
      ...fixture.project,
      animations: fixture.project.animations.map((a) =>
        a.id === baseDef.id ? defWithSharedOverride : a,
      ),
    });

    const evaluatedWithShared = evaluateFlaGraphicVisual({
      definition: defWithSharedOverride,
      frameOrdinal: 0,
      mode: 'instance',
    })!;

    // Verify selectFlaGraphicSubtreeVisual fail-closed directly on unmatched regionRef vs recoverable regionRef-only:
    const recoverableSubtree = selectFlaGraphicSubtreeVisual(
      evaluatedWithShared,
      fixture.ringPath,
      { regionRef: regB.regionRef },
    );
    expect(hasRenderableFlaGraphicSubtree(recoverableSubtree)).toBe(true);
    const missingSubtree = selectFlaGraphicSubtreeVisual(
      evaluatedWithShared,
      fixture.ringPath,
      { regionRef: 'reg-does-not-exist' },
    );
    expect(hasRenderableFlaGraphicSubtree(missingSubtree)).toBe(false);
    expect(missingSubtree.layers).toEqual([]);
    expect(missingSubtree.resourceAssetIds).toEqual([]);

    // Build an Adaptive Character containing all 5 combinations required by Issue #1200 Part B!
    const adaptiveCharProject = new CharacterService().createAdaptiveParts(projectWithShared, {
      name: 'Issue1200五态测试角色',
      sourceRootTransform: IDENTITY,
      parts: [
        // (1) Normal regionRef + regionVector
        {
          partId: 'e5000000-0000-4000-8000-000000000001',
          source: { kind: 'manual', sourceId: 's1' },
          visualSource: {
            kind: 'fla-graphic',
            animationId: defWithSharedOverride.id,
            nodePath: fixture.ringPath,
            poseFrameOrdinal: 0,
            regionRef: regA.regionRef,
            regionVector: regA,
          },
          sourceRestTransform: IDENTITY,
          restTransform: IDENTITY,
          drawOrder: 0,
          visible: true,
        },
        // (2) regionRef-only recoverable from formal shared override
        {
          partId: 'e5000000-0000-4000-8000-000000000002',
          source: { kind: 'manual', sourceId: 's2' },
          visualSource: {
            kind: 'fla-graphic',
            animationId: defWithSharedOverride.id,
            nodePath: fixture.ringPath,
            poseFrameOrdinal: 0,
            regionRef: regB.regionRef,
          },
          sourceRestTransform: IDENTITY,
          restTransform: IDENTITY,
          drawOrder: 1,
          visible: true,
        },
        // (3) regionRef-only with non-existent regionRef -> MUST fail closed (NOT full Shape!)
        {
          partId: 'e5000000-0000-4000-8000-000000000003',
          source: { kind: 'manual', sourceId: 's3' },
          visualSource: {
            kind: 'fla-graphic',
            animationId: defWithSharedOverride.id,
            nodePath: fixture.ringPath,
            poseFrameOrdinal: 0,
            regionRef: 'reg-nonexistent-999',
          },
          sourceRestTransform: IDENTITY,
          restTransform: IDENTITY,
          drawOrder: 2,
          visible: true,
        },
        // (4) regionRef WITHOUT nodePath -> MUST fail closed (NOT whole Graphic!)
        {
          partId: 'e5000000-0000-4000-8000-000000000004',
          source: { kind: 'manual', sourceId: 's4' },
          visualSource: {
            kind: 'fla-graphic',
            animationId: defWithSharedOverride.id,
            poseFrameOrdinal: 0,
            regionRef: regA.regionRef,
          },
          sourceRestTransform: IDENTITY,
          restTransform: IDENTITY,
          drawOrder: 3,
          visible: true,
        },
        // (5) Legacy whole-Graphic Part without nodePath & without regionRef -> MUST still render full Graphic
        {
          partId: 'e5000000-0000-4000-8000-000000000005',
          source: { kind: 'manual', sourceId: 's5' },
          visualSource: {
            kind: 'fla-graphic',
            animationId: defWithSharedOverride.id,
            poseFrameOrdinal: 0,
          },
          sourceRestTransform: IDENTITY,
          restTransform: IDENTITY,
          drawOrder: 4,
          visible: true,
        },
      ],
    });

    const createdChar = adaptiveCharProject.characters.at(-1)!;
    if (createdChar.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts');
    // (1) tight bounds of regA (80x80)
    expect(
      characterPartSourceBounds(createdChar.parts[0]!, adaptiveCharProject.animations, adaptiveCharProject.assets)!.width,
    ).toBeCloseTo(80, 6);
    // (2) recovered tight bounds of regB (40x40)
    expect(
      characterPartSourceBounds(createdChar.parts[1]!, adaptiveCharProject.animations, adaptiveCharProject.assets)!.width,
    ).toBeCloseTo(40, 6);
    // (3) missing regionRef -> null bounds (not whole Shape!)
    expect(
      characterPartSourceBounds(createdChar.parts[2]!, adaptiveCharProject.animations, adaptiveCharProject.assets),
    ).toBeNull();
    // (4) regionRef && !nodePath -> null bounds (not whole Graphic!)
    expect(
      characterPartSourceBounds(createdChar.parts[3]!, adaptiveCharProject.animations, adaptiveCharProject.assets),
    ).toBeNull();
    // (5) legacy full Graphic -> canvas width 320
    expect(
      characterPartSourceBounds(createdChar.parts[4]!, adaptiveCharProject.animations, adaptiveCharProject.assets)!.width,
    ).toBe(320);

    // Stage/layer evaluation does not throw when valid + broken Parts coexist!
    const mixedCharLayer: Layer = {
      ...adaptiveCharProject.shots[0]!.layers[0]!,
      id: 'e3000000-0000-4000-8000-000000000099',
      name: '五态混合角色层',
      source: { kind: 'character', characterId: createdChar.id },
      animationPlayback: undefined,
    };
    const projectWithMixedCharLayer = ProjectSchema.parse({
      ...adaptiveCharProject,
      shots: [{
        ...adaptiveCharProject.shots[0]!,
        layers: [...adaptiveCharProject.shots[0]!.layers, mixedCharLayer],
      }],
    });
    const evalShot = evaluateShotAtTime(projectWithMixedCharLayer.shots[0]!, 0, projectWithMixedCharLayer);
    const resolved = resolveLayerVisualParts(
      projectWithMixedCharLayer,
      projectWithMixedCharLayer.shots[0]!,
      evalShot.layers.find((l) => l.id === mixedCharLayer.id)!,
    );
    expect(resolved.parts).toHaveLength(5);
    expect(hasRenderableFlaGraphicSubtree(resolved.parts[0]!.flaGraphic!)).toBe(true);
    expect(hasRenderableFlaGraphicSubtree(resolved.parts[1]!.flaGraphic!)).toBe(true);
    expect(hasRenderableFlaGraphicSubtree(resolved.parts[2]!.flaGraphic!)).toBe(false);
    expect(resolved.parts[2]!.localRect.width).toBe(0);
    expect(hasRenderableFlaGraphicSubtree(resolved.parts[3]!.flaGraphic!)).toBe(false);
    expect(resolved.parts[3]!.localRect.width).toBe(0);
    expect(resolved.parts[4]!.localRect.width).toBe(320);

    // Check Export Preparation asset isolation: remove Part 5 (legacy full) and verify Part 3 + Part 4 alone add ZERO whole-frame assets!
    const onlyBrokenPartsProject = ProjectSchema.parse({
      ...projectWithMixedCharLayer,
      characters: projectWithMixedCharLayer.characters.map((c) =>
        c.id === createdChar.id && c.mode === 'adaptive-parts'
          ? {
              ...c,
              parts: [
                { ...createdChar.parts[2]!, drawOrder: 0 },
                { ...createdChar.parts[3]!, drawOrder: 1 },
              ],
            }
          : c,
      ),
      shots: projectWithMixedCharLayer.shots.map((s) => ({
        ...s,
        timelineEvents: [],
        layers: s.layers.filter((l) => l.id !== fixture.layerId),
      })),
    });
    const exportMediaForBroken = collectExportPreparationMedia(onlyBrokenPartsProject)
      .filter((entry) => entry.asset.id === FRAME_ASSET_ID || entry.asset.id === RING_SHAPE_ASSET_ID);
    expect(exportMediaForBroken).toHaveLength(0);
  });

  function buildTwoShapePairFixture() {
    const project = migrateProject(exampleProject);
    const frameDuration = 1_000 / 24;
    const SHAPE_A_ASSET_ID = 'e1000000-0000-4000-8000-000000000011';
    const SHAPE_B_ASSET_ID = 'e1000000-0000-4000-8000-000000000012';
    const BITMAP_NODE_ASSET_ID = 'e1000000-0000-4000-8000-000000000013';
    const PAIR_GRAPHIC_ID = 'e2000000-0000-4000-8000-000000000010';
    const GROUP_PATH = ['group-pair'];
    const SHAPE_A_PATH = ['group-pair', 'shape-a'];
    const SHAPE_B_PATH = ['group-pair', 'shape-b'];
    const SYMBOL_PATH = ['symbol-wrap'];
    const BITMAP_PATH = ['bitmap-leaf'];

    const shapeASvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 20 80 80" width="80" height="80"><path d="M 20 20 L 100 20 L 100 100 L 20 100 Z" fill="#e63946" fill-opacity="1" stroke="none" fill-rule="nonzero"/></svg>`;
    const shapeBSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="220 40 100 60" width="100" height="60"><path d="M 220 40 L 320 40 L 320 100 L 220 100 Z" fill="#457b9d" fill-opacity="1" stroke="none" fill-rule="nonzero"/></svg>`;
    const rawRegA = decomposeSvgToEditableShapeRegions(shapeASvg).regions[0]!;
    const rawRegB = decomposeSvgToEditableShapeRegions(shapeBSvg).regions[0]!;
    const regA: FlaEditableShapeRegion = { ...rawRegA, regionRef: 'reg-shape-a', sourceShapeRef: 'fla-shape-a' };
    const regB: FlaEditableShapeRegion = { ...rawRegB, regionRef: 'reg-shape-b', sourceShapeRef: 'fla-shape-b' };

    const structure: FlaGraphicStructure = {
      version: 1,
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: '图层_双件',
              nodes: [
                {
                  type: 'group',
                  id: 'group-pair',
                  sourceAddress: 'graphic:Pair/0',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 30, ty: 10 },
                  groupId: 'pair',
                  children: [
                    {
                      type: 'opaque',
                      id: 'shape-a',
                      sourceAddress: 'graphic:Pair/0/0',
                      drawOrder: 0,
                      localTransform: IDENTITY,
                      opaqueKind: 'shape',
                      sourceRef: 'fla-shape-a',
                      fallbackScope: 'subtree',
                      fallbackAssetId: SHAPE_A_ASSET_ID,
                      fallbackViewBox: { x: 20, y: 20, width: 80, height: 80 },
                    },
                    {
                      type: 'opaque',
                      id: 'shape-b',
                      sourceAddress: 'graphic:Pair/0/1',
                      drawOrder: 1,
                      localTransform: IDENTITY,
                      opaqueKind: 'shape',
                      sourceRef: 'fla-shape-b',
                      fallbackScope: 'subtree',
                      fallbackAssetId: SHAPE_B_ASSET_ID,
                      fallbackViewBox: { x: 220, y: 40, width: 100, height: 60 },
                    },
                  ],
                },
                {
                  type: 'symbol',
                  id: 'symbol-wrap',
                  sourceAddress: 'graphic:Pair/1',
                  drawOrder: 1,
                  localTransform: IDENTITY,
                  symbolRef: 'sym-inner',
                  children: [],
                },
                {
                  type: 'bitmap',
                  id: 'bitmap-leaf',
                  sourceAddress: 'graphic:Pair/2',
                  drawOrder: 2,
                  localTransform: IDENTITY,
                  bitmapRef: 'bmp.png',
                  assetId: BITMAP_NODE_ASSET_ID,
                },
              ],
            },
          ],
        },
      ],
    };

    const definition = FlaGraphicDefinitionSchema.parse({
      id: PAIR_GRAPHIC_ID,
      kind: 'fla-graphic',
      name: 'Pair Graphic',
      source: {
        basename: 'pair.fla',
        sha256: 'd'.repeat(64),
        renderTargetId: 'pair-target',
        targetKind: 'graphic-symbol',
        targetName: 'PairGraphic',
        startFrameIndex: 0,
        endFrameIndex: 0,
        sourceFps: 24,
        canvas: { width: 400, height: 240 },
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
          sourceViewport: { x: 0, y: 0, width: 400, height: 240 },
          offset: { x: 0, y: 0 },
          startMs: 0,
          durationMs: frameDuration,
          createdBySequenceImport: false,
        },
      ],
      structure,
      flaGraphicSharedShapeOverrides: {
        '0': {
          [JSON.stringify(SHAPE_A_PATH)]: {
            baseViewBox: { x: 20, y: 20, width: 80, height: 80 },
            regions: [regA],
            excludedRegionRefs: [],
            extractedRegions: [],
          },
          [JSON.stringify(SHAPE_B_PATH)]: {
            baseViewBox: { x: 220, y: 40, width: 100, height: 60 },
            regions: [regB],
            excludedRegionRefs: [],
            extractedRegions: [],
          },
        },
      },
    });

    project.assets.push(
      {
        id: FRAME_ASSET_ID,
        kind: 'image',
        name: 'pair-frame.svg',
        relativePath: 'assets/pair-frame.svg',
        mimeType: 'image/svg+xml',
        width: 400,
        height: 240,
        sha256: 'b'.repeat(64),
        usage: 'prop',
        keywords: [],
      },
      {
        id: SHAPE_A_ASSET_ID,
        kind: 'image',
        name: 'shape-a.svg',
        relativePath: 'assets/shape-a.svg',
        mimeType: 'image/svg+xml',
        width: 80,
        height: 80,
        sha256: 'e'.repeat(64),
        usage: 'prop',
        keywords: [],
      },
      {
        id: SHAPE_B_ASSET_ID,
        kind: 'image',
        name: 'shape-b.svg',
        relativePath: 'assets/shape-b.svg',
        mimeType: 'image/svg+xml',
        width: 100,
        height: 60,
        sha256: 'f'.repeat(64),
        usage: 'prop',
        keywords: [],
      },
      {
        id: BITMAP_NODE_ASSET_ID,
        kind: 'image',
        name: 'bmp.png',
        relativePath: 'assets/bmp.png',
        mimeType: 'image/png',
        width: 40,
        height: 40,
        sha256: '1'.repeat(64),
        usage: 'prop',
        keywords: [],
      },
    );
    project.animations.push(definition);

    return {
      project: ProjectSchema.parse(project),
      definition,
      GROUP_PATH,
      SHAPE_A_PATH,
      SHAPE_B_PATH,
      SYMBOL_PATH,
      BITMAP_PATH,
      regA,
      regB,
      SHAPE_A_ASSET_ID,
      SHAPE_B_ASSET_ID,
      BITMAP_NODE_ASSET_ID,
    };
  }

  it('fails closed when regionRef/regionVector points to Group/Symbol/Bitmap or mismatched sourceShapeRef while preserving Group/Shape/legacy region paths (#1201 A)', () => {
    const pair = buildTwoShapePairFixture();
    const evaluated = evaluateFlaGraphicVisual({
      definition: pair.definition,
      frameOrdinal: 0,
      mode: 'instance',
    })!;

    // 1) regionRef + regionVector pointing to Group MUST return empty subtree (must NOT leak Shape A + Shape B or assets)
    const groupAsRegion = selectFlaGraphicSubtreeVisual(evaluated, pair.GROUP_PATH, {
      regionRef: pair.regA.regionRef,
      regionVector: pair.regA,
    });
    expect(groupAsRegion.layers).toEqual([]);
    expect(groupAsRegion.resourceAssetIds).toEqual([]);
    expect(hasRenderableFlaGraphicSubtree(groupAsRegion)).toBe(false);

    const groupCandidate = assessFlaGraphicSubtreeCandidate({
      definition: pair.definition,
      frameOrdinal: 0,
      nodePath: pair.GROUP_PATH,
      regionRef: pair.regA.regionRef,
      regionVector: pair.regA,
      assets: pair.project.assets,
    });
    expect(groupCandidate.extractable).toBe(false);
    expect(groupCandidate.renderable).toBe(false);
    expect(groupCandidate.resourceAssetIds).toEqual([]);

    // Symbol and Bitmap nodes MUST also reject region selection
    for (const nonShapePath of [pair.SYMBOL_PATH, pair.BITMAP_PATH]) {
      const rejected = selectFlaGraphicSubtreeVisual(evaluated, nonShapePath, {
        regionRef: pair.regA.regionRef,
        regionVector: pair.regA,
      });
      expect(rejected.layers).toEqual([]);
      expect(rejected.resourceAssetIds).toEqual([]);
      expect(hasRenderableFlaGraphicSubtree(rejected)).toBe(false);
    }

    // 2) Shape A nodePath with regionVector whose sourceShapeRef points to Shape B -> fail closed!
    const crossShapeConflict = selectFlaGraphicSubtreeVisual(evaluated, pair.SHAPE_A_PATH, {
      regionRef: pair.regA.regionRef,
      regionVector: { ...pair.regA, sourceShapeRef: 'fla-shape-b' },
    });
    expect(crossShapeConflict.layers).toEqual([]);
    expect(crossShapeConflict.resourceAssetIds).toEqual([]);
    expect(hasRenderableFlaGraphicSubtree(crossShapeConflict)).toBe(false);

    // 3) Export media isolation when Adaptive CharacterPart points to Group with regionVector or mismatched sourceShapeRef
    const badCharProject = new CharacterService().createAdaptiveParts(pair.project, {
      name: 'Bad Region Identity Char',
      sourceRootTransform: IDENTITY,
      parts: [
        {
          partId: 'e5000000-0000-4000-8000-000000000021',
          source: { kind: 'manual', sourceId: 'bad-group-region' },
          visualSource: {
            kind: 'fla-graphic',
            animationId: pair.definition.id,
            nodePath: pair.GROUP_PATH,
            poseFrameOrdinal: 0,
            regionRef: pair.regA.regionRef,
            regionVector: pair.regA,
          },
          sourceRestTransform: IDENTITY,
          restTransform: IDENTITY,
          drawOrder: 0,
          visible: true,
        },
        {
          partId: 'e5000000-0000-4000-8000-000000000022',
          source: { kind: 'manual', sourceId: 'bad-cross-shape' },
          visualSource: {
            kind: 'fla-graphic',
            animationId: pair.definition.id,
            nodePath: pair.SHAPE_A_PATH,
            poseFrameOrdinal: 0,
            regionRef: pair.regA.regionRef,
            regionVector: { ...pair.regA, sourceShapeRef: 'fla-shape-b' },
          },
          sourceRestTransform: IDENTITY,
          restTransform: IDENTITY,
          drawOrder: 1,
          visible: true,
        },
      ],
    });
    const badChar = badCharProject.characters.at(-1)!;
    const withBadLayer = new LayerService().createFromAdaptiveCharacter(
      badCharProject,
      badCharProject.shots[0]!.id,
      badChar.id,
      { x: 960, y: 540 },
    ).project;
    const isolatedMedia = collectExportPreparationMedia(withBadLayer).filter((entry) =>
      [FRAME_ASSET_ID, pair.SHAPE_A_ASSET_ID, pair.SHAPE_B_ASSET_ID, pair.BITMAP_NODE_ASSET_ID].includes(entry.asset.id),
    );
    expect(isolatedMedia).toEqual([]);

    // 4) Non-degradation controls: Group Part (no regionRef), whole Shape Part (no regionRef),
    // valid regionRef+regionVector, valid regionRef-only, and legacy vector without sourceShapeRef
    const validGroup = selectFlaGraphicSubtreeVisual(evaluated, pair.GROUP_PATH);
    expect(hasRenderableFlaGraphicSubtree(validGroup)).toBe(true);
    expect(validGroup.layers![0]!.nodes[0]!.children).toHaveLength(2);

    const validWholeShape = selectFlaGraphicSubtreeVisual(evaluated, pair.SHAPE_A_PATH);
    expect(hasRenderableFlaGraphicSubtree(validWholeShape)).toBe(true);

    const validRegionWithVector = selectFlaGraphicSubtreeVisual(evaluated, pair.SHAPE_A_PATH, {
      regionRef: pair.regA.regionRef,
      regionVector: pair.regA,
    });
    expect(hasRenderableFlaGraphicSubtree(validRegionWithVector)).toBe(true);

    const validRegionRefOnly = selectFlaGraphicSubtreeVisual(evaluated, pair.SHAPE_A_PATH, {
      regionRef: pair.regA.regionRef,
    });
    expect(hasRenderableFlaGraphicSubtree(validRegionRefOnly)).toBe(true);

    const legacyWithoutSourceShapeRef: FlaEditableShapeRegion = {
      regionRef: pair.regA.regionRef,
      fill: pair.regA.fill,
      contours: pair.regA.contours,
      strokes: pair.regA.strokes,
      bounds: pair.regA.bounds,
    };
    const validLegacyNoSourceRef = selectFlaGraphicSubtreeVisual(evaluated, pair.SHAPE_A_PATH, {
      regionRef: pair.regA.regionRef,
      regionVector: legacyWithoutSourceShapeRef,
    });
    expect(hasRenderableFlaGraphicSubtree(validLegacyNoSourceRef)).toBe(true);
  });

  it('keeps sibling Part B source/Stage/Workbench/Export position invariant when Part A region ref mismatches (#1201 B)', () => {
    const pair = buildTwoShapePairFixture();
    const buildInput = buildAdaptivePartsFromFlaGraphicSubtrees({
      project: pair.project,
      definition: pair.definition,
      frameOrdinal: 0,
      characterName: 'Left-Right Pair Character',
      selections: [
        {
          nodePath: pair.SHAPE_A_PATH,
          label: '左区域A',
          regionRef: pair.regA.regionRef,
          regionVector: pair.regA,
        },
        {
          nodePath: pair.SHAPE_B_PATH,
          label: '右区域B',
          regionRef: pair.regB.regionRef,
          regionVector: pair.regB,
        },
      ],
    });
    const baseProject = new CharacterService().createAdaptiveParts(pair.project, buildInput);
    const baseChar = baseProject.characters.at(-1)!;
    if (baseChar.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts');
    const anchorBefore = adaptiveCharacterSourceAnchor(baseProject, baseChar);
    const placedProject = new LayerService().createFromAdaptiveCharacter(
      baseProject,
      baseProject.shots[0]!.id,
      baseChar.id,
      anchorBefore,
    );
    const healthyProject = placedProject.project;
    const healthyLayerId = placedProject.layer.id;

    const inspectState = (targetProject: typeof healthyProject) => {
      const char = targetProject.characters.find((c) => c.id === baseChar.id)!;
      if (char.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts');
      const shot = targetProject.shots[0]!;
      const evaluated = evaluateShotAtTime(shot, 0, targetProject);
      const evalLayer = evaluated.layers.find((l) => l.id === healthyLayerId)!;
      const layerVisual = resolveLayerVisualParts(targetProject, shot, evalLayer, 0);
      const shotVisual = resolveShotVisualParts(targetProject, shot, evaluated).find(
        (entry) => entry.ownerLayerId === healthyLayerId,
      )!;
      const workbenchVisual = buildAdaptivePartsAssemblyPreviewVisual(targetProject, {
        status: 'active',
        kind: 'adaptive-parts',
        sessionId: 1,
        generation: 1,
        projectId: targetProject.id,
        projectRoot: '',
        characterId: char.id,
        selectedPartId: char.parts[1]?.partId ?? null,
        draft: {
          sourceRootTransform: char.sourceRootTransform,
          parts: char.parts,
        },
      })!;
      const partBShot = layerVisual.parts.find(
        (p) => p.source.kind === 'adaptive-part-fla-graphic' && p.source.characterPartId === char.parts[1]!.partId,
      )!;
      const partBExport = shotVisual.parts.find(
        (p) => p.source.kind === 'adaptive-part-fla-graphic' && p.source.characterPartId === char.parts[1]!.partId,
      )!;
      const partBWorkbench = workbenchVisual.parts.find(
        (p) => p.source.kind === 'adaptive-part-fla-graphic' && p.source.characterPartId === char.parts[1]!.partId,
      )!;
      const partAShot = layerVisual.parts.find(
        (p) => p.source.kind === 'adaptive-part-fla-graphic' && p.source.characterPartId === char.parts[0]!.partId,
      )!;
      return {
        char,
        anchor: adaptiveCharacterSourceAnchor(targetProject, char),
        partAShot,
        partBShot,
        partBExport,
        partBWorkbench,
        partBRender: visualPartRenderTransform(partBShot),
        partBWorldTx: evalLayer.x + partBShot.imageTransform!.tx,
        partBWorldTy: evalLayer.y + partBShot.imageTransform!.ty,
      };
    };

    const baseline = inspectState(healthyProject);

    type AdaptivePartEntry = Extract<typeof baseChar, { mode: 'adaptive-parts' }>['parts'][number];
    type FlaVisualSource = Extract<NonNullable<AdaptivePartEntry['visualSource']>, { kind: 'fla-graphic' }>;
    const mutatePartA = (
      patchVisualSource: (vs: FlaVisualSource) => FlaVisualSource,
    ) =>
      ProjectSchema.parse({
        ...healthyProject,
        characters: healthyProject.characters.map((c) => {
          if (c.id !== baseChar.id || c.mode !== 'adaptive-parts') return c;
          const partA = c.parts[0]!;
          if (partA.visualSource?.kind !== 'fla-graphic') {
            throw new Error('Expected fla-graphic visualSource');
          }
          return {
            ...c,
            parts: [{ ...partA, visualSource: patchVisualSource(partA.visualSource) }, c.parts[1]!],
          };
        }),
      });

    // Test all four broken Part A failure modes: nodePath->Group/missing, sourceShapeRef conflict, regionRef miss
    const brokenVariants = [
      mutatePartA((vs) => ({ ...vs, nodePath: pair.GROUP_PATH })),
      mutatePartA((vs) => ({ ...vs, nodePath: ['nonexistent-node'] })),
      mutatePartA((vs) => ({
        ...vs,
        regionVector: { ...pair.regA, sourceShapeRef: 'fla-shape-b' },
      })),
      mutatePartA((vs) => ({ ...vs, regionRef: 'reg-nonexistent-999' })),
    ];

    for (const variantProject of brokenVariants) {
      const brokenChar = variantProject.characters.find((c) => c.id === baseChar.id)!;
      if (brokenChar.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts');
      expect(
        characterPartSourceBounds(brokenChar.parts[0]!, variantProject.animations, variantProject.assets),
      ).toBeNull();

      const broken = inspectState(variantProject);
      expect(hasRenderableFlaGraphicSubtree(broken.partAShot.flaGraphic!)).toBe(false);
      expect(broken.partAShot.localRect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
      expect(broken.partAShot.flaGraphic!.resourceAssetIds).toEqual([]);

      // Part B remains at exact same coordinates across Anchor, Stage, Export, Workbench, and Save/Reopen!
      expect(broken.anchor).toEqual(baseline.anchor);
      expect(broken.partBShot.imageTransform).toEqual(baseline.partBShot.imageTransform);
      expect(broken.partBShot.localRect).toEqual(baseline.partBShot.localRect);
      expect(broken.partBExport.imageTransform).toEqual(baseline.partBExport.imageTransform);
      expect(broken.partBWorkbench.imageTransform).toEqual(baseline.partBWorkbench.imageTransform);
      expect(broken.partBRender).toEqual(baseline.partBRender);
      expect(broken.partBWorldTx).toBeCloseTo(baseline.partBWorldTx, 10);
      expect(broken.partBWorldTy).toBeCloseTo(baseline.partBWorldTy, 10);
      expect(Object.values(broken.partBShot.imageTransform!).every(Number.isFinite)).toBe(true);
      expect(broken.partBRender.scaleX).not.toBe(0);
      expect(broken.partBRender.scaleY).not.toBe(0);

      const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(variantProject)));
      const reopenedState = inspectState(reopened);
      expect(reopenedState.partBShot.imageTransform).toEqual(baseline.partBShot.imageTransform);
      expect(reopenedState.partAShot.localRect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    }

    // Clip animation with frozen fixedCharacterCenter remains intact if Part A later breaks
    const clip = createCharacterPartAnimationClip(healthyProject, healthyProject.shots[0]!.id, healthyLayerId);
    const clipWithBrokenA = ProjectSchema.parse({
      ...healthyProject,
      shots: healthyProject.shots.map((s) => ({
        ...s,
        layers: s.layers.map((l) =>
          l.id === healthyLayerId
            ? {
                ...l,
                animationClip: {
                  ...clip,
                  targetBases: [
                    {
                      ...clip.targetBases[0]!,
                      visualSource: {
                        ...clip.targetBases[0]!.visualSource,
                        regionRef: 'reg-nonexistent-999',
                      },
                    },
                    clip.targetBases[1]!,
                  ],
                },
              }
            : l,
        ),
      })),
    });
    const healthyClipShot = ProjectSchema.parse({
      ...healthyProject,
      shots: healthyProject.shots.map((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === healthyLayerId ? { ...l, animationClip: clip } : l)),
      })),
    });
    const clipEvalHealthy = resolveLayerVisualParts(
      healthyClipShot,
      healthyClipShot.shots[0]!,
      evaluateShotAtTime(healthyClipShot.shots[0]!, 0, healthyClipShot).layers.find((l) => l.id === healthyLayerId)!,
    );
    const clipEvalBroken = resolveLayerVisualParts(
      clipWithBrokenA,
      clipWithBrokenA.shots[0]!,
      evaluateShotAtTime(clipWithBrokenA.shots[0]!, 0, clipWithBrokenA).layers.find((l) => l.id === healthyLayerId)!,
    );
    expect(clipEvalBroken.parts[1]!.imageTransform).toEqual(clipEvalHealthy.parts[1]!.imageTransform);
    expect(hasRenderableFlaGraphicSubtree(clipEvalBroken.parts[0]!.flaGraphic!)).toBe(false);

    // Intentional deletion of Part A keeps normal re-centering behavior for remaining [Part B]
    const intentionallyRemovedA = ProjectSchema.parse({
      ...healthyProject,
      characters: healthyProject.characters.map((c) =>
        c.id === baseChar.id && c.mode === 'adaptive-parts'
          ? { ...c, parts: [{ ...c.parts[1]!, drawOrder: 0 }] }
          : c,
      ),
    });
    const charOnlyB = intentionallyRemovedA.characters.find((c) => c.id === baseChar.id)!;
    if (charOnlyB.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts');
    const soloAnchor = adaptiveCharacterSourceAnchor(intentionallyRemovedA, charOnlyB);
    expect(soloAnchor.x).not.toBeCloseTo(baseline.anchor.x, 3);
  });
});
