import {
  CharacterService, LayerService, ProjectSchema, type AnimationClipV0,
} from '../../src/domain';
import { adaptivePartsFixture } from './adaptivePartsFixtures';
import { buildProject, IDS } from '../unit/domain/testProject';

/** Hand-authored persisted data; deliberately does not implement snapshot creation. */
export function animationCoreFixture() {
  const parts = adaptivePartsFixture(IDS.assetChar);
  const created = new CharacterService().createAdaptiveParts(buildProject(), {
    name: 'Core fixture', parts,
  });
  const placed = new LayerService().createFromAdaptiveCharacter(
    created, IDS.shot, created.characters.at(-1)!.id, { x: 960, y: 540 },
  );
  const target = { kind: 'character-part' as const, layerId: placed.layer.id, partId: parts[0]!.partId };
  const clip: AnimationClipV0 = {
    version: 1,
    fixedCharacterCenter: { x: 320, y: 320 },
    targetBases: [{
      target, visualSource: { kind: 'image', assetId: IDS.assetChar, imageMapping: parts[0]!.imageMapping! },
      baseTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      pivot: { space: 'target-local', x: 320, y: 320 },
      drawOrder: 0, visible: true, displayName: 'Arm',
    }],
    tracks: [{ target, property: 'transform.rotationDeg', keys: [
      { timeMs: 0, value: 0, interpolationToNext: 'linear' },
      { timeMs: 1000, value: 270, interpolationToNext: 'linear' },
    ] }],
  };
  const project = ProjectSchema.parse({ ...placed.project, shots: placed.project.shots.map(shot => ({
    ...shot, layers: shot.layers.map(layer => layer.id === placed.layer.id ? { ...layer, animationClip: clip } : layer),
  })) });
  return { project, clip, layerId: placed.layer.id };
}
