import { describe, expect, it } from 'vitest';
import { CharacterService, DialogueService, LayerService, PROJECT_SCHEMA_VERSION, ProjectSchema, ProjectV19Schema, migrateProject, evaluateShotAtTime, projectShotDialogueVisual, resolveShotVisualParts, scanAssetReferences, type Project } from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import { resolveEditorTemporalAssetResolution } from '../../src/renderer/features/canvas/temporalVisualContinuity';
import { applyProductPreviewMouthFallback, buildProductPreviewImagePlan } from '../../src/renderer/shell/productPreviewModel';
import { resolveCharacterFaceSource } from '../../src/domain/selectors/characterFaceSource';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { buildCharacterAssemblyPreviewVisual } from '../../src/renderer/features/characters/characterAssemblyPreview';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { CharacterStore } from '../../src/renderer/stores/characterStore';
import { graphicFaceProject, faceSource } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';
import historicalV18 from '../fixtures/project-v18-character-dialogue.json';

const service = new CharacterService();
function graphicProject() {
  let project = service.setExpressionVisualSource(graphicFaceProject(), IDS.character, IDS.expressionNormal, faceSource(0));
  project = service.setExpressionVisualSource(project, IDS.character, IDS.expressionAngry, faceSource(1));
  return service.setMouthOpenVisualSource(project, IDS.character, faceSource(3));
}
function visual(project: Project, mouthOpen = false) {
  const shot = project.shots[0]!;
  const evaluated = evaluateShotAtTime(shot, 0, project);
  if (mouthOpen) evaluated.layers = evaluated.layers.map(layer => ({ ...layer, mouthOpen: true }));
  return resolveShotVisualParts(project, shot, evaluated).find(layer => layer.ownerLayerId === IDS.layerChar)!;
}

describe('Graphic expressions and mouth single-frame selection (#1112)', () => {
  it('maps zero-based firstFrame to true ordinal, independent of source timeline start', () => {
    const project = graphicProject();
    expect(resolveCharacterFaceSource(project, faceSource(0)).flaGraphic?.frameOrdinal).toBe(0);
    expect(resolveCharacterFaceSource(project, faceSource(1)).flaGraphic?.frameOrdinal).toBe(1);
    for (const index of [-1, 1.5, 4, 999]) expect(() => resolveCharacterFaceSource(project, faceSource(index))).toThrow();
    expect(() => service.setExpressionVisualSource(project, IDS.character, IDS.expressionNormal, { ...faceSource(0), animationId: IDS.animation })).toThrow();
  });
  it('keeps Graphic defaults free of fake PNG identity, and restores image constraints on replacement', () => {
    const project = graphicProject();
    const character = project.characters[0]!;
    expect(character).not.toHaveProperty('baseAssetId');
    expect(character).toHaveProperty('expressions.0.visualSource', faceSource(0));
    expect(ProjectSchema.safeParse({ ...project, schemaVersion: 19 }).success).toBe(false);
    expect(ProjectV19Schema.safeParse({ ...project, schemaVersion: 19 }).success).toBe(false);
    const image = service.setExpressionAsset(project, IDS.character, IDS.expressionNormal, IDS.assetChar);
    expect(image.characters[0]).toHaveProperty('baseAssetId', IDS.assetChar);
    expect(image.characters[0]).not.toHaveProperty('expressions.0.visualSource');
    expect(ProjectSchema.safeParse({ ...image, characters: [{ ...image.characters[0], baseAssetId: IDS.assetChar2 }] }).success).toBe(false);
  });
  it('isolates expressions/instances and restores the selected formal frame when mouth closes', () => {
    let project = graphicProject();
    const definition = JSON.stringify(project.animations);
    const added = new LayerService().createFromAsset(project, IDS.shot, { version: 2, type: 'character-expression', characterId: IDS.character, expressionId: IDS.expressionAngry, position: { x: 400, y: 500 } });
    project = added.project;
    const shot = project.shots[0]!;
    const normal = resolveShotVisualParts(project, shot, evaluateShotAtTime(shot, 0, project));
    expect(normal.find(layer => layer.ownerLayerId === IDS.layerChar)?.parts[0]?.flaGraphic?.frameOrdinal).toBe(0);
    expect(normal.find(layer => layer.ownerLayerId === added.layer.id)?.parts[0]?.flaGraphic?.frameOrdinal).toBe(1);
    expect(visual(project, true).parts[0]?.flaGraphic?.frameOrdinal).toBe(3);
    expect(visual(project).parts[0]?.flaGraphic?.frameOrdinal).toBe(0);
    expect(JSON.stringify(project.animations)).toBe(definition);
    const stage = buildStageRenderModel(project, evaluateShotAtTime(shot, 0, project), Object.fromEntries(project.assets.map(asset => [asset.id, 'file:///' + asset.relativePath])));
    expect(stage.layers.find(layer => layer.id === IDS.layerChar)?.parts[0]?.flaGraphic?.frameOrdinal).toBe(0);
  });
  it('keeps the full Definition pivot when the selected frame uses a cropped SVG fallback', () => {
    let project = graphicFaceProject(false);
    project = service.setExpressionVisualSource(project, IDS.character, IDS.expressionNormal, faceSource(1));
    const part = visual(project).parts[0]!;
    expect(part.assetId).toBe(project.animations[0]!.frames[1]!.assetId);
    expect(part.flaGraphic).toBeUndefined();
    expect(part.imageTransform).toMatchObject({ a: 1, d: 1, tx: -95, ty: -82 });
    expect(scanAssetReferences(project, part.assetId!)).not.toHaveLength(0);
  });
  it('preserves Graphic bindings when applying a composite placement update', () => {
    let project = graphicProject();
    project = ProjectSchema.parse({ ...project, characters: [{ ...project.characters[0], mode: 'composite', bodyAssetId: IDS.assetChar, bodyPlacement: { offsetX: 0, offsetY: 0, scale: 1 }, facePlacement: { offsetX: 12, offsetY: -20, scale: 0.5 } }] });
    project = service.setFacePlacement(project, IDS.character, { offsetX: 30, offsetY: -10, scale: 0.6, rotationDeg: 15, flipX: true });
    const draft = service.getCompositeDefinition(project, IDS.character);
    expect(draft.expressionAssets[0]?.visualSource).toEqual(faceSource(0));
    expect(draft.mouthOpenVisualSource).toEqual(faceSource(3));
    const preview = buildCharacterAssemblyPreviewVisual(project, { kind: 'edit', characterId: IDS.character, draft } as Parameters<typeof buildCharacterAssemblyPreviewVisual>[1], { kind: 'mouth' });
    expect(preview?.parts.find(part => part.slot === 'face')?.flaGraphic?.frameOrdinal).toBe(3);
    project = service.setMouthOpenAsset(project, IDS.character, IDS.assetChar);
    project = service.applyCompositeUpdate(project, IDS.character, { mouthOpenVisualSource: faceSource(2) });
    expect(project.characters[0]).not.toHaveProperty('mouthOpenAssetId');
    expect(project.characters[0]).toHaveProperty('mouthOpenVisualSource', faceSource(2));
  });
  it('upgrades genuine v19 images without injecting or rewriting face/audio/narrator data', () => {
    const historical = { ...structuredClone(historicalV18), schemaVersion: 19 };
    expect(ProjectV19Schema.safeParse(historical).success).toBe(true);
    expect(migrateProject(historical)).toEqual({ ...historical, schemaVersion: PROJECT_SCHEMA_VERSION });
    expect(() => migrateProject({ ...graphicProject(), schemaVersion: 19 })).toThrow();
  });
  it('routes Graphic source edits through existing project history', () => {
    const editor = new EditorProjectStore();
    editor.open('D:\\acceptance\\project', graphicFaceProject());
    const store = new CharacterStore(editor, service);
    store.setExpressionVisualSource(IDS.character, IDS.expressionNormal, faceSource(1));
    store.setMouthOpenVisualSource(IDS.character, faceSource(3));
    expect(editor.getSnapshot()?.project.characters[0]).toHaveProperty('mouthOpenVisualSource', faceSource(3));
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()?.project.characters[0]).not.toHaveProperty('mouthOpenVisualSource');
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()?.project.characters[0]).toHaveProperty('baseAssetId', IDS.assetChar);
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()?.project.characters[0]).toHaveProperty('expressions.0.visualSource', faceSource(1));
  });
  it('shares audio-bound Graphic mouth projection, expression timeline, export dependencies and failure recovery', () => {
    const audioId = 'a0000000-0000-4000-8000-000000001112';
    let project = graphicProject();
    project = ProjectSchema.parse({ ...project, assets: [...project.assets, { id: audioId, kind: 'audio', name: 'tone', relativePath: 'assets/tone.wav', mimeType: 'audio/wav', durationMs: 3000 }], shots: project.shots.map(shot => ({ ...shot, timelineEvents: [{ id: 'b0000000-0000-4000-8000-000000001112', layerId: IDS.layerChar, type: 'expression', expressionId: IDS.expressionAngry, startMs: 500, endMs: 500 }] })) });
    const dialogue = new DialogueService();
    project = dialogue.create(project, { shotId: IDS.shot, characterId: IDS.character, text: 'Graphic mouth', pointTimeMs: 0 });
    const dialogueId = project.shots[0]!.dialogues[0]!.id;
    project = dialogue.setTiming(project, { shotId: IDS.shot, dialogueId, startMs: 0, endMs: 3000 });
    project = dialogue.bindAudio(project, { shotId: IDS.shot, dialogueId, assetId: audioId });
    const shot = project.shots[0]!;
    const evaluated = (time: number) => projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, time, project));
    const faceAt = (time: number) => resolveShotVisualParts(project, shot, evaluated(time)).find(layer => layer.ownerLayerId === IDS.layerChar)!.parts[0]!;
    expect(faceAt(0).flaGraphic?.frameOrdinal).toBe(3);
    expect(faceAt(200).flaGraphic?.frameOrdinal).toBe(0);
    expect(faceAt(600).flaGraphic?.frameOrdinal).toBe(1);
    expect(faceAt(640).flaGraphic?.frameOrdinal).toBe(3);
    const media = new Set(collectExportPreparationMedia(project).map(entry => entry.asset.id));
    expect(media.has(IDS.assetChar)).toBe(true);
    expect(media.has(IDS.assetChar2)).toBe(true);
    expect(media.has(audioId)).toBe(true);
    // The mouth uses the second bitmap, while the expression can still load.
    const continuity = resolveEditorTemporalAssetResolution(project, shot, evaluated(0), new Set([IDS.assetBg, IDS.assetChar]), new Map(), undefined, new Set([IDS.assetChar2]));
    expect(continuity.visualsByLayer.get(IDS.layerChar)?.parts[0]?.flaGraphic?.frameOrdinal).toBe(0);
    const plan = buildProductPreviewImagePlan(project, shot, evaluated(0));
    expect(plan.mouthFallbacks.some(rule => rule.sourceAssetId === IDS.assetChar2 && rule.fallbackAssetIds?.includes(IDS.assetChar))).toBe(true);
    const degraded = applyProductPreviewMouthFallback(project, shot, evaluated(0), new Set([IDS.assetChar2]));
    expect(resolveShotVisualParts(project, shot, degraded).find(layer => layer.ownerLayerId === IDS.layerChar)?.parts[0]?.flaGraphic?.frameOrdinal).toBe(0);
    expect(scanAssetReferences(project, IDS.assetChar2).some(reference => reference.kind === 'character-mouth')).toBe(true);
    expect(() => ProjectSchema.parse({ ...project, animations: [] })).toThrow();
  });
});
