import { describe, expect, it } from 'vitest';
import { ProjectSchema, evaluateShotAtTime, isValidFrameTime } from '../../../src/domain';
import {
  characterTemplateHeadParts, planCharacterAppearanceSwitch, planCharacterMotionTemplate,
} from '../../../src/domain/services/CharacterMotionTemplateService';
import { addTestAnimation, characterPartAnimationFixture } from '../../helpers/characterPartAnimationFixture';
import { IDS } from './testProject';

describe('character motion templates', () => {
  it('uses editable Move/Shake events, explicit frame timing and a returning shake', () => {
    const { project, layerId } = characterPartAnimationFixture();
    const input = { shotId: IDS.shot, layerId, startMs: 500, endMs: 1500, cycles: 1, amplitude: 80 };
    const next = planCharacterMotionTemplate(project, { ...input, kind: 'teleport', templateName: 'Jump' });
    const poseAt = (value: typeof project, timeMs: number) =>
      evaluateShotAtTime(value.shots[0]!, timeMs, value).layers.find(({ id }) => id === layerId)!;
    expect(poseAt(next, 499).x).toBe(poseAt(project, 499).x);
    expect(poseAt(next, 500).x).toBe(poseAt(project, 500).x + 80);
    expect(poseAt(next, 1500).x).toBe(poseAt(next, 500).x);
    const shaken = planCharacterMotionTemplate(project, { ...input, kind: 'shake', templateName: 'Shake' });
    expect(poseAt(shaken, 750).x).toBeCloseTo(poseAt(project, 750).x + 80);
    expect(poseAt(shaken, 1500).x).toBeCloseTo(poseAt(project, 1500).x);
    expect(() => planCharacterMotionTemplate(shaken, { ...input, kind: 'sway', templateName: 'Sway' })).toThrow();
  });

  it('adds reusable head-local action tracks while retaining the instance body tracks', () => {
    const { project, layerId, characterId, graphicPartId, imagePartId } = characterPartAnimationFixture();
    const bodyAnimated = addTestAnimation(project, layerId, imagePartId, 'transform.offsetX', 90);
    const historicalAction = {
      id: crypto.randomUUID(), name: 'Body pose with head follower', kind: 'layered', headAnchorPartId: imagePartId,
      tracks: [{ partId: imagePartId, property: 'transform.offsetX', keys: [
        { timeMs: 0, value: 0, interpolationToNext: 'linear' },
        { timeMs: 500, value: 90, interpolationToNext: 'linear' },
      ] }],
    };
    const configureHead = (partIds?: string[]) => ProjectSchema.parse({
      ...bodyAnimated,
      characters: bodyAnimated.characters.map((character) => character.id === characterId
        ? { ...character, actions: [historicalAction], headMotionBinding: partIds ? { partIds } : undefined } : character),
    });
    const layer = bodyAnimated.shots[0]!.layers.find(({ id }) => id === layerId)!;
    const pickHead = (candidate: typeof project) =>
      characterTemplateHeadParts(candidate.characters.find(({ id }) => id === characterId)!, layer);
    const unbound = configureHead();
    const bound = configureHead([graphicPartId]);
    expect(pickHead(unbound)).toEqual([]);
    expect(pickHead(bound).map(({ id }) => id)).toEqual([graphicPartId]);

    const motion = { shotId: IDS.shot, layerId, startMs: 542, endMs: 1542, cycles: 1, amplitude: 25 };
    expect(() => planCharacterMotionTemplate(bound, { ...motion, kind: 'nod', templateName: 'Nod',
      headPartId: imagePartId })).toThrow();
    expect(planCharacterMotionTemplate(unbound, { ...motion, kind: 'sway', templateName: 'Sway' })
      .shots[0]!.timelineEvents.at(-1)?.type).toBe('shake');
    for (const kind of ['nod', 'head-shake', 'look-up', 'look-down', 'smooth-head-shake'] as const) {
      const next = planCharacterMotionTemplate(bound, { shotId: IDS.shot, layerId, kind, headPartId: graphicPartId,
        templateName: kind, startMs: 542, endMs: 1542, cycles: 1, amplitude: 25 });
      expect(next.shots[0]!.layers).toEqual(bound.shots[0]!.layers);
      expect(next.characters.filter(({ id }) => id !== characterId))
        .toEqual(bound.characters.filter(({ id }) => id !== characterId));
      const action = next.characters.find(({ id }) => id === characterId)!.actions!.at(-1)!;
      if (!('kind' in action)) throw new Error('Expected a layered action');
      expect(action.headAnchorPartId).toBe(graphicPartId);
      expect(action.tracks.every((track) => track.partId === graphicPartId &&
        track.keys[0]!.timeMs === 0 && track.keys.every(({ timeMs }) => isValidFrameTime(timeMs)))).toBe(true);
      const mid = evaluateShotAtTime(next.shots[0]!, 792, next).layers.find(({ id }) => id === layerId)!;
      expect(mid.layeredCharacterAction?.action.id).toBe(action.id);
      expect(evaluateShotAtTime(next.shots[0]!, 1542, next).layers.find(({ id }) => id === layerId)!
        .layeredCharacterAction).toBeUndefined();
    }
  });

  it('switches appearance of one instance with a fade on the normal expression and opacity tracks', () => {
    const { project } = characterPartAnimationFixture();
    const shot = project.shots[0]!;
    const source = shot.layers.find((layer) => layer.source.kind === 'character' && layer.source.characterId === IDS.character)!;
    const expression = project.characters.find(({ id }) => id === IDS.character)!.expressions![0]!;
    const next = planCharacterAppearanceSwitch(project, { shotId: shot.id, layerId: source.id,
      expressionId: expression.id, timeMs: 500, fadeFrames: 12 });
    const poseAt = (timeMs: number) =>
      evaluateShotAtTime(next.shots[0]!, timeMs, next).layers.find(({ id }) => id === source.id)!;
    expect(poseAt(750)).toMatchObject({ currentExpressionId: expression.id, opacity: 0 });
    expect(poseAt(1000).opacity).toBe(source.opacity);
    expect(next.characters).toEqual(project.characters);
    expect(next.shots[0]!.layers).toEqual(shot.layers);
  });
});
