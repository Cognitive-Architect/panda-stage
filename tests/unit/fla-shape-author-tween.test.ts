import { describe, expect, it } from 'vitest';
import {
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  decomposeSvgToEditableShapeRegions,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  findFlaShapeTweenTrackById,
  resolveLayerVisualParts,
  type EvaluatedFlaGraphicNode,
  type FlaEditableShapeRegion,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

const GRAPHIC_ID = 'e2000000-0000-4000-8000-000000000101';
const TWEEN_LAYER_ID = 'e3000000-0000-4000-8000-000000000101';
const TWEEN_START_MS = 0;
const TWEEN_END_MS = 1_000;
const SHAPE_PATH = ['group-shape', 'shape-mouth'] as const;
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as const;
const FRAME_DURATION_MS = 1_000 / 24;

const SHAPE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" width="240" height="200">' +
  '<path d="M 40 100 L 120 40 L 200 100 L 120 160 Z" fill="#ff5533" fill-opacity="1" stroke="none" fill-rule="nonzero"/>' +
  '</svg>';

const HOLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" width="240" height="200">' +
  '<path d="M 40 40 L 200 40 L 200 160 L 40 160 Z M 90 90 L 90 120 L 150 120 L 150 90 Z" fill="#ff5533" fill-opacity="1" stroke="none" fill-rule="nonzero"/>' +
  '</svg>';

function shapeStructure(): FlaGraphicStructure {
  return {
    version: 1,
    frames: [
      {
        ordinal: 0,
        layers: [
          {
            name: 'main',
            nodes: [
              {
                type: 'group',
                id: 'group-shape',
                sourceAddress: 'graphic:Tween/layer-0-frame-0/0',
                drawOrder: 0,
                localTransform: { ...IDENTITY },
                groupId: 'shape-group',
                children: [
                  {
                    type: 'opaque',
                    id: 'shape-mouth',
                    sourceAddress: 'graphic:Tween/layer-0-frame-0/0/0',
                    drawOrder: 0,
                    localTransform: { ...IDENTITY },
                    opaqueKind: 'shape',
                    sourceRef: 'shape-mouth',
                    fallbackScope: 'subtree',
                    fallbackAssetId: IDS.assetChar,
                    fallbackViewBox: { x: 0, y: 0, width: 240, height: 200 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildTweenProject(): {
  readonly project: Project;
  readonly shotId: string;
  readonly layerId: string;
  readonly regionRef: string;
} {
  const base = buildProjectWithAnimation();
  const template = base.animations[0]!;
  const definition = FlaGraphicDefinitionSchema.parse({
    id: GRAPHIC_ID,
    kind: 'fla-graphic',
    name: 'Tween Graphic',
    source: {
      ...template.source,
      targetKind: 'graphic-symbol',
      targetName: 'TweenGraphic',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 240, height: 200 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    durationMs: FRAME_DURATION_MS,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: IDS.assetChar,
        sha256: 'b'.repeat(64),
        sourceViewport: { x: 0, y: 0, width: 240, height: 200 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: FRAME_DURATION_MS,
        createdBySequenceImport: false,
      },
    ],
    structure: shapeStructure(),
  });
  const shot = base.shots[0]!;
  const templateLayer = shot.layers[1]!;
  const layer = {
    ...templateLayer,
    id: TWEEN_LAYER_ID,
    name: '补间图层',
    source: { kind: 'animation' as const, animationId: definition.id },
    startTimeMs: 0,
    animationPlayback: { mode: 'once' as const, endBehavior: 'hold' as const },
    zIndex: Math.max(...shot.layers.map((candidate) => candidate.zIndex)) + 1,
  };
  const project = ProjectSchema.parse({
    ...base,
    animations: [definition],
    shots: [{ ...shot, layers: [...shot.layers, layer] }],
  });
  const decomposed = decomposeSvgToEditableShapeRegions(SHAPE_SVG);
  return {
    project,
    shotId: shot.id,
    layerId: TWEEN_LAYER_ID,
    regionRef: decomposed.regions[0]!.regionRef,
  };
}

function findDefinition(project: Project): FlaGraphicDefinition {
  const definition = project.animations.find((candidate) => candidate.id === GRAPHIC_ID);
  if (!definition || !('kind' in definition) || definition.kind !== 'fla-graphic') {
    throw new Error('Tween Graphic definition is missing.');
  }
  return definition;
}

function findTween(project: Project, tweenId: string) {
  return findFlaShapeTweenTrackById(findDefinition(project).structure?.shapeTweenTracks, tweenId);
}

function findNode(
  nodes: readonly EvaluatedFlaGraphicNode[],
  path: readonly string[],
): EvaluatedFlaGraphicNode | null {
  for (const node of nodes) {
    if (node.path.length === path.length && node.path.every((part, index) => part === path[index])) {
      return node;
    }
    const nested = findNode(node.children, path);
    if (nested) return nested;
  }
  return null;
}

function evaluateRegion(
  project: Project,
  internalTimeMs: number,
): FlaEditableShapeRegion | null {
  const definition = findDefinition(project);
  const layer = project.shots[0]!.layers.find((candidate) => candidate.id === TWEEN_LAYER_ID)!;
  const visual = evaluateFlaGraphicVisual({
    definition,
    frameOrdinal: 0,
    mode: 'instance',
    internalTimeMs,
    instanceTransformOverrides: layer.flaGraphicInstanceTransformOverrides,
    instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
  });
  const nodes = visual?.layers?.flatMap((entry) => entry.nodes) ?? [];
  const node = findNode(nodes, SHAPE_PATH);
  return node?.vectorVisual?.regions[0] ?? null;
}

function withTween(
  fixture: ReturnType<typeof buildTweenProject>,
): {
  readonly project: Project;
  readonly tweenId: string;
} {
  const service = new LayerService();
  const created = service.createFlaGraphicShapeTween(fixture.project, {
    shotId: fixture.shotId,
    layerId: fixture.layerId,
    frameOrdinal: 0,
    nodePath: [...SHAPE_PATH],
    regionRef: fixture.regionRef,
    mode: 'definition',
    svgText: SHAPE_SVG,
    startTimeMs: TWEEN_START_MS,
    durationMs: TWEEN_END_MS - TWEEN_START_MS,
  });
  const tweenId = findDefinition(created).structure!.shapeTweenTracks![0]!.tweenId;
  return { project: created, tweenId };
}

/** Author the second pose by editing the region anchor at the tween's end time. */
function withAuthoredSecondPose(
  fixture: ReturnType<typeof buildTweenProject>,
): {
  readonly project: Project;
  readonly tweenId: string;
} {
  const { project, tweenId } = withTween(fixture);
  const service = new LayerService();
  const moved = service.moveFlaGraphicShapeRegionVertex(project, {
    shotId: fixture.shotId,
    layerId: fixture.layerId,
    frameOrdinal: 0,
    nodePath: [...SHAPE_PATH],
    regionRef: fixture.regionRef,
    mode: 'definition',
    target: { contourIndex: 0, commandIndex: 1, pointKind: 'anchor' },
    x: 150,
    y: 10,
    internalTimeMs: TWEEN_END_MS,
  });
  return { project: moved, tweenId };
}

describe('native author Shape Tween (#1457 F02)', () => {
  it('creates a stable single-region tween that round-trips through ProjectSchema and evaluates exact endpoints', () => {
    const fixture = buildTweenProject();
    const { project, tweenId } = withAuthoredSecondPose(fixture);
    const roundTripped = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    const track = findTween(roundTripped, tweenId)!;
    expect(track).toBeTruthy();
    expect(track.easing).toBe('linear');
    expect(track.startTimeMs).toBe(TWEEN_START_MS);
    expect(track.endTimeMs).toBe(TWEEN_END_MS);
    expect(track.target.nodeTrackId).toContain('addr:');
    expect(track.target.regionRef).toBe(fixture.regionRef);
    expect(track.from.contours).toHaveLength(1);
    expect(track.to.contours).toHaveLength(1);

    const atStart = evaluateRegion(roundTripped, TWEEN_START_MS)!;
    const atEnd = evaluateRegion(roundTripped, TWEEN_END_MS)!;
    expect(atStart).not.toBeNull();
    expect(atEnd).not.toBeNull();
    // Authored endpoints stay exact (the authored commands are preserved at t=0/t=1).
    expect(atStart.contours).toEqual(track.from.contours);
    expect(atEnd.contours).toEqual(track.to.contours);
    expect(atStart.contours).not.toEqual(atEnd.contours);
    expect(atEnd.bounds.height).toBeGreaterThan(atStart.bounds.height);

    const middleA = evaluateRegion(roundTripped, 500)!;
    const middleB = evaluateRegion(roundTripped, 500)!;
    expect(middleA).not.toBeNull();
    expect(JSON.stringify(middleA)).toBe(JSON.stringify(middleB));
    expect(middleA.contours).not.toEqual(track.from.contours);
    expect(middleA.contours).not.toEqual(track.to.contours);
    expect(middleA.contours[0]!.commands.every((command) =>
      command.type === 'M' || command.type === 'C' || command.type === 'Z')).toBe(true);
    expect(middleA.contours[0]!.commands.at(-1)!.type).toBe('Z');
    expect(Number.isFinite(middleA.bounds.width) && middleA.bounds.width > 0).toBe(true);
  });

  it('drives the same evaluated geometry through the Stage/Export visual-part path', () => {
    const fixture = buildTweenProject();
    const { project } = withAuthoredSecondPose(fixture);
    const shot = project.shots[0]!;
    const evaluatedShot = evaluateShotAtTime(shot, 500, project);
    const evaluatedLayer = evaluatedShot.layers.find((candidate) => candidate.id === TWEEN_LAYER_ID)!;
    const resolved = resolveLayerVisualParts(project, shot, evaluatedLayer);
    expect(resolved.kind).toBe('fla-graphic');
    const flaGraphic = resolved.flaGraphic;
    expect(flaGraphic).toBeTruthy();
    expect(flaGraphic!.layers).toBeTruthy();
    const nodes = flaGraphic!.layers!.flatMap((entry) => entry.nodes);
    const node = findNode(nodes, SHAPE_PATH);
    const stageRegion = node?.vectorVisual?.regions[0] ?? null;
    const internalTimeMs =
      evaluatedLayer.animationFrame?.internalTimeMs ?? 500;
    const directRegion = evaluateRegion(project, internalTimeMs);
    expect(JSON.stringify(stageRegion)).toBe(JSON.stringify(directRegion));
  });

  it('updates timing, easing and poses once, with single-source validation errors', () => {
    const fixture = buildTweenProject();
    const { project, tweenId } = withAuthoredSecondPose(fixture);
    const service = new LayerService();
    const retimed = service.updateFlaGraphicShapeTween(project, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      tweenId,
      endTimeMs: 1_500,
      easing: 'ease',
    });
    const retimedTrack = findTween(retimed, tweenId)!;
    expect(retimedTrack.endTimeMs).toBe(1_500);
    expect(retimedTrack.easing).toBe('ease');
    // With `ease`, the halfway progress is 0.5 but quarter-time is eased (slower start).
    const quarter = evaluateRegion(retimed, 375)!;
    const linearQuarter = (() => {
      const linear = service.updateFlaGraphicShapeTween(retimed, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        tweenId,
        easing: 'linear',
      });
      return evaluateRegion(linear, 375)!;
    })();
    expect(JSON.stringify(quarter.contours)).not.toBe(JSON.stringify(linearQuarter.contours));

    const mismatchedStyle: FlaEditableShapeRegion = {
      ...findTween(retimed, tweenId)!.to,
      fill: { ...findTween(retimed, tweenId)!.to.fill, color: '#00FF00' },
    };
    expect(() =>
      service.updateFlaGraphicShapeTween(retimed, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        tweenId,
        pose: 'to',
        region: mismatchedStyle,
      }),
    ).toThrow(/相同的填充和描边样式/u);

    const midRangeEdit = () =>
      service.moveFlaGraphicShapeRegionVertex(retimed, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: [...SHAPE_PATH],
        regionRef: fixture.regionRef,
        mode: 'definition',
        target: { contourIndex: 0, commandIndex: 1, pointKind: 'anchor' },
        x: 170,
        y: 20,
        internalTimeMs: 700,
      });
    expect(midRangeEdit).toThrow(/拖到补间起点或终点/u);

    expect(() =>
      service.createFlaGraphicShapeTween(project, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: [...SHAPE_PATH],
        regionRef: fixture.regionRef,
        mode: 'instance',
        svgText: SHAPE_SVG,
        startTimeMs: 0,
        durationMs: 500,
      }),
    ).toThrow(/仅支持在共享元件定义中创建/u);
  });

  it('deletes a tween and keeps one History entry per confirmed edit through the store', () => {
    const fixture = buildTweenProject();
    const editorStore = new EditorProjectStore();
    editorStore.open('C:\\dummy\\tween-project', fixture.project);
    const layerStore = new LayerStore(editorStore, {
      getCurrentShotId: () => fixture.shotId,
    }, new LayerService());
    const created = layerStore.createFlaGraphicShapeTween({
      layerId: fixture.layerId,
      frameOrdinal: 0,
      nodePath: [...SHAPE_PATH],
      regionRef: fixture.regionRef,
      mode: 'definition',
      svgText: SHAPE_SVG,
      startTimeMs: 0,
      durationMs: 1_000,
    });
    const tweenId = findDefinition(created).structure!.shapeTweenTracks![0]!.tweenId;
    expect(editorStore.getSnapshot()!.project).toEqual(created);
    expect(editorStore.undo()).toBe(true);
    expect(
      findDefinition(editorStore.getSnapshot()!.project).structure?.shapeTweenTracks,
    ).toBeUndefined();
    expect(editorStore.redo()).toBe(true);
    expect(
      findDefinition(editorStore.getSnapshot()!.project).structure!.shapeTweenTracks,
    ).toHaveLength(1);

    const deleted = layerStore.deleteFlaGraphicShapeTween({
      layerId: fixture.layerId,
      tweenId,
    });
    expect(findDefinition(deleted).structure!.shapeTweenTracks).toBeUndefined();
    expect(evaluateRegion(deleted, 500)).not.toBeNull();
    expect(editorStore.undo()).toBe(true);
    expect(
      findDefinition(editorStore.getSnapshot()!.project).structure!.shapeTweenTracks,
    ).toHaveLength(1);
  });

  it('rejects unsupported hole / multi-contour geometry with a clear Chinese error', () => {
    const fixture = buildTweenProject();
    const service = new LayerService();
    const definition = findDefinition(fixture.project);
    const decomposed = decomposeSvgToEditableShapeRegions(HOLE_SVG);
    const holeRegion = decomposed.regions[0]!;
    expect(holeRegion.contours.length).toBe(2);
    const frameKey = '0';
    const pathKey = JSON.stringify(SHAPE_PATH);
    const seeded = FlaGraphicDefinitionSchema.parse({
      ...definition,
      flaGraphicSharedShapeOverrides: {
        [frameKey]: {
          [pathKey]: {
            baseViewBox: decomposed.viewBox,
            regions: decomposed.regions,
            excludedRegionRefs: [],
            extractedRegions: [],
          },
        },
      },
    });
    const project = ProjectSchema.parse({
      ...fixture.project,
      animations: [seeded],
    });
    expect(() =>
      service.createFlaGraphicShapeTween(project, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: [...SHAPE_PATH],
        regionRef: holeRegion.regionRef,
        mode: 'definition',
        startTimeMs: 0,
        durationMs: 1_000,
      }),
    ).toThrow(/孔洞或多轮廓/u);
  });

  it('degrades locally when the target region is deleted from the authored override', () => {
    const fixture = buildTweenProject();
    const { project, tweenId } = withAuthoredSecondPose(fixture);
    const opened = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    const animations = opened.animations as Array<Record<string, unknown>>;
    const definition = animations.find((candidate) => candidate.id === GRAPHIC_ID)!;
    const overrides = definition.flaGraphicSharedShapeOverrides as Record<
      string,
      Record<string, { regions: FlaEditableShapeRegion[] }>
    >;
    const frameOverrides = overrides['0']!;
    const nodeOverride = frameOverrides[JSON.stringify(SHAPE_PATH)]!;
    nodeOverride.regions = nodeOverride.regions.filter(
      (region) => region.regionRef !== fixture.regionRef,
    );
    const brokenProject = ProjectSchema.parse(opened);
    expect(findTween(brokenProject, tweenId)!.tweenId).toBe(tweenId);

    const withoutTrack = ProjectSchema.parse({
      ...brokenProject,
      animations: brokenProject.animations.map((candidate) =>
        candidate.id !== GRAPHIC_ID
          ? candidate
          : {
              ...(candidate as FlaGraphicDefinition),
              structure: {
                ...(candidate as FlaGraphicDefinition).structure!,
                shapeTweenTracks: undefined,
              },
            },
      ),
    });
    const degraded = evaluateRegion(brokenProject, 500);
    expect(degraded).toBeNull();
    const evaluateDefinition = (projectToEvaluate: Project): unknown => {
      const currentDefinition = findDefinition(projectToEvaluate);
      const layer = projectToEvaluate.shots[0]!.layers.find(
        (candidate) => candidate.id === TWEEN_LAYER_ID,
      )!;
      return evaluateFlaGraphicVisual({
        definition: currentDefinition,
        frameOrdinal: 0,
        mode: 'instance',
        internalTimeMs: 500,
        instanceTransformOverrides: layer.flaGraphicInstanceTransformOverrides,
        instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
      });
    };
    expect(JSON.stringify(evaluateDefinition(brokenProject))).toBe(
      JSON.stringify(evaluateDefinition(withoutTrack)),
    );
  });

  it('treats a stale target as inert, leaving the source-baked frame fallback unchanged', () => {
    const fixture = buildTweenProject();
    const { project, tweenId } = withAuthoredSecondPose(fixture);
    const opened = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    const animations = opened.animations as Array<Record<string, unknown>>;
    const definition = animations.find((candidate) => candidate.id === GRAPHIC_ID)!;
    const structure = definition.structure as {
      shapeTweenTracks: Array<{ target: { nodeTrackId: string } }>;
    };
    structure.shapeTweenTracks[0]!.target.nodeTrackId = 'addr:missing-node';
    const staleProject = ProjectSchema.parse(opened);
    expect(findTween(staleProject, tweenId)).toBeTruthy();

    const evaluateDefinition = (projectToEvaluate: Project): unknown => {
      const currentDefinition = findDefinition(projectToEvaluate);
      const layer = projectToEvaluate.shots[0]!.layers.find(
        (candidate) => candidate.id === TWEEN_LAYER_ID,
      )!;
      return evaluateFlaGraphicVisual({
        definition: currentDefinition,
        frameOrdinal: 0,
        mode: 'instance',
        internalTimeMs: 500,
        instanceTransformOverrides: layer.flaGraphicInstanceTransformOverrides,
        instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
      });
    };
    const withoutTracks = ProjectSchema.parse({
      ...staleProject,
      animations: staleProject.animations.map((candidate) =>
        candidate.id === GRAPHIC_ID
          ? {
              ...(candidate as FlaGraphicDefinition),
              structure: {
                ...(candidate as FlaGraphicDefinition).structure!,
                shapeTweenTracks: undefined,
              },
            }
          : candidate,
      ),
    });
    expect(JSON.stringify(evaluateDefinition(staleProject))).toBe(
      JSON.stringify(evaluateDefinition(withoutTracks)),
    );
    // The authored override (source-svg region) still renders untouched.
    expect(evaluateRegion(staleProject, 500)?.regionRef).toBe(fixture.regionRef);
  });

  it('keeps the source-baked FLA morph / display-cache regression inert', () => {
    // A definition without any author tween evaluates exactly as before, and
    // the pre-existing source morph sampling test file is still run by the
    // targeted suite. Here we prove the new optional field never changes a
    // graphic without a matching author track.
    const fixture = buildTweenProject();
    const baseline = evaluateFlaGraphicVisual({
      definition: findDefinition(fixture.project),
      frameOrdinal: 0,
      mode: 'definition',
    });
    const withInertField = ProjectSchema.parse({
      ...fixture.project,
      animations: fixture.project.animations.map((candidate) => {
        if (candidate.id !== GRAPHIC_ID) return candidate;
        const definition = candidate as FlaGraphicDefinition;
        return FlaGraphicDefinitionSchema.parse({
          ...definition,
          structure: {
            ...definition.structure!,
            shapeTweenTracks: [
              {
                tweenId: 'shape-tween-inert',
                target: {
                  nodeTrackId: 'addr:not-present',
                  ownerKind: 'frame',
                  regionRef: 'missing-region',
                  sourceFrameOrdinal: 0,
                  sourceNodePath: [...SHAPE_PATH],
                },
                startTimeMs: 0,
                endTimeMs: 1_000,
                easing: 'linear',
                from: {
                  regionRef: 'missing-region',
                  fill: { kind: 'solid', color: '#FF5533', opacity: 1, fillRule: 'nonzero' },
                  contours: [
                    {
                      closed: true,
                      commands: [
                        { type: 'M', x: 0, y: 0 },
                        { type: 'L', x: 10, y: 0 },
                        { type: 'L', x: 10, y: 10 },
                        { type: 'Z' },
                      ],
                    },
                  ],
                  strokes: [],
                  bounds: { x: 0, y: 0, width: 10, height: 10 },
                },
                to: {
                  regionRef: 'missing-region',
                  fill: { kind: 'solid', color: '#FF5533', opacity: 1, fillRule: 'nonzero' },
                  contours: [
                    {
                      closed: true,
                      commands: [
                        { type: 'M', x: 0, y: 0 },
                        { type: 'L', x: 10, y: 0 },
                        { type: 'L', x: 10, y: 10 },
                        { type: 'Z' },
                      ],
                    },
                  ],
                  strokes: [],
                  bounds: { x: 0, y: 0, width: 10, height: 10 },
                },
              },
            ],
          },
        });
      }),
    });
    const withInertTween = evaluateFlaGraphicVisual({
      definition: findDefinition(withInertField),
      frameOrdinal: 0,
      mode: 'definition',
    });
    expect(JSON.stringify(withInertTween)).toBe(JSON.stringify(baseline));
  });
});
