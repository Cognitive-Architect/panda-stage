import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CharacterMotionService, LayerService, ShotService, ProjectSchema,
  evaluateShotAtTime, resolveLayerVisualParts, projectShotDialogueVisual, type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { buildProductPreviewImagePlan } from '../../src/renderer/shell/productPreviewModel';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { IDS } from '../unit/domain/testProject';
import { animationV0UatFixture } from '../helpers/animationV0UatFixture';

function authoredFixture() {
  const fixture = characterPartAnimationFixture();
  const placed = new LayerService().createFromAdaptiveCharacter(fixture.project, IDS.shot, fixture.characterId, { x: 400, y: 400 });
  const authoring = new CharacterMotionService();
  let project = authoring.apply(placed.project, { shotId: IDS.shot, layerId: fixture.layerId, partId: fixture.graphicPartId, timeMs: 500, autoKey: true }, {
    'transform.rotationDeg': 90, 'transform.offsetX': 30, 'transform.scaleX': 1.5, 'transform.scaleY': 1.5,
  });
  project = authoring.apply(project, { shotId: IDS.shot, layerId: fixture.layerId, partId: fixture.imagePartId, timeMs: 500, autoKey: true }, { 'transform.rotationDeg': 270 });
  project = authoring.apply(project, { shotId: IDS.shot, layerId: placed.layer.id, partId: fixture.graphicPartId, timeMs: 500, autoKey: true }, { 'transform.offsetY': -80 });
  const basis = project.shots[0]!.layers.find(l => l.id === fixture.layerId)!.animationClip!.targetBases[1]!;
  if (basis.visualSource.kind !== 'fla-graphic') throw new Error('fixture');
  basis.visualSource.instanceTransformOverrides = { '2': { '["group-2","arm-2","leaf-2"]': { a: 2, b: 0, c: 0, d: 3, tx: 15, ty: 7 } } };
  return { ...fixture, project: ProjectSchema.parse(project), secondLayerId: placed.layer.id };
}
function at(project: Project, time: number) {
  const shot = project.shots[0]!;
  return evaluateShotAtTime(shot, time, project).layers.map(layer => resolveLayerVisualParts(project, shot, layer, time));
}

describe('V0-04 persistence, isolation and same-time production seams', () => {
  it('preserves two nested Symbol levels and loop/play-once/single-frame clocks under outer motion', () => {
    const fixture = animationV0UatFixture(true);
    const project = ProjectSchema.parse(JSON.parse(JSON.stringify(fixture.project)));
    const definition = project.animations[0]!;
    if (!('kind' in definition) || definition.kind !== 'fla-graphic') throw new Error('fixture');
    expect(Object.keys(definition.structure!.symbolDefinitions!).length).toBeGreaterThanOrEqual(2);
    for (const time of [0, 250, 500, 900]) {
      const shot = project.shots[0]!;
      const editor = buildEditorTemporalCanvasModel({ project, shot, currentTimeMs: time, readyAssetIds: new Set(project.assets.map(a => a.id)), previousVisuals: new Map() });
      const exported = buildStageRenderModel(project, evaluateExportShotAtTime(project, shot, time), Object.fromEntries(project.assets.map(a => [a.id, `test:${a.id}`])));
      expect(exported.layers.map(l => l.visual)).toEqual(editor.stageModel.layers.map(l => l.visual));
      const visual = at(project, time).find(v => v.ownerLayerId === fixture.layerId)!.parts[1]!.flaGraphic!;
      const symbols = visual.layers![0]!.nodes;
      expect(symbols.map(s => s.source.type === 'symbol' ? s.source.playbackMode : null)).toEqual(['loop', 'play once', 'single frame']);
      expect(symbols.every(s => s.children[0]!.children[0]!.source.type === 'bitmap')).toBe(true);
      const expectedFrames: Record<number, number[]> = { 0: [2, 2, 2], 250: [3, 3, 2], 500: [0, 0, 2], 900: [1, 0, 2] };
      expect(symbols.map(s => {
        const source = s.children[0]!.children[0]!.source;
        return source.type === 'bitmap' ? source.bitmapRef : null;
      })).toEqual(expectedFrames[time]!.map(frame => `frame-${frame}`));
      for (let count = 0; count < 20; count++) expect(at(project, time)).toEqual(at(fixture.project, time));
    }
  });
  it('saves/reopens authored Image/Graphic clips without resnapshotting, with deterministic seek and independent overrides', async () => {
    const fixture = authoredFixture(), before = fixture.project;
    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-v004-'));
    try {
      const root = path.join(parent, 'acceptance.pandastage'); await mkdir(root);
      const initial = structuredClone(before);
      initial.shots.forEach(shot => shot.layers.forEach(layer => { delete layer.animationClip; }));
      await writeFile(path.join(root, 'project.json'), JSON.stringify(initial));
      await new ProjectService().save(root, before, 1);
      const reopened = (await new ProjectService().open(root)).project;
      expect(reopened).toEqual(before);
      expect(reopened.shots[0]!.layers.find(l => l.id === fixture.layerId)!.animationClip).toEqual(before.shots[0]!.layers.find(l => l.id === fixture.layerId)!.animationClip);
      const expected = at(before, 500);
      for (let index = 0; index < 20; index++) expect(at(reopened, 500)).toEqual(expected);
      const seek900 = at(reopened, 900); at(reopened, 250); expect(at(reopened, 900)).toEqual(seek900);
      const first = expected.find(v => v.ownerLayerId === fixture.layerId)!, second = expected.find(v => v.ownerLayerId === fixture.secondLayerId)!;
      expect(first.parts[1]!.imageTransform).not.toEqual(second.parts[1]!.imageTransform);
      expect(first.parts[1]!.flaGraphic!.layers![0]!.nodes[0]!.children[0]!.children[0]!.localTransform.tx).toBe(15);
      expect(second.parts[1]!.flaGraphic!.layers![0]!.nodes[0]!.children[0]!.children[0]!.localTransform.tx).toBe(5);
      const updated = structuredClone(reopened);
      const definition = updated.animations[0]!;
      if (!('kind' in definition) || definition.kind !== 'fla-graphic') throw new Error('fixture');
      definition.structure!.frames[2]!.layers[0]!.nodes[0]!.localTransform.tx += 60;
      const changed = at(ProjectSchema.parse(updated), 500);
      for (const layerId of [fixture.layerId, fixture.secondLayerId]) {
        expect(changed.find(v => v.ownerLayerId === layerId)!.parts[1]!.flaGraphic!.layers![0]!.nodes[0]!.worldTransform.tx).toBe(70);
        expect(updated.shots[0]!.layers.find(l => l.id === layerId)!.animationClip).toEqual(reopened.shots[0]!.layers.find(l => l.id === layerId)!.animationClip);
      }
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it.each([0, 250, 500])('Editor Stage / Product Preview / Export agree on matrix, frame, override and geometry at %sms', time => {
    const { project } = authoredFixture(), shot = project.shots[0]!;
    const editor = buildEditorTemporalCanvasModel({ project, shot, currentTimeMs: time, readyAssetIds: new Set(project.assets.map(a => a.id)), previousVisuals: new Map() });
    const previewShot = projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, time, project), null);
    expect(() => buildProductPreviewImagePlan(project, shot, previewShot)).not.toThrow();
    const urls = Object.fromEntries(project.assets.map(a => [a.id, `test:${a.id}`]));
    const preview = buildStageRenderModel(project, previewShot, urls);
    const exported = buildStageRenderModel(project, evaluateExportShotAtTime(project, shot, time), urls);
    expect(preview.layers.map(l => l.visual)).toEqual(editor.stageModel.layers.map(l => l.visual));
    expect(exported.layers.map(l => l.visual)).toEqual(preview.layers.map(l => l.visual));
    expect(exported.layers.map(l => l.parts)).toEqual(preview.layers.map(l => l.parts));
  });
  it('duplicates the existing Shot including clips with remapped Layer identity and independent subsequent editing', () => {
    const fixture = authoredFixture();
    const copied = new ShotService().duplicate(fixture.project, IDS.shot);
    const duplicate = copied.shots[1]!;
    const originalLayer = fixture.project.shots[0]!.layers.find(l => l.id === fixture.layerId)!;
    const layer = duplicate.layers.find(l => l.name === originalLayer.name)!;
    expect(layer.id).not.toBe(originalLayer.id);
    expect(layer.animationClip!.targetBases.every(b => b.target.layerId === layer.id)).toBe(true);
    expect(layer.animationClip!.tracks.every(t => t.target.layerId === layer.id)).toBe(true);
    expect(layer.animationClip!.tracks.map(t => t.keys)).toEqual(originalLayer.animationClip!.tracks.map(t => t.keys));
    const edited = new CharacterMotionService().apply(copied, { shotId: duplicate.id, layerId: layer.id, partId: fixture.graphicPartId, timeMs: 500, autoKey: true }, { 'transform.rotationDeg': -90 });
    expect(edited.shots[0]).toEqual(fixture.project.shots[0]);
    expect(edited.shots[1]).not.toEqual(copied.shots[1]);
  });
});
