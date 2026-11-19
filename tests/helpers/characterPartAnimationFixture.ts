import {
  CharacterService, LayerService, ProjectSchema, createCharacterPartAnimationClip,
  type AnimationClipV0, type AnimationProperty, type FlaGraphicDefinition, type Project,
} from '../../src/domain';
import { adaptivePartsFixture } from './adaptivePartsFixtures';
import { graphicFaceProject, FACE_GRAPHIC_ID } from './graphicFaceProject';
import { IDS } from '../unit/domain/testProject';

export function characterPartAnimationFixture() {
  const initial = graphicFaceProject();
  const definition = initial.animations[0] as FlaGraphicDefinition;
  definition.source.sourceFps = 4;
  definition.durationMs = 1000;
  definition.frames = definition.frames.map((frame, ordinal) => ({ ...frame, startMs: ordinal * 250, durationMs: 250 }));
  definition.structure!.frames = definition.structure!.frames.map(frame => ({ ...frame, layers: [{ name: 'Nested', nodes: [{
    type: 'group', id: 'group-' + frame.ordinal, groupId: 'group', drawOrder: 0,
    localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
    children: [{ type: 'symbol', id: 'arm-' + frame.ordinal, symbolRef: 'Arm', drawOrder: 0,
      localTransform: { a: 0, b: 1, c: -1, d: 0, tx: 30, ty: 40 },
      children: [{ type: 'bitmap', id: 'leaf-' + frame.ordinal, drawOrder: 0, bitmapRef: 'Leaf', assetId: frame.ordinal % 2 ? IDS.assetChar2 : IDS.assetChar,
        localTransform: { a: 2, b: 0, c: 0, d: 3, tx: 5, ty: 7 } }],
    }],
  }] }] }));
  const parts = adaptivePartsFixture(IDS.assetChar).slice(0, 2);
  parts[0]!.imageMapping = { sourceWidth: 640, sourceHeight: 640, crop: { x: 100, y: 80, width: 320, height: 320 }, exportScale: 2 };
  parts[0]!.restTransform = { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 30 };
  delete parts[1]!.assetId; delete parts[1]!.imageMapping;
  parts[1]!.visualSource = { kind: 'fla-graphic', animationId: FACE_GRAPHIC_ID };
  parts[1]!.restTransform = { a: 1, b: 0, c: 0, d: 1, tx: 500, ty: 100 };
  const created = new CharacterService().createAdaptiveParts(ProjectSchema.parse(initial), {
    name: 'Mixed animated character', sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 70, ty: 90 }, parts,
  });
  const characterId = created.characters.at(-1)!.id;
  const placed = new LayerService().createFromAdaptiveCharacter(created, IDS.shot, characterId, { x: 960, y: 540 });
  return { project: placed.project, layerId: placed.layer.id, characterId, imagePartId: parts[0]!.partId, graphicPartId: parts[1]!.partId };
}

/** Test authoring only: production Stage / lazy Track services belong to V0-03. */
export function addTestAnimation(project: Project, layerId: string, partId: string, property: AnimationProperty, endValue: number, startValue = 0): Project {
  const next = structuredClone(project);
  const layer = next.shots[0]!.layers.find(entry => entry.id === layerId)!;
  const clip: AnimationClipV0 = layer.animationClip?.version === 1
    ? layer.animationClip
    : createCharacterPartAnimationClip(next, IDS.shot, layerId);
  clip.tracks = clip.tracks.filter(track => !(track.target.partId === partId && track.property === property));
  clip.tracks.push({ target: { kind: 'character-part', layerId, partId }, property, keys: [
    { timeMs: 0, value: startValue, interpolationToNext: 'linear' },
    { timeMs: 1000, value: endValue, interpolationToNext: 'linear' },
  ] });
  layer.animationClip = clip;
  return ProjectSchema.parse(next);
}
