import { describe, expect, it } from 'vitest';
import {
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  computeFlaShapeRegionBounds,
  decomposeSvgToEditableShapeRegions,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  findFlaShapeTweenTrackById,
  interpolateShapeMorphPair,
  prepareFlaShapeTweenTrack,
  prepareShapeMorphPair,
  resolveLayerVisualParts,
  withFlaShapeTweenContours,
  type EvaluatedFlaGraphicNode,
  type FlaEditableShapeRegion,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type FlaVectorContour,
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

const TWO_REGION_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" width="240" height="200">' +
  '<path d="M 40 60 L 120 20 L 200 60 L 120 100 Z" fill="#ff5533" fill-opacity="1" stroke="none" fill-rule="nonzero"/>' +
  '<path d="M 40 140 L 120 100 L 200 140 L 120 180 Z" fill="#ff5533" fill-opacity="1" stroke="none" fill-rule="nonzero"/>' +
  '</svg>';

function closedPolygon(points: readonly { readonly x: number; readonly y: number }[]): FlaVectorContour {
  return {
    closed: true,
    commands: [
      { type: 'M', x: points[0]!.x, y: points[0]!.y },
      ...points.slice(1).map((point) => ({ type: 'L' as const, x: point.x, y: point.y })),
      { type: 'Z' },
    ],
  };
}

function ellipseContour(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): FlaVectorContour {
  const k = 0.5522847498307936;
  return {
    closed: true,
    commands: [
      { type: 'M', x: cx + rx, y: cy },
      { type: 'C', c1x: cx + rx, c1y: cy + k * ry, c2x: cx + k * rx, c2y: cy + ry, x: cx, y: cy + ry },
      { type: 'C', c1x: cx - k * rx, c1y: cy + ry, c2x: cx - rx, c2y: cy + k * ry, x: cx - rx, y: cy },
      { type: 'C', c1x: cx - rx, c1y: cy - k * ry, c2x: cx - k * rx, c2y: cy - ry, x: cx, y: cy - ry },
      { type: 'C', c1x: cx + k * rx, c1y: cy - ry, c2x: cx + rx, c2y: cy - k * ry, x: cx + rx, y: cy },
      { type: 'Z' },
    ],
  };
}

function flattenContourPoints(contour: FlaVectorContour): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let cursor = { x: 0, y: 0 };
  const steps = 12;
  for (const command of contour.commands) {
    if (command.type === 'M' || command.type === 'L') {
      points.push({ x: command.x, y: command.y });
      cursor = { x: command.x, y: command.y };
    } else if (command.type === 'Q') {
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        points.push({
          x: u * u * cursor.x + 2 * u * t * command.cx + t * t * command.x,
          y: u * u * cursor.y + 2 * u * t * command.cy + t * t * command.y,
        });
      }
      cursor = { x: command.x, y: command.y };
    } else if (command.type === 'C') {
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        points.push({
          x:
            u * u * u * cursor.x +
            3 * u * u * t * command.c1x +
            3 * u * t * t * command.c2x +
            t * t * t * command.x,
          y:
            u * u * u * cursor.y +
            3 * u * u * t * command.c1y +
            3 * u * t * t * command.c2y +
            t * t * t * command.y,
        });
      }
      cursor = { x: command.x, y: command.y };
    }
  }
  return points;
}

function pointInRing(
  point: { readonly x: number; readonly y: number },
  ring: readonly { readonly x: number; readonly y: number }[],
): number {
  let winding = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    if (a.y <= point.y) {
      if (b.y > point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) > 0) {
        winding += 1;
      }
    } else if (b.y <= point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) < 0) {
      winding -= 1;
    }
  }
  return winding;
}

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

function evaluateNodeRegions(
  project: Project,
  internalTimeMs: number,
): readonly FlaEditableShapeRegion[] {
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
  return node?.vectorVisual?.regions ?? [];
}

function evaluateRegion(
  project: Project,
  internalTimeMs: number,
): FlaEditableShapeRegion | null {
  return evaluateNodeRegions(project, internalTimeMs)[0] ?? null;
}

function findTweenForRegion(project: Project, regionRef: string) {
  return (
    findDefinition(project).structure?.shapeTweenTracks?.find(
      (track) => track.target.regionRef === regionRef,
    ) ?? null
  );
}

/** Same project with every author Shape Tween track removed (baseline geometry). */
function withoutShapeTweenTracks(project: Project): Project {
  return ProjectSchema.parse({
    ...project,
    animations: project.animations.map((candidate) =>
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
}

/** Replaces the `to` pose of one tween with new single-contour geometry. */
function authorToPose(
  fixture: ReturnType<typeof buildTweenProject>,
  project: Project,
  tweenId: string,
  contours: readonly FlaVectorContour[],
): Project {
  const track = findTween(project, tweenId)!;
  return new LayerService().updateFlaGraphicShapeTween(project, {
    shotId: fixture.shotId,
    layerId: fixture.layerId,
    tweenId,
    pose: 'to',
    region: withFlaShapeTweenContours(track.from, contours),
  });
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

  it('supports an outer + hole region tween and rejects unsupported nested topology', () => {
    const fixture = buildTweenProject();
    const service = new LayerService();
    const definition = findDefinition(fixture.project);
    const decomposed = decomposeSvgToEditableShapeRegions(HOLE_SVG);
    const holeRegion = decomposed.regions[0]!;
    expect(holeRegion.contours.length).toBe(2);
    const frameKey = '0';
    const pathKey = JSON.stringify(SHAPE_PATH);
    const withSeededRegions = (
      regions: readonly FlaEditableShapeRegion[],
    ): Project => {
      const seeded = FlaGraphicDefinitionSchema.parse({
        ...definition,
        flaGraphicSharedShapeOverrides: {
          [frameKey]: {
            [pathKey]: {
              baseViewBox: decomposed.viewBox,
              regions: [...regions],
              excludedRegionRefs: [],
              extractedRegions: [],
            },
          },
        },
      });
      return ProjectSchema.parse({
        ...fixture.project,
        animations: [seeded],
      });
    };

    // Outer + direct hole is now inside the documented multi-contour boundary.
    const withHole = withSeededRegions(decomposed.regions);
    const created = service.createFlaGraphicShapeTween(withHole, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      frameOrdinal: 0,
      nodePath: [...SHAPE_PATH],
      regionRef: holeRegion.regionRef,
      mode: 'definition',
      startTimeMs: 0,
      durationMs: 1_000,
    });
    const holeTrack = findDefinition(created).structure!.shapeTweenTracks![0]!;
    expect(holeTrack.from.contours).toHaveLength(2);
    expect(holeTrack.to.contours).toHaveLength(2);

    // A contour nested inside the hole is outside the boundary.
    const island = closedPolygon([
      { x: 110, y: 100 },
      { x: 110, y: 112 },
      { x: 130, y: 112 },
      { x: 130, y: 100 },
    ]);
    const nestedRegion: FlaEditableShapeRegion = {
      ...holeRegion,
      contours: [...holeRegion.contours, island],
      bounds: computeFlaShapeRegionBounds({
        contours: [...holeRegion.contours, island],
        strokes: holeRegion.strokes,
      }),
    };
    const withNested = withSeededRegions([nestedRegion]);
    expect(() =>
      service.createFlaGraphicShapeTween(withNested, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: [...SHAPE_PATH],
        regionRef: nestedRegion.regionRef,
        mode: 'definition',
        startTimeMs: 0,
        durationMs: 1_000,
      }),
    ).toThrow(/暂不支持该多轮廓/u);
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

  it('changes the morph with an authored hint and restores the unhinted evaluation exactly when removed', () => {
    const fixture = buildTweenProject();
    const { project, tweenId } = withTween(fixture);
    const service = new LayerService();
    const triangle = closedPolygon([
      { x: 40, y: 100 },
      { x: 200, y: 100 },
      { x: 120, y: 190 },
    ]);
    const withPose = authorToPose(fixture, project, tweenId, [triangle]);
    const times = [150, 400, 650, 900];
    const before = times.map((time) => JSON.stringify(evaluateRegion(withPose, time)));
    const hinted = service.addFlaGraphicShapeTweenHint(withPose, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      tweenId,
      from: { contourIndex: 0, segmentIndex: 0, t: 0.5 },
      to: { contourIndex: 0, segmentIndex: 1, t: 0.5 },
    });
    const hintedTrack = findTween(hinted, tweenId)!;
    expect(hintedTrack.hints).toHaveLength(1);
    expect(hintedTrack.hints![0]!.hintId).toMatch(/^shape-hint-/u);
    const after = times.map((time) => JSON.stringify(evaluateRegion(hinted, time)));
    expect(after).not.toEqual(before);
    // Endpoints stay exact with hints present.
    expect(evaluateRegion(hinted, TWEEN_START_MS)!.contours).toEqual(hintedTrack.from.contours);
    expect(evaluateRegion(hinted, TWEEN_END_MS)!.contours).toEqual(hintedTrack.to.contours);

    // Moving the hint changes the morph again (dragging a hint is authoritative).
    const moved = service.updateFlaGraphicShapeTweenHint(hinted, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      tweenId,
      hintId: hintedTrack.hints![0]!.hintId,
      to: { contourIndex: 0, segmentIndex: 2, t: 0.5 },
    });
    expect(JSON.stringify(evaluateRegion(moved, 400))).not.toBe(after[1]);

    const withoutHint = service.removeFlaGraphicShapeTweenHint(hinted, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      tweenId,
      hintId: hintedTrack.hints![0]!.hintId,
    });
    expect(findTween(withoutHint, tweenId)!.hints).toBeUndefined();
    expect(times.map((time) => JSON.stringify(evaluateRegion(withoutHint, time)))).toEqual(before);
  });

  it('commits each hint action as one undo entry through the store', () => {
    const fixture = buildTweenProject();
    const editorStore = new EditorProjectStore();
    editorStore.open('C:\\dummy\\hint-project', fixture.project);
    const layerStore = new LayerStore(
      editorStore,
      { getCurrentShotId: () => fixture.shotId },
      new LayerService(),
    );
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
    const hinted = layerStore.addFlaGraphicShapeTweenHint({
      layerId: fixture.layerId,
      tweenId,
      from: { contourIndex: 0, segmentIndex: 0, t: 0.5 },
      to: { contourIndex: 0, segmentIndex: 0, t: 0.5 },
    });
    expect(findTween(hinted, tweenId)!.hints).toHaveLength(1);
    expect(editorStore.undo()).toBe(true);
    expect(findDefinition(editorStore.getSnapshot()!.project).structure!.shapeTweenTracks![0]!.hints)
      .toBeUndefined();
    expect(editorStore.redo()).toBe(true);
    const redoTrack = findDefinition(
      editorStore.getSnapshot()!.project,
    ).structure!.shapeTweenTracks![0]!;
    expect(redoTrack.hints).toHaveLength(1);
    const removed = layerStore.removeFlaGraphicShapeTweenHint({
      layerId: fixture.layerId,
      tweenId,
      hintId: redoTrack.hints![0]!.hintId,
    });
    expect(findTween(removed, tweenId)!.hints).toBeUndefined();
    expect(editorStore.undo()).toBe(true);
    expect(findDefinition(editorStore.getSnapshot()!.project).structure!.shapeTweenTracks![0]!.hints)
      .toHaveLength(1);
  });

  it('round-trips hints through ProjectSchema and evaluates identically after save/reopen', () => {
    const fixture = buildTweenProject();
    const { project, tweenId } = withTween(fixture);
    const service = new LayerService();
    const triangle = closedPolygon([
      { x: 40, y: 100 },
      { x: 200, y: 100 },
      { x: 120, y: 190 },
    ]);
    const withPose = authorToPose(fixture, project, tweenId, [triangle]);
    const hinted = service.addFlaGraphicShapeTweenHint(withPose, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      tweenId,
      from: { contourIndex: 0, segmentIndex: 1, t: 0.25 },
      to: { contourIndex: 0, segmentIndex: 2, t: 0.5 },
    });
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(hinted)));
    expect(findTween(reopened, tweenId)!.hints).toEqual(findTween(hinted, tweenId)!.hints);
    for (const time of [0, 250, 500, 750, 1_000]) {
      expect(JSON.stringify(evaluateRegion(reopened, time))).toBe(
        JSON.stringify(evaluateRegion(hinted, time)),
      );
    }
  });

  it('rejects crossing and out-of-range hints with clear Chinese errors and keeps the persisted hints', () => {
    const fixture = buildTweenProject();
    const { project, tweenId } = withTween(fixture);
    const service = new LayerService();
    const triangle = closedPolygon([
      { x: 40, y: 100 },
      { x: 200, y: 100 },
      { x: 120, y: 190 },
    ]);
    const withPose = authorToPose(fixture, project, tweenId, [triangle]);
    const first = service.addFlaGraphicShapeTweenHint(withPose, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      tweenId,
      from: { contourIndex: 0, segmentIndex: 0, t: 0.25 },
      to: { contourIndex: 0, segmentIndex: 0, t: 0.75 },
    });
    const second = service.addFlaGraphicShapeTweenHint(first, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      tweenId,
      from: { contourIndex: 0, segmentIndex: 0, t: 0.5 },
      to: { contourIndex: 0, segmentIndex: 0, t: 0.9 },
    });
    const secondHintId = findTween(second, tweenId)!.hints![1]!.hintId;
    expect(() =>
      service.updateFlaGraphicShapeTweenHint(second, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        tweenId,
        hintId: secondHintId,
        to: { contourIndex: 0, segmentIndex: 0, t: 0.2 },
      }),
    ).toThrow(/顺序交叉/u);
    expect(() =>
      service.addFlaGraphicShapeTweenHint(second, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        tweenId,
        from: { contourIndex: 0, segmentIndex: 9, t: 0.5 },
        to: { contourIndex: 0, segmentIndex: 0, t: 0.5 },
      }),
    ).toThrow(/提示点位置无效/u);
    expect(findTween(second, tweenId)!.hints).toHaveLength(2);
  });

  it('keeps a tween without hints byte-identical to the #1457 prepared pair and interpolation', () => {
    const fixture = buildTweenProject();
    const { project, tweenId } = withAuthoredSecondPose(fixture);
    const track = findTween(project, tweenId)!;
    expect(track.hints).toBeUndefined();
    const expected = prepareShapeMorphPair(
      { contours: track.from.contours },
      { contours: track.to.contours },
    );
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(JSON.stringify(prepareFlaShapeTweenTrack(track))).toBe(JSON.stringify(expected));
    for (const progress of [0.13, 0.5, 0.87]) {
      const manual = interpolateShapeMorphPair(expected.pair, progress)!;
      const time = track.startTimeMs + (track.endTimeMs - track.startTimeMs) * progress;
      expect(JSON.stringify(evaluateRegion(project, time)!.contours)).toBe(
        JSON.stringify(manual.contours),
      );
    }
  });

  it('degrades one unsupported tween locally while another tween stays healthy', () => {
    const fixture = buildTweenProject();
    const service = new LayerService();
    const definition = findDefinition(fixture.project);
    const decomposed = decomposeSvgToEditableShapeRegions(TWO_REGION_SVG);
    expect(decomposed.regions).toHaveLength(2);
    const pathKey = JSON.stringify(SHAPE_PATH);
    const seededDefinition = FlaGraphicDefinitionSchema.parse({
      ...definition,
      flaGraphicSharedShapeOverrides: {
        '0': {
          [pathKey]: {
            baseViewBox: decomposed.viewBox,
            regions: decomposed.regions,
            excludedRegionRefs: [],
            extractedRegions: [],
          },
        },
      },
    });
    const base = ProjectSchema.parse({
      ...fixture.project,
      animations: [seededDefinition],
    });
    const create = (target: Project, regionRef: string): Project =>
      service.createFlaGraphicShapeTween(target, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        frameOrdinal: 0,
        nodePath: [...SHAPE_PATH],
        regionRef,
        mode: 'definition',
        startTimeMs: 0,
        durationMs: 1_000,
      });
    const withFirst = create(base, decomposed.regions[0]!.regionRef);
    const withBoth = create(withFirst, decomposed.regions[1]!.regionRef);
    const firstTrack = findTweenForRegion(withBoth, decomposed.regions[0]!.regionRef)!;
    const secondTrack = findTweenForRegion(withBoth, decomposed.regions[1]!.regionRef)!;
    expect(firstTrack).toBeTruthy();
    expect(secondTrack).toBeTruthy();
    const firstAuthored = authorToPose(fixture, withBoth, firstTrack.tweenId, [
      closedPolygon([
        { x: 40, y: 60 },
        { x: 200, y: 60 },
        { x: 120, y: 180 },
      ]),
    ]);
    const bothAuthored = authorToPose(fixture, firstAuthored, secondTrack.tweenId, [
      closedPolygon([
        { x: 40, y: 140 },
        { x: 200, y: 140 },
        { x: 120, y: 40 },
      ]),
    ]);
    const baseline = evaluateNodeRegions(bothAuthored, 500);
    expect(baseline).toHaveLength(2);
    expect(baseline[0]!.contours).not.toEqual(findTween(bothAuthored, firstTrack.tweenId)!.from.contours);
    expect(baseline[1]!.contours).not.toEqual(findTween(bothAuthored, secondTrack.tweenId)!.from.contours);

    // Persist an out-of-boundary topology on the first tween only.
    const opened = JSON.parse(JSON.stringify(bothAuthored)) as Record<string, unknown>;
    const animations = opened.animations as Array<Record<string, unknown>>;
    const openedDefinition = animations.find((candidate) => candidate.id === GRAPHIC_ID)!;
    const openedStructure = openedDefinition.structure as {
      shapeTweenTracks: Array<{ tweenId: string; from: { contours: FlaVectorContour[] } }>;
    };
    const brokenTrack = openedStructure.shapeTweenTracks.find(
      (track) => track.tweenId === firstTrack.tweenId,
    )!;
    brokenTrack.from.contours = [
      closedPolygon([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]),
      closedPolygon([
        { x: 25, y: 25 },
        { x: 25, y: 75 },
        { x: 75, y: 75 },
        { x: 75, y: 25 },
      ]),
      closedPolygon([
        { x: 40, y: 40 },
        { x: 40, y: 60 },
        { x: 60, y: 60 },
        { x: 60, y: 40 },
      ]),
    ];
    const broken = ProjectSchema.parse(opened);
    const brokenRegions = evaluateNodeRegions(broken, 500);
    expect(JSON.stringify(brokenRegions[1])).toBe(JSON.stringify(baseline[1]));
    // The broken region falls back to the same geometry as having no track at all.
    const withoutFirst = ProjectSchema.parse({
      ...broken,
      animations: broken.animations.map((candidate) =>
        candidate.id !== GRAPHIC_ID
          ? candidate
          : {
              ...(candidate as FlaGraphicDefinition),
              structure: {
                ...(candidate as FlaGraphicDefinition).structure!,
                shapeTweenTracks: (
                  candidate as FlaGraphicDefinition
                ).structure!.shapeTweenTracks!.filter(
                  (track) => track.tweenId !== firstTrack.tweenId,
                ),
              },
            },
      ),
    });
    expect(JSON.stringify(brokenRegions[0])).toBe(
      JSON.stringify(evaluateNodeRegions(withoutFirst, 500)[0]),
    );
  });

  it('keeps authored geometry when persisted hints cross, without touching other tweens', () => {
    const fixture = buildTweenProject();
    const { project, tweenId } = withAuthoredSecondPose(fixture);
    const opened = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    const animations = opened.animations as Array<Record<string, unknown>>;
    const definition = animations.find((candidate) => candidate.id === GRAPHIC_ID)!;
    const structure = definition.structure as {
      shapeTweenTracks: Array<{ tweenId: string; hints?: unknown[] }>;
    };
    structure.shapeTweenTracks[0]!.hints = [
      {
        hintId: 'stored-hint-a',
        from: { contourIndex: 0, segmentIndex: 0, t: 0.25 },
        to: { contourIndex: 0, segmentIndex: 0, t: 0.75 },
      },
      {
        hintId: 'stored-hint-b',
        from: { contourIndex: 0, segmentIndex: 0, t: 0.5 },
        to: { contourIndex: 0, segmentIndex: 0, t: 0.25 },
      },
    ];
    const conflicting = ProjectSchema.parse(opened);
    expect(findTween(conflicting, tweenId)!.hints).toHaveLength(2);
    const evaluated = evaluateRegion(conflicting, 500);
    expect(evaluated).not.toBeNull();
    // Crossing hints degrade to the authored override geometry (as if no tween existed).
    expect(JSON.stringify(evaluated)).toBe(
      JSON.stringify(evaluateRegion(withoutShapeTweenTracks(conflicting), 500)),
    );
  });

  it('evaluates a hole pose through the same path with exact endpoints and a contained hole', () => {
    const fixture = buildTweenProject();
    const service = new LayerService();
    const definition = findDefinition(fixture.project);
    const decomposed = decomposeSvgToEditableShapeRegions(HOLE_SVG);
    const holeRegion = decomposed.regions[0]!;
    expect(holeRegion.contours).toHaveLength(2);
    const pathKey = JSON.stringify(SHAPE_PATH);
    const seededDefinition = FlaGraphicDefinitionSchema.parse({
      ...definition,
      flaGraphicSharedShapeOverrides: {
        '0': {
          [pathKey]: {
            baseViewBox: decomposed.viewBox,
            regions: decomposed.regions,
            excludedRegionRefs: [],
            extractedRegions: [],
          },
        },
      },
    });
    const base = ProjectSchema.parse({
      ...fixture.project,
      animations: [seededDefinition],
    });
    const created = service.createFlaGraphicShapeTween(base, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      frameOrdinal: 0,
      nodePath: [...SHAPE_PATH],
      regionRef: holeRegion.regionRef,
      mode: 'definition',
      startTimeMs: 0,
      durationMs: 1_000,
    });
    const tweenId = findDefinition(created).structure!.shapeTweenTracks![0]!.tweenId;
    const withEllipse = authorToPose(fixture, created, tweenId, [
      ellipseContour(120, 110, 80, 60),
    ]);
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(withEllipse)));
    const track = findTween(reopened, tweenId)!;
    const start = evaluateRegion(reopened, TWEEN_START_MS)!;
    const end = evaluateRegion(reopened, TWEEN_END_MS)!;
    const middle = evaluateRegion(reopened, 500)!;
    expect(start.contours).toEqual(track.from.contours);
    expect(end.contours).toEqual(track.to.contours);
    expect(start.contours).toHaveLength(2);
    expect(end.contours).toHaveLength(1);
    expect(middle.contours).toHaveLength(2);
    const outer = flattenContourPoints(middle.contours[0]!);
    const hole = flattenContourPoints(middle.contours[1]!);
    expect(hole.length).toBeGreaterThan(0);
    expect(hole.every((point) => pointInRing(point, outer) !== 0)).toBe(true);
  });
});
