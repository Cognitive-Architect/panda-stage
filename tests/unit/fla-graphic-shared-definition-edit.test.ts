import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FlaGraphicStructureSchema,
  LayerService,
  ProjectSchema,
  evaluateFlaGraphicVisual,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type Project,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { CanvasToolbar } from '../../src/renderer/features/canvas/CanvasToolbar';
import {
  recordFlaGraphicEditDraft,
  resolveFlaGraphicEditTarget,
  resolveFlaGraphicExitScopeTransition,
} from '../../src/renderer/features/canvas/flaGraphicEditScope';
import { evaluateFlaGraphicProjectionVisual } from '../../src/renderer/features/canvas/FlaGraphicStructureProjection';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

const FLA_FRAME_ASSET_ID = '10000000-0000-4000-8000-000000000004';
const AUTHORED_ARM: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 };
const UPDATED_ARM: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 55, ty: -12 };
const OVERRIDE_ARM: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 99, ty: 77 };
const NESTED_DEF_ID = 'symdef_shared_hand_internal_01';

function sharedStructure(): FlaGraphicStructure {
  return FlaGraphicStructureSchema.parse({
    version: 1,
    symbolDefinitions: {
      [NESTED_DEF_ID]: {
        symbolRef: 'Library/Hand',
        children: [
          {
            type: 'bitmap',
            id: 'hand-bmp',
            drawOrder: 0,
            localTransform: AUTHORED_ARM,
            bitmapRef: 'Library/hand.png',
            assetId: IDS.assetChar,
          },
        ],
      },
    },
    frames: [
      {
        ordinal: 0,
        layers: [
          {
            name: 'Body',
            nodes: [
              {
                type: 'group',
                id: 'group-a',
                drawOrder: 0,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                groupId: 'group-a',
                children: [
                  {
                    type: 'bitmap',
                    id: 'bitmap-a',
                    drawOrder: 0,
                    localTransform: AUTHORED_ARM,
                    bitmapRef: 'Library/arm.png',
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
              },
              {
                type: 'symbol',
                id: 'sym-left',
                drawOrder: 1,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: -30, ty: 0 },
                symbolRef: 'Library/Hand',
                nestedDefinitionId: NESTED_DEF_ID,
              },
              {
                type: 'symbol',
                id: 'sym-right',
                drawOrder: 2,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 30, ty: 0 },
                symbolRef: 'Library/Hand',
                nestedDefinitionId: NESTED_DEF_ID,
              },
              {
                type: 'symbol',
                id: 'sym-stale',
                drawOrder: 3,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 60, ty: 0 },
                symbolRef: 'Library/Missing',
                nestedDefinitionId: 'symdef_missing_stale',
              },
            ],
          },
        ],
      },
      {
        ordinal: 1,
        layers: [
          {
            name: 'Body',
            nodes: [
              {
                type: 'bitmap',
                id: 'frame1-arm',
                drawOrder: 0,
                localTransform: AUTHORED_ARM,
                bitmapRef: 'Library/arm.png',
                assetId: IDS.assetChar,
              },
            ],
          },
        ],
      },
    ],
  });
}

function twoInstanceGraphicProject(): {
  project: Project;
  shotId: string;
  layerAId: string;
  layerBId: string;
  service: LayerService;
} {
  const base = buildProjectWithAnimation();
  const animation = base.animations[0]!;
  const structure = sharedStructure();
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
  const flaGraphic: FlaGraphicDefinition = {
    ...animation,
    kind: 'fla-graphic' as const,
    durationMs: 80,
    source: {
      ...animation.source,
      endFrameIndex: animation.source.startFrameIndex + 1,
    },
    frames: [
      {
        ...animation.frames[0]!,
        ordinal: 0,
        assetId: frameAsset.id,
        sha256: frameAsset.sha256,
        createdBySequenceImport: false,
      },
      {
        ...animation.frames[0]!,
        ordinal: 1,
        sourceFrameIndex: animation.frames[0]!.sourceFrameIndex + 1,
        startMs: animation.frames[0]!.startMs + animation.frames[0]!.durationMs,
        assetId: frameAsset.id,
        sha256: frameAsset.sha256,
        createdBySequenceImport: false,
      },
    ],
    structure,
  };

  let project: Project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, frameAsset],
    animations: [flaGraphic],
  });
  const service = new LayerService();
  const shotId = project.shots[0]!.id;
  const createdA = service.createFromAsset(project, shotId, {
    version: 3,
    type: 'animation',
    animationId: flaGraphic.id,
    position: { x: 400, y: 300 },
    startTimeMs: 0,
  });
  project = createdA.project;
  const createdB = service.createFromAsset(project, shotId, {
    version: 3,
    type: 'animation',
    animationId: flaGraphic.id,
    position: { x: 900, y: 300 },
    startTimeMs: 0,
  });
  project = createdB.project;
  return {
    project,
    shotId,
    layerAId: createdA.layer.id,
    layerBId: createdB.layer.id,
    service,
  };
}

function getDefinition(project: Project): FlaGraphicDefinition {
  return project.animations[0] as FlaGraphicDefinition;
}

function getLayer(project: Project, shotId: string, layerId: string) {
  return project.shots
    .find((s) => s.id === shotId)!
    .layers.find((l) => l.id === layerId)!;
}

function findEvaluatedNodeTransform(
  definition: FlaGraphicDefinition,
  frameOrdinal: number,
  targetPath: readonly string[],
  mode: 'definition' | 'instance',
  overrides?: Project['shots'][number]['layers'][number]['flaGraphicInstanceTransformOverrides'],
): AffineMatrix2D | null {
  const evaluated = evaluateFlaGraphicVisual({
    definition,
    frameOrdinal,
    mode,
    instanceTransformOverrides: overrides,
  });
  if (!evaluated?.layers) return null;
  const visit = (nodes: typeof evaluated.layers[number]['nodes']): AffineMatrix2D | null => {
    for (const node of nodes) {
      if (
        node.path.length === targetPath.length &&
        node.path.every((part, idx) => part === targetPath[idx])
      ) {
        return node.localTransform;
      }
      const nested = visit(node.children);
      if (nested) return nested;
    }
    return null;
  };
  return visit(evaluated.layers.flatMap((l) => l.nodes));
}

describe('FLA Graphic Shared Definition Editing (E5)', () => {
  it('updates root shared definition, syncs non-overridden instances, preserves overrides, and avoids layer fan-out writes', () => {
    const { project: initial, shotId, layerAId, layerBId, service } =
      twoInstanceGraphicProject();

    // Give layerB an explicit instance override on ['group-a', 'bitmap-a'].
    const withOverride = service.updateFlaGraphicInstanceTransform(
      initial,
      shotId,
      layerBId,
      0,
      ['group-a', 'bitmap-a'],
      OVERRIDE_ARM,
    );

    // Edit shared definition via layerA.
    const sharedEdited = service.updateFlaGraphicSharedDefinitionTransform(
      withOverride,
      shotId,
      layerAId,
      0,
      ['group-a', 'bitmap-a'],
      UPDATED_ARM,
    );

    // No Layer fan-out writes: shots/layers stay untouched.
    expect(sharedEdited.shots).toBe(withOverride.shots);
    expect(getLayer(sharedEdited, shotId, layerAId).flaGraphicInstanceTransformOverrides).toBeUndefined();
    expect(getLayer(sharedEdited, shotId, layerBId).flaGraphicInstanceTransformOverrides).toEqual(
      getLayer(withOverride, shotId, layerBId).flaGraphicInstanceTransformOverrides,
    );

    const def = getDefinition(sharedEdited);
    // Definition preview & non-overridden layerA reflect UPDATED_ARM.
    expect(findEvaluatedNodeTransform(def, 0, ['group-a', 'bitmap-a'], 'definition')).toEqual(
      UPDATED_ARM,
    );
    expect(
      findEvaluatedNodeTransform(
        def,
        0,
        ['group-a', 'bitmap-a'],
        'instance',
        getLayer(sharedEdited, shotId, layerAId).flaGraphicInstanceTransformOverrides,
      ),
    ).toEqual(UPDATED_ARM);

    // Overridden layerB keeps OVERRIDE_ARM over shared UPDATED_ARM.
    expect(
      findEvaluatedNodeTransform(
        def,
        0,
        ['group-a', 'bitmap-a'],
        'instance',
        getLayer(sharedEdited, shotId, layerBId).flaGraphicInstanceTransformOverrides,
      ),
    ).toEqual(OVERRIDE_ARM);

    // Frame boundary: frameOrdinal 1 is untouched.
    expect(findEvaluatedNodeTransform(def, 1, ['group-a', 'bitmap-a'], 'definition')).toBeNull();
    expect(findEvaluatedNodeTransform(def, 1, ['frame1-arm'], 'definition')).toEqual(AUTHORED_ARM);
  });

  it('updates nested symbolDefinitions once so all referencing symbol instances sync, and locally forbids stale nestedDefinitionId', () => {
    const { project, shotId, layerAId, service } = twoInstanceGraphicProject();

    const edited = service.updateFlaGraphicSharedDefinitionTransform(
      project,
      shotId,
      layerAId,
      0,
      ['sym-left', 'hand-bmp'],
      UPDATED_ARM,
    );
    const def = getDefinition(edited);
    expect(def.structure?.symbolDefinitions?.[NESTED_DEF_ID]?.children[0]?.localTransform).toEqual(
      UPDATED_ARM,
    );
    // Both sym-left and sym-right immediately reflect the updated hand-bmp transform!
    expect(findEvaluatedNodeTransform(def, 0, ['sym-left', 'hand-bmp'], 'definition')).toEqual(
      UPDATED_ARM,
    );
    expect(findEvaluatedNodeTransform(def, 0, ['sym-right', 'hand-bmp'], 'definition')).toEqual(
      UPDATED_ARM,
    );

    // Stale/missing nestedDefinitionId is a safe no-op without fail-closing the rest of the definition.
    const staleAttempt = service.updateFlaGraphicSharedDefinitionTransform(
      edited,
      shotId,
      layerAId,
      0,
      ['sym-stale', 'missing-child'],
      OVERRIDE_ARM,
    );
    expect(staleAttempt).toBe(edited);
  });

  it('commits one History entry without leaking internal nestedDefinitionId, supports Undo/Redo & Save/Reload, and ignores opaque/no-op edits', () => {
    const { project, shotId, layerAId, service } = twoInstanceGraphicProject();
    const editor = new EditorProjectStore();
    editor.open('D:\\PandaStage-Acceptance\\shared-def.pandastage', project);
    const layerStore = new LayerStore(
      editor,
      { getCurrentShotId: () => shotId },
      service,
    );

    // Opaque guard: no-op, 0 History entries.
    layerStore.updateFlaGraphicSharedDefinitionTransform(
      layerAId,
      0,
      ['group-a', 'opaque-a'],
      UPDATED_ARM,
    );
    expect(editor.history.getSnapshot().undoCount).toBe(0);

    // Same-matrix no-op: 0 History entries.
    layerStore.updateFlaGraphicSharedDefinitionTransform(
      layerAId,
      0,
      ['sym-left', 'hand-bmp'],
      AUTHORED_ARM,
    );
    expect(editor.history.getSnapshot().undoCount).toBe(0);

    // Real commit: exactly 1 History entry, label does not expose NESTED_DEF_ID.
    layerStore.updateFlaGraphicSharedDefinitionTransform(
      layerAId,
      0,
      ['sym-left', 'hand-bmp'],
      UPDATED_ARM,
    );
    const historySnap = editor.history.getSnapshot();
    expect(historySnap.undoCount).toBe(1);
    expect(historySnap.nextUndoLabel).toBe('编辑共享元件');
    expect(historySnap.nextUndoLabel).not.toContain(NESTED_DEF_ID);

    // Undo restores authored transform; Redo re-applies.
    expect(editor.undo()).toBe(true);
    expect(
      findEvaluatedNodeTransform(
        getDefinition(editor.getSnapshot()!.project),
        0,
        ['sym-right', 'hand-bmp'],
        'definition',
      ),
    ).toEqual(AUTHORED_ARM);

    expect(editor.redo()).toBe(true);
    expect(
      findEvaluatedNodeTransform(
        getDefinition(editor.getSnapshot()!.project),
        0,
        ['sym-right', 'hand-bmp'],
        'definition',
      ),
    ).toEqual(UPDATED_ARM);

    // Save/Reload round-trip via ProjectSchema.
    const saved = editor.getSnapshot()!.project;
    const reloaded = ProjectSchema.parse(JSON.parse(JSON.stringify(saved)));
    expect(
      findEvaluatedNodeTransform(
        getDefinition(reloaded),
        0,
        ['sym-right', 'hand-bmp'],
        'definition',
      ),
    ).toEqual(UPDATED_ARM);
    expect(getLayer(reloaded, shotId, layerAId).flaGraphicInstanceTransformOverrides).toBeUndefined();
  });

  it('exposes explicit Instance vs Shared Definition UI entries, compact shared indicator, and preserves sessionKey across definition commits', () => {
    const viewportTransform = {
      mode: 'fit' as const,
      container: { width: 1280, height: 720 },
      logical: { width: 1920, height: 1080 },
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      displayWidth: 1920,
      displayHeight: 1080,
      contentWidth: 1920,
      contentHeight: 1080,
    };
    const idleMarkup = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        mode: 'fit',
        point: null,
        transform: viewportTransform,
        flaGraphicEditAvailable: true,
        flaGraphicEditActive: false,
      }),
    );
    expect(idleMarkup).toContain('data-testid="fla-group-edit-toggle"');
    expect(idleMarkup).toContain('编辑元件');
    expect(idleMarkup).toContain('data-testid="fla-shared-definition-edit-toggle"');
    expect(idleMarkup).toContain('编辑共享元件');

    const sharedActiveMarkup = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        mode: 'fit',
        point: null,
        transform: viewportTransform,
        flaGraphicEditAvailable: true,
        flaGraphicEditActive: true,
        flaGraphicEditMode: 'definition',
      }),
    );
    expect(sharedActiveMarkup).toContain('data-testid="fla-shared-definition-badge"');
    expect(sharedActiveMarkup).toContain('共享');
    expect(sharedActiveMarkup).not.toContain(NESTED_DEF_ID);

    // Target sessionKey stays stable across definition edits while target.key tracks structure revision.
    const { project, shotId, layerAId, service } = twoInstanceGraphicProject();
    const targetBefore = resolveFlaGraphicEditTarget({
      project,
      projectRoot: 'D:\\PandaStage-Acceptance\\shared-def',
      projectInstanceId: 1,
      shot: project.shots[0]!,
      layerId: layerAId,
    })!;
    const edited = service.updateFlaGraphicSharedDefinitionTransform(
      project,
      shotId,
      layerAId,
      0,
      ['sym-left', 'hand-bmp'],
      UPDATED_ARM,
    );
    const targetAfter = resolveFlaGraphicEditTarget({
      project: edited,
      projectRoot: 'D:\\PandaStage-Acceptance\\shared-def',
      projectInstanceId: 1,
      shot: edited.shots[0]!,
      layerId: layerAId,
    })!;
    expect(targetAfter.sessionKey).toBe(targetBefore.sessionKey);
    expect(targetAfter.key).not.toBe(targetBefore.key);

    // Exit scope pops nested symbol -> parent -> exits cleanly.
    const popNested = resolveFlaGraphicExitScopeTransition(
      targetAfter.frame,
      ['sym-left'],
      targetAfter.animation.structure,
    );
    expect(popNested).toEqual({
      nextScopePath: [],
      nextSelectedNodePath: ['sym-left'],
    });
  });

  it('fans out transient shared drafts to all nested symbol occurrences in real time without mutating Project or History, while keeping Instance Edit isolated', () => {
    const { project: base, shotId, layerAId, service } = twoInstanceGraphicProject();
    // Give layerA an instance override so we also verify override isolation during shared preview.
    const withOverride = service.updateFlaGraphicInstanceTransform(
      base,
      shotId,
      layerAId,
      0,
      ['sym-left', 'hand-bmp'],
      OVERRIDE_ARM,
    );
    const editor = new EditorProjectStore();
    editor.open('D:\\PandaStage-Acceptance\\shared-draft.pandastage', withOverride);
    const layerStore = new LayerStore(
      editor,
      { getCurrentShotId: () => shotId },
      service,
    );

    const defBefore = getDefinition(editor.getSnapshot()!.project);
    const layerOverridesBefore = getLayer(
      editor.getSnapshot()!.project,
      shotId,
      layerAId,
    ).flaGraphicInstanceTransformOverrides;

    const findTransformInVisual = (
      visual: ReturnType<typeof evaluateFlaGraphicProjectionVisual>,
      targetPath: readonly string[],
    ): AffineMatrix2D | null => {
      if (!visual?.layers) return null;
      const visit = (nodes: typeof visual.layers[number]['nodes']): AffineMatrix2D | null => {
        for (const node of nodes) {
          if (
            node.path.length === targetPath.length &&
            node.path.every((part, idx) => part === targetPath[idx])
          ) {
            return node.localTransform;
          }
          const nested = visit(node.children);
          if (nested) return nested;
        }
        return null;
      };
      return visit(visual.layers.flatMap((l) => l.nodes));
    };

    // 1. Nested shared draft fan-out + override isolation (before commit).
    const nestedDrafts = recordFlaGraphicEditDraft(
      {},
      'target-a',
      ['sym-left', 'hand-bmp'],
      UPDATED_ARM,
    )['target-a']!;
    const sharedPreview = evaluateFlaGraphicProjectionVisual({
      definition: defBefore,
      frameOrdinal: 0,
      editMode: 'definition',
      instanceTransformOverrides: layerOverridesBefore,
      draftMatrices: nestedDrafts,
    });
    expect(findTransformInVisual(sharedPreview, ['sym-left', 'hand-bmp'])).toEqual(UPDATED_ARM);
    expect(findTransformInVisual(sharedPreview, ['sym-right', 'hand-bmp'])).toEqual(UPDATED_ARM);

    // 2. No Project or History mutation during draft.
    expect(getDefinition(editor.getSnapshot()!.project)).toBe(defBefore);
    expect(editor.history.getSnapshot().undoCount).toBe(0);

    // 3. Instance Edit regression: instance draft affects ONLY sym-left, not sym-right.
    const instancePreview = evaluateFlaGraphicProjectionVisual({
      definition: defBefore,
      frameOrdinal: 0,
      editMode: 'instance',
      instanceTransformOverrides: layerOverridesBefore,
      draftMatrices: nestedDrafts,
    });
    expect(findTransformInVisual(instancePreview, ['sym-left', 'hand-bmp'])).toEqual(UPDATED_ARM);
    expect(findTransformInVisual(instancePreview, ['sym-right', 'hand-bmp'])).toEqual(AUTHORED_ARM);

    // 4. Root Definition shared draft regression & Read-only opaque guard.
    const rootAndOpaqueDrafts = recordFlaGraphicEditDraft(
      recordFlaGraphicEditDraft({}, 'target-a', ['group-a', 'bitmap-a'], UPDATED_ARM),
      'target-a',
      ['group-a', 'opaque-a'],
      UPDATED_ARM,
    )['target-a']!;
    const rootPreview = evaluateFlaGraphicProjectionVisual({
      definition: defBefore,
      frameOrdinal: 0,
      editMode: 'definition',
      instanceTransformOverrides: layerOverridesBefore,
      draftMatrices: rootAndOpaqueDrafts,
    });
    expect(findTransformInVisual(rootPreview, ['group-a', 'bitmap-a'])).toEqual(UPDATED_ARM);
    expect(findTransformInVisual(rootPreview, ['group-a', 'opaque-a'])).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      tx: 0,
      ty: 0,
    });

    // 5. Commit parity: committed definition matches shared preview with 1 History entry.
    layerStore.updateFlaGraphicSharedDefinitionTransform(
      layerAId,
      0,
      ['sym-left', 'hand-bmp'],
      UPDATED_ARM,
    );
    expect(editor.history.getSnapshot().undoCount).toBe(1);
    const committedView = evaluateFlaGraphicProjectionVisual({
      definition: getDefinition(editor.getSnapshot()!.project),
      frameOrdinal: 0,
      editMode: 'definition',
      draftMatrices: {},
    });
    expect(findTransformInVisual(committedView, ['sym-left', 'hand-bmp'])).toEqual(
      findTransformInVisual(sharedPreview, ['sym-left', 'hand-bmp']),
    );
    expect(findTransformInVisual(committedView, ['sym-right', 'hand-bmp'])).toEqual(
      findTransformInVisual(sharedPreview, ['sym-right', 'hand-bmp']),
    );
  });
});
