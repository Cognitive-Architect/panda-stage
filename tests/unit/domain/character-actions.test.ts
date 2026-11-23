import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  CharacterSchema,
  CharacterActionSchema,
  ProjectSchema,
  ProjectV27Schema,
  migrateProject,
  PROJECT_SCHEMA_VERSION,
  evaluateShotAtTime,
  resolveLayerVisualParts,
  upsertCharacterActionEvent,
  deleteCharacterActionEvent,
  ShotService,
  listCharacterActionVisualAssetIds,
  buildEditorStageRenderModel,
} from '../../../src/domain';
import { projectProductPreviewDialogue } from '../../../src/renderer/shell/productPreviewModel';
import { evaluateExportShotAtTime } from '../../../src/export-renderer/evaluateExportShotAtTime';
import { buildStageRenderModel } from '../../../src/shared/stage/render-model';
import { characterActionGraphicFixture } from '../../helpers/characterActionGraphicFixture';
import { buildProject, buildProjectWithAnimation, IDS } from './testProject';

const action = {
  id: '71000000-0000-4000-8000-000000000001',
  name: '挥手',
  animationId: IDS.animation,
  placement: { offsetX: 0, offsetY: 0, scale: 1 },
};

describe('Character actions', () => {
  it('stores a stable named link to an existing animation shape', () => {
    const parsed = CharacterActionSchema.parse(action);
    expect(parsed).toEqual(action);

    const character = CharacterSchema.parse({
      ...buildProject().characters[0],
      actions: [parsed],
    });
    expect(character.actions).toEqual([action]);
  });

  it('rejects duplicate action ids and names on one character', () => {
    const character = buildProject().characters[0]!;
    expect(CharacterSchema.safeParse({
      ...character,
      actions: [action, { ...action, id: '71000000-0000-4000-8000-000000000002' }],
    }).success).toBe(false);
    expect(CharacterSchema.safeParse({
      ...character,
      actions: [action, { ...action, id: '71000000-0000-4000-8000-000000000002', name: ' 挥手 ' }],
    }).success).toBe(false);
  });

  it('saves and renames an action while preserving its id and animation reference', () => {
    const service = new CharacterService({
      createId: () => action.id,
      now: () => new Date('2026-11-23T00:00:00.000Z'),
    });
    const project = buildProjectWithAnimation();
    const saved = service.setAction(project, IDS.character, {
      name: '挥手',
      animationId: IDS.animation,
    });
    const savedAction = saved.characters[0]!.actions?.[0];
    expect(savedAction).toMatchObject(action);

    const renamed = service.setAction(saved, IDS.character, {
      ...savedAction!,
      name: '招手',
    });
    expect(renamed.characters[0]!.actions).toEqual([
      { ...action, name: '招手' },
    ]);
  });

  it('prevents deleting an action that a shot event still uses', () => {
    const service = new CharacterService({ createId: () => action.id });
    const project = service.setAction(buildProjectWithAnimation(), IDS.character, {
      name: '挥手',
      animationId: IDS.animation,
    });
    const shot = project.shots[0]!;
    const withEvent = {
      ...project,
      shots: [{
        ...shot,
        timelineEvents: [{
          id: '72000000-0000-4000-8000-000000000001',
          type: 'character-action' as const,
          layerId: IDS.layerChar,
          startMs: 500,
          endMs: 900,
          actionId: action.id,
        }],
      }],
    };

    expect(() => service.removeAction(withEvent, IDS.character, action.id))
      .toThrow('仍被 1 段镜头动作使用');
  });

  it('validates bounded action events and rejects overlap on one layer', () => {
    const project = new CharacterService({ createId: () => action.id }).setAction(
      buildProjectWithAnimation(), IDS.character, { name: action.name, animationId: action.animationId },
    );
    const shot = project.shots[0]!;
    const event = {
      id: '72000000-0000-4000-8000-000000000001',
      type: 'character-action' as const,
      layerId: IDS.layerChar,
      startMs: 500,
      endMs: 900,
      actionId: action.id,
    };
    expect(ProjectSchema.safeParse({
      ...project,
      shots: [{ ...shot, timelineEvents: [event] }],
    }).success).toBe(true);
    expect(ProjectSchema.safeParse({
      ...project,
      shots: [{ ...shot, timelineEvents: [event, { ...event, id: '72000000-0000-4000-8000-000000000002', startMs: 899 }] }],
    }).success).toBe(false);
    expect(ProjectSchema.safeParse({
      ...project,
      shots: [{ ...shot, timelineEvents: [event, { ...event, id: '72000000-0000-4000-8000-000000000002', startMs: 900, endMs: 1_100 }] }],
    }).success).toBe(true);
  });

  it('migrates frozen v27 projects to the current action schema', () => {
    const legacy = { ...buildProjectWithAnimation(), schemaVersion: 27 };
    expect(ProjectV27Schema.safeParse(legacy).success).toBe(true);
    const migrated = migrateProject(legacy);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.characters[0]!.actions).toBeUndefined();
  });

  it('plays once on the existing character layer and restores at the exact end', () => {
    const service = new CharacterService({ createId: () => action.id });
    const authored = service.setAction(buildProjectWithAnimation(), IDS.character, {
      name: action.name,
      animationId: action.animationId,
      placement: { offsetX: 12, offsetY: 6, scale: 1.5 },
    });
    const shot = authored.shots[0]!;
    const project = ProjectSchema.parse({
      ...authored,
      shots: [{
        ...shot,
        timelineEvents: [{
          id: '72000000-0000-4000-8000-000000000001',
          type: 'character-action',
          layerId: IDS.layerChar,
          startMs: 500,
          endMs: 2_500,
          actionId: action.id,
        }],
      }],
    });
    const reopened = migrateProject(JSON.parse(JSON.stringify(project)) as unknown);
    expect(reopened.characters[0]!.actions).toEqual(project.characters[0]!.actions);
    expect(reopened.shots[0]!.timelineEvents).toEqual(project.shots[0]!.timelineEvents);
    const resolvedShot = project.shots[0]!;
    const active = evaluateShotAtTime(resolvedShot, 500, project).layers.find((layer) => layer.id === IDS.layerChar)!;
    expect(active.characterAction?.id).toBe(action.id);
    expect(active.animationFrame).toMatchObject({ animationId: IDS.animation, frameOrdinal: 0 });
    expect(resolveLayerVisualParts(project, resolvedShot, active, 500)).toMatchObject({
      ownerLayerId: IDS.layerChar,
      kind: 'ordinary-image',
      parts: [{ ownerLayerId: IDS.layerChar, source: { kind: 'animation-frame', animationId: IDS.animation } }],
    });
    const directVisual = resolveLayerVisualParts(project, resolvedShot, active, 500);
    const stageVisual = buildEditorStageRenderModel(
      project, resolvedShot, { shotId: resolvedShot.id, timeMs: 500, backgroundLayerId: null,
        layers: evaluateShotAtTime(resolvedShot, 500, project).layers },
    ).layers.find((entry) => entry.layer.id === IDS.layerChar)?.visual;
    const previewLayer = projectProductPreviewDialogue(project, resolvedShot,
      evaluateShotAtTime(resolvedShot, 500, project)).layers.find((entry) => entry.id === IDS.layerChar)!;
    const exportLayer = evaluateExportShotAtTime(project, resolvedShot, 500)
      .layers.find((entry) => entry.id === IDS.layerChar)!;
    expect(stageVisual).toEqual(directVisual);
    expect(resolveLayerVisualParts(project, resolvedShot, previewLayer, 500)).toEqual(directVisual);
    expect(resolveLayerVisualParts(project, resolvedShot, exportLayer, 500)).toEqual(directVisual);

    const held = evaluateShotAtTime(resolvedShot, 2_000, project).layers.find((layer) => layer.id === IDS.layerChar)!;
    expect(held.animationFrame?.frameOrdinal).toBe(20);
    expect(held.animationFrame?.internalTimeMs).toBe(839);

    const restored = evaluateShotAtTime(resolvedShot, 2_500, project).layers.find((layer) => layer.id === IDS.layerChar)!;
    expect(restored.characterAction).toBeUndefined();
    expect(restored.currentExpressionId).toBe(IDS.expressionNormal);
    expect(resolveLayerVisualParts(project, resolvedShot, restored, 2_500).kind).toBe('single-image-character');
  });

  it('authors non-overlapping intervals and remaps the occurrence when duplicating a shot', () => {
    const authored = new CharacterService({ createId: () => action.id }).setAction(
      buildProjectWithAnimation(), IDS.character, { name: action.name, animationId: action.animationId },
    );
    const withEvent = upsertCharacterActionEvent(authored, IDS.shot, IDS.layerChar, {
      actionId: action.id, startMs: 500, endMs: 1_000,
    }, () => '72000000-0000-4000-8000-000000000001');
    const originalEvent = withEvent.shots[0]!.timelineEvents[0]!;
    expect(() => upsertCharacterActionEvent(withEvent, IDS.shot, IDS.layerChar, {
      actionId: action.id, startMs: 900, endMs: 1_200,
    })).toThrow('不能重叠');
    const adjacent = upsertCharacterActionEvent(withEvent, IDS.shot, IDS.layerChar, {
      actionId: action.id, startMs: 1_000, endMs: 1_500,
    }, () => '72000000-0000-4000-8000-000000000002');
    expect(adjacent.shots[0]!.timelineEvents).toHaveLength(2);

    const duplicated = new ShotService().duplicate(withEvent, IDS.shot);
    const copiedShot = duplicated.shots.find((candidate) => candidate.id !== IDS.shot)!;
    const copiedEvent = copiedShot.timelineEvents[0]!;
    expect(copiedEvent).toMatchObject({ type: 'character-action', actionId: action.id });
    expect(copiedEvent.layerId).not.toBe(originalEvent.layerId);
    expect(copiedShot.layers.find((layer) => layer.id === copiedEvent.layerId)?.source)
      .toMatchObject({ kind: 'character', characterId: IDS.character });
    expect(listCharacterActionVisualAssetIds(withEvent, withEvent.shots[0]!))
      .toContain(IDS.assetChar);

    const removed = deleteCharacterActionEvent(withEvent, IDS.shot, IDS.layerChar, originalEvent.id);
    expect(removed.shots[0]!.timelineEvents).toHaveLength(0);
  });

  it('renders calibrated geometry and holds the terminal nested pose across all three surfaces', () => {
    const project = characterActionGraphicFixture();
    const shot = project.shots[0]!;
    const original = structuredClone(shot.layers.find((layer) => layer.id === IDS.layerChar)!);
    const second = { ...original, id: '72000000-0000-4000-8000-000000000003', x: 1000, zIndex: 99 };
    shot.layers.push(second);
    const assetUrls = Object.fromEntries(project.assets.map((asset) => [asset.id, 'file:///' + asset.relativePath]));
    expect(listCharacterActionVisualAssetIds(project, shot)).toContain(IDS.assetChar2);

    // Seek out of order, including the exclusive end and the held section.
    for (const [timeMs, handX] of [[1_000, 100], [250, 0], [1_250, null], [500, 50], [0, null], [750, 100]] as const) {
      const evaluated = evaluateShotAtTime(shot, timeMs, project);
      const editor = buildEditorStageRenderModel(project, shot, evaluated).layers.find((entry) => entry.layer.id === original.id)!;
      const preview = buildStageRenderModel(project, projectProductPreviewDialogue(project, shot, evaluated), assetUrls);
      const output = buildStageRenderModel(project, evaluateExportShotAtTime(project, shot, timeMs), assetUrls);
      const expectedGeometry = handX === null
        ? { x: 600, y: 400, scaleX: -1, scaleY: 1, rotationDeg: 90 }
        : { x: 588, y: 376, scaleX: -1.5, scaleY: 1.5, rotationDeg: 90 };
      for (const entry of [
        editor, preview.layers.find((layer) => layer.id === original.id)!,
        output.layers.find((layer) => layer.id === original.id)!,
      ]) {
        expect(entry.render).toMatchObject({ id: original.id, ...expectedGeometry });
        if (handX === null) {
          expect(entry.visual?.kind).toBe('single-image-character');
          continue;
        }
        expect(entry.visual?.kind).toBe('fla-graphic');
        expect(entry.visual?.parts).toHaveLength(1);
        const hand = entry.visual?.flaGraphic?.layers?.[0]?.nodes[0]?.children?.[0];
        expect(hand?.worldTransform.tx).toBeCloseTo(handX);
      }
      expect(output.layers).toHaveLength(shot.layers.length);
      expect(output.layers.find((layer) => layer.id === second.id)?.visual?.kind).toBe('single-image-character');
    }
    expect(shot.layers.find((layer) => layer.id === original.id)).toEqual(original);
  });

  it('keeps a static one-frame Graphic on its resting pose until the action ends', () => {
    const project = characterActionGraphicFixture(false);
    const shot = project.shots[0]!;
    const held = evaluateShotAtTime(shot, 1_000, project).layers.find((layer) => layer.id === IDS.layerChar)!;
    const visual = resolveLayerVisualParts(project, shot, held, 1_000);
    expect(held.animationFrame?.frameOrdinal).toBe(0);
    expect(visual.flaGraphic?.layers?.[0]?.nodes[0]?.children?.[0]?.worldTransform.tx).toBe(0);
  });

  it('applies action calibration to a live Position draft even with a cached visual', () => {
    const project = characterActionGraphicFixture();
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 500, project);
    const layer = evaluated.layers.find((entry) => entry.id === IDS.layerChar)!;
    const cached = resolveLayerVisualParts(project, shot, layer, 500);
    layer.x += 40;
    layer.y += 20;
    const rendered = buildEditorStageRenderModel(project, shot, evaluated, new Map([[layer.id, cached]]));
    expect(rendered.layers.find((entry) => entry.layer.id === layer.id)?.render)
      .toMatchObject({ x: 628, y: 396, scaleX: -1.5, scaleY: 1.5 });
  });
});
