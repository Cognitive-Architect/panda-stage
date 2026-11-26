import { describe, expect, it } from 'vitest';
import { LayerService, evaluateShotAtTime } from '../../../src/domain';
import { planMonologueBackdrop } from '../../../src/domain/services/MonologueBackdropService';
import { buildProject, IDS } from './testProject';

describe('monologue backdrop', () => {
  it('adds a normal image with an opacity interval below the speaker and preserves the authored shot', () => {
    const project = buildProject();
    const baseShot = project.shots[0]!;
    const planned = planMonologueBackdrop(project, {
      shotId: IDS.shot, layerId: IDS.layerChar, assetId: IDS.assetBg, startMs: 500, endMs: 1000,
    });
    const shot = planned.shots[0]!;
    const backdrop = shot.layers.find(({ name }) => name === '独白黑幕')!;
    const speaker = shot.layers.find(({ id }) => id === IDS.layerChar)!;
    const opacity = (timeMs: number) => evaluateShotAtTime(shot, timeMs, planned)
      .layers.find(({ id }) => id === backdrop.id)!.opacity;
    expect([opacity(499), opacity(500), opacity(999), opacity(1000)]).toEqual([0, 1, 1, 0]);
    expect(shot.backgroundLayerId).toBe(baseShot.backgroundLayerId);
    expect(shot.layers.filter(({ id }) => id !== backdrop.id).map(({ id }) => id)).toEqual(baseShot.layers.map(({ id }) => id));
    expect(speaker.zIndex).toBe(backdrop.zIndex + 1);
    expect(backdrop).toMatchObject({ source: { kind: 'asset', assetId: IDS.assetBg }, x: 960, y: 540, opacity: 0 });
    expect(planned.assets).toEqual(project.assets);
    expect(planned.characters).toEqual(project.characters);
    expect(shot.dialogues).toEqual(baseShot.dialogues);
    expect(shot.audioClips).toEqual(baseShot.audioClips);
  });

  it('requires the speaker to be topmost and rejects invalid layer or frame ranges', () => {
    const project = buildProject();
    const { project: withForeground } = new LayerService().createFromAsset(project, IDS.shot, {
      version: 2, type: 'asset-image', assetId: IDS.assetBg, position: { x: 960, y: 540 },
    });
    const input = { shotId: IDS.shot, layerId: IDS.layerChar, assetId: IDS.assetBg, startMs: 500, endMs: 1000 };
    expect(() => planMonologueBackdrop(withForeground, input)).toThrow('最上层');
    expect(() => planMonologueBackdrop(project, { ...input, startMs: 501 })).toThrow('有效');
    expect(() => planMonologueBackdrop(project, { ...input, layerId: IDS.layerAsset })).toThrow('角色图层');
  });
});
