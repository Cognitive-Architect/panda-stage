import { describe, expect, it } from 'vitest';
import {
  addNativeGraphicNode,
  createNativeGraphicDefinitionFromNodes,
  deleteNativeGraphicDefinition,
  duplicateNativeGraphicDefinition,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  isFlaGraphicDefinition,
  isNativeFlaGraphicDefinition,
  LayerService,
  moveNativeGraphicNode,
  ProjectSchema,
  removeNativeGraphicNode,
  replaceNativeGraphicNode,
  resolveLayerVisualParts,
  type EvaluatedFlaGraphicNode,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { FlaGraphicDefinitionSchema } from '../../src/domain/models/animation';
import {
  collectExportPreparationMedia,
  evaluateExportPreparationSupport,
} from '../../src/domain/export-preparation';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import {
  buildNativeBitmapOnlyProject,
  buildSourceGraphicFixture,
  placeGraphicLayer,
  SOURCE_CIRCLE_PATH,
  SOURCE_GRAPHIC_ID,
  SOURCE_RECT_PATH,
  CIRCLE_REGION,
  RECT_REGION,
  UNUSED_MEDIA_ASSET_ID,
} from '../helpers/nativeGraphicProject';

const FRAME_DURATION_MS = 1_000 / 24;

let idCounter = 0;
function deterministicIds(): () => string {
  return () => {
    idCounter += 1;
    return `90000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
  };
}

function createService(): LayerService {
  return new LayerService();
}

function nativeDefinition(project: Project, animationId: string): FlaGraphicDefinition {
  const definition = project.animations.find((candidate) => candidate.id === animationId);
  if (!definition || !isFlaGraphicDefinition(definition)) {
    throw new Error('native definition is missing');
  }
  return definition;
}

function nodeWorldTransform(
  project: Project,
  layerId: string,
  nodePath: readonly string[],
): { a: number; b: number; c: number; d: number; tx: number; ty: number } | null {
  const layer = project.shots
    .flatMap((shot) => shot.layers)
    .find((candidate) => candidate.id === layerId);
  if (!layer || layer.source.kind !== 'animation') return null;
  const animationId = layer.source.animationId;
  const graphic = project.animations.find((candidate) => candidate.id === animationId);
  if (!graphic || !isFlaGraphicDefinition(graphic)) return null;
  const evaluated = evaluateFlaGraphicVisual({
    definition: graphic,
    frameOrdinal: 0,
    mode: 'instance',
    instanceTransformOverrides: layer.flaGraphicInstanceTransformOverrides,
    instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
  });
  const targetKey = JSON.stringify(nodePath);
  const findNode = (
    nodes: readonly EvaluatedFlaGraphicNode[],
  ): { a: number; b: number; c: number; d: number; tx: number; ty: number } | null => {
    for (const node of nodes) {
      if (JSON.stringify(node.path) === targetKey) return node.worldTransform;
      const nested = findNode(node.children);
      if (nested) return nested;
    }
    return null;
  };
  for (const evaluatedLayer of evaluated?.layers ?? []) {
    const result = findNode(evaluatedLayer.nodes);
    if (result) return result;
  }
  return null;
}

function buildCreatedNative(): {
  readonly project: Project;
  readonly shotId: string;
  readonly layerAId: string;
  readonly layerBId: string;
  readonly animationId: string;
  readonly firstNodeId: string;
  readonly secondNodeId: string;
} {
  const fixture = buildSourceGraphicFixture();
  const placed = placeGraphicLayer(fixture.project, fixture.shotId, SOURCE_GRAPHIC_ID);
  const createId = deterministicIds();
  const created = createNativeGraphicDefinitionFromNodes(placed.project, {
    shotId: fixture.shotId,
    layerId: placed.layerId,
    frameOrdinal: 0,
    nodePaths: [SOURCE_CIRCLE_PATH, SOURCE_RECT_PATH],
    createId,
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
  const definition = nativeDefinition(placedB.project, created.animationId);
  const nodes = definition.structure!.frames[0]!.layers[0]!.nodes;
  return {
    project: placedB.project,
    shotId: fixture.shotId,
    layerAId: placedA.layerId,
    layerBId: placedB.layerId,
    animationId: created.animationId,
    firstNodeId: nodes[0]!.id,
    secondNodeId: nodes[1]!.id,
  };
}

describe('issue #1452 native FLA Graphic Definitions', () => {
  it('creates a legitimate native Definition from two editable vector nodes', () => {
    const fixture = buildSourceGraphicFixture();
    const placed = placeGraphicLayer(fixture.project, fixture.shotId, SOURCE_GRAPHIC_ID);
    const createId = deterministicIds();
    const result = createNativeGraphicDefinitionFromNodes(placed.project, {
      shotId: fixture.shotId,
      layerId: placed.layerId,
      frameOrdinal: 0,
      nodePaths: [SOURCE_CIRCLE_PATH, SOURCE_RECT_PATH],
      createId,
    });

    const definition = nativeDefinition(result.project, result.animationId);
    // Legitimate native provenance: no fabricated FLA archive or frame media.
    expect(definition.source.origin).toBe('native');
    expect(definition.source.basename).toBeUndefined();
    expect(definition.source.sha256).toBeUndefined();
    expect(definition.source.renderTargetId).toBeUndefined();
    expect(definition.source.targetKind).toBe('graphic-symbol');
    expect(definition.source.sourceFps).toBe(24);
    expect(definition.frames).toHaveLength(1);
    const frame = definition.frames[0]!;
    expect(frame.assetId).toBeUndefined();
    expect(frame.sha256).toBeUndefined();
    expect(frame.sourceFrameIndex).toBe(0);
    expect(frame.startMs).toBe(0);
    expect(Math.abs(frame.durationMs - FRAME_DURATION_MS)).toBeLessThan(0.001);
    expect(Math.abs(definition.durationMs - FRAME_DURATION_MS)).toBeLessThan(0.001);
    expect(frame.offset).toEqual({ x: 0, y: 0 });
    // Content bounds: circle 10..110/20..120 + rect 120..200/0..60 => 190x120.
    expect(definition.source.canvas.width).toBeCloseTo(190, 6);
    expect(definition.source.canvas.height).toBeCloseTo(120, 6);
    expect(definition.source.anchor).toEqual({ x: 0, y: 0 });

    const structureNodes = definition.structure!.frames[0]!.layers[0]!.nodes;
    expect(structureNodes).toHaveLength(2);
    for (const node of structureNodes) {
      expect(node.authored).toBe('native');
      expect(node.type).toBe('opaque');
      if (node.type !== 'opaque') continue;
      expect(node.opaqueKind).toBe('shape');
      expect(node.fallbackScope).toBe('subtree');
      expect(node.fallbackViewBox).toBeDefined();
      expect(node.fallbackAssetId).toBeUndefined();
    }
    expect(structureNodes[0]!.localTransform).toMatchObject({ tx: 0, ty: 20 });
    expect(structureNodes[1]!.localTransform).toMatchObject({ tx: 110, ty: 0 });
    const overrides = definition.flaGraphicSharedShapeOverrides!['0']!;
    expect(overrides[JSON.stringify([structureNodes[0]!.id])]!.regions[0]!.regionRef)
      .toBe(CIRCLE_REGION.regionRef);
    expect(overrides[JSON.stringify([structureNodes[1]!.id])]!.regions[0]!.regionRef)
      .toBe(RECT_REGION.regionRef);

    // The Definition is a normal library entry and did not fabricate media.
    expect(result.project.animations.map((candidate) => candidate.id)).toContain(result.animationId);
    expect(result.project.assets).toHaveLength(placed.project.assets.length);
    expect(isNativeFlaGraphicDefinition(definition)).toBe(true);

    // Same existing evaluator renders it: structured layers, no baked frame asset.
    const visual = evaluateFlaGraphicVisual({ definition, frameOrdinal: 0, mode: 'definition' });
    expect(visual).not.toBeNull();
    expect(visual!.structureFrame).not.toBeNull();
    expect(visual!.frameAssetId).toBe('');
    expect(visual!.resourceAssetIds).toEqual([]);
    expect(visual!.layers).toHaveLength(1);
    expect(visual!.layers![0]!.nodes).toHaveLength(2);
    expect(visual!.layers![0]!.nodes.every((node) => node.renderable)).toBe(true);
    expect(visual!.layers![0]!.nodes[0]!.vectorVisual?.regions[0]!.regionRef)
      .toBe(CIRCLE_REGION.regionRef);

    // Random internal times hold the same authored single frame.
    for (const internalTimeMs of [0, 137, 1_234, 10_000]) {
      const sampled = evaluateFlaGraphicVisual({
        definition,
        frameOrdinal: 0,
        mode: 'definition',
        internalTimeMs,
      });
      expect(sampled!.structureFrame).not.toBeNull();
      expect(sampled!.layers![0]!.nodes).toHaveLength(2);
    }
  });

  it('rejects non-editable and overlapping selections with clear Chinese errors', () => {
    const fixture = buildSourceGraphicFixture();
    const placed = placeGraphicLayer(fixture.project, fixture.shotId, SOURCE_GRAPHIC_ID);
    const createId = deterministicIds();
    expect(() => createNativeGraphicDefinitionFromNodes(placed.project, {
      shotId: fixture.shotId,
      layerId: placed.layerId,
      frameOrdinal: 0,
      nodePaths: [['readonly-caption']],
      createId,
    })).toThrow(/不是可编辑/);
    expect(() => createNativeGraphicDefinitionFromNodes(placed.project, {
      shotId: fixture.shotId,
      layerId: placed.layerId,
      frameOrdinal: 0,
      nodePaths: [SOURCE_CIRCLE_PATH, SOURCE_CIRCLE_PATH],
      createId,
    })).toThrow(/包含关系/);
    expect(() => createNativeGraphicDefinitionFromNodes(placed.project, {
      shotId: fixture.shotId,
      layerId: placed.layerId,
      frameOrdinal: 0,
      nodePaths: [],
      createId,
    })).toThrow(/至少一个/);
  });

  it('places A/B instances that share edits while an independent copy diverges', () => {
    const fixture = buildSourceGraphicFixture();
    const placed = placeGraphicLayer(fixture.project, fixture.shotId, SOURCE_GRAPHIC_ID);
    const createId = deterministicIds();
    const created = createNativeGraphicDefinitionFromNodes(placed.project, {
      shotId: fixture.shotId,
      layerId: placed.layerId,
      frameOrdinal: 0,
      nodePaths: [SOURCE_CIRCLE_PATH, SOURCE_RECT_PATH],
      createId,
    });
    const placedA = placeGraphicLayer(created.project, fixture.shotId, created.animationId, { x: 400, y: 300 });
    const placedB = placeGraphicLayer(placedA.project, fixture.shotId, created.animationId, { x: 800, y: 300 });
    const definition = nativeDefinition(placedB.project, created.animationId);
    const nodeId = definition.structure!.frames[0]!.layers[0]!.nodes[0]!.id;
    const service = createService();

    const sharedEdited = service.updateFlaGraphicSharedDefinitionTransform(
      placedB.project,
      fixture.shotId,
      placedA.layerId,
      0,
      [nodeId],
      { a: 1, b: 0, c: 0, d: 1, tx: 55, ty: 12 },
    );
    expect(nativeDefinition(sharedEdited, created.animationId)
      .structure!.frames[0]!.layers[0]!.nodes[0]!.localTransform).toMatchObject({ tx: 55, ty: 12 });
    // Both instances see the shared Definition edit.
    expect(nodeWorldTransform(sharedEdited, placedA.layerId, [nodeId]))
      .toMatchObject({ tx: 55, ty: 12 });
    expect(nodeWorldTransform(sharedEdited, placedB.layerId, [nodeId]))
      .toMatchObject({ tx: 55, ty: 12 });

    // Instance-scoped edit only affects B.
    const instanceEdited = service.updateFlaGraphicInstanceTransform(
      sharedEdited,
      fixture.shotId,
      placedB.layerId,
      0,
      [nodeId],
      { a: 1, b: 0, c: 0, d: 1, tx: 300, ty: 0 },
    );
    expect(nodeWorldTransform(instanceEdited, placedA.layerId, [nodeId]))
      .toMatchObject({ tx: 55, ty: 12 });
    expect(nodeWorldTransform(instanceEdited, placedB.layerId, [nodeId]))
      .toMatchObject({ tx: 300, ty: 0 });

    // Independent copy diverges without touching the original Definition.
    const duplicated = duplicateNativeGraphicDefinition(instanceEdited, {
      animationId: created.animationId,
      createId: deterministicIds(),
    });
    const placedCopy = placeGraphicLayer(
      duplicated.project,
      fixture.shotId,
      duplicated.animationId,
      { x: 1200, y: 300 },
    );
    const copyDefinition = nativeDefinition(placedCopy.project, duplicated.animationId);
    expect(copyDefinition.id).not.toBe(created.animationId);
    expect(copyDefinition.name).not.toBe(definition.name);
    const copyEdited = service.updateFlaGraphicSharedDefinitionTransform(
      placedCopy.project,
      fixture.shotId,
      placedCopy.layerId,
      0,
      [nodeId],
      { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 90 },
    );
    // Original instances and the original shared Definition are unchanged.
    expect(nativeDefinition(copyEdited, created.animationId)
      .structure!.frames[0]!.layers[0]!.nodes[0]!.localTransform).toMatchObject({ tx: 55, ty: 12 });
    expect(nodeWorldTransform(copyEdited, placedA.layerId, [nodeId]))
      .toMatchObject({ tx: 55, ty: 12 });
    expect(nodeWorldTransform(copyEdited, placedCopy.layerId, [nodeId]))
      .toMatchObject({ tx: 10, ty: 90 });
  });

  it('adds, reorders, replaces and deletes native nodes across shared instances', () => {
    const created = buildCreatedNative();
    const definitionBefore = nativeDefinition(created.project, created.animationId);
    const definitionsBefore = JSON.stringify(
      created.project.animations.filter((candidate) => candidate.id !== created.animationId),
    );
    const nodeIdsBefore = definitionBefore.structure!.frames[0]!.layers[0]!.nodes.map((node) => node.id);
    const firstNodeId = nodeIdsBefore[0]!;
    const secondNodeId = nodeIdsBefore[1]!;

    const added = addNativeGraphicNode(created.project, {
      animationId: created.animationId,
      frameOrdinal: 0,
      source: {
        animationId: created.animationId,
        frameOrdinal: 0,
        nodePath: [firstNodeId],
      },
      afterNodePath: [firstNodeId],
      createId: deterministicIds(),
    });
    let nodes = nativeDefinition(added.project, created.animationId)
      .structure!.frames[0]!.layers[0]!.nodes;
    expect(nodes).toHaveLength(3);
    const copyNodeId = nodes[1]!.id;
    expect(copyNodeId).not.toBe(firstNodeId);
    expect(nodes.map((node) => node.drawOrder)).toEqual([0, 1, 2]);
    // Both A and B instances now render three nodes.
    for (const layerId of [created.layerAId, created.layerBId]) {
      const world = nodeWorldTransform(added.project, layerId, [copyNodeId]);
      expect(world).not.toBeNull();
    }

    const reordered = moveNativeGraphicNode(added.project, {
      animationId: created.animationId,
      frameOrdinal: 0,
      nodePath: [secondNodeId],
      direction: -1,
    });
    nodes = nativeDefinition(reordered, created.animationId)
      .structure!.frames[0]!.layers[0]!.nodes;
    expect(nodes.map((node) => node.id)).toEqual([firstNodeId, secondNodeId, copyNodeId]);
    expect(nodes.map((node) => node.drawOrder)).toEqual([0, 1, 2]);

    const replaced = replaceNativeGraphicNode(reordered, {
      animationId: created.animationId,
      frameOrdinal: 0,
      nodePath: [secondNodeId],
      source: {
        animationId: created.animationId,
        frameOrdinal: 0,
        nodePath: [copyNodeId],
      },
    });
    const replacedDefinition = nativeDefinition(replaced, created.animationId);
    const replacedNodes = replacedDefinition.structure!.frames[0]!.layers[0]!.nodes;
    const replacedOverride = replacedDefinition.flaGraphicSharedShapeOverrides!['0']![
      JSON.stringify([secondNodeId])
    ]!;
    const copyOverride = replacedDefinition.flaGraphicSharedShapeOverrides!['0']![
      JSON.stringify([copyNodeId])
    ]!;
    expect(replacedOverride.regions[0]!.regionRef).toBe(copyOverride.regions[0]!.regionRef);
    expect(replacedNodes.find((node) => node.id === secondNodeId)).toBeDefined();
    expect(replacedNodes.find((node) => node.id === secondNodeId)!.localTransform)
      .toEqual(definitionBefore.structure!.frames[0]!.layers[0]!.nodes[1]!.localTransform);

    // A stale instance override on the node that will be deleted is pruned.
    const service = createService();
    const withStaleOverride = service.updateFlaGraphicInstanceTransform(
      replaced,
      created.shotId,
      created.layerBId,
      0,
      [copyNodeId],
      { a: 1, b: 0, c: 0, d: 1, tx: 444, ty: 444 },
    );
    const removed = removeNativeGraphicNode(withStaleOverride, {
      animationId: created.animationId,
      frameOrdinal: 0,
      nodePath: [copyNodeId],
    });
    const removedDefinition = nativeDefinition(removed, created.animationId);
    expect(removedDefinition.structure!.frames[0]!.layers[0]!.nodes.map((node) => node.id))
      .toEqual([firstNodeId, secondNodeId]);
    expect(removedDefinition.flaGraphicSharedShapeOverrides!['0']![JSON.stringify([copyNodeId])])
      .toBeUndefined();
    const layerB = removed.shots[0]!.layers.find((layer) => layer.id === created.layerBId)!;
    expect(
      layerB.flaGraphicInstanceTransformOverrides?.['0']?.[JSON.stringify([copyNodeId])],
    ).toBeUndefined();

    // Unrelated Definitions are never rewritten by native node recomposition.
    expect(JSON.stringify(
      removed.animations.filter((candidate) => candidate.id !== created.animationId),
    )).toBe(definitionsBefore);
    expect(removed.assets).toEqual(created.project.assets);
  });

  it('protects a referenced Definition and deletes an unused one with released-media reporting', () => {
    const fixture = buildSourceGraphicFixture();
    const placed = placeGraphicLayer(fixture.project, fixture.shotId, SOURCE_GRAPHIC_ID);
    const created = createNativeGraphicDefinitionFromNodes(placed.project, {
      shotId: fixture.shotId,
      layerId: placed.layerId,
      frameOrdinal: 0,
      nodePaths: [SOURCE_CIRCLE_PATH, SOURCE_RECT_PATH],
      createId: deterministicIds(),
    });
    const placedA = placeGraphicLayer(created.project, fixture.shotId, created.animationId);

    let blocked: unknown = null;
    try {
      deleteNativeGraphicDefinition(placedA.project, { animationId: created.animationId });
    } catch (error) {
      blocked = error;
    }
    expect(blocked).toBeInstanceOf(Error);
    expect((blocked as { code?: string }).code).toBe('NATIVE_GRAPHIC_IN_USE');
    expect((blocked as Error).message).toMatch(/仍被/);
    expect((blocked as Error).message).toMatch(/图层/);

    const service = createService();
    const withoutInstance = service.deleteLayer(
      placedA.project,
      fixture.shotId,
      placedA.layerId,
      0,
    );
    const assetsBefore = withoutInstance.assets.length;
    const deleted = deleteNativeGraphicDefinition(withoutInstance, {
      animationId: created.animationId,
    });
    expect(deleted.project.animations.some((candidate) => candidate.id === created.animationId))
      .toBe(false);
    expect(deleted.project.assets).toHaveLength(assetsBefore);
    expect(deleted.releasedAssets).toEqual([]);

    // An unused native Definition that references existing media reports it instead
    // of orphaning it silently; the media itself stays in the asset library.
    const bitmapProject = buildNativeBitmapOnlyProject();
    const bitmapDelete = deleteNativeGraphicDefinition(bitmapProject.project, {
      animationId: bitmapProject.animationId,
    });
    expect(bitmapDelete.project.animations).toEqual([]);
    expect(bitmapDelete.releasedAssets.map((asset) => asset.assetId))
      .toContain(UNUSED_MEDIA_ASSET_ID);
    expect(bitmapDelete.project.assets.some((asset) => asset.id === UNUSED_MEDIA_ASSET_ID))
      .toBe(true);
  });

  it('keeps legacy source-backed Definitions validating and evaluating unchanged', () => {
    const fixture = buildSourceGraphicFixture();
    const definition = nativeDefinition(fixture.project, SOURCE_GRAPHIC_ID);
    expect(isNativeFlaGraphicDefinition(definition)).toBe(false);
    expect(definition.source.origin).toBeUndefined();
    expect(definition.frames[0]!.assetId).toBeDefined();

    // The same evaluator still uses the baked frame asset for the legacy path.
    const visual = evaluateFlaGraphicVisual({ definition, frameOrdinal: 0, mode: 'definition' });
    expect(visual!.structureFrame).not.toBeNull();
    expect(visual!.frameAssetId).toBe(definition.frames[0]!.assetId);
    expect(visual!.resourceAssetIds).toContain(UNUSED_MEDIA_ASSET_ID);

    // Source-backed Definitions still require FLA provenance and frame media.
    const parsed = FlaGraphicDefinitionSchema.parse(JSON.parse(JSON.stringify(definition)));
    expect(parsed.source.basename).toBe(definition.source.basename);
    const withoutFrameAsset = JSON.parse(JSON.stringify(definition)) as {
      frames: { assetId?: string; sha256?: string }[];
      source: { basename?: string };
    };
    delete withoutFrameAsset.frames[0]!.assetId;
    delete withoutFrameAsset.frames[0]!.sha256;
    expect(FlaGraphicDefinitionSchema.safeParse(withoutFrameAsset).success).toBe(false);
    const withoutSource = JSON.parse(JSON.stringify(definition)) as { source: { basename?: string } };
    delete withoutSource.source.basename;
    expect(FlaGraphicDefinitionSchema.safeParse(withoutSource).success).toBe(false);

    // A native Definition may never claim an external FLA source.
    const nativeWithSource = JSON.parse(JSON.stringify(definition)) as {
      source: { origin?: string };
    };
    nativeWithSource.source.origin = 'native';
    expect(FlaGraphicDefinitionSchema.safeParse(nativeWithSource).success).toBe(false);
  });

  it('renders a native Definition through the existing Stage visual-part path', () => {
    const created = buildCreatedNative();
    const shot = created.project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 250, created.project);
    const layerA = evaluated.layers.find((layer) => layer.id === created.layerAId)!;
    const parts = resolveLayerVisualParts(created.project, shot, layerA, 250);
    expect(parts.flaGraphic?.structureFrame).not.toBeNull();
    expect(parts.parts).toHaveLength(1);
    expect(parts.parts[0]!.source.kind).toBe('animation-frame');
    expect(parts.parts[0]!.assetId).toBeUndefined();
    // Random seeks keep the authored single frame available.
    for (const timeMs of [0, 361, 1_500, 2_999]) {
      const sampled = evaluateShotAtTime(shot, timeMs, created.project);
      const sampledLayer = sampled.layers.find((layer) => layer.id === created.layerBId)!;
      const sampledParts = resolveLayerVisualParts(created.project, shot, sampledLayer, timeMs);
      expect(sampledParts.parts[0]!.flaGraphic?.structureFrame).not.toBeNull();
    }
  });

  it('survives save/reopen serialization and export preparation without new media', () => {
    const created = buildCreatedNative();
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(created.project)));
    const reopenedDefinition = nativeDefinition(reopened, created.animationId);
    expect(isNativeFlaGraphicDefinition(reopenedDefinition)).toBe(true);
    const before = evaluateFlaGraphicVisual({
      definition: nativeDefinition(created.project, created.animationId),
      frameOrdinal: 0,
      mode: 'definition',
    });
    const after = evaluateFlaGraphicVisual({
      definition: reopenedDefinition,
      frameOrdinal: 0,
      mode: 'definition',
    });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));

    // Export preparation only knows the existing project media set.
    const media = collectExportPreparationMedia(reopened);
    const assetIds = new Set(reopened.assets.map((asset) => asset.id));
    expect(media.every((entry) => assetIds.has(entry.asset.id))).toBe(true);
    const exportIssues = evaluateExportPreparationSupport(reopened, 'static');
    expect(exportIssues).toEqual([]);
  });

  it('commits native creation as exactly one undoable project update', () => {
    const fixture = buildSourceGraphicFixture();
    const placed = placeGraphicLayer(fixture.project, fixture.shotId, SOURCE_GRAPHIC_ID);
    const store = new EditorProjectStore();
    store.open('C:\\dummy\\native-graphic', placed.project);
    const layerStore = new LayerStore(
      store,
      { getCurrentShotId: () => fixture.shotId },
      createService(),
      { select: () => undefined },
    );
    const result = layerStore.createNativeGraphicFromSelection({
      shotId: fixture.shotId,
      layerId: placed.layerId,
      frameOrdinal: 0,
      nodePaths: [SOURCE_CIRCLE_PATH, SOURCE_RECT_PATH],
    });
    const afterCreate = store.getSnapshot()!.project;
    expect(afterCreate.animations.some((candidate) => candidate.id === result.animationId))
      .toBe(true);
    const nativeLayer = layerStore.createFromAsset({
      version: 3,
      type: 'animation',
      animationId: result.animationId,
      position: { x: 400, y: 300 },
      startTimeMs: 0,
    });
    expect(nativeLayer.id).toBeTruthy();

    // Undo restores the library entry and the placed instance in order.
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()!.project.shots[0]!.layers.some((layer) => layer.id === nativeLayer.id))
      .toBe(false);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()!.project.animations.some(
      (candidate) => candidate.id === result.animationId,
    )).toBe(false);
  });
});
