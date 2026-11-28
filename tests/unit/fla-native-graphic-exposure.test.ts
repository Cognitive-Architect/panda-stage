import { describe, expect, it } from 'vitest';
import {
  addNativeGraphicBlankKeyframe,
  addNativeGraphicLayer,
  copyNativeGraphicFrame,
  createNativeGraphicDefinitionFromNodes,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  extendNativeGraphicExposure,
  groupNativeGraphicNodes,
  isFlaGraphicDefinition,
  LayerService,
  listNativeGraphicExposureFrames,
  moveNativeGraphicLayer,
  ProjectSchema,
  removeNativeGraphicLayer,
  removeNativeGraphicNode,
  resolveFlaGraphicTimelineTarget,
  shortenNativeGraphicExposure,
  ungroupNativeGraphicNode,
  type EvaluatedFlaGraphicNode,
  type EvaluatedFlaGraphicVisual,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { FlaGraphicDefinitionSchema } from '../../src/domain/models/animation';
import {
  FlaGraphicStructureSchema,
  type FlaGraphicStructure,
} from '../../src/domain/models/flaGraphicStructure';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { buildSourceGraphicMultiFrameFixture } from '../helpers/nativeGraphicExposureFixtures';
import {
  buildSourceGraphicFixture,
  CIRCLE_REGION,
  editableRegion,
  placeGraphicLayer,
  RECT_REGION,
  SOURCE_CIRCLE_PATH,
  SOURCE_GRAPHIC_ID,
  SOURCE_RECT_PATH,
} from '../helpers/nativeGraphicProject';
import sourceEvalBaseline from '../fixtures/fla-graphic-source-eval-baseline.json';

const FPS = 24;

let idCounter = 0;
function deterministicIds(): () => string {
  return () => {
    idCounter += 1;
    return `91000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
  };
}

interface NativeFixture {
  readonly project: Project;
  readonly shotId: string;
  readonly animationId: string;
  readonly layerAId: string;
  readonly layerBId: string;
  readonly firstNodeId: string;
  readonly secondNodeId: string;
}

function definitionOf(project: Project, animationId: string): FlaGraphicDefinition {
  const definition = project.animations.find((candidate) => candidate.id === animationId);
  if (!definition || !isFlaGraphicDefinition(definition)) {
    throw new Error('native definition is missing');
  }
  return definition;
}

function buildNativeFixture(): NativeFixture {
  const fixture = buildSourceGraphicFixture();
  const placed = placeGraphicLayer(fixture.project, fixture.shotId, SOURCE_GRAPHIC_ID);
  const created = createNativeGraphicDefinitionFromNodes(placed.project, {
    shotId: fixture.shotId,
    layerId: placed.layerId,
    frameOrdinal: 0,
    nodePaths: [SOURCE_CIRCLE_PATH, SOURCE_RECT_PATH],
    createId: deterministicIds(),
  });
  const placedA = placeGraphicLayer(
    created.project,
    fixture.shotId,
    created.animationId,
    { x: 400, y: 300 },
  );
  const placedB = placeGraphicLayer(
    placedA.project,
    fixture.shotId,
    created.animationId,
    { x: 800, y: 300 },
  );
  const definition = definitionOf(placedB.project, created.animationId);
  const nodes = definition.structure!.frames[0]!.layers[0]!.nodes;
  return {
    project: placedB.project,
    shotId: fixture.shotId,
    animationId: created.animationId,
    layerAId: placedA.layerId,
    layerBId: placedB.layerId,
    firstNodeId: nodes[0]!.id,
    secondNodeId: nodes[1]!.id,
  };
}

/**
 * Hand-authored two-layer native Definition so layer order can be observed as
 * draw order. Both nodes are authored-native editable vector shapes.
 */
function buildTwoLayerNativeFixture(): {
  readonly project: Project;
  readonly shotId: string;
  readonly animationId: string;
  readonly layerAId: string;
  readonly layerBId: string;
} {
  const base = buildSourceGraphicFixture();
  const shapeA = editableRegion('reg-layer-a', 0, 0, 40, 30, '#cc3333');
  const shapeB = editableRegion('reg-layer-b', 0, 0, 50, 40, '#3333cc');
  const frameDurationMs = 1_000 / FPS;
  const definition = FlaGraphicDefinitionSchema.parse({
    id: '91000000-0000-4000-8000-0000000000aa',
    name: '双层原生元件',
    kind: 'fla-graphic',
    source: {
      origin: 'native',
      targetKind: 'graphic-symbol',
      targetName: '双层原生元件',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: FPS,
      canvas: { width: 100, height: 100 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 100, height: 100 },
    },
    durationMs: frameDurationMs,
    frames: [{
      ordinal: 0,
      sourceFrameIndex: 0,
      sourceViewport: { x: 0, y: 0, width: 100, height: 100 },
      offset: { x: 0, y: 0 },
      startMs: 0,
      durationMs: frameDurationMs,
      createdBySequenceImport: false,
    }],
    structure: {
      version: 1,
      frames: [{
        ordinal: 0,
        layers: [
          {
            name: '底层',
            nodes: [{
              type: 'opaque',
              id: 'layer-a-node',
              authored: 'native',
              drawOrder: 0,
              localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 10 },
              opaqueKind: 'shape',
              fallbackScope: 'subtree',
              fallbackViewBox: { x: 0, y: 0, width: 40, height: 30 },
            }],
          },
          {
            name: '顶层',
            nodes: [{
              type: 'opaque',
              id: 'layer-b-node',
              authored: 'native',
              drawOrder: 0,
              localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 50, ty: 50 },
              opaqueKind: 'shape',
              fallbackScope: 'subtree',
              fallbackViewBox: { x: 0, y: 0, width: 50, height: 40 },
            }],
          },
        ],
      }],
    },
    flaGraphicSharedShapeOverrides: {
      '0': {
        [JSON.stringify(['layer-a-node'])]: {
          baseViewBox: { x: 0, y: 0, width: 40, height: 30 },
          regions: [shapeA],
          excludedRegionRefs: [],
          extractedRegions: [],
        },
        [JSON.stringify(['layer-b-node'])]: {
          baseViewBox: { x: 0, y: 0, width: 50, height: 40 },
          regions: [shapeB],
          excludedRegionRefs: [],
          extractedRegions: [],
        },
      },
    },
  });
  const project = ProjectSchema.parse({
    ...base.project,
    animations: [definition],
  });
  const service = new LayerService();
  const placedA = service.createFromAnimation(project, base.shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 400, y: 300 },
  });
  const placedB = service.createFromAnimation(placedA.project, base.shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 800, y: 300 },
  });
  return {
    project: placedB.project,
    shotId: base.shotId,
    animationId: definition.id,
    layerAId: placedA.layer.id,
    layerBId: placedB.layer.id,
  };
}

function evaluateDefinition(
  project: Project,
  animationId: string,
  frameOrdinal: number,
  options: {
    readonly mode?: 'definition' | 'instance';
    readonly internalTimeMs?: number;
    readonly layerId?: string;
  } = {},
): EvaluatedFlaGraphicVisual {
  const definition = definitionOf(project, animationId);
  const mode = options.mode ?? 'definition';
  const layer = options.layerId
    ? project.shots.flatMap((shot) => shot.layers).find((candidate) => candidate.id === options.layerId)
    : undefined;
  const visual = evaluateFlaGraphicVisual({
    definition,
    frameOrdinal,
    mode,
    ...(options.internalTimeMs !== undefined ? { internalTimeMs: options.internalTimeMs } : {}),
    ...(layer && layer.source.kind === 'animation'
      ? {
          instanceTransformOverrides: layer.flaGraphicInstanceTransformOverrides,
          instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
          instanceTextOverrides: layer.flaGraphicInstanceTextOverrides,
        }
      : {}),
  });
  if (!visual) throw new Error(`frame ${frameOrdinal} did not evaluate`);
  return visual;
}

function flattenEvaluatedNodes(
  nodes: readonly EvaluatedFlaGraphicNode[],
): {
  readonly path: string;
  readonly worldTransform: EvaluatedFlaGraphicNode['worldTransform'];
  readonly localTransform: EvaluatedFlaGraphicNode['localTransform'];
}[] {
  return nodes.flatMap((node) => [
    {
      path: JSON.stringify(node.path),
      worldTransform: node.worldTransform,
      localTransform: node.localTransform,
    },
    ...flattenEvaluatedNodes(node.children),
  ]);
}

function layerNodeIds(visual: EvaluatedFlaGraphicVisual): string[][] {
  return (visual.layers ?? []).map((layer) => layer.nodes.map((node) => node.source.id));
}

function expectRefusal(operation: () => void): void {
  let caught: unknown = null;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'operation should have been refused').toBeInstanceOf(Error);
  expect((caught as { code?: string }).code).toBe('NATIVE_GRAPHIC_NOT_NATIVE');
  expect((caught as Error).message).toMatch(/只支持原生元件/);
}

describe('issue #1453 native Graphic exposure and frame authoring', () => {
  it('inserts blank keyframes that play empty without disturbing other frames', () => {
    const created = buildNativeFixture();
    const copied = copyNativeGraphicFrame(created.project, {
      animationId: created.animationId,
      sourceFrameOrdinal: 0,
      createId: deterministicIds(),
    });
    const before = evaluateDefinition(copied.project, created.animationId, 0);
    const blanked = addNativeGraphicBlankKeyframe(copied.project, {
      animationId: created.animationId,
      frameOrdinal: 1,
    });
    const definition = definitionOf(blanked.project, created.animationId);
    expect(definition.frames).toHaveLength(2);
    expect(definition.structure!.frames[1]!.holdFromOrdinal).toBeUndefined();
    expect(definition.structure!.frames[1]!.layers.every((layer) => layer.nodes.length === 0))
      .toBe(true);
    // The blank ordinal plays no content at all.
    const blankVisual = evaluateDefinition(blanked.project, created.animationId, 1);
    expect(blankVisual.layers).toHaveLength(1);
    expect(blankVisual.layers!.every((layer) => layer.nodes.length === 0)).toBe(true);
    // The other frame keeps its exact previous content.
    const after = evaluateDefinition(blanked.project, created.animationId, 0);
    expect(after.layers).toEqual(before.layers);

    // Appending a blank keyframe at the end grows the definition by one frame.
    const appended = addNativeGraphicBlankKeyframe(blanked.project, {
      animationId: created.animationId,
      frameOrdinal: 2,
    });
    expect(definitionOf(appended.project, created.animationId).frames).toHaveLength(3);
    expect(evaluateDefinition(appended.project, created.animationId, 2).layers![0]!.nodes)
      .toEqual([]);
    // Out-of-range ordinals are rejected with a clear message.
    expect(() => addNativeGraphicBlankKeyframe(appended.project, {
      animationId: created.animationId,
      frameOrdinal: 4,
    })).toThrow(/超出范围/);
  });

  it('copies a frame with fresh, independently editable node identities', () => {
    const created = buildNativeFixture();
    const sourceIds = definitionOf(created.project, created.animationId)
      .structure!.frames[0]!.layers[0]!.nodes.map((node) => node.id);
    const copied = copyNativeGraphicFrame(created.project, {
      animationId: created.animationId,
      sourceFrameOrdinal: 0,
      createId: deterministicIds(),
    });
    expect(copied.frameOrdinal).toBe(1);
    const definition = definitionOf(copied.project, created.animationId);
    const copyNodes = definition.structure!.frames[1]!.layers[0]!.nodes;
    expect(copyNodes).toHaveLength(sourceIds.length);
    expect(copyNodes.map((node) => node.id)).not.toEqual(sourceIds);
    for (const node of copyNodes) {
      expect(node.authored).toBe('native');
    }
    // The copy renders identically at its ordinal.
    const sourceVisual = evaluateDefinition(copied.project, created.animationId, 0);
    const copyVisual = evaluateDefinition(copied.project, created.animationId, 1);
    expect(copyVisual.layers!.map((layer) => layer.nodes.map((node) => node.worldTransform)))
      .toEqual(sourceVisual.layers!.map((layer) => layer.nodes.map((node) => node.worldTransform)));
    expect(copyVisual.layers!.map((layer) => layer.nodes.map(
      (node) => node.vectorVisual?.regions[0]?.regionRef,
    ))).toEqual(sourceVisual.layers!.map((layer) => layer.nodes.map(
      (node) => node.vectorVisual?.regions[0]?.regionRef,
    )));
    expect(copyVisual.structureFrame!.ordinal).toBe(1);
    // Copied nodes keep a proven author identity, so they can be keyframed.
    const copyNodeId = copyNodes[0]!.id;
    const target = resolveFlaGraphicTimelineTarget(
      definition.structure!,
      1,
      [copyNodeId],
    );
    expect(target?.identitySource).toBe('node');
    expect(target?.authoringCapability).toBe('editable');
    // Editing the copied node only affects its own frame.
    const service = new LayerService();
    const edited = service.updateFlaGraphicSharedDefinitionTransform(
      copied.project,
      created.shotId,
      created.layerAId,
      1,
      [copyNodeId],
      { a: 1, b: 0, c: 0, d: 1, tx: 333, ty: 77 },
    );
    const editedDefinition = definitionOf(edited, created.animationId);
    expect(editedDefinition.structure!.frames[1]!.layers[0]!.nodes[0]!.localTransform)
      .toMatchObject({ tx: 333, ty: 77 });
    expect(editedDefinition.structure!.frames[0]!.layers[0]!.nodes.map((node) => node.id))
      .toEqual(sourceIds);
    expect(evaluateDefinition(edited, created.animationId, 0).layers)
      .toEqual(sourceVisual.layers);
  });

  it('extends and shortens exposure over the authored range with random seek', () => {
    const created = buildNativeFixture();
    const copied = copyNativeGraphicFrame(created.project, {
      animationId: created.animationId,
      sourceFrameOrdinal: 0,
      createId: deterministicIds(),
    });
    const frameOneNodes = definitionOf(copied.project, created.animationId)
      .structure!.frames[1]!.layers[0]!.nodes.map((node) => node.id);
    const extended = extendNativeGraphicExposure(copied.project, {
      animationId: created.animationId,
      count: 2,
    });
    expect(extended.addedFrames).toBe(2);
    expect(extended.authoredOrdinal).toBe(1);
    const definition = definitionOf(extended.project, created.animationId);
    expect(definition.frames).toHaveLength(4);
    expect(definition.frames.map((frame) => frame.ordinal)).toEqual([0, 1, 2, 3]);
    expect(definition.structure!.frames.slice(2).map((frame) => frame.holdFromOrdinal))
      .toEqual([1, 1]);
    expect(definition.structure!.frames.slice(2).every((frame) => frame.layers.length === 0))
      .toBe(true);
    expect(listNativeGraphicExposureFrames(definition).map((frame) => [
      frame.held,
      frame.authoredOrdinal,
    ])).toEqual([[false, 0], [false, 1], [true, 1], [true, 1]]);

    // Held cells display exactly the authored frame-1 content.
    const frameOneVisual = evaluateDefinition(extended.project, created.animationId, 1);
    for (const ordinal of [2, 3]) {
      const visual = evaluateDefinition(extended.project, created.animationId, ordinal);
      expect(visual.layers).toEqual(frameOneVisual.layers);
      expect(layerNodeIds(visual)).toEqual([frameOneNodes]);
    }

    // Random seek: the shot clock maps each time to the same played exposure cell.
    const shot = extended.project.shots[0]!;
    for (const [timeMs, expectedOrdinal] of [[0, 0], [50, 1], [100, 2], [150, 3]] as const) {
      const evaluated = evaluateShotAtTime(shot, timeMs, extended.project);
      const layer = evaluated.layers.find((candidate) => candidate.id === created.layerAId)!;
      expect(layer.animationFrame?.frameOrdinal).toBe(expectedOrdinal);
    }

    // Other authored frames are untouched by extension.
    const frameZeroVisual = evaluateDefinition(extended.project, created.animationId, 0);
    const sourceVisual = evaluateDefinition(copied.project, created.animationId, 0);
    expect(frameZeroVisual.layers).toEqual(sourceVisual.layers);

    // Instance overrides stay per-instance and follow the authored keyframe the
    // held cells expose (evaluated at the authored ordinal, not the cell).
    const service = new LayerService();
    const overrideTarget = frameOneNodes[0]!;
    const overrideMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 777, ty: 31 };
    const withInstanceOverride = service.updateFlaGraphicInstanceTransform(
      extended.project,
      created.shotId,
      created.layerBId,
      1,
      [overrideTarget],
      overrideMatrix,
    );
    const evaluatedHeldA = evaluateDefinition(withInstanceOverride, created.animationId, 2, {
      mode: 'instance',
      layerId: created.layerAId,
    });
    const evaluatedHeldB = evaluateDefinition(withInstanceOverride, created.animationId, 2, {
      mode: 'instance',
      layerId: created.layerBId,
    });
    const overrideLocal = (visual: EvaluatedFlaGraphicVisual): unknown =>
      flattenEvaluatedNodes(visual.layers!.flatMap((layer) => [...layer.nodes]))
        .find((leaf) => leaf.path === JSON.stringify([overrideTarget]))?.localTransform;
    expect(overrideLocal(evaluatedHeldA)).not.toMatchObject({ tx: 777 });
    expect(overrideLocal(evaluatedHeldB)).toMatchObject({ tx: 777, ty: 31 });
    // The authored Definition itself was never rewritten by the instance edit.
    expect(definitionOf(withInstanceOverride, created.animationId)
      .structure!.frames[1]!.layers[0]!.nodes[0]!.localTransform)
      .toEqual(frameOneVisual.layers![0]!.nodes[0]!.source.localTransform);

    // Shortening only removes trailing held cells, never authored content.
    const shortenedOnce = shortenNativeGraphicExposure(extended.project, {
      animationId: created.animationId,
      count: 1,
    });
    expect(shortenedOnce.removedFrames).toBe(1);
    expect(definitionOf(shortenedOnce.project, created.animationId).frames).toHaveLength(3);
    const shortenedAll = shortenNativeGraphicExposure(shortenedOnce.project, {
      animationId: created.animationId,
      count: 10,
    });
    expect(shortenedAll.removedFrames).toBe(1);
    expect(definitionOf(shortenedAll.project, created.animationId).frames).toHaveLength(2);
    expect(() => shortenNativeGraphicExposure(shortenedAll.project, {
      animationId: created.animationId,
      count: 1,
    })).toThrow(/没有可缩短的曝光/);
    expect(evaluateDefinition(shortenedAll.project, created.animationId, 1).layers)
      .toEqual(frameOneVisual.layers);
  });

  it('adds, removes and reorders layers so draw order follows for every shared instance', () => {
    const fixture = buildTwoLayerNativeFixture();
    const layerNames = (project: Project): string[] =>
      evaluateDefinition(project, fixture.animationId, 0).layers!.map((layer) => layer.name);
    expect(layerNames(fixture.project)).toEqual(['底层', '顶层']);
    // Swapping layer array order is the authored back-to-front draw order.
    const reordered = moveNativeGraphicLayer(fixture.project, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      layerIndex: 1,
      direction: -1,
    });
    expect(layerNames(reordered)).toEqual(['顶层', '底层']);
    for (const layerId of [fixture.layerAId, fixture.layerBId]) {
      const visual = evaluateDefinition(reordered, fixture.animationId, 0, {
        mode: 'instance',
        layerId,
      });
      expect(visual.layers!.map((layer) => layer.name)).toEqual(['顶层', '底层']);
    }

    const added = addNativeGraphicLayer(reordered, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      name: '新增层',
    });
    expect(layerNames(added)).toEqual(['顶层', '底层', '新增层']);
    const removed = removeNativeGraphicLayer(added, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      layerIndex: 2,
    });
    expect(layerNames(removed)).toEqual(['顶层', '底层']);
    // Removing the bottom layer also prunes its node's shared shape override.
    const removedBottom = removeNativeGraphicLayer(removed, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      layerIndex: 1,
    });
    const removedDefinition = definitionOf(removedBottom, fixture.animationId);
    expect(removedDefinition.structure!.frames[0]!.layers).toHaveLength(1);
    expect(removedDefinition.flaGraphicSharedShapeOverrides?.['0']?.[
      JSON.stringify(['layer-a-node'])
    ]).toBeUndefined();
    for (const layerId of [fixture.layerAId, fixture.layerBId]) {
      const visual = evaluateDefinition(removedBottom, fixture.animationId, 0, {
        mode: 'instance',
        layerId,
      });
      expect(layerNodeIds(visual)).toEqual([['layer-b-node']]);
    }
    expect(() => removeNativeGraphicLayer(removedBottom, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      layerIndex: 0,
    })).toThrow(/至少需要保留一个图层/);
  });

  it('groups and ungroups nodes while preserving world transforms and overrides', () => {
    const created = buildNativeFixture();
    const before = evaluateDefinition(created.project, created.animationId, 0);
    const beforeLeaves = flattenEvaluatedNodes(before.layers!.flatMap((layer) => [...layer.nodes]));
    const grouped = groupNativeGraphicNodes(created.project, {
      animationId: created.animationId,
      frameOrdinal: 0,
      nodePaths: [[created.firstNodeId], [created.secondNodeId]],
      createId: deterministicIds(),
    });
    const groupId = grouped.groupPath[0]!;
    const groupedDefinition = definitionOf(grouped.project, created.animationId);
    const groupedLayerNodes = groupedDefinition.structure!.frames[0]!.layers[0]!.nodes;
    expect(groupedLayerNodes).toHaveLength(1);
    expect(groupedLayerNodes[0]).toMatchObject({ type: 'group', id: groupId });
    expect(groupedLayerNodes[0]!.type === 'group'
      ? groupedLayerNodes[0]!.children.map((child) => child.id)
      : []).toEqual([created.firstNodeId, created.secondNodeId]);
    // Shape overrides were remapped onto the group path.
    const groupedOverrides = groupedDefinition.flaGraphicSharedShapeOverrides!['0']!;
    expect(groupedOverrides[JSON.stringify([groupId, created.firstNodeId])]?.regions[0]!.regionRef)
      .toBe(CIRCLE_REGION.regionRef);
    expect(groupedOverrides[JSON.stringify([groupId, created.secondNodeId])]?.regions[0]!.regionRef)
      .toBe(RECT_REGION.regionRef);
    const groupedVisual = evaluateDefinition(grouped.project, created.animationId, 0);
    const groupedLeaves = flattenEvaluatedNodes(groupedVisual.layers!.flatMap((layer) => [...layer.nodes]))
      .filter((leaf) => leaf.path !== JSON.stringify([groupId]));
    const leavesById = (
      leaves: readonly { readonly path: string; readonly worldTransform: EvaluatedFlaGraphicNode['worldTransform'] }[],
    ): Map<string, EvaluatedFlaGraphicNode['worldTransform']> =>
      new Map(leaves.map((leaf) => [JSON.parse(leaf.path).at(-1) as string, leaf.worldTransform]));
    // Grouping is identity-composed, so every leaf keeps its world matrix.
    expect(leavesById(groupedLeaves)).toEqual(leavesById(beforeLeaves));
    for (const layerId of [created.layerAId, created.layerBId]) {
      const visual = evaluateDefinition(grouped.project, created.animationId, 0, {
        mode: 'instance',
        layerId,
      });
      expect(leavesById(flattenEvaluatedNodes(visual.layers!.flatMap((layer) => [...layer.nodes]))
        .filter((leaf) => leaf.path !== JSON.stringify([groupId])))).toEqual(leavesById(groupedLeaves));
    }

    const ungrouped = ungroupNativeGraphicNode(grouped.project, {
      animationId: created.animationId,
      frameOrdinal: 0,
      nodePath: grouped.groupPath,
    });
    expect(ungrouped.nodePaths.map((path) => path[0])).toEqual([
      created.firstNodeId,
      created.secondNodeId,
    ]);
    const ungroupedVisual = evaluateDefinition(ungrouped.project, created.animationId, 0);
    expect(ungroupedVisual.layers).toEqual(before.layers);
    // Group/ungroup errors stay actionable.
    expect(() => ungroupNativeGraphicNode(ungrouped.project, {
      animationId: created.animationId,
      frameOrdinal: 0,
      nodePath: [created.firstNodeId],
    })).toThrow(/不是分组/);
    expect(() => groupNativeGraphicNodes(ungrouped.project, {
      animationId: created.animationId,
      frameOrdinal: 0,
      nodePaths: [],
      createId: deterministicIds(),
    })).toThrow(/至少一个节点/);
  });

  it('refuses every exposure operation on source-backed Definitions and evaluates byte-identically', () => {
    const multi = buildSourceGraphicMultiFrameFixture();
    const singleFixture = buildSourceGraphicFixture();
    const single = singleFixture.project.animations.find(
      (candidate) => candidate.id === SOURCE_GRAPHIC_ID,
    ) as FlaGraphicDefinition;
    const evaluate = (
      project: Project,
      definition: FlaGraphicDefinition,
      frameOrdinal: number,
      internalTimeMs: number,
      mode: 'definition' | 'instance',
    ) => JSON.parse(JSON.stringify(evaluateFlaGraphicVisual({
      definition: definitionOf(project, definition.id),
      frameOrdinal,
      internalTimeMs,
      mode,
    })));

    // Frozen pre-#1453 evaluation payloads for source-backed Definitions.
    expect(evaluate(singleFixture.project, single, 0, 0, 'definition'))
      .toEqual(sourceEvalBaseline['single-definition-0-0']);
    const multiBefore = evaluate(multi.project, multi.definition, 0, 0, 'definition');
    expect(multiBefore).toEqual(sourceEvalBaseline['multi-definition-0-0']);
    expect(evaluate(multi.project, multi.definition, 1, 0, 'definition'))
      .toEqual(sourceEvalBaseline['multi-definition-1-0']);
    expect(evaluate(multi.project, multi.definition, 1, 250, 'instance'))
      .toEqual(sourceEvalBaseline['multi-instance-1-250']);

    const definitionJsonBefore = JSON.stringify(multi.project);
    const animationId = multi.definition.id;
    const firstNodePath = ['shape-circle'];
    const refusals: (() => void)[] = [
      () => addNativeGraphicBlankKeyframe(multi.project, { animationId, frameOrdinal: 0 }),
      () => copyNativeGraphicFrame(multi.project, {
        animationId,
        sourceFrameOrdinal: 0,
        createId: deterministicIds(),
      }),
      () => extendNativeGraphicExposure(multi.project, { animationId, count: 1 }),
      () => shortenNativeGraphicExposure(multi.project, { animationId, count: 1 }),
      () => addNativeGraphicLayer(multi.project, { animationId, frameOrdinal: 0 }),
      () => removeNativeGraphicLayer(multi.project, {
        animationId,
        frameOrdinal: 0,
        layerIndex: 0,
      }),
      () => moveNativeGraphicLayer(multi.project, {
        animationId,
        frameOrdinal: 0,
        layerIndex: 0,
        direction: 1,
      }),
      () => groupNativeGraphicNodes(multi.project, {
        animationId,
        frameOrdinal: 0,
        nodePaths: [firstNodePath],
        createId: deterministicIds(),
      }),
      () => ungroupNativeGraphicNode(multi.project, {
        animationId,
        frameOrdinal: 0,
        nodePath: firstNodePath,
      }),
    ];
    for (const refusal of refusals) expectRefusal(refusal);
    // Refusals must not rewrite the imported Definition or its frames.
    expect(JSON.stringify(multi.project)).toBe(definitionJsonBefore);
    expect(evaluate(multi.project, multi.definition, 0, 0, 'definition')).toEqual(multiBefore);
    // Source-backed structures never gain hold markers.
    expect(multi.definition.structure!.frames.every((frame) => frame.holdFromOrdinal === undefined))
      .toBe(true);
  });

  it('commits one undo step per operation and survives save/reopen', () => {
    const fixture = buildNativeFixture();
    const store = new EditorProjectStore();
    store.open('C:\\dummy\\native-graphic-exposure', fixture.project);
    const layerStore = new LayerStore(
      store,
      { getCurrentShotId: () => fixture.shotId },
      new LayerService(),
      { select: () => undefined },
    );
    const project = (): Project => store.getSnapshot()!.project;
    const expectOneUndo = (operation: () => void): void => {
      const before = JSON.stringify(project());
      operation();
      expect(JSON.stringify(project())).not.toBe(before);
      expect(store.undo()).toBe(true);
      expect(JSON.stringify(project())).toBe(before);
    };

    const animationId = fixture.animationId;
    expectOneUndo(() => layerStore.addNativeGraphicBlankKeyframe(animationId, 0));
    expectOneUndo(() => layerStore.copyNativeGraphicFrame(animationId, 0));

    layerStore.copyNativeGraphicFrame(animationId, 0);
    expectOneUndo(() => layerStore.extendNativeGraphicExposure(animationId, 1));
    layerStore.extendNativeGraphicExposure(animationId, 1);
    expectOneUndo(() => layerStore.shortenNativeGraphicExposure(animationId, 1));
    expectOneUndo(() => layerStore.addNativeGraphicLayer(animationId, 0, '撤销层'));
    layerStore.addNativeGraphicLayer(animationId, 0, '排序层');
    expectOneUndo(() => layerStore.moveNativeGraphicLayer(animationId, 0, 1, -1));

    const live = definitionOf(project(), animationId);
    const nodeIds = live.structure!.frames[0]!.layers[0]!.nodes.map((node) => node.id);
    expectOneUndo(() => layerStore.groupNativeGraphicNodes({
      animationId,
      frameOrdinal: 0,
      nodePaths: nodeIds.map((id) => [id]),
    }));

    // Save / reopen through the formal schema and a JSON round-trip.
    const roundTripped = ProjectSchema.parse(JSON.parse(JSON.stringify(project())));
    const liveDefinition = definitionOf(project(), animationId);
    const reopenedDefinition = definitionOf(roundTripped, animationId);
    const frameCount = liveDefinition.frames.length;
    for (let ordinal = 0; ordinal < frameCount; ordinal += 1) {
      const before = evaluateFlaGraphicVisual({
        definition: liveDefinition,
        frameOrdinal: ordinal,
        mode: 'definition',
        internalTimeMs: 120,
      });
      const after = evaluateFlaGraphicVisual({
        definition: reopenedDefinition,
        frameOrdinal: ordinal,
        mode: 'definition',
        internalTimeMs: 120,
      });
      expect(after).toEqual(before);
    }
  });

  it('keeps tweens on kept nodes and leaves removed-node tracks inert', () => {
    const created = buildNativeFixture();
    const service = new LayerService();
    // Author a transform track on the first node of frame 0.
    let project = service.addFlaGraphicTimelineKeyframe(
      created.project,
      created.shotId,
      created.layerAId,
      0,
      [created.firstNodeId],
      0,
      'linear',
    );
    project = service.updateFlaGraphicTimelineKeyframeTransform(
      project,
      created.shotId,
      created.layerAId,
      0,
      [created.firstNodeId],
      0,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 20 },
    );
    project = service.addFlaGraphicTimelineKeyframe(
      project,
      created.shotId,
      created.layerAId,
      0,
      [created.firstNodeId],
      500,
      'linear',
    );
    project = service.updateFlaGraphicTimelineKeyframeTransform(
      project,
      created.shotId,
      created.layerAId,
      0,
      [created.firstNodeId],
      500,
      { a: 1, b: 0, c: 0, d: 1, tx: 200, ty: 20 },
    );
    const tweened = evaluateDefinition(project, created.animationId, 0, {
      mode: 'instance',
      layerId: created.layerAId,
      internalTimeMs: 250,
    });
    const tweenedNode = flattenEvaluatedNodes(tweened.layers!.flatMap((layer) => [...layer.nodes]))
      .find((node) => node.path === JSON.stringify([created.firstNodeId]));
    expect(tweenedNode).toBeDefined();

    // Copying a frame keeps the authored track applied to the kept source node.
    const copied = copyNativeGraphicFrame(project, {
      animationId: created.animationId,
      sourceFrameOrdinal: 0,
      createId: deterministicIds(),
    });
    const copiedTween = evaluateDefinition(copied.project, created.animationId, 0, {
      mode: 'instance',
      layerId: created.layerAId,
      internalTimeMs: 250,
    });
    expect(copiedTween.layers).toEqual(tweened.layers);
    const definitionAfterCopy = definitionOf(copied.project, created.animationId);
    expect(definitionAfterCopy.structure!.timeline?.tracks.length).toBeGreaterThan(0);

    // Removing the tracked node leaves its stale track inert instead of breaking
    // evaluation; the surviving node's track data stays intact.
    const removed = removeNativeGraphicNode(copied.project, {
      animationId: created.animationId,
      frameOrdinal: 0,
      nodePath: [created.firstNodeId],
    });
    const removedDefinition = definitionOf(removed, created.animationId);
    expect(removedDefinition.structure!.timeline?.tracks.some(
      (track) => track.trackId === `node:${created.firstNodeId}`,
    )).toBe(true);
    expect(() => evaluateDefinition(removed, created.animationId, 0)).not.toThrow();
    expect(evaluateDefinition(removed, created.animationId, 0).layers![0]!.nodes.length)
      .toBe(1);
    // Blanking a frame removes its nodes, so any old track is simply never visited.
    const blanked = addNativeGraphicBlankKeyframe(removed, {
      animationId: created.animationId,
      frameOrdinal: 0,
    });
    expect(definitionOf(blanked.project, created.animationId).structure!.frames[0]!.layers
      .every((layer) => layer.nodes.length === 0)).toBe(true);
    expect(evaluateDefinition(blanked.project, created.animationId, 0).layers![0]!.nodes)
      .toEqual([]);
    expect(() => evaluateDefinition(blanked.project, created.animationId, 1)).not.toThrow();
  });

  it('exposes the authored, held and blank cells for the editor UI', () => {
    const created = buildNativeFixture();
    const copied = copyNativeGraphicFrame(created.project, {
      animationId: created.animationId,
      sourceFrameOrdinal: 0,
      createId: deterministicIds(),
    });
    const extended = extendNativeGraphicExposure(copied.project, {
      animationId: created.animationId,
      count: 2,
    });
    const blanked = addNativeGraphicBlankKeyframe(extended.project, {
      animationId: created.animationId,
      frameOrdinal: 1,
    });
    const definition = definitionOf(blanked.project, created.animationId);
    expect(listNativeGraphicExposureFrames(definition)).toEqual([
      { ordinal: 0, authoredOrdinal: 0, held: false, blank: false, layerCount: 1 },
      { ordinal: 1, authoredOrdinal: 1, held: false, blank: true, layerCount: 1 },
      { ordinal: 2, authoredOrdinal: 1, held: true, blank: true, layerCount: 1 },
      { ordinal: 3, authoredOrdinal: 1, held: true, blank: true, layerCount: 1 },
    ]);
  });
});

// Keep the structure schema import exercised so malformed hold markers stay rejected.
describe('issue #1453 exposure schema guards', () => {
  it('rejects hold markers that point forward, chain, or carry layer content', () => {
    const fixture = buildNativeFixture();
    const base = definitionOf(fixture.project, fixture.animationId);
    const structure = JSON.parse(JSON.stringify(base.structure)) as FlaGraphicStructure;
    expect(() => FlaGraphicStructureSchema.parse({
      ...structure,
      frames: [
        { ordinal: 0, layers: [] , holdFromOrdinal: 0 },
      ],
    })).toThrow();
    expect(() => FlaGraphicStructureSchema.parse({
      ...structure,
      frames: [
        { ordinal: 0, layers: [] },
        { ordinal: 1, layers: [], holdFromOrdinal: 0 },
        { ordinal: 2, layers: [], holdFromOrdinal: 1 },
      ],
    })).toThrow(/authored frame, not another hold/);
    expect(() => FlaGraphicStructureSchema.parse({
      ...structure,
      frames: [
        { ordinal: 0, layers: [] },
        { ordinal: 1, layers: [{ name: '带内容', nodes: [] }], holdFromOrdinal: 0 },
      ],
    })).toThrow(/must not carry/);
  });
});
