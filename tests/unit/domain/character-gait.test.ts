import { describe, expect, it } from 'vitest';
import { CharacterService, LayerService, evaluateShotAtTime, type CharacterPart } from '../../../src/domain';
import { planCharacterGait } from '../../../src/domain/services/CharacterGaitService';
import { graphicFaceProject } from '../../helpers/graphicFaceProject';
import { IDS } from './testProject';

function fixture() {
  const base = graphicFaceProject();
  const image = base.assets.find(({ id }) => id === IDS.assetChar);
  if (image?.kind !== 'image') throw new Error('Missing fixture image');
  const assets = [70, 20].map((height, index) => ({
    ...image, id: `98000000-0000-4000-8100-00000000000${index + 1}`,
    name: 'Gait segment ' + height, relativePath: 'assets/gait-' + height + '.png', width: 24, height,
  }));
  const parts: CharacterPart[] = Array.from({ length: 6 }, (_, index) => {
    const segment = index % 3;
    return {
      partId: `98000000-0000-4000-8000-00000000000${index + 1}`,
      assetId: assets[segment === 2 ? 1 : 0]!.id,
      source: { kind: 'manual', sourceId: `leg:${index}` },
      drawOrder: index,
      visible: true,
      imageMapping: { sourceWidth: 640, sourceHeight: 640,
        crop: { x: 0, y: 0, width: 24, height: segment === 2 ? 20 : 70 }, exportScale: 1 },
      restTransform: { a: 1, b: 0, c: 0, d: 1, tx: index < 3 ? -22 : 23, ty: [0, 59, 119][segment]! },
    };
  });
  const project = new CharacterService().createAdaptiveParts({ ...base, assets: [...base.assets, ...assets] }, {
    name: 'Gait fixture', parts, sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  });
  const character = project.characters.at(-1)!;
  const placed = new LayerService().createFromAdaptiveCharacter(project, IDS.shot, character.id, { x: 960, y: 540 });
  const [left, right] = [parts.slice(0, 3), parts.slice(3)].map(([thigh, shin, foot]) =>
    ({ thigh: thigh!.partId, shin: shin!.partId, foot: foot!.partId }));
  return { ...placed, character, parts: { left: left!, right: right! } };
}

describe('character gait templates', () => {
  it('keeps travel feet planted on native frame keys and emits different walk and run cycles', () => {
    const { project, layer, character, parts } = fixture();
    const input = { shotId: IDS.shot, layerId: layer.id, startMs: 0, endMs: 1000, cycles: 1,
      direction: 1 as const, parts };
    const walk = planCharacterGait(project, { ...input, travel: false, gait: 'walk' });
    const run = planCharacterGait(project, { ...input, travel: true, gait: 'run' });
    const runShot = run.shots[0]!;
    expect(runShot.layers).toEqual(project.shots[0]!.layers);
    const poseAt = (time: number) => evaluateShotAtTime(runShot, time, run).layers.find(({ id }) => id === layer.id)!;
    expect(poseAt(1000).x).toBeGreaterThan(layer.x + 45);
    expect(poseAt(1000).layeredCharacterAction).toBeUndefined();
    expect(walk.shots[0]!.timelineEvents.some(({ type }) => type === 'move')).toBe(false);
    const action = run.characters.find(({ id }) => id === character.id)!.actions!.at(-1)!;
    const walkAction = walk.characters.find(({ id }) => id === character.id)!.actions!.at(-1)!;
    if (!('kind' in action) || !('kind' in walkAction)) throw new Error('Expected layered action');
    for (const track of action.tracks) {
      expect(track.keys[0]?.value).toBe(0);
      expect(track.keys.at(-1)?.value).toBe(0);
    }
    const xKeys = action.tracks.find(({ partId, property }) => partId === parts.left.foot && property === 'transform.offsetX')!.keys;
    const contact = xKeys.slice(4, 10).map((key) => key.value + poseAt(key.timeMs).x);
    expect(Math.max(...contact) - Math.min(...contact)).toBeLessThan(0.2);
    const altitude = (tracks: typeof action.tracks) => tracks.find(({ partId, property }) =>
      partId === parts.left.foot && property === 'transform.offsetY')!.keys.map(({ value }) => value);
    expect(Math.min(...altitude(action.tracks))).toBeLessThan(Math.min(...altitude(walkAction.tracks)));
    expect(() => planCharacterGait(run, { ...input, travel: false, gait: 'walk' })).toThrow();
  });
});
