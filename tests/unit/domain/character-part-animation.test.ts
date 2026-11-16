import { describe, expect, it } from 'vitest';
import {
  createCharacterPartAnimationClip, resolveCharacterPartAnimationBasis,
  recalibrateCharacterPartAnimationPivot, composeAnimatedCharacterPartTransform,
  evaluateAnimationClipAtTime, evaluateShotAtTime, resolveLayerVisualParts,
  adaptiveCharacterSourceAnchor, transformPointByVisualPart, ProjectSchema,
} from '../../../src/domain';
import { characterPartAnimationFixture, addTestAnimation } from '../../helpers/characterPartAnimationFixture';
import { IDS } from './testProject';

describe('CharacterPart Animation Basis and pivot lifecycle', () => {
  it('captures minimal mixed-source bases and the existing stable center without mutating Project', () => {
    const { project, layerId, characterId } = characterPartAnimationFixture();
    const before = structuredClone(project);
    const clip = createCharacterPartAnimationClip(project, IDS.shot, layerId);
    const character = project.characters.find(entry => entry.id === characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('fixture');
    expect(clip.fixedCharacterCenter).toEqual(adaptiveCharacterSourceAnchor(project, character));
    expect(clip.targetBases[0]!.pivot).toEqual({ space: 'target-local', x: 260, y: 240 });
    expect(clip.targetBases[1]!.pivot).toEqual({ space: 'target-local', x: 100, y: 90 });
    expect(clip.targetBases[1]!.visualSource).toEqual({ kind: 'fla-graphic', animationId: project.animations[0]!.id });
    expect(clip.targetBases[1]!.baseTransform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 570, ty: 190 });
    expect(clip.tracks).toEqual([]);
    expect(project).toEqual(before);
    clip.targetBases[0]!.baseTransform.tx += 50;
    expect(project).toEqual(before);
  });
  it('keeps neutral snapshot visuals identical to the existing Image/Graphic path', () => {
    const { project, layerId } = characterPartAnimationFixture();
    const shot = project.shots[0]!;
    const before = resolveLayerVisualParts(project, shot, evaluateShotAtTime(shot, 500, project).layers.find(l => l.id === layerId)!, 500);
    shot.layers.find(l => l.id === layerId)!.animationClip = createCharacterPartAnimationClip(project, IDS.shot, layerId);
    const after = resolveLayerVisualParts(project, shot, evaluateShotAtTime(shot, 500, project).layers.find(l => l.id === layerId)!, 500);
    expect(after).toEqual(before);
  });
  it('resolves frozen identities after Library membership, layout, visibility and source edits', () => {
    const input = characterPartAnimationFixture();
    const project = addTestAnimation(input.project, input.layerId, input.imagePartId, 'transform.rotationDeg', 90);
    const shot = project.shots[0]!;
    const clip = shot.layers.find(l => l.id === input.layerId)!.animationClip!;
    const before = resolveLayerVisualParts(project, shot, evaluateShotAtTime(shot, 500, project).layers.find(l => l.id === input.layerId)!, 500);
    const changed = structuredClone(project);
    const character = changed.characters.find(c => c.id === input.characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('fixture');
    character.parts = [character.parts[1]!];
    character.parts[0]!.drawOrder = 0;
    character.parts[0]!.visible = false;
    character.parts[0]!.restTransform.tx = 9000;
    character.sourceRootTransform.tx = -2000;
    const parsed = ProjectSchema.parse(changed);
    const basis = resolveCharacterPartAnimationBasis(clip, clip.targetBases[0]!.target);
    expect(basis.target.partId).toBe(input.imagePartId);
    expect(createCharacterPartAnimationClip(parsed, IDS.shot, input.layerId)).toEqual(clip);
    expect(resolveLayerVisualParts(parsed, parsed.shots[0]!, evaluateShotAtTime(parsed.shots[0]!, 500, parsed).layers.find(l => l.id === input.layerId)!, 500)).toEqual(before);
    expect(() => resolveCharacterPartAnimationBasis(clip, { ...basis.target, layerId: IDS.layerAsset })).toThrow(/Unknown animation target/);
  });
  it('permits explicit pivot calibration only before non-neutral authored motion, independently per target', () => {
    const input = characterPartAnimationFixture();
    const clip = createCharacterPartAnimationClip(input.project, IDS.shot, input.layerId);
    const target = clip.targetBases[0]!.target;
    const pivot = { space: 'target-local' as const, x: 150, y: 100 };
    const neutral = addTestAnimation(input.project, input.layerId, input.imagePartId, 'transform.scaleX', 1, 1).shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!;
    expect(recalibrateCharacterPartAnimationPivot(neutral, target, pivot).targetBases[0]!.pivot).toEqual(pivot);
    const authored = addTestAnimation(input.project, input.layerId, input.imagePartId, 'transform.rotationDeg', 90).shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!;
    expect(() => recalibrateCharacterPartAnimationPivot(authored, target, pivot)).toThrow(/fixed after non-neutral/);
    expect(recalibrateCharacterPartAnimationPivot(authored, authored.targetBases[1]!.target, pivot).targetBases[1]!.pivot).toEqual(pivot);
    expect(recalibrateCharacterPartAnimationPivot({ ...authored, tracks: [] }, target, pivot).targetBases[0]!.pivot).toEqual(pivot);
    expect(clip.targetBases[0]!.pivot).toEqual({ space: 'target-local', x: 260, y: 240 });
    expect(() => recalibrateCharacterPartAnimationPivot(clip, target, { ...pivot, x: Infinity })).toThrow();
  });
});

describe('CharacterPart animation matrix order', () => {
  it('rotates around a noncentral source-local pivot with independent scale and offset after base transform', () => {
    const input = characterPartAnimationFixture();
    let project = addTestAnimation(input.project, input.layerId, input.imagePartId, 'transform.rotationDeg', 90);
    project = addTestAnimation(project, input.layerId, input.imagePartId, 'transform.offsetX', 12);
    project = addTestAnimation(project, input.layerId, input.imagePartId, 'transform.offsetY', -8);
    project = addTestAnimation(project, input.layerId, input.imagePartId, 'transform.scaleX', 2, 1);
    project = addTestAnimation(project, input.layerId, input.imagePartId, 'transform.scaleY', 3, 1);
    const clip = project.shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!;
    const basis = clip.targetBases[0]!;
    basis.pivot = { space: 'target-local', x: 150, y: 100 };
    const matrix = composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, evaluateAnimationClipAtTime(clip, 1000));
    // Source delta (10,20) scales to (20,60), rotates to (-60,20), then translates.
    const pivotX = 90 + 150 - clip.fixedCharacterCenter.x, pivotY = 120 + 100 - clip.fixedCharacterCenter.y;
    const apply = (x: number, y: number) => ({ x: matrix.a * x + matrix.c * y + matrix.tx, y: matrix.b * x + matrix.d * y + matrix.ty });
    expect(apply(150, 100).x).toBeCloseTo(pivotX + 12);
    expect(apply(150, 100).y).toBeCloseTo(pivotY - 8);
    expect(apply(160, 120).x).toBeCloseTo(pivotX + 12 - 60);
    expect(apply(160, 120).y).toBeCloseTo(pivotY - 8 + 20);
    // Image pixels still map through cropToSource (1/exportScale, crop.x/y).
    const visual = resolveLayerVisualParts(project, project.shots[0]!, evaluateShotAtTime(project.shots[0]!, 1000, project).layers.find(l => l.id === input.layerId)!, 1000);
    const image = visual.parts[0]!;
    const mapped = transformPointByVisualPart({ x: 120, y: 80 }, image); // source (160,120)
    expect(mapped.x).toBeCloseTo(pivotX + 12 - 60);
    expect(mapped.y).toBeCloseTo(pivotY - 8 + 20);
  });
  it('applies animated rotation outside rest rotation, shear and reflection', () => {
    const input = characterPartAnimationFixture();
    const clip = createCharacterPartAnimationClip(input.project, IDS.shot, input.layerId);
    const basis = clip.targetBases[0]!;
    basis.baseTransform = { a: 0, b: 2, c: 1, d: 0.5, tx: 20, ty: 30 };
    basis.pivot = { space: 'target-local', x: 0, y: 0 };
    const matrix = composeAnimatedCharacterPartTransform(basis, { x: 5, y: 10 }, [{ target: basis.target, property: 'transform.rotationDeg', value: 90 }]);
    // Base delta (1,2) -> (2,3), outer 90deg -> (-3,2), center-local pivot (15,20).
    expect(matrix.a + 2 * matrix.c + matrix.tx).toBeCloseTo(12);
    expect(matrix.b + 2 * matrix.d + matrix.ty).toBeCloseTo(22);
  });
  it('rejects degenerate/non-finite output and ignores another instance values', () => {
    const input = characterPartAnimationFixture();
    const clip = createCharacterPartAnimationClip(input.project, IDS.shot, input.layerId), basis = clip.targetBases[0]!;
    expect(() => composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, [{ target: basis.target, property: 'transform.scaleX', value: 0 }])).toThrow(/degenerate/);
    expect(() => composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, [{ target: basis.target, property: 'transform.offsetX', value: Infinity }])).toThrow(/non-finite/);
    expect(composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, [{ target: { ...basis.target, layerId: IDS.layerAsset }, property: 'transform.rotationDeg', value: 90 }])).toEqual(composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, []));
  });
});
