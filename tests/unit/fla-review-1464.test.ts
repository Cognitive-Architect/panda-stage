import { describe, expect, it } from 'vitest';
import {
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  addNativeGraphicNode,
  copyNativeGraphicFrame,
  createNativeGraphicDefinitionFromNodes,
  evaluateFlaGraphicVisual,
  extendNativeGraphicExposure,
  groupNativeGraphicNodes,
  isFlaGraphicDefinition,
  replaceNativeGraphicNode,
  ungroupNativeGraphicNode,
  type EvaluatedFlaGraphicNode,
  type EvaluatedFlaGraphicVisual,
  type FlaEditableShapeRegion,
  type FlaGraphicDefinition,
  type FlaGraphicStructureNode,
  type Project,
} from '../../src/domain';
import {
  CIRCLE_REGION,
  editableRegion,
  placeGraphicLayer,
  RECT_REGION,
  SOURCE_CIRCLE_PATH,
  SOURCE_GRAPHIC_ID,
  SOURCE_RECT_PATH,
  buildSourceGraphicFixture,
} from '../helpers/nativeGraphicProject';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { IDS } from './domain/testProject';

const FPS = 24;
const FRAME_MS = 1_000 / FPS;
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as const;

let idCounter = 0;
function deterministicIds(): () => string {
  return () => {
    idCounter += 1;
    return `a1000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
  };
}

function definitionOf(project: Project, animationId: string): FlaGraphicDefinition {
  const definition = project.animations.find((candidate) => candidate.id === animationId);
  if (!definition || !isFlaGraphicDefinition(definition)) {
    throw new Error(`missing definition ${animationId}`);
  }
  return definition;
}

function evaluatedNodeAtPath(
  visual: EvaluatedFlaGraphicVisual | null,
  path: readonly string[],
): EvaluatedFlaGraphicNode | null {
  if (!visual?.layers) return null;
  const visit = (nodes: readonly EvaluatedFlaGraphicNode[]): EvaluatedFlaGraphicNode | null => {
    for (const node of nodes) {
      if (node.path.length === path.length && node.path.every((part, index) => part === path[index])) {
        return node;
      }
      const nested = visit(node.children);
      if (nested) return nested;
    }
    return null;
  };
  return visit(visual.layers.flatMap((layer) => layer.nodes));
}

function instanceVisual(
  project: Project,
  animationId: string,
  frameOrdinal: number,
  layerId: string,
  internalTimeMs = 0,
): EvaluatedFlaGraphicVisual {
  const definition = definitionOf(project, animationId);
  const layer = project.shots
    .flatMap((shot) => shot.layers)
    .find((candidate) => candidate.id === layerId);
  if (!layer || layer.source.kind !== 'animation') {
    throw new Error(`missing animation layer ${layerId}`);
  }
  const visual = evaluateFlaGraphicVisual({
    definition,
    frameOrdinal,
    mode: 'instance',
    internalTimeMs,
    instanceTransformOverrides: layer.flaGraphicInstanceTransformOverrides,
    instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
  });
  if (!visual) throw new Error(`frame ${frameOrdinal} did not evaluate`);
  return visual;
}

function worldTransformAt(
  project: Project,
  animationId: string,
  frameOrdinal: number,
  layerId: string,
  path: readonly string[],
): EvaluatedFlaGraphicNode['worldTransform'] | null {
  return evaluatedNodeAtPath(instanceVisual(project, animationId, frameOrdinal, layerId), path)
    ?.worldTransform ?? null;
}

function expectMatrixCloseTo(
  actual: EvaluatedFlaGraphicNode['worldTransform'] | null,
  expected: EvaluatedFlaGraphicNode['worldTransform'] | null,
): void {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
    expect(actual![key]).toBeCloseTo(expected![key], 6);
  }
}

/* ------------------------------------------------------------------------- *
 * R5 fixtures: two authored frames via the existing copy-frame service.
 * ------------------------------------------------------------------------- */

function buildTwoFrameNativeFixture(): {
  readonly project: Project;
  readonly shotId: string;
  readonly animationId: string;
  readonly layerAId: string;
  readonly layerBId: string;
  readonly frame0NodeIds: string[];
  readonly frame1NodeIds: string[];
} {
  const fixture = buildSourceGraphicFixture();
  const placed = placeGraphicLayer(fixture.project, fixture.shotId, SOURCE_GRAPHIC_ID);
  const created = createNativeGraphicDefinitionFromNodes(placed.project, {
    shotId: fixture.shotId,
    layerId: placed.layerId,
    frameOrdinal: 0,
    nodePaths: [SOURCE_CIRCLE_PATH, SOURCE_RECT_PATH],
    createId: deterministicIds(),
  });
  const placedA = placeGraphicLayer(created.project, fixture.shotId, created.animationId, { x: 400, y: 300 });
  const placedB = placeGraphicLayer(placedA.project, fixture.shotId, created.animationId, { x: 800, y: 300 });
  const copied = copyNativeGraphicFrame(placedB.project, {
    animationId: created.animationId,
    sourceFrameOrdinal: 0,
    createId: deterministicIds(),
  });
  const definition = definitionOf(copied.project, created.animationId);
  return {
    project: copied.project,
    shotId: fixture.shotId,
    animationId: created.animationId,
    layerAId: placedA.layerId,
    layerBId: placedB.layerId,
    frame0NodeIds: definition.structure!.frames[0]!.layers[0]!.nodes.map((node) => node.id),
    frame1NodeIds: definition.structure!.frames[1]!.layers[0]!.nodes.map((node) => node.id),
  };
}

function evaluateDefinitionFrame(
  project: Project,
  animationId: string,
  frameOrdinal: number,
): EvaluatedFlaGraphicVisual {
  const visual = evaluateFlaGraphicVisual({
    definition: definitionOf(project, animationId),
    frameOrdinal,
    mode: 'definition',
  });
  if (!visual) throw new Error(`frame ${frameOrdinal} did not evaluate`);
  return visual;
}

describe('#1464 R5 — non-zero frame vector node writes (#1452 x #1453)', () => {
  it('adds a node on authored frame 1 with its complete path and draws it there only', () => {
    const fixture = buildTwoFrameNativeFixture();
    const frame0Before = evaluateDefinitionFrame(fixture.project, fixture.animationId, 0);
    const added = addNativeGraphicNode(fixture.project, {
      animationId: fixture.animationId,
      frameOrdinal: 1,
      source: {
        animationId: fixture.animationId,
        frameOrdinal: 0,
        nodePath: [fixture.frame0NodeIds[0]!],
      },
      createId: deterministicIds(),
    });
    const addedPath = added.nodePath;
    const definition = definitionOf(added.project, fixture.animationId);

    // The structure change and the shape override land on the authored target frame.
    expect(definition.structure!.frames[0]!.layers[0]!.nodes.map((node) => node.id))
      .toEqual(fixture.frame0NodeIds);
    expect(definition.structure!.frames[1]!.layers[0]!.nodes.map((node) => node.id))
      .toHaveLength(3);
    expect(definition.flaGraphicSharedShapeOverrides?.['1']?.[JSON.stringify(addedPath)])
      .toBeDefined();
    // Frame 0 must not be polluted with an override for a node it does not own.
    expect(definition.flaGraphicSharedShapeOverrides?.['0']?.[JSON.stringify(addedPath)])
      .toBeUndefined();

    // The formal evaluator actually draws the new content on frame 1.
    const frame1Visual = evaluateDefinitionFrame(added.project, fixture.animationId, 1);
    expect(frame1Visual.layers![0]!.nodes).toHaveLength(3);
    const addedNode = evaluatedNodeAtPath(frame1Visual, addedPath);
    expect(addedNode).not.toBeNull();
    expect(addedNode!.renderable).toBe(true);
    expect(addedNode!.vectorVisual?.regions[0]?.regionRef).toBe(CIRCLE_REGION.regionRef);
    // Frame 0 evaluation is byte-identical to before the operation.
    expect(JSON.stringify(evaluateDefinitionFrame(added.project, fixture.animationId, 0).layers))
      .toBe(JSON.stringify(frame0Before.layers));

    // Both shared instances draw the new node on frame 1.
    for (const layerId of [fixture.layerAId, fixture.layerBId]) {
      expect(worldTransformAt(added.project, fixture.animationId, 1, layerId, addedPath))
        .not.toBeNull();
    }

    // Replacing on the same non-zero authored frame keys the new content on
    // frame 1 as well and never on frame 0.
    const replaced = replaceNativeGraphicNode(added.project, {
      animationId: fixture.animationId,
      frameOrdinal: 1,
      nodePath: addedPath,
      source: {
        animationId: fixture.animationId,
        frameOrdinal: 0,
        nodePath: [fixture.frame0NodeIds[1]!],
      },
    });
    const replacedDefinition = definitionOf(replaced, fixture.animationId);
    expect(replacedDefinition.flaGraphicSharedShapeOverrides?.['1']?.[JSON.stringify(addedPath)]
      ?.regions[0]?.regionRef).toBe(RECT_REGION.regionRef);
    expect(replacedDefinition.flaGraphicSharedShapeOverrides?.['0']?.[JSON.stringify(addedPath)])
      .toBeUndefined();
    const replacedNode = evaluatedNodeAtPath(
      evaluateDefinitionFrame(replaced, fixture.animationId, 1),
      addedPath,
    );
    expect(replacedNode!.renderable).toBe(true);
    expect(replacedNode!.vectorVisual?.regions[0]?.regionRef).toBe(RECT_REGION.regionRef);
  });

  it('resolves a held exposure cell to its authored frame when adding a node', () => {
    const fixture = buildTwoFrameNativeFixture();
    // Cells 2 and 3 are held exposure cells exposing authored frame 1.
    const extended = extendNativeGraphicExposure(fixture.project, {
      animationId: fixture.animationId,
      count: 2,
    });
    const added = addNativeGraphicNode(extended.project, {
      animationId: fixture.animationId,
      frameOrdinal: 3,
      source: {
        animationId: fixture.animationId,
        frameOrdinal: 0,
        nodePath: [fixture.frame0NodeIds[0]!],
      },
      createId: deterministicIds(),
    });
    const addedPath = added.nodePath;
    const definition = definitionOf(added.project, fixture.animationId);
    expect(definition.flaGraphicSharedShapeOverrides?.['1']?.[JSON.stringify(addedPath)])
      .toBeDefined();
    expect(definition.flaGraphicSharedShapeOverrides?.['3']).toBeUndefined();

    for (const heldOrdinal of [2, 3]) {
      const visual = evaluateDefinitionFrame(added.project, fixture.animationId, heldOrdinal);
      const addedNode = evaluatedNodeAtPath(visual, addedPath);
      expect(addedNode, `held cell ${heldOrdinal}`).not.toBeNull();
      expect(addedNode!.renderable).toBe(true);
      expect(addedNode!.vectorVisual?.regions[0]?.regionRef).toBe(CIRCLE_REGION.regionRef);
    }
    // Frame 0 stays untouched, so existing content never moves into frame 0.
    expect(evaluateDefinitionFrame(added.project, fixture.animationId, 0).layers![0]!.nodes)
      .toHaveLength(2);
  });

  it('replaces a nested node with its complete group path and keeps the other frames intact', () => {
    const fixture = buildTwoFrameNativeFixture();
    const grouped = groupNativeGraphicNodes(fixture.project, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      nodePaths: fixture.frame0NodeIds.map((nodeId) => [nodeId]),
      createId: deterministicIds(),
    });
    const groupId = grouped.groupPath[0]!;
    const nestedPath = [groupId, fixture.frame0NodeIds[0]!];
    const frame1Before = evaluateDefinitionFrame(grouped.project, fixture.animationId, 1);

    const replaced = replaceNativeGraphicNode(grouped.project, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      nodePath: nestedPath,
      source: {
        animationId: fixture.animationId,
        frameOrdinal: 1,
        nodePath: [fixture.frame1NodeIds[1]!],
      },
    });
    const definition = definitionOf(replaced, fixture.animationId);
    // The complete path (including the Group ancestor) owns the new override.
    expect(definition.flaGraphicSharedShapeOverrides?.['0']?.[JSON.stringify(nestedPath)])
      .toBeDefined();
    expect(definition.flaGraphicSharedShapeOverrides?.['0']?.[JSON.stringify([fixture.frame0NodeIds[0]!])])
      .toBeUndefined();
    expect(definition.flaGraphicSharedShapeOverrides?.['1'])
      .toEqual(definitionOf(grouped.project, fixture.animationId).flaGraphicSharedShapeOverrides?.['1']);

    // The replaced nested node is evaluated/drawn with the new rectangle content.
    const replacedVisual = evaluateDefinitionFrame(replaced, fixture.animationId, 0);
    const replacedNode = evaluatedNodeAtPath(replacedVisual, nestedPath);
    expect(replacedNode).not.toBeNull();
    expect(replacedNode!.renderable).toBe(true);
    expect(replacedNode!.vectorVisual?.regions[0]?.regionRef).toBe(RECT_REGION.regionRef);
    // Frame 1 is untouched by the frame-0 edit.
    expect(JSON.stringify(evaluateDefinitionFrame(replaced, fixture.animationId, 1).layers))
      .toBe(JSON.stringify(frame1Before.layers));
  });
});

/* ------------------------------------------------------------------------- *
 * R6 fixtures: authored native Group with a non-identity matrix plus shared
 * instance Layers whose overrides must compose the Group effective transform.
 * ------------------------------------------------------------------------- */

const R6_GRAPHIC_ID = 'a2000000-0000-4000-8000-000000000101';
const R6_GROUP_ID = 'r6-group';
const R6_CHILD_A = 'r6-child-a';
const R6_CHILD_B = 'r6-child-b';
const R6_GROUP_TRANSFORM = { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 40 } as const;
const R6_CHILD_A_TRANSFORM = { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 7 } as const;
const R6_CHILD_B_TRANSFORM = { a: 1, b: 0, c: 0, d: 1, tx: 60, ty: 10 } as const;

function r6ShapeNode(
  id: string,
  drawOrder: number,
  localTransform: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  width: number,
  height: number,
): FlaGraphicStructureNode {
  return {
    type: 'opaque',
    id,
    authored: 'native',
    drawOrder,
    localTransform: { ...localTransform },
    opaqueKind: 'shape',
    fallbackScope: 'subtree',
    fallbackViewBox: { x: 0, y: 0, width, height },
  };
}

function r6Region(regionRef: string, width: number, height: number): FlaEditableShapeRegion {
  return editableRegion(regionRef, 0, 0, width, height);
}

function buildGroupedNativeFixture(): {
  readonly project: Project;
  readonly shotId: string;
  readonly animationId: string;
  readonly layerAId: string;
  readonly layerBId: string;
  readonly layerCId: string;
} {
  const base = buildSourceGraphicFixture();
  const definition = FlaGraphicDefinitionSchema.parse({
    id: R6_GRAPHIC_ID,
    name: '分组元件',
    kind: 'fla-graphic',
    source: {
      origin: 'native',
      targetKind: 'graphic-symbol',
      targetName: '分组元件',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: FPS,
      canvas: { width: 200, height: 200 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 200, height: 200 },
    },
    durationMs: FRAME_MS,
    frames: [{
      ordinal: 0,
      sourceFrameIndex: 0,
      sourceViewport: { x: 0, y: 0, width: 200, height: 200 },
      offset: { x: 0, y: 0 },
      startMs: 0,
      durationMs: FRAME_MS,
      createdBySequenceImport: false,
    }],
    structure: {
      version: 1,
      frames: [{
        ordinal: 0,
        layers: [{
          name: '图层',
          nodes: [{
            type: 'group',
            id: R6_GROUP_ID,
            authored: 'native',
            drawOrder: 0,
            localTransform: { ...R6_GROUP_TRANSFORM },
            groupId: '分组',
            children: [
              r6ShapeNode(R6_CHILD_A, 0, R6_CHILD_A_TRANSFORM, 40, 30),
              r6ShapeNode(R6_CHILD_B, 1, R6_CHILD_B_TRANSFORM, 50, 20),
            ],
          }],
        }],
      }],
    },
    flaGraphicSharedShapeOverrides: {
      '0': {
        [JSON.stringify([R6_GROUP_ID, R6_CHILD_A])]: {
          baseViewBox: { x: 0, y: 0, width: 40, height: 30 },
          regions: [r6Region('r6-region-a', 40, 30)],
          excludedRegionRefs: [],
          extractedRegions: [],
        },
        [JSON.stringify([R6_GROUP_ID, R6_CHILD_B])]: {
          baseViewBox: { x: 0, y: 0, width: 50, height: 20 },
          regions: [r6Region('r6-region-b', 50, 20)],
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
  const shotId = project.shots[0]!.id;
  const createdA = service.createFromAnimation(project, shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 400, y: 300 },
  });
  const createdB = service.createFromAnimation(createdA.project, shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 800, y: 300 },
  });
  const createdC = service.createFromAnimation(createdB.project, shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 1200, y: 300 },
  });
  return {
    project: createdC.project,
    shotId,
    animationId: definition.id,
    layerAId: createdA.layer.id,
    layerBId: createdB.layer.id,
    layerCId: createdC.layer.id,
  };
}

describe('#1464 R6 — ungroup keeps instance-independent transforms (#1452 x #1453)', () => {
  it('composes the group effective matrix into child instance overrides for every instance', () => {
    const fixture = buildGroupedNativeFixture();
    const service = new LayerService();
    // The documented example: the group's effective X is 100, the child instance
    // override X is 30, so the child must stay at 100 + 30 = 130 after ungroup.
    const groupOverride = { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 0 };
    const childOverride = { a: 1, b: 0, c: 0, d: 1, tx: 30, ty: 0 };

    // A: independent group override + independent child override.
    let project = service.updateFlaGraphicInstanceTransform(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [R6_GROUP_ID],
      groupOverride,
    );
    project = service.updateFlaGraphicInstanceTransform(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [R6_GROUP_ID, R6_CHILD_A],
      childOverride,
    );
    // C: only an independent child override (the authored group matrix still applies).
    project = service.updateFlaGraphicInstanceTransform(
      project,
      fixture.shotId,
      fixture.layerCId,
      0,
      [R6_GROUP_ID, R6_CHILD_A],
      childOverride,
    );

    const childAPath: readonly string[] = [R6_GROUP_ID, R6_CHILD_A];
    const childBPath: readonly string[] = [R6_GROUP_ID, R6_CHILD_B];
    const before = {
      aChildA: worldTransformAt(project, fixture.animationId, 0, fixture.layerAId, childAPath),
      aChildB: worldTransformAt(project, fixture.animationId, 0, fixture.layerAId, childBPath),
      bChildA: worldTransformAt(project, fixture.animationId, 0, fixture.layerBId, childAPath),
      bChildB: worldTransformAt(project, fixture.animationId, 0, fixture.layerBId, childBPath),
      cChildA: worldTransformAt(project, fixture.animationId, 0, fixture.layerCId, childAPath),
      cChildB: worldTransformAt(project, fixture.animationId, 0, fixture.layerCId, childBPath),
    };

    const ungrouped = ungroupNativeGraphicNode(project, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      nodePath: [R6_GROUP_ID],
    });
    expect(ungrouped.nodePaths.map((path) => path[0])).toEqual([R6_CHILD_A, R6_CHILD_B]);
    const flatChildA = [R6_CHILD_A];
    const flatChildB = [R6_CHILD_B];
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerAId, flatChildA),
      before.aChildA,
    );
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerAId, flatChildB),
      before.aChildB,
    );
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerBId, flatChildA),
      before.bChildA,
    );
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerBId, flatChildB),
      before.bChildB,
    );
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerCId, flatChildA),
      before.cChildA,
    );
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerCId, flatChildB),
      before.cChildB,
    );
    // Documented example: group effective X=100 + child instance override X=30
    // evaluates to X=130 for A before and after ungroup.
    const definition = definitionOf(project, fixture.animationId);
    const groupAuthoredX = (definition.structure!.frames[0]!.layers[0]!.nodes[0] as {
      localTransform: { tx: number };
    }).localTransform.tx;
    expect(groupAuthoredX).toBe(100);
    expect(before.aChildA!.tx).toBeCloseTo(100 + 30, 6);
    // C composes the authored non-identity group matrix (scale 2) into its
    // independent child override: 100 + 2 * 30 = 160.
    expect(before.cChildA!.tx).toBeCloseTo(100 + 2 * 30, 6);

    // Shared Definition geometry is the authored composition for every instance.
    const ungroupedDefinition = definitionOf(ungrouped.project, fixture.animationId);
    const flatNodes = ungroupedDefinition.structure!.frames[0]!.layers[0]!.nodes;
    expect(flatNodes).toHaveLength(2);
    expect(flatNodes[0]!.localTransform.tx).toBeCloseTo(R6_GROUP_TRANSFORM.a * R6_CHILD_A_TRANSFORM.tx + R6_GROUP_TRANSFORM.tx, 6);
    expect(flatNodes[1]!.localTransform.tx).toBeCloseTo(R6_GROUP_TRANSFORM.a * R6_CHILD_B_TRANSFORM.tx + R6_GROUP_TRANSFORM.tx, 6);
    expect(ungroupedDefinition.flaGraphicSharedShapeOverrides?.['0']?.[JSON.stringify([R6_CHILD_A])])
      .toBeDefined();
    expect(ungroupedDefinition.flaGraphicSharedShapeOverrides?.['0']?.[JSON.stringify([R6_GROUP_ID, R6_CHILD_A])])
      .toBeUndefined();
  });

  it('refuses to ungroup an animated group instead of silently dropping keyframes', () => {
    const fixture = buildGroupedNativeFixture();
    const service = new LayerService();
    const animated = service.addFlaGraphicTimelineKeyframe(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [R6_GROUP_ID],
      0,
    );
    expect(() => ungroupNativeGraphicNode(animated, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      nodePath: [R6_GROUP_ID],
    })).toThrow(/关键帧|动画|暂不支持解组/);

    // A directly animated child cannot be converted losslessly either.
    const childAnimated = service.addFlaGraphicTimelineKeyframe(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [R6_GROUP_ID, R6_CHILD_A],
      0,
    );
    expect(() => ungroupNativeGraphicNode(childAnimated, {
      animationId: fixture.animationId,
      frameOrdinal: 0,
      nodePath: [R6_GROUP_ID],
    })).toThrow(/关键帧|动画|暂不支持解组/);
  });
});

/* ------------------------------------------------------------------------- *
 * R7 fixtures: multi-frame native Definition whose non-native Shape node has
 * no proven identity, so it needs the author alias.
 * ------------------------------------------------------------------------- */

const R7_GRAPHIC_ID = 'a3000000-0000-4000-8000-000000000101';
const R7_SHAPE_PATH = ['r7-shape-0'] as const;
const R7_REGION = r6Region('r7-region', 40, 30);

function r7ShapeNode(id: string, drawOrder: number): FlaGraphicStructureNode {
  return {
    type: 'opaque',
    id,
    drawOrder,
    localTransform: { ...IDENTITY },
    opaqueKind: 'shape',
    fallbackScope: 'subtree',
    fallbackAssetId: IDS.assetChar,
    fallbackViewBox: { x: 0, y: 0, width: 40, height: 30 },
  };
}

/**
 * Two-frame Definition: the Shape node has no source-proven cross-frame
 * identity (two frames, no source address, not authored-native), so an author
 * alias is required before tracks/tweens can target it.
 */
function buildAliasableTweenFixture(): {
  readonly project: Project;
  readonly shotId: string;
  readonly animationId: string;
  readonly layerAId: string;
  readonly layerBId: string;
} {
  const base = buildSourceGraphicFixture();
  const definition = FlaGraphicDefinitionSchema.parse({
    id: R7_GRAPHIC_ID,
    name: '关联身份元件',
    kind: 'fla-graphic',
    source: {
      origin: 'native',
      targetKind: 'graphic-symbol',
      targetName: '关联身份元件',
      startFrameIndex: 0,
      endFrameIndex: 1,
      sourceFps: FPS,
      canvas: { width: 200, height: 200 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 200, height: 200 },
    },
    durationMs: FRAME_MS * 2,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        sourceViewport: { x: 0, y: 0, width: 200, height: 200 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: FRAME_MS,
        createdBySequenceImport: false,
      },
      {
        ordinal: 1,
        sourceFrameIndex: 1,
        sourceViewport: { x: 0, y: 0, width: 200, height: 200 },
        offset: { x: 0, y: 0 },
        startMs: FRAME_MS,
        durationMs: FRAME_MS,
        createdBySequenceImport: false,
      },
    ],
    structure: {
      version: 1,
      frames: [
        { ordinal: 0, layers: [{ name: '图层', nodes: [r7ShapeNode('r7-shape-0', 0)] }] },
        { ordinal: 1, layers: [{ name: '图层', nodes: [r7ShapeNode('r7-shape-1', 0)] }] },
      ],
    },
    flaGraphicSharedShapeOverrides: {
      '0': {
        [JSON.stringify(R7_SHAPE_PATH)]: {
          baseViewBox: { x: 0, y: 0, width: 40, height: 30 },
          regions: [R7_REGION],
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
  const shotId = project.shots[0]!.id;
  const createdA = service.createFromAnimation(project, shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 400, y: 300 },
  });
  const createdB = service.createFromAnimation(createdA.project, shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 800, y: 300 },
  });
  return {
    project: createdB.project,
    shotId,
    animationId: definition.id,
    layerAId: createdA.layer.id,
    layerBId: createdB.layer.id,
  };
}

function aliasIdFor(project: Project, animationId: string, nodeId: string): string {
  const aliasId = definitionOf(project, animationId).structure!.nodeIdentityAliases
    ?.['frame:0']?.[nodeId];
  if (!aliasId) throw new Error(`missing alias for ${nodeId}`);
  return aliasId;
}

function replaceLayer(
  project: Project,
  layerId: string,
  update: (layer: Project['shots'][number]['layers'][number]) => Project['shots'][number]['layers'][number],
): Project {
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) => ({
      ...shot,
      layers: shot.layers.map((layer) => (layer.id === layerId ? update(layer) : layer)),
    })),
  });
}

function withStaticGraphicAttachment(
  project: Project,
  childLayerId: string,
  ownerLayerId: string,
  identityPath: readonly string[],
): Project {
  return replaceLayer(project, childLayerId, (layer) => ({
    ...layer,
    parentLayerId: ownerLayerId,
    parentAttachment: {
      target: { kind: 'graphic-node', identityPath: [...identityPath] },
      ownerLocalFallback: { ...IDENTITY },
    },
  }));
}

function withDynamicGraphicAttachment(
  project: Project,
  childLayerId: string,
  ownerLayerId: string,
  identityPath: readonly string[],
): Project {
  return replaceLayer(project, childLayerId, (layer) => ({
    ...layer,
    parentLayerId: undefined,
    parentKeys: [{
      timeMs: 0,
      parentLayerId: ownerLayerId,
      parentAttachment: {
        target: { kind: 'graphic-node', identityPath: [...identityPath] },
        ownerLocalFallback: { ...IDENTITY },
      },
    }],
  }));
}

describe('#1464 R7 — cross-frame identity consumer protection (#1450 x #1457)', () => {
  it('blocks clearing an alias still targeted by a shape tween, then allows it after deletion', () => {
    const fixture = buildAliasableTweenFixture();
    const service = new LayerService();
    let project = service.setFlaGraphicNodeIdentityAlias(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [...R7_SHAPE_PATH],
    );
    const aliasId = aliasIdFor(project, fixture.animationId, R7_SHAPE_PATH[0]);

    project = service.createFlaGraphicShapeTween(project, {
      shotId: fixture.shotId,
      layerId: fixture.layerAId,
      frameOrdinal: 0,
      nodePath: [...R7_SHAPE_PATH],
      regionRef: R7_REGION.regionRef,
      mode: 'definition',
      startTimeMs: 0,
      durationMs: 1_000,
    });
    const tween = definitionOf(project, fixture.animationId).structure!.shapeTweenTracks?.[0];
    expect(tween?.target.nodeTrackId).toBe(`alias:${aliasId}`);

    // The shape tween resolves through the alias, so clearing it must be refused.
    expect(() => service.clearFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [...R7_SHAPE_PATH],
    )).toThrow(/形状补间/);
    // A refused operation is not a user action: no project change, no undo entry.
    const editor = new EditorProjectStore();
    editor.open('C:\\dummy\\issue-1464-r7', project);
    const store = new LayerStore(
      editor,
      { getCurrentShotId: () => fixture.shotId },
      service,
    );
    const undoBefore = editor.history.getSnapshot().undoCount;
    expect(() => store.clearFlaGraphicNodeIdentityAlias(
      fixture.layerAId,
      0,
      [...R7_SHAPE_PATH],
    )).toThrow(/形状补间/);
    expect(editor.history.getSnapshot().undoCount).toBe(undoBefore);
    expect(JSON.stringify(editor.getSnapshot()!.project)).toBe(JSON.stringify(project));

    // After the creator deletes the tween the node is unreferenced and clears.
    const deleted = service.deleteFlaGraphicShapeTween(project, {
      shotId: fixture.shotId,
      layerId: fixture.layerAId,
      tweenId: tween!.tweenId,
    });
    const cleared = service.clearFlaGraphicNodeIdentityAlias(
      deleted,
      fixture.shotId,
      fixture.layerAId,
      0,
      [...R7_SHAPE_PATH],
    );
    expect(definitionOf(cleared, fixture.animationId).structure!.nodeIdentityAliases)
      .toBeUndefined();
  });

  it('blocks clearing an alias still referenced by dynamic parentKeys attachments', () => {
    const fixture = buildAliasableTweenFixture();
    const service = new LayerService();
    let project = service.setFlaGraphicNodeIdentityAlias(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [...R7_SHAPE_PATH],
    );
    const aliasId = aliasIdFor(project, fixture.animationId, R7_SHAPE_PATH[0]);
    project = withDynamicGraphicAttachment(
      project,
      fixture.layerBId,
      fixture.layerAId,
      [`alias:${aliasId}`],
    );

    expect(() => service.clearFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [...R7_SHAPE_PATH],
    )).toThrow(/挂接/);

    // Once the dynamic attachment is retargeted away the alias can be cleared.
    const retargeted = replaceLayer(project, fixture.layerBId, (layer) => {
      const rest = { ...layer };
      delete rest.parentKeys;
      return { ...rest, parentLayerId: undefined };
    });
    const cleared = service.clearFlaGraphicNodeIdentityAlias(
      retargeted,
      fixture.shotId,
      fixture.layerAId,
      0,
      [...R7_SHAPE_PATH],
    );
    expect(definitionOf(cleared, fixture.animationId).structure!.nodeIdentityAliases)
      .toBeUndefined();
  });

  it('does not block on an unrelated definition reusing the same alias id', () => {
    const fixture = buildAliasableTweenFixture();
    const service = new LayerService();
    let project = service.setFlaGraphicNodeIdentityAlias(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [...R7_SHAPE_PATH],
    );
    const aliasId = aliasIdFor(project, fixture.animationId, R7_SHAPE_PATH[0]);

    // An unrelated Definition Y reuses the very same author alias id and owns a
    // shape tween plus a dynamic attachment that resolve through it.
    const definitionX = definitionOf(project, fixture.animationId);
    const definitionY = FlaGraphicDefinitionSchema.parse({
      ...JSON.parse(JSON.stringify(definitionX)),
      id: 'a3000000-0000-4000-8000-0000000001ff',
      name: '无关元件',
    });
    project = ProjectSchema.parse({
      ...project,
      animations: [...project.animations, definitionY],
    });
    const createdY = service.createFromAnimation(project, fixture.shotId, {
      animationId: definitionY.id,
      startTimeMs: 0,
      position: { x: 1_200, y: 300 },
    });
    const yLayerId = createdY.layer.id;
    project = service.createFlaGraphicShapeTween(createdY.project, {
      shotId: fixture.shotId,
      layerId: yLayerId,
      frameOrdinal: 0,
      nodePath: [...R7_SHAPE_PATH],
      regionRef: R7_REGION.regionRef,
      mode: 'definition',
      startTimeMs: 0,
      durationMs: 1_000,
    });
    // The unrelated Definition also owns a Graphic attachment whose identity
    // path reuses the same alias id.
    project = withStaticGraphicAttachment(
      project,
      fixture.layerBId,
      yLayerId,
      [`alias:${aliasId}`],
    );

    // X's alias is not referenced by any consumer of X and must stay removable.
    const cleared = service.clearFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [...R7_SHAPE_PATH],
    );
    expect(definitionOf(cleared, fixture.animationId).structure!.nodeIdentityAliases)
      .toBeUndefined();
    // Y's own alias still owns its real consumers and remains protected.
    expect(() => service.clearFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      yLayerId,
      0,
      [...R7_SHAPE_PATH],
    )).toThrow(/形状补间/);
    expect(definitionOf(project, definitionY.id).structure!.nodeIdentityAliases).toBeDefined();
  });
});

/* ------------------------------------------------------------------------- *
 * R9 fixtures: two-frame Definition with one cross-frame Shape identity whose
 * source-frame instance shape overrides participate in the tween evaluation.
 * ------------------------------------------------------------------------- */

const R9_GRAPHIC_ID = 'a4000000-0000-4000-8000-000000000101';
const R9_SOURCE_PATH = ['r9-mouth-0'] as const;
const R9_TARGET_PATH = ['r9-mouth-1'] as const;
const R9_SOURCE_ADDRESS = 'graphic:R9/mouth';
const R9_REGION = r6Region('r9-region', 60, 40);
const R9_EXTRA_REGION = r6Region('r9-extra', 12, 18);

function r9ShapeNode(id: string, drawOrder: number): FlaGraphicStructureNode {
  return {
    type: 'opaque',
    id,
    sourceAddress: R9_SOURCE_ADDRESS,
    drawOrder,
    localTransform: { ...IDENTITY },
    opaqueKind: 'shape',
    fallbackScope: 'subtree',
    fallbackAssetId: IDS.assetChar,
    fallbackViewBox: { x: 0, y: 0, width: 100, height: 80 },
  };
}

function buildTweenCacheFixture(): {
  readonly project: Project;
  readonly shotId: string;
  readonly animationId: string;
  readonly layerAId: string;
  readonly layerBId: string;
  readonly tweenId: string;
} {
  const base = buildSourceGraphicFixture();
  const definition = FlaGraphicDefinitionSchema.parse({
    id: R9_GRAPHIC_ID,
    name: '补间缓存元件',
    kind: 'fla-graphic',
    source: {
      origin: 'native',
      targetKind: 'graphic-symbol',
      targetName: '补间缓存元件',
      startFrameIndex: 0,
      endFrameIndex: 1,
      sourceFps: FPS,
      canvas: { width: 240, height: 200 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 240, height: 200 },
    },
    durationMs: FRAME_MS * 2,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        sourceViewport: { x: 0, y: 0, width: 240, height: 200 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: FRAME_MS,
        createdBySequenceImport: false,
      },
      {
        ordinal: 1,
        sourceFrameIndex: 1,
        sourceViewport: { x: 0, y: 0, width: 240, height: 200 },
        offset: { x: 0, y: 0 },
        startMs: FRAME_MS,
        durationMs: FRAME_MS,
        createdBySequenceImport: false,
      },
    ],
    structure: {
      version: 1,
      frames: [
        {
          ordinal: 0,
          layers: [{ name: '图层', nodes: [r9ShapeNode('r9-mouth-0', 0)] }],
        },
        {
          ordinal: 1,
          layers: [{ name: '图层', nodes: [r9ShapeNode('r9-mouth-1', 0)] }],
        },
      ],
    },
    flaGraphicSharedShapeOverrides: {
      '0': {
        [JSON.stringify(R9_SOURCE_PATH)]: {
          baseViewBox: { x: 0, y: 0, width: 100, height: 80 },
          regions: [R9_REGION],
          excludedRegionRefs: [],
          extractedRegions: [],
        },
      },
    },
  });
  const initial = ProjectSchema.parse({
    ...base.project,
    animations: [definition],
  });
  const service = new LayerService();
  const shotId = initial.shots[0]!.id;
  const createdA = service.createFromAnimation(initial, shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 400, y: 300 },
  });
  const createdB = service.createFromAnimation(createdA.project, shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 800, y: 300 },
  });
  // Author the tween from the frame-0 source pose.
  const tweened = service.createFlaGraphicShapeTween(createdB.project, {
    shotId,
    layerId: createdA.layer.id,
    frameOrdinal: 0,
    nodePath: [...R9_SOURCE_PATH],
    regionRef: R9_REGION.regionRef,
    mode: 'definition',
    startTimeMs: 0,
    durationMs: 1_000,
  });
  const tween = definitionOf(tweened, definition.id).structure!.shapeTweenTracks?.[0];
  if (!tween) throw new Error('tween was not created');
  return {
    project: tweened,
    shotId,
    animationId: definition.id,
    layerAId: createdA.layer.id,
    layerBId: createdB.layer.id,
    tweenId: tween.tweenId,
  };
}

function withSourceFrameInstanceOverride(
  project: Project,
  layerId: string,
  region: FlaEditableShapeRegion,
): Project {
  return replaceLayer(project, layerId, (layer) => ({
    ...layer,
    flaGraphicInstanceShapeOverrides: {
      '0': {
        [JSON.stringify(R9_SOURCE_PATH)]: {
          baseViewBox: { x: 0, y: 0, width: 100, height: 80 },
          regions: [JSON.parse(JSON.stringify(R9_REGION)) as FlaEditableShapeRegion, region],
          excludedRegionRefs: [],
          extractedRegions: [],
        },
      },
    },
  }));
}

interface EvaluatedFrameOneShape {
  readonly regionRefs: readonly string[];
  readonly regionBounds: readonly unknown[];
}

function evaluateFrameOneInstance(
  project: Project,
  animationId: string,
  layerId: string,
  internalTimeMs = 500,
): EvaluatedFrameOneShape {
  const visual = instanceVisual(project, animationId, 1, layerId, internalTimeMs);
  const node = evaluatedNodeAtPath(visual, R9_TARGET_PATH);
  if (!node?.vectorVisual) throw new Error('frame-1 shape did not evaluate');
  return {
    regionRefs: node.vectorVisual.regions.map((candidate) => candidate.regionRef),
    regionBounds: node.vectorVisual.regions.map((candidate) => candidate.bounds),
  };
}

describe('#1464 R9 — cross-frame Shape Tween cache instance isolation (#1450 x #1457)', () => {
  it('never reuses one instance cached tween geometry for another instance', () => {
    const fixture = buildTweenCacheFixture();
    const projectWithOverrides = withSourceFrameInstanceOverride(
      withSourceFrameInstanceOverride(
        fixture.project,
        fixture.layerAId,
        { ...R9_EXTRA_REGION },
      ),
      fixture.layerBId,
      { ...editableRegion('r9-extra-b', 30, 30, 8, 8) },
    );

    // A -> B, then repeated A for determinism.
    const firstA = evaluateFrameOneInstance(projectWithOverrides, fixture.animationId, fixture.layerAId);
    const firstB = evaluateFrameOneInstance(projectWithOverrides, fixture.animationId, fixture.layerBId);
    expect(firstA.regionRefs).toContain('r9-extra');
    expect(firstB.regionRefs).not.toContain('r9-extra');
    expect(firstB.regionRefs).toContain('r9-extra-b');
    expect(JSON.stringify(evaluateFrameOneInstance(
      projectWithOverrides,
      fixture.animationId,
      fixture.layerAId,
    ))).toBe(JSON.stringify(firstA));
    expect(JSON.stringify(evaluateFrameOneInstance(
      projectWithOverrides,
      fixture.animationId,
      fixture.layerBId,
    ))).toBe(JSON.stringify(firstB));

    // B -> A on a fresh project snapshot must produce the same per-instance geometry.
    const reversed = ProjectSchema.parse(JSON.parse(JSON.stringify(projectWithOverrides)));
    const reversedB = evaluateFrameOneInstance(reversed, fixture.animationId, fixture.layerBId);
    const reversedA = evaluateFrameOneInstance(reversed, fixture.animationId, fixture.layerAId);
    expect(reversedB.regionRefs).not.toContain('r9-extra');
    expect(reversedA.regionRefs).toContain('r9-extra');
    expect(JSON.stringify(reversedA)).toBe(JSON.stringify(firstA));
    expect(JSON.stringify(reversedB)).toBe(JSON.stringify(firstB));
  });

  it('keeps the shared no-override fast path', () => {
    const fixture = buildTweenCacheFixture();
    // Same Definition/tween but no instance overrides at all: both instances must
    // share the cached authored visual (one object, one evaluation bucket).
    const sharedA = evaluateFrameOneInstance(fixture.project, fixture.animationId, fixture.layerAId);
    const sharedB = evaluateFrameOneInstance(fixture.project, fixture.animationId, fixture.layerBId);
    expect(sharedB).toEqual(sharedA);
    const definition = definitionOf(fixture.project, fixture.animationId);
    const layerA = fixture.project.shots[0]!.layers.find((layer) => layer.id === fixture.layerAId)!;
    const visualA = evaluateFlaGraphicVisual({
      definition,
      frameOrdinal: 1,
      mode: 'instance',
      internalTimeMs: 500,
    });
    const visualAgain = evaluateFlaGraphicVisual({
      definition,
      frameOrdinal: 1,
      mode: 'instance',
      internalTimeMs: 500,
    });
    expect(visualAgain).toBe(visualA);
    expect(layerA.flaGraphicInstanceShapeOverrides).toBeUndefined();
  });
});
