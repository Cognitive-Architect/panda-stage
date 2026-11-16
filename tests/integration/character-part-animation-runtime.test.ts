import { describe, expect, it } from 'vitest';
import {
  LayerService, ProjectSchema, evaluateShotAtTime, resolveLayerVisualParts,
  createCharacterPartAnimationClip, transformPointByVisualPart, buildEditorStageRenderModel,
  listShotRuntimeImageAssets, type Project, type FlaGraphicDefinition,
} from '../../src/domain';
import { characterPartAnimationFixture, addTestAnimation } from '../helpers/characterPartAnimationFixture';
import { IDS } from '../unit/domain/testProject';

function visualAt(project: Project, layerId: string, timeMs: number) {
  const shot = project.shots[0]!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find(l => l.id === layerId)!;
  // Timestamp carried by Shot evaluation keeps both animation owners synchronized.
  return resolveLayerVisualParts(project, shot, evaluated);
}

describe('CharacterPart outer motion through the shared visualParts pipeline', () => {
  it('evaluates four Graphic frames and outer rotation at one absolute Shot time, including backward seeks', () => {
    const input = characterPartAnimationFixture();
    const project = addTestAnimation(input.project, input.layerId, input.graphicPartId, 'transform.rotationDeg', 90);
    const before = structuredClone(project);
    const clip = project.shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!;
    const center = clip.fixedCharacterCenter;
    const pivot = clip.targetBases[1]!.pivot;
    const matrices = [];
    for (const [time, ordinal, angle] of [[0, 0, 0], [250, 1, 22.5], [500, 2, 45]] as const) {
      const graphic = visualAt(project, input.layerId, time).parts[1]!;
      expect(graphic.flaGraphic!.frameOrdinal).toBe(ordinal);
      expect(graphic.imageTransform!.a).toBeCloseTo(Math.cos(angle * Math.PI / 180));
      const projectedPivot = transformPointByVisualPart(pivot, graphic);
      expect(projectedPivot.x).toBeCloseTo(670 - center.x);
      expect(projectedPivot.y).toBeCloseTo(280 - center.y);
      matrices.push(graphic.imageTransform);
    }
    expect(matrices[0]).not.toEqual(matrices[1]);
    const at900 = visualAt(project, input.layerId, 900);
    const at250 = visualAt(project, input.layerId, 250);
    expect(visualAt(project, input.layerId, 900)).toEqual(at900);
    for (let index = 0; index < 20; index += 1) expect(visualAt(project, input.layerId, 250)).toEqual(at250);
    expect(project).toEqual(before);
  });
  it('composes nested Graphic transforms under the same outer transform and retains instance overrides', () => {
    const input = characterPartAnimationFixture();
    let project = addTestAnimation(input.project, input.layerId, input.graphicPartId, 'transform.rotationDeg', 90);
    project = addTestAnimation(project, input.layerId, input.graphicPartId, 'transform.scaleX', 2, 1);
    project = addTestAnimation(project, input.layerId, input.graphicPartId, 'transform.scaleY', 0.5, 1);
    const clip = project.shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!;
    const graphic = visualAt(project, input.layerId, 1000).parts[1]!;
    const leaf = graphic.flaGraphic!.layers![0]!.nodes[0]!.children[0]!.children[0]!;
    const nested = leaf.worldTransform;
    const point = { x: nested.a + nested.c * 2 + nested.tx, y: nested.b + nested.d * 2 + nested.ty };
    expect(point).toEqual({ x: 27, y: 67 });
    const final = transformPointByVisualPart(point, graphic);
    expect(final.x).toBeCloseTo(681.5 - clip.fixedCharacterCenter.x);
    expect(final.y).toBeCloseTo(134 - clip.fixedCharacterCenter.y);
    const beforeDefinition = structuredClone(project.animations);
    project = structuredClone(project);
    const source = project.shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!.targetBases[1]!.visualSource;
    if (source.kind !== 'fla-graphic') throw new Error('fixture');
    source.instanceTransformOverrides = { '0': { '["group-0","arm-0","leaf-0"]': { a: 2, b: 0, c: 0, d: 3, tx: 15, ty: 7 } } };
    project = ProjectSchema.parse(project);
    const override = visualAt(project, input.layerId, 1000).parts[1]!;
    const overriddenLeaf = override.flaGraphic!.layers![0]!.nodes[0]!.children[0]!.children[0]!.worldTransform;
    const finalOverride = transformPointByVisualPart({ x: overriddenLeaf.a + 2 * overriddenLeaf.c + overriddenLeaf.tx, y: overriddenLeaf.b + 2 * overriddenLeaf.d + overriddenLeaf.ty }, override);
    expect(finalOverride.x).toBeCloseTo(676.5 - clip.fixedCharacterCenter.x);
    expect(finalOverride.y).toBeCloseTo(134 - clip.fixedCharacterCenter.y);
    expect(project.animations).toEqual(beforeDefinition);
  });
  it('isolates two Layer instances while keeping shared Definition visuals live', () => {
    const input = characterPartAnimationFixture();
    const placedB = new LayerService().createFromAdaptiveCharacter(input.project, IDS.shot, input.characterId, { x: 200, y: 300 });
    const layerB = placedB.layer.id;
    const beforeB = visualAt(placedB.project, layerB, 500);
    let project = addTestAnimation(placedB.project, input.layerId, input.graphicPartId, 'transform.rotationDeg', 90);
    expect(visualAt(project, layerB, 500)).toEqual(beforeB);
    const beforeA = visualAt(project, input.layerId, 500);
    project = addTestAnimation(project, layerB, input.graphicPartId, 'transform.offsetX', 100);
    expect(visualAt(project, input.layerId, 500)).toEqual(beforeA);
    const animatedB = visualAt(project, layerB, 500).parts[1]!;
    expect(animatedB.imageTransform!.a).toBe(1);
    expect(animatedB.imageTransform!.tx).toBeCloseTo(beforeB.parts[1]!.imageTransform!.tx + 50);
    project = structuredClone(project);
    const definition = project.animations[0] as FlaGraphicDefinition;
    const node = definition.structure!.frames[2]!.layers[0]!.nodes[0]!;
    node.localTransform.tx += 99;
    definition.source.canvas.width = 300;
    project = ProjectSchema.parse(project);
    const changedA = visualAt(project, input.layerId, 500).parts[1]!;
    const changedB = visualAt(project, layerB, 500).parts[1]!;
    expect(changedA.flaGraphic!.layers![0]!.nodes[0]!.worldTransform.tx).toBe(109);
    expect(changedB.flaGraphic!.layers![0]!.nodes[0]!.worldTransform.tx).toBe(109);
    expect(changedA.imageTransform).toEqual(beforeA.parts[1]!.imageTransform);
    expect(changedB.imageTransform).toEqual(animatedB.imageTransform);
    expect(project.shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!.targetBases[1]!.pivot.x).toBe(100);
  });
  it('keeps frame-to-canvas fallback mapping under the same pivot, including changing frame bounds', () => {
    const input = characterPartAnimationFixture();
    let project = addTestAnimation(input.project, input.layerId, input.graphicPartId, 'transform.rotationDeg', 90);
    project = structuredClone(project);
    // Preserve structured Definition support while one frame uses the existing raster fallback.
    (project.animations[0] as FlaGraphicDefinition).structure!.frames = (project.animations[0] as FlaGraphicDefinition).structure!.frames.filter(frame => frame.ordinal === 0);
    project = ProjectSchema.parse(project);
    const clip = project.shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!;
    for (const [time, ordinal] of [[250, 1], [500, 2]] as const) {
      const part = visualAt(project, input.layerId, time).parts[1]!;
      expect(part.flaGraphic).toBeUndefined();
      expect(part.assetId).toBe(project.animations[0]!.frames[ordinal]!.assetId);
      const frame = project.animations[0]!.frames[ordinal]!;
      const pixelPivot = { x: 100 - frame.offset.x, y: 90 - frame.offset.y };
      const point = transformPointByVisualPart(pixelPivot, part);
      expect(point.x).toBeCloseTo(670 - clip.fixedCharacterCenter.x);
      expect(point.y).toBeCloseTo(280 - clip.fixedCharacterCenter.y);
    }
  });
  it('preserves frozen resource references after Library source replacement, and shares the Stage projection', () => {
    const input = characterPartAnimationFixture();
    const project = addTestAnimation(input.project, input.layerId, input.graphicPartId, 'transform.rotationDeg', 90);
    const character = project.characters.find(c => c.id === input.characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('fixture');
    character.parts = [character.parts[0]!];
    expect(listShotRuntimeImageAssets(project, project.shots[0]!).map(asset => asset.id)).toContain(IDS.assetChar2);
    const stage = buildEditorStageRenderModel(project, project.shots[0]!);
    expect(stage.layers.find(l => l.layer.id === input.layerId)!.visual).toEqual(visualAt(project, input.layerId, 0));
    const clip = createCharacterPartAnimationClip(project, IDS.shot, input.layerId);
    expect(clip.targetBases).toHaveLength(2);
    const evaluated = evaluateShotAtTime(project.shots[0]!, 500, project).layers.find(l => l.id === input.layerId)!;
    expect(() => resolveLayerVisualParts(project, project.shots[0]!, { ...evaluated, animationValues: [] })).toThrow(/complete Shot-time/);
  });
});
