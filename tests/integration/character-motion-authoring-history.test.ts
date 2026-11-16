import { describe, expect, it } from 'vitest';
import { LayerService, evaluateShotAtTime, resolveLayerVisualParts } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { CharacterMotionGesture } from '../../src/renderer/features/canvas/characterMotionGesture';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { IDS } from '../unit/domain/testProject';

describe('Character Motion authoring integration', () => {
  it('keeps shared Definition playback and the second instance intact through author/Undo/Redo', () => {
    const fixture = characterPartAnimationFixture();
    const placed = new LayerService().createFromAdaptiveCharacter(fixture.project, IDS.shot, fixture.characterId, { x: 400, y: 400 });
    const editor = new EditorProjectStore(); editor.open('D:/test-motion-integration', placed.project);
    const before = editor.getSnapshot()!.project;
    const visual = (layerId: string, timeMs: number) => {
      const project = editor.getSnapshot()!.project, shot = project.shots[0]!;
      return resolveLayerVisualParts(project, shot, evaluateShotAtTime(shot, timeMs, project).layers.find(l => l.id === layerId)!, timeMs);
    };
    const secondVisual = visual(placed.layer.id, 500);
    new CharacterMotionGesture(editor, { shotId: IDS.shot, layerId: fixture.layerId, partId: fixture.graphicPartId, timeMs: 500, autoKey: true }, () => true).commit({ 'transform.rotationDeg': 90 });
    const after = editor.getSnapshot()!.project;
    expect(after.animations).toEqual(before.animations);
    expect(after.characters).toEqual(before.characters);
    expect(after.shots[0]!.layers.find(l => l.id === placed.layer.id)).toEqual(before.shots[0]!.layers.find(l => l.id === placed.layer.id));
    expect(visual(placed.layer.id, 500)).toEqual(secondVisual);
    expect([0, 250, 500].map(time => visual(fixture.layerId, time).parts[1]!.flaGraphic!.frameOrdinal)).toEqual([0, 1, 2]);
    const authoredVisual = visual(fixture.layerId, 500);
    expect(authoredVisual.parts[1]!.imageTransform!.a).toBeCloseTo(0);
    editor.undo(); expect(editor.getSnapshot()!.project).toEqual(before);
    editor.redo(); expect(editor.getSnapshot()!.project).toEqual(after);
    expect(visual(fixture.layerId, 500)).toEqual(authoredVisual);
  });
});
