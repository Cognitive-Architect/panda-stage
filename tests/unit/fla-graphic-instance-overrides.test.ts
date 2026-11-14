import { describe, expect, it } from 'vitest';
import {
  FlaGraphicStructureSchema,
  LayerService,
  ProjectSchema,
  evaluateFlaGraphicInstanceTransform,
  flaGraphicInstanceNodePathKey,
  pruneFlaGraphicInstanceTransformOverrides,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
  type Project,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

const PARENT_PATH = ['group-a'];
const CHILD_PATH = ['group-a', 'bitmap-a'];
const AUTHORED_CHILD: AffineMatrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 12,
  ty: 8,
};
const MOVED_ROTATED_SCALED_CHILD: AffineMatrix2D = {
  a: 0,
  b: 1.5,
  c: -0.75,
  d: 0,
  tx: 35,
  ty: 20,
};
const REPLACEMENT_ANIMATION_ID = '70000000-0000-4000-8000-000000000003';
const FLA_FRAME_ASSET_ID = '10000000-0000-4000-8000-000000000004';

function graphicStructure(): FlaGraphicStructure {
  const group: FlaGraphicStructureNode = {
    type: 'group',
    id: PARENT_PATH[0]!,
    drawOrder: 0,
    localTransform: { a: 3, b: 0, c: 0, d: 4, tx: 100, ty: 120 },
    groupId: 'group-a',
    children: [
      {
        type: 'bitmap',
        id: 'bitmap-a',
        drawOrder: 0,
        localTransform: AUTHORED_CHILD,
        bitmapRef: 'Library/part.png',
        assetId: IDS.assetChar,
      },
      {
        type: 'opaque',
        id: 'opaque-a',
        drawOrder: 1,
        localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        opaqueKind: 'text',
      },
    ],
  };
  return FlaGraphicStructureSchema.parse({
    version: 1,
    frames: [
      { ordinal: 0, layers: [{ name: 'Body', nodes: [group] }] },
      {
        ordinal: 1,
        layers: [{
          name: 'Body',
          nodes: [{
            type: 'bitmap',
            id: 'frame-one-bitmap',
            drawOrder: 0,
            localTransform: AUTHORED_CHILD,
            bitmapRef: 'Library/part.png',
            assetId: IDS.assetChar,
          }],
        }],
      },
    ],
  });
}

function graphicProject(): {
  project: Project;
  shotId: string;
  layerId: string;
  service: LayerService;
  structure: FlaGraphicStructure;
} {
  const base = buildProjectWithAnimation();
  const animation = base.animations[0]!;
  const structure = graphicStructure();
  const frameAsset = {
    id: FLA_FRAME_ASSET_ID,
    kind: 'image' as const,
    name: 'Graphic frame',
    relativePath: 'assets/graphic-frame.svg',
    mimeType: 'image/svg+xml',
    sha256: 'e'.repeat(64),
    width: 640,
    height: 640,
    usage: 'uncategorized' as const,
    keywords: [],
    flaGraphicFrame: { definitionId: animation.id, ordinal: 0 },
  };
  const graphicDefinition = {
    ...animation,
    kind: 'fla-graphic' as const,
    durationMs: 40,
    source: { ...animation.source, endFrameIndex: animation.source.startFrameIndex },
    frames: [{
      ...animation.frames[0]!,
      assetId: frameAsset.id,
      sha256: frameAsset.sha256,
      createdBySequenceImport: false,
    }],
    structure,
  };
  const replacementDefinition = {
    ...animation,
    id: REPLACEMENT_ANIMATION_ID,
    name: 'replacement graphic',
  };
  const project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, frameAsset],
    animations: [graphicDefinition, replacementDefinition],
  });
  const service = new LayerService();
  const shotId = project.shots[0]!.id;
  const created = service.createFromAsset(project, shotId, {
    version: 3,
    type: 'animation',
    animationId: graphicDefinition.id,
    position: { x: 900, y: 500 },
    startTimeMs: 0,
  });
  return {
    project: created.project,
    shotId,
    layerId: created.layer.id,
    service,
    structure,
  };
}

function layerFor(project: Project, shotId: string, layerId: string) {
  return project.shots.find((shot) => shot.id === shotId)!.layers.find(
    (layer) => layer.id === layerId,
  )!;
}

describe('FLA Graphic per-instance transform overrides', () => {
  it('round-trips sparse overrides and keeps older projects without the field valid', () => {
    const { project, shotId, layerId, service } = graphicProject();
    expect(layerFor(project, shotId, layerId)).not.toHaveProperty(
      'flaGraphicInstanceTransformOverrides',
    );

    const saved = service.updateFlaGraphicInstanceTransform(
      project,
      shotId,
      layerId,
      0,
      CHILD_PATH,
      MOVED_ROTATED_SCALED_CHILD,
    );
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(saved)));
    const reopenedLayer = layerFor(reopened, shotId, layerId);
    expect(reopenedLayer.flaGraphicInstanceTransformOverrides).toEqual({
      '0': {
        [flaGraphicInstanceNodePathKey(CHILD_PATH)]: MOVED_ROTATED_SCALED_CHILD,
      },
    });
    expect(reopened.animations[0]).toEqual(project.animations[0]);
  });

  it('evaluates the instance matrix over immutable authored Definition data', () => {
    const { project, shotId, layerId, service } = graphicProject();
    const saved = service.updateFlaGraphicInstanceTransform(
      project,
      shotId,
      layerId,
      0,
      CHILD_PATH,
      MOVED_ROTATED_SCALED_CHILD,
    );
    const layer = layerFor(saved, shotId, layerId);
    const definition = saved.animations[0]!;
    if (!('structure' in definition) || !definition.structure) {
      throw new Error('Expected the FLA Graphic Definition structure.');
    }
    const node = definition.structure.frames[0]!.layers[0]!.nodes[0]!;
    const child = node.type === 'group' ? node.children[0]! : null;
    if (!child) throw new Error('Expected the nested bitmap node.');

    expect(evaluateFlaGraphicInstanceTransform(
      child.localTransform,
      layer.flaGraphicInstanceTransformOverrides,
      0,
      CHILD_PATH,
    )).toEqual(MOVED_ROTATED_SCALED_CHILD);
    expect(child.localTransform).toEqual(AUTHORED_CHILD);
    expect(evaluateFlaGraphicInstanceTransform(
      child.localTransform,
      layer.flaGraphicInstanceTransformOverrides,
      1,
      CHILD_PATH,
    )).toEqual(AUTHORED_CHILD);
  });

  it('commits one Project history entry and restores the override immediately on undo and redo', () => {
    const { project, shotId, layerId, service } = graphicProject();
    const editor = new EditorProjectStore();
    editor.open('D:\\PandaStage-Acceptance\\graphic-overrides.pandastage', project);
    const layerStore = new LayerStore(
      editor,
      { getCurrentShotId: () => shotId },
      service,
    );

    layerStore.updateFlaGraphicInstanceTransform(
      layerId,
      0,
      CHILD_PATH,
      MOVED_ROTATED_SCALED_CHILD,
    );
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, revision: 1 });
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      nextUndoLabel: 'Edit Graphic instance',
    });
    expect(layerFor(editor.getSnapshot()!.project, shotId, layerId)
      .flaGraphicInstanceTransformOverrides).toBeDefined();

    expect(editor.undo()).toBe(true);
    const undoneLayer = layerFor(editor.getSnapshot()!.project, shotId, layerId);
    expect(undoneLayer)
      .not.toHaveProperty('flaGraphicInstanceTransformOverrides');
    expect(evaluateFlaGraphicInstanceTransform(
      AUTHORED_CHILD,
      undoneLayer.flaGraphicInstanceTransformOverrides,
      0,
      CHILD_PATH,
    )).toEqual(AUTHORED_CHILD);
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 1 });

    expect(editor.redo()).toBe(true);
    const redoneLayer = layerFor(editor.getSnapshot()!.project, shotId, layerId);
    expect(evaluateFlaGraphicInstanceTransform(
      AUTHORED_CHILD,
      redoneLayer.flaGraphicInstanceTransformOverrides,
      0,
      CHILD_PATH,
    )).toEqual(MOVED_ROTATED_SCALED_CHILD);
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
  });

  it('prunes no-op entries without a Project change and keeps separate layer instances isolated', () => {
    const { project, shotId, layerId, service } = graphicProject();
    expect(service.updateFlaGraphicInstanceTransform(
      project,
      shotId,
      layerId,
      0,
      CHILD_PATH,
      AUTHORED_CHILD,
    )).toBe(project);

    const changed = service.updateFlaGraphicInstanceTransform(
      project,
      shotId,
      layerId,
      0,
      CHILD_PATH,
      MOVED_ROTATED_SCALED_CHILD,
    );
    expect(service.updateFlaGraphicInstanceTransform(
      changed,
      shotId,
      layerId,
      0,
      CHILD_PATH,
      MOVED_ROTATED_SCALED_CHILD,
    )).toBe(changed);
    const restored = service.updateFlaGraphicInstanceTransform(
      changed,
      shotId,
      layerId,
      0,
      CHILD_PATH,
      AUTHORED_CHILD,
    );
    expect(layerFor(restored, shotId, layerId))
      .not.toHaveProperty('flaGraphicInstanceTransformOverrides');

    const fresh = service.createFromAsset(changed, shotId, {
      version: 3,
      type: 'animation',
      animationId: IDS.animation,
      position: { x: 920, y: 500 },
      startTimeMs: 0,
    });
    expect(fresh.layer).not.toHaveProperty('flaGraphicInstanceTransformOverrides');
    expect(layerFor(fresh.project, shotId, fresh.layer.id))
      .not.toHaveProperty('flaGraphicInstanceTransformOverrides');
    expect(layerFor(fresh.project, shotId, layerId)
      .flaGraphicInstanceTransformOverrides).toBeDefined();
  });

  it('duplicates overrides as independent values and removes them with the Layer', () => {
    const { project, shotId, layerId, service } = graphicProject();
    const changed = service.updateFlaGraphicInstanceTransform(
      project,
      shotId,
      layerId,
      0,
      CHILD_PATH,
      MOVED_ROTATED_SCALED_CHILD,
    );
    const duplicated = service.duplicateAnimationLayer(changed, shotId, layerId);
    const originalOverrides = layerFor(
      duplicated.project,
      shotId,
      layerId,
    ).flaGraphicInstanceTransformOverrides!;
    const duplicateOverrides = duplicated.layer.flaGraphicInstanceTransformOverrides!;
    expect(duplicateOverrides).toEqual(originalOverrides);
    expect(duplicateOverrides).not.toBe(originalOverrides);
    expect(duplicateOverrides['0']).not.toBe(originalOverrides['0']);

    const duplicateChanged = service.updateFlaGraphicInstanceTransform(
      duplicated.project,
      shotId,
      duplicated.layer.id,
      0,
      CHILD_PATH,
      { ...MOVED_ROTATED_SCALED_CHILD, tx: 99 },
    );
    expect(layerFor(duplicateChanged, shotId, layerId)
      .flaGraphicInstanceTransformOverrides?.['0']?.[
        flaGraphicInstanceNodePathKey(CHILD_PATH)
      ]).toEqual(MOVED_ROTATED_SCALED_CHILD);
    const deleted = service.deleteLayer(duplicateChanged, shotId, duplicated.layer.id);
    expect(deleted.shots[0]!.layers.some((layer) => layer.id === duplicated.layer.id)).toBe(false);
    expect(layerFor(deleted, shotId, layerId)
      .flaGraphicInstanceTransformOverrides).toBeDefined();
  });

  it('clears overrides on source replacement and prunes only stale paths after structure changes', () => {
    const { project, shotId, layerId, service, structure } = graphicProject();
    const changed = service.updateFlaGraphicInstanceTransform(
      project,
      shotId,
      layerId,
      0,
      CHILD_PATH,
      MOVED_ROTATED_SCALED_CHILD,
    );
    const editor = new EditorProjectStore();
    editor.open('D:\\PandaStage-Acceptance\\graphic-source-replacement.pandastage', changed);
    const replacedSource = {
      ...changed,
      shots: changed.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) => layer.id === layerId
          ? { ...layer, source: { kind: 'animation' as const, animationId: REPLACEMENT_ANIMATION_ID } }
          : layer),
      })),
    };
    editor.updateProject(replacedSource, 'Replace animation source');
    expect(layerFor(editor.getSnapshot()!.project, shotId, layerId))
      .not.toHaveProperty('flaGraphicInstanceTransformOverrides');
    expect(editor.history.getSnapshot().undoCount).toBe(1);

    const staleOverrides = {
      '0': {
        [flaGraphicInstanceNodePathKey(CHILD_PATH)]: MOVED_ROTATED_SCALED_CHILD,
        [flaGraphicInstanceNodePathKey(['missing-node'])]: MOVED_ROTATED_SCALED_CHILD,
        [flaGraphicInstanceNodePathKey([...PARENT_PATH, 'opaque-a'])]: MOVED_ROTATED_SCALED_CHILD,
      },
      '99': { [flaGraphicInstanceNodePathKey(['old-frame-node'])]: MOVED_ROTATED_SCALED_CHILD },
    };
    const pruned = pruneFlaGraphicInstanceTransformOverrides(staleOverrides, structure);
    expect(pruned).toEqual({
      '0': {
        [flaGraphicInstanceNodePathKey(CHILD_PATH)]: MOVED_ROTATED_SCALED_CHILD,
      },
    });

    const withFrameOneOverride = service.updateFlaGraphicInstanceTransform(
      changed,
      shotId,
      layerId,
      1,
      ['frame-one-bitmap'],
      { ...MOVED_ROTATED_SCALED_CHILD, tx: 64 },
    );
    const outerGroup = structure.frames[0]!.layers[0]!.nodes[0]!;
    if (outerGroup.type !== 'group') throw new Error('Expected the outer Group.');
    const nextGroup: FlaGraphicStructureNode = {
      ...outerGroup,
      children: outerGroup.children
        .filter((node) => node.id !== 'bitmap-a')
        .map((node, drawOrder) => ({ ...node, drawOrder })),
    };
    const nextStructure = FlaGraphicStructureSchema.parse({
      ...structure,
      frames: structure.frames.map((frame) => frame.ordinal === 0
        ? {
            ...frame,
            layers: frame.layers.map((layer) => ({
              ...layer,
              nodes: layer.nodes.map((node) => node.id === outerGroup.id ? nextGroup : node),
            })),
          }
        : frame),
    });
    const structureEditor = new EditorProjectStore();
    structureEditor.open('D:\\PandaStage-Acceptance\\graphic-structure-update.pandastage', withFrameOneOverride);
    structureEditor.updateProject({
      ...withFrameOneOverride,
      animations: withFrameOneOverride.animations.map((animation) =>
        animation.id === IDS.animation && 'kind' in animation && animation.kind === 'fla-graphic'
          ? { ...animation, structure: nextStructure }
          : animation,
      ),
    }, 'Update Graphic structure');
    expect(layerFor(structureEditor.getSnapshot()!.project, shotId, layerId)
      .flaGraphicInstanceTransformOverrides).toEqual({
      '1': {
        [flaGraphicInstanceNodePathKey(['frame-one-bitmap'])]: {
          ...MOVED_ROTATED_SCALED_CHILD,
          tx: 64,
        },
      },
    });
  });

  it('ignores stale path lookups without changing the authored fallback', () => {
    const { structure } = graphicProject();
    expect(evaluateFlaGraphicInstanceTransform(
      AUTHORED_CHILD,
      { '0': { [flaGraphicInstanceNodePathKey(['stale'])]: MOVED_ROTATED_SCALED_CHILD } },
      0,
      CHILD_PATH,
    )).toEqual(AUTHORED_CHILD);
    expect(FlaGraphicStructureSchema.parse(structure)).toEqual(structure);
  });
});
