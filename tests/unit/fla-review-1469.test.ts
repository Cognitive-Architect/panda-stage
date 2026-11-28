import { describe, expect, it } from 'vitest';
import {
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  copyNativeGraphicFrame,
  evaluateFlaGraphicVisual,
  isFlaGraphicDefinition,
  ungroupNativeGraphicNode,
  type EvaluatedFlaGraphicNode,
  type EvaluatedFlaGraphicVisual,
  type FlaEditableShapeRegion,
  type FlaGraphicDefinition,
  type FlaGraphicStructureNode,
  type Project,
} from '../../src/domain';
import {
  buildSourceGraphicFixture,
  editableRegion,
  SOURCE_GRAPHIC_ID,
} from '../helpers/nativeGraphicProject';

const FPS = 24;
const FRAME_MS = 1_000 / FPS;
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as const;

type Matrix = { a: number; b: number; c: number; d: number; tx: number; ty: number };

let idCounter = 0;
function deterministicIds(): () => string {
  return () => {
    idCounter += 1;
    return `a6900000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
  };
}

function definitionOf(project: Project, animationId: string): FlaGraphicDefinition {
  const definition = project.animations.find((candidate) => candidate.id === animationId);
  if (!definition || !isFlaGraphicDefinition(definition)) {
    throw new Error(`missing definition ${animationId}`);
  }
  return definition;
}

function layerOf(project: Project, layerId: string): Project['shots'][number]['layers'][number] {
  const layer = project.shots
    .flatMap((shot) => shot.layers)
    .find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`missing layer ${layerId}`);
  return layer;
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
): EvaluatedFlaGraphicVisual {
  const definition = definitionOf(project, animationId);
  const layer = layerOf(project, layerId);
  if (layer.source.kind !== 'animation') {
    throw new Error(`layer ${layerId} is not an animation instance`);
  }
  const visual = evaluateFlaGraphicVisual({
    definition,
    frameOrdinal,
    mode: 'instance',
    internalTimeMs: 0,
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

function transformFrameMap(
  project: Project,
  layerId: string,
  frameOrdinal: number,
): Record<string, Matrix> | undefined {
  return layerOf(project, layerId).flaGraphicInstanceTransformOverrides?.[String(frameOrdinal)];
}

/* ------------------------------------------------------------------------- *
 * F1 fixture: outer Group > inner Group > grandchild, plus a direct shape
 * child of the outer Group. The nested shape keeps its authored transform, so
 * every evaluated world matrix difference is caused by the group composition.
 * ------------------------------------------------------------------------- */

const NESTED_GRAPHIC_ID = 'a6900000-0000-4000-8000-000000000001';
const F1_OUTER = 'f1-outer-group';
const F1_INNER = 'f1-inner-group';
const F1_GRANDCHILD = 'f1-grandchild';
const F1_SIBLING = 'f1-sibling';

const OUTER_TRANSFORM: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 0 };
const INNER_TRANSFORM: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 0 };
const GRANDCHILD_TRANSFORM: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const SIBLING_TRANSFORM: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 0 };

function f1Region(regionRef: string, width: number, height: number): FlaEditableShapeRegion {
  return editableRegion(regionRef, 0, 0, width, height);
}

function f1ShapeNode(id: string, drawOrder: number, localTransform: Matrix): FlaGraphicStructureNode {
  return {
    type: 'opaque',
    id,
    authored: 'native',
    drawOrder,
    localTransform: { ...localTransform },
    opaqueKind: 'shape',
    fallbackScope: 'subtree',
    fallbackViewBox: { x: 0, y: 0, width: 40, height: 30 },
  };
}

function buildNestedGroupFixture(options?: {
  readonly outer?: Matrix;
  readonly inner?: Matrix;
}): {
  readonly project: Project;
  readonly shotId: string;
  readonly animationId: string;
  readonly layerAId: string;
  readonly layerBId: string;
  readonly unrelatedLayerId: string;
} {
  const base = buildSourceGraphicFixture();
  const outer = options?.outer ?? OUTER_TRANSFORM;
  const inner = options?.inner ?? INNER_TRANSFORM;
  const definition = FlaGraphicDefinitionSchema.parse({
    id: NESTED_GRAPHIC_ID,
    name: '嵌套分组元件',
    kind: 'fla-graphic',
    source: {
      origin: 'native',
      targetKind: 'graphic-symbol',
      targetName: '嵌套分组元件',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: FPS,
      canvas: { width: 400, height: 300 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 400, height: 300 },
    },
    durationMs: FRAME_MS,
    frames: [{
      ordinal: 0,
      sourceFrameIndex: 0,
      sourceViewport: { x: 0, y: 0, width: 400, height: 300 },
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
            id: F1_OUTER,
            authored: 'native',
            drawOrder: 0,
            localTransform: { ...outer },
            groupId: '外层分组',
            children: [
              {
                type: 'group',
                id: F1_INNER,
                authored: 'native',
                drawOrder: 0,
                localTransform: { ...inner },
                groupId: '内层分组',
                children: [f1ShapeNode(F1_GRANDCHILD, 0, GRANDCHILD_TRANSFORM)],
              },
              f1ShapeNode(F1_SIBLING, 1, SIBLING_TRANSFORM),
            ],
          }],
        }],
      }],
    },
    flaGraphicSharedShapeOverrides: {
      '0': {
        [JSON.stringify([F1_OUTER, F1_INNER, F1_GRANDCHILD])]: {
          baseViewBox: { x: 0, y: 0, width: 40, height: 30 },
          regions: [f1Region('f1-grandchild-region', 40, 30)],
          excludedRegionRefs: [],
          extractedRegions: [],
        },
        [JSON.stringify([F1_OUTER, F1_SIBLING])]: {
          baseViewBox: { x: 0, y: 0, width: 40, height: 30 },
          regions: [f1Region('f1-sibling-region', 40, 30)],
          excludedRegionRefs: [],
          extractedRegions: [],
        },
      },
    },
  });
  const project = ProjectSchema.parse({
    ...base.project,
    animations: [...base.project.animations, definition],
  });
  const service = new LayerService();
  const createdA = service.createFromAnimation(project, base.shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 400, y: 300 },
  });
  const createdB = service.createFromAnimation(createdA.project, base.shotId, {
    animationId: definition.id,
    startTimeMs: 0,
    position: { x: 800, y: 300 },
  });
  // An instance of a different, source-backed Definition that the ungroup must
  // never touch.
  const unrelated = service.createFromAnimation(createdB.project, base.shotId, {
    animationId: SOURCE_GRAPHIC_ID,
    startTimeMs: 0,
    position: { x: 1200, y: 300 },
  });
  return {
    project: unrelated.project,
    shotId: base.shotId,
    animationId: definition.id,
    layerAId: createdA.layer.id,
    layerBId: createdB.layer.id,
    unrelatedLayerId: unrelated.layer.id,
  };
}

function setOverride(
  project: Project,
  shotId: string,
  layerId: string,
  frameOrdinal: number,
  path: readonly string[],
  matrix: Matrix,
): Project {
  return new LayerService().updateFlaGraphicInstanceTransform(
    project,
    shotId,
    layerId,
    frameOrdinal,
    path,
    matrix,
  );
}

function ungroupOuter(project: Project, animationId: string, frameOrdinal = 0) {
  return ungroupNativeGraphicNode(project, {
    animationId,
    frameOrdinal,
    nodePath: [F1_OUTER],
  });
}

describe('#1469 F1 — ungroup composes the removed group matrix only into promoted direct children', () => {
  it('keeps a grandchild override local to its surviving inner group (100 + 20 + 30 stays 150, not 250)', () => {
    const fixture = buildNestedGroupFixture();
    const project = setOverride(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [F1_OUTER, F1_INNER, F1_GRANDCHILD],
      { ...IDENTITY, tx: 30 },
    );

    const grandchildPathBefore = [F1_OUTER, F1_INNER, F1_GRANDCHILD];
    const before = worldTransformAt(
      project,
      fixture.animationId,
      0,
      fixture.layerAId,
      grandchildPathBefore,
    );
    // outer authored X=100 + inner authored X=20 + grandchild override X=30.
    expect(before!.tx).toBeCloseTo(150, 6);

    const ungrouped = ungroupOuter(project, fixture.animationId);
    expect(ungrouped.nodePaths.map((path) => path[0])).toEqual([F1_INNER, F1_SIBLING]);

    const after = worldTransformAt(
      ungrouped.project,
      fixture.animationId,
      0,
      fixture.layerAId,
      [F1_INNER, F1_GRANDCHILD],
    );
    expect(after!.tx).toBeCloseTo(150, 6);
    expectMatrixCloseTo(after, before);

    // The override was only re-keyed; its matrix stays relative to the inner
    // group instead of being composed with the removed outer group again.
    const frameMap = transformFrameMap(ungrouped.project, fixture.layerAId, 0);
    expect(frameMap?.[JSON.stringify([F1_OUTER, F1_INNER, F1_GRANDCHILD])]).toBeUndefined();
    expect(frameMap?.[JSON.stringify([F1_INNER, F1_GRANDCHILD])]?.tx).toBeCloseTo(30, 6);
    expect(frameMap?.[JSON.stringify([F1_INNER])]).toBeUndefined();
  });

  it('composes a group-only instance override into the promoted direct children only', () => {
    const fixture = buildNestedGroupFixture();
    const project = setOverride(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [F1_OUTER],
      { ...IDENTITY, tx: 1000 },
    );
    const innerPathBefore = [F1_OUTER, F1_INNER];
    const grandchildPathBefore = [F1_OUTER, F1_INNER, F1_GRANDCHILD];
    const before = {
      inner: worldTransformAt(project, fixture.animationId, 0, fixture.layerAId, innerPathBefore),
      grandchild: worldTransformAt(
        project,
        fixture.animationId,
        0,
        fixture.layerAId,
        grandchildPathBefore,
      ),
      sibling: worldTransformAt(
        project,
        fixture.animationId,
        0,
        fixture.layerAId,
        [F1_OUTER, F1_SIBLING],
      ),
    };
    // The group instance override replaces the authored X=100; inner authored
    // X=20 and sibling authored X=5 stay local below it.
    expect(before.inner!.tx).toBeCloseTo(1020, 6);
    expect(before.grandchild!.tx).toBeCloseTo(1020, 6);
    expect(before.sibling!.tx).toBeCloseTo(1005, 6);

    const ungrouped = ungroupOuter(project, fixture.animationId);
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerAId, [F1_INNER]),
      before.inner,
    );
    expectMatrixCloseTo(
      worldTransformAt(
        ungrouped.project,
        fixture.animationId,
        0,
        fixture.layerAId,
        [F1_INNER, F1_GRANDCHILD],
      ),
      before.grandchild,
    );
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerAId, [F1_SIBLING]),
      before.sibling,
    );

    // Synthesis produces direct-child overrides only.
    const frameMap = transformFrameMap(ungrouped.project, fixture.layerAId, 0);
    expect(frameMap?.[JSON.stringify([F1_OUTER])]).toBeUndefined();
    expect(frameMap?.[JSON.stringify([F1_INNER])]?.tx).toBeCloseTo(1020, 6);
    expect(frameMap?.[JSON.stringify([F1_SIBLING])]?.tx).toBeCloseTo(1005, 6);
    expect(frameMap?.[JSON.stringify([F1_INNER, F1_GRANDCHILD])]).toBeUndefined();
  });

  it('composes a group override with a direct-child override but keeps the grandchild override local', () => {
    const fixture = buildNestedGroupFixture();
    let project = setOverride(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [F1_OUTER],
      { ...IDENTITY, tx: 1000 },
    );
    project = setOverride(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [F1_OUTER, F1_INNER],
      { ...IDENTITY, tx: 7 },
    );
    project = setOverride(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [F1_OUTER, F1_INNER, F1_GRANDCHILD],
      { ...IDENTITY, tx: 30 },
    );

    const before = {
      inner: worldTransformAt(
        project,
        fixture.animationId,
        0,
        fixture.layerAId,
        [F1_OUTER, F1_INNER],
      ),
      grandchild: worldTransformAt(
        project,
        fixture.animationId,
        0,
        fixture.layerAId,
        [F1_OUTER, F1_INNER, F1_GRANDCHILD],
      ),
    };
    // group X=1000 + inner override X=7 + grandchild override X=30.
    expect(before.inner!.tx).toBeCloseTo(1007, 6);
    expect(before.grandchild!.tx).toBeCloseTo(1037, 6);

    const ungrouped = ungroupOuter(project, fixture.animationId);
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerAId, [F1_INNER]),
      before.inner,
    );
    expectMatrixCloseTo(
      worldTransformAt(
        ungrouped.project,
        fixture.animationId,
        0,
        fixture.layerAId,
        [F1_INNER, F1_GRANDCHILD],
      ),
      before.grandchild,
    );

    const frameMap = transformFrameMap(ungrouped.project, fixture.layerAId, 0);
    expect(frameMap?.[JSON.stringify([F1_INNER])]?.tx).toBeCloseTo(1007, 6);
    // Only re-keyed: 30, never group(1000) + 30 = 1030.
    expect(frameMap?.[JSON.stringify([F1_INNER, F1_GRANDCHILD])]?.tx).toBeCloseTo(30, 6);
    expect(frameMap?.[JSON.stringify([F1_OUTER])]).toBeUndefined();
    expect(frameMap?.[JSON.stringify([F1_OUTER, F1_INNER])]).toBeUndefined();
  });

  it('preserves every affected world matrix through non-unit scale and rotation', () => {
    const outer: Matrix = { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 40 };
    const inner: Matrix = { a: 0, b: 1, c: -1, d: 0, tx: 20, ty: 0 };
    const fixture = buildNestedGroupFixture({ outer, inner });
    const grandchildOverride: Matrix = { a: 0.5, b: 0, c: 0, d: 0.5, tx: 30, ty: 10 };
    const project = setOverride(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [F1_OUTER, F1_INNER, F1_GRANDCHILD],
      grandchildOverride,
    );

    const before = {
      inner: worldTransformAt(project, fixture.animationId, 0, fixture.layerAId, [F1_OUTER, F1_INNER]),
      grandchild: worldTransformAt(
        project,
        fixture.animationId,
        0,
        fixture.layerAId,
        [F1_OUTER, F1_INNER, F1_GRANDCHILD],
      ),
      sibling: worldTransformAt(
        project,
        fixture.animationId,
        0,
        fixture.layerAId,
        [F1_OUTER, F1_SIBLING],
      ),
    };

    const ungrouped = ungroupOuter(project, fixture.animationId);
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerAId, [F1_INNER]),
      before.inner,
    );
    expectMatrixCloseTo(
      worldTransformAt(
        ungrouped.project,
        fixture.animationId,
        0,
        fixture.layerAId,
        [F1_INNER, F1_GRANDCHILD],
      ),
      before.grandchild,
    );
    expectMatrixCloseTo(
      worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerAId, [F1_SIBLING]),
      before.sibling,
    );
    // The grandchild override matrix itself is never composed with the group.
    const frameMap = transformFrameMap(ungrouped.project, fixture.layerAId, 0);
    const rekeyed = frameMap?.[JSON.stringify([F1_INNER, F1_GRANDCHILD])];
    for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
      expect(rekeyed![key]).toBeCloseTo(grandchildOverride[key], 6);
    }
  });

  it('leaves other authored frames, shared definition geometry and unrelated instances untouched', () => {
    const fixture = buildNestedGroupFixture();
    const copied = copyNativeGraphicFrame(fixture.project, {
      animationId: fixture.animationId,
      sourceFrameOrdinal: 0,
      createId: deterministicIds(),
    });
    const copiedDefinition = definitionOf(copied.project, fixture.animationId);
    const frame1Structure = copiedDefinition.structure!.frames.find((frame) => frame.ordinal === 1)!;
    const frame1Outer = frame1Structure.layers[0]!.nodes[0]!;
    if (frame1Outer.type !== 'group') throw new Error('expected a copied outer group');
    const frame1Inner = frame1Outer.children[0]!;
    if (frame1Inner.type !== 'group') throw new Error('expected a copied inner group');
    const frame1Grandchild = frame1Inner.children[0]!;

    // Frame 1 gets its own grandchild override; frame 0 gets the counterexample.
    let project = setOverride(
      copied.project,
      fixture.shotId,
      fixture.layerAId,
      1,
      [frame1Outer.id, frame1Inner.id, frame1Grandchild.id],
      { ...IDENTITY, tx: 40 },
    );
    project = setOverride(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      [F1_OUTER, F1_INNER, F1_GRANDCHILD],
      { ...IDENTITY, tx: 30 },
    );
    // The unrelated instance of another Definition carries its own override.
    project = setOverride(
      project,
      fixture.shotId,
      fixture.unrelatedLayerId,
      0,
      ['shape-circle'],
      { ...IDENTITY, tx: 55 },
    );

    const frame1StructureBefore = JSON.stringify(
      definitionOf(project, fixture.animationId).structure!.frames.find((frame) => frame.ordinal === 1),
    );
    const frame1OverridesBefore = JSON.stringify(transformFrameMap(project, fixture.layerAId, 1));
    const frame1WorldBefore = worldTransformAt(
      project,
      fixture.animationId,
      1,
      fixture.layerAId,
      [frame1Outer.id, frame1Inner.id, frame1Grandchild.id],
    );
    const unrelatedLayerBefore = JSON.stringify(layerOf(project, fixture.unrelatedLayerId));
    const sharedOverridesBefore = JSON.stringify(
      definitionOf(project, fixture.animationId).flaGraphicSharedShapeOverrides?.['1'],
    );

    const ungrouped = ungroupOuter(project, fixture.animationId);

    // Frame 1 (and its override) is byte-identical: composition is frame-scoped.
    expect(JSON.stringify(
      definitionOf(ungrouped.project, fixture.animationId).structure!.frames.find(
        (frame) => frame.ordinal === 1,
      ),
    )).toBe(frame1StructureBefore);
    expect(JSON.stringify(transformFrameMap(ungrouped.project, fixture.layerAId, 1)))
      .toBe(frame1OverridesBefore);
    expectMatrixCloseTo(
      worldTransformAt(
        ungrouped.project,
        fixture.animationId,
        1,
        fixture.layerAId,
        [frame1Outer.id, frame1Inner.id, frame1Grandchild.id],
      ),
      frame1WorldBefore,
    );
    // Shared shape overrides of the untouched authored frame are untouched too.
    expect(JSON.stringify(
      definitionOf(ungrouped.project, fixture.animationId).flaGraphicSharedShapeOverrides?.['1'],
    )).toBe(sharedOverridesBefore);

    // The flattened shared Definition geometry composes the removed group once.
    const ungroupedDefinition = definitionOf(ungrouped.project, fixture.animationId);
    const flatNodes = ungroupedDefinition.structure!.frames[0]!.layers[0]!.nodes;
    expect(flatNodes.map((node) => node.id)).toEqual([F1_INNER, F1_SIBLING]);
    expect(flatNodes[0]!.localTransform.tx).toBeCloseTo(100 + 20, 6);
    expect(flatNodes[1]!.localTransform.tx).toBeCloseTo(100 + 5, 6);
    // Definition-level shape overrides are only re-keyed, never matrix-composed.
    expect(ungroupedDefinition.flaGraphicSharedShapeOverrides?.['0']?.[
      JSON.stringify([F1_INNER, F1_GRANDCHILD])
    ]).toBeDefined();
    expect(ungroupedDefinition.flaGraphicSharedShapeOverrides?.['0']?.[
      JSON.stringify([F1_OUTER, F1_INNER, F1_GRANDCHILD])
    ]).toBeUndefined();
    expect(ungroupedDefinition.flaGraphicSharedShapeOverrides?.['0']?.[
      JSON.stringify([F1_SIBLING])
    ]).toBeDefined();

    // The unrelated instance and its override are unchanged.
    expect(JSON.stringify(layerOf(ungrouped.project, fixture.unrelatedLayerId)))
      .toBe(unrelatedLayerBefore);

    // The other instance of the same shared Definition keeps its world matrices.
    for (const path of [
      [F1_INNER],
      [F1_INNER, F1_GRANDCHILD],
      [F1_SIBLING],
    ] as const) {
      expectMatrixCloseTo(
        worldTransformAt(ungrouped.project, fixture.animationId, 0, fixture.layerBId, path),
        worldTransformAt(project, fixture.animationId, 0, fixture.layerBId, [
          F1_OUTER,
          ...path,
        ]),
      );
    }
  });
});
