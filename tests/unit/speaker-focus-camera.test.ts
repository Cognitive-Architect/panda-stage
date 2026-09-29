import { describe, expect, it } from 'vitest';
import {
  resolveSpeakerFocusCamera,
  type Project,
  type Shot,
} from '../../src/domain';

function fixture(): { project: Project; shot: Shot } {
  const shot = {
    id: 'shot', durationMs: 2000, backgroundLayerId: null,
    dialogues: [], audioClips: [], timelineEvents: [],
    layers: [
      { id: 'a', source: { kind: 'character', characterId: 'A' }, x: 400, y: 500, visible: true },
      { id: 'b', source: { kind: 'character', characterId: 'B' }, x: 1500, y: 500, visible: true },
    ],
  } as unknown as Shot;
  const project = { width: 1920, height: 1080, characters: [], shots: [shot] } as unknown as Project;
  return { project, shot };
}

function dialogue(id: string, characterId: string, startMs: number, endMs: number) {
  return { id, characterId, startMs, endMs, text: id, subtitleStyleId: 'style' } as Shot['dialogues'][number];
}

describe('Speaker Focus Camera', () => {
  it('defaults to full stage and focuses a text-only Dialogue at 1.5x after 250ms', () => {
    const { project, shot } = fixture();
    expect(resolveSpeakerFocusCamera(project, shot, 500)).toEqual({ centerX: 960, centerY: 540, zoom: 1 });
    shot.dialogues.push(dialogue('a-dialogue', 'A', 0, 600));
    expect(resolveSpeakerFocusCamera(project, shot, 0)).toEqual({ centerX: 960, centerY: 540, zoom: 1 });
    expect(resolveSpeakerFocusCamera(project, shot, 125)).toEqual({ centerX: 800, centerY: 520, zoom: 1.25 });
    expect(resolveSpeakerFocusCamera(project, shot, 250)).toEqual({ centerX: 640, centerY: 500, zoom: 1.5 });
    expect(resolveSpeakerFocusCamera(project, shot, 850)).toEqual({ centerX: 960, centerY: 540, zoom: 1 });
  });

  it('falls back for missing, hidden, or duplicate occurrences', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('a-dialogue', 'A', 0, 1000));
    shot.layers[0]!.visible = false;
    expect(resolveSpeakerFocusCamera(project, shot, 500).zoom).toBe(1);
    shot.layers[0]!.visible = true;
    shot.layers.push({ ...shot.layers[0]!, id: 'a-copy' });
    expect(resolveSpeakerFocusCamera(project, shot, 500).zoom).toBe(1);
    shot.layers.pop();
    shot.dialogues[0]!.characterId = 'missing';
    expect(resolveSpeakerFocusCamera(project, shot, 500).zoom).toBe(1);
  });

  it('follows main Position but not temporary Shake and clamps near edges', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('a-dialogue', 'A', 0, 1000));
    shot.timelineEvents.push({ id: 'move', layerId: 'a', type: 'move', startMs: 0, endMs: 500, from: { x: 400, y: 500 }, to: { x: 0, y: 0 }, easing: 'linear' });
    const beforeShake = resolveSpeakerFocusCamera(project, shot, 500);
    expect(beforeShake).toEqual({ centerX: 640, centerY: 360, zoom: 1.5 });
    shot.timelineEvents.push({ id: 'shake', layerId: 'a', type: 'shake', startMs: 0, endMs: 1000, amplitudeX: 50, amplitudeY: 80, frequencyHz: 1 });
    expect(resolveSpeakerFocusCamera(project, shot, 500)).toEqual(beforeShake);
  });

  it('folds rapid speaker changes and short gaps without a snap; seeking is stateless', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('A1', 'A', 0, 100), dialogue('B1', 'B', 100, 200), dialogue('A2', 'A', 230, 500));
    const first = resolveSpeakerFocusCamera(project, shot, 100);
    const next = resolveSpeakerFocusCamera(project, shot, 101);
    expect(Math.abs(next.centerX - first.centerX)).toBeLessThan(1);
    const sought = resolveSpeakerFocusCamera(project, shot, 400);
    for (let at = 0; at <= 400; at += 10) resolveSpeakerFocusCamera(project, shot, at);
    expect(resolveSpeakerFocusCamera(project, shot, 400)).toEqual(sought);
    const gapEnd = resolveSpeakerFocusCamera(project, shot, 230);
    const afterGap = resolveSpeakerFocusCamera(project, shot, 231);
    expect(Math.abs(afterGap.centerX - gapEnd.centerX)).toBeLessThan(1);
    expect(resolveSpeakerFocusCamera(project, shot, 0).zoom).toBe(1);
    const other = fixture();
    other.shot.dialogues.push(dialogue('B2', 'B', 0, 1000));
    expect(resolveSpeakerFocusCamera(other.project, other.shot, 0).zoom).toBe(1);
  });

  it('uses the shared latest-start subtitle winner, including overlap', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('A1', 'A', 0, 1000), dialogue('B1', 'B', 300, 900));
    const before = resolveSpeakerFocusCamera(project, shot, 300);
    expect(before.centerX).toBe(640);
    expect(resolveSpeakerFocusCamera(project, shot, 550).centerX).toBe(1280);
  });

  it('reacts to authored visibility changes without following a hidden speaker', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('A1', 'A', 0, 1000));
    shot.timelineEvents.push({ id: 'hide', layerId: 'a', type: 'visibility', startMs: 500, endMs: 500, visible: false });
    expect(resolveSpeakerFocusCamera(project, shot, 499).zoom).toBe(1.5);
    expect(resolveSpeakerFocusCamera(project, shot, 750).zoom).toBe(1);
  });
});
