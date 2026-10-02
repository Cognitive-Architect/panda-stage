import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  AudioClipService, AudioClipSchema, DialogueService, ProjectSchema,
  audioClipDurationMs, audioClipGain, audioClipSourceTimeMs, isAudioClipActiveAtTime, migrateProject,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { ShotService } from '../../src/domain';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { AudioClipSelectionStore } from '../../src/renderer/stores/audioClipSelectionStore';
import { AudioClipStore } from '../../src/renderer/stores/audioClipStore';
import { buildProject, IDS } from './domain/testProject';

const ASSET = '10000000-0000-4000-8000-000000000777';
const CLIP = '70000000-0000-4000-8000-000000000777';
const service = new AudioClipService({ createId: () => CLIP, now: () => new Date('2026-10-01T00:00:00Z') });
const target = { shotId: IDS.shot, clipId: CLIP };
function fixture() {
  const project = buildProject();
  return ProjectSchema.parse({ ...project, assets: [...project.assets, {
    id: ASSET, name: 'audio', kind: 'audio', relativePath: 'assets/audio.wav',
    mimeType: 'audio/wav', durationMs: 2000, metadata: { status: 'ready', warnings: [] },
  }] });
}
function created(role: 'bgm' | 'sfx' = 'bgm') {
  return service.create(fixture(), { shotId: IDS.shot, assetId: ASSET, role, startMs: 500 });
}

describe('A01 standalone audio foundation', () => {
  it.each(['bgm', 'sfx'] as const)('creates %s with defaults and source/Shot limits', (role) => {
    const project = created(role);
    expect(project.shots[0]!.audioClips[0]).toMatchObject({ role, startMs: 500, endMs: 2500, offsetMs: 0, volume: 1 });
    expect(fixture().shots[0]!.audioClips).toEqual([]);
    const tail = service.create(fixture(), { shotId: IDS.shot, assetId: ASSET, role, startMs: 2900 });
    expect(tail.shots[0]!.audioClips[0]!.endMs).toBe(3000);
    expect(() => service.create(fixture(), { shotId: IDS.shot, assetId: ASSET, role, startMs: 3000 })).toThrow();
  });

  it('rejects missing, errored and non-audio sources and invalid identity', () => {
    const project = fixture();
    const input = { shotId: IDS.shot, assetId: ASSET, role: 'bgm' as const, startMs: 0 };
    expect(() => service.create(project, { ...input, assetId: IDS.assetBg })).toThrow();
    expect(() => service.create(project, { ...input, assetId: CLIP })).toThrow();
    expect(() => service.create(project, { ...input, startMs: Number.NaN })).toThrow();
    const bad = { ...project, assets: project.assets.map((asset) => asset.id === ASSET ? { ...asset, durationMs: undefined } : asset) };
    expect(() => service.create(bad, input)).toThrow();
    const error = ProjectSchema.parse({ ...project, assets: project.assets.map((asset) => asset.id === ASSET ? {
      ...asset, metadata: { status: 'error', code: 'ASSET_METADATA_INVALID_AUDIO', message: 'invalid' },
    } : asset) });
    expect(() => service.create(error, input)).toThrow();
    const clip = created().shots[0]!.audioClips[0]!;
    expect(AudioClipSchema.safeParse({ ...clip, role: 'music' }).success).toBe(false);
    const { role, ...missing } = clip;
    void role;
    expect(AudioClipSchema.safeParse(missing).success).toBe(false);
  });

  it('moves without changing source offset/duration and clamps both Shot edges', () => {
    const project = service.trimStart(created(), { ...target, startMs: 800 });
    const moved = service.move(project, { ...target, startMs: 9999 });
    expect(moved.shots[0]!.audioClips[0]).toMatchObject({ startMs: 1300, endMs: 3000, offsetMs: 300 });
    const left = service.move(moved, { ...target, startMs: -100 });
    expect(left.shots[0]!.audioClips[0]).toMatchObject({ startMs: 0, endMs: 1700, offsetMs: 300 });
    expect(audioClipDurationMs(left.shots[0]!.audioClips[0]!)).toBe(1700);
  });

  it('trims start and offset together; extends only through available source', () => {
    const right = service.trimStart(created(), { ...target, startMs: 1000 });
    expect(right.shots[0]!.audioClips[0]).toMatchObject({ startMs: 1000, endMs: 2500, offsetMs: 500 });
    const left = service.trimStart(right, { ...target, startMs: 0 });
    expect(left.shots[0]!.audioClips[0]).toMatchObject({ startMs: 500, endMs: 2500, offsetMs: 0 });
    const minimum = service.trimStart(left, { ...target, startMs: 9999 });
    expect(audioClipDurationMs(minimum.shots[0]!.audioClips[0]!)).toBe(1);
  });

  it('trims only end within source and Shot; preserves assets on delete', () => {
    const shortened = service.trimEnd(created(), { ...target, endMs: 1200 });
    expect(shortened.shots[0]!.audioClips[0]).toMatchObject({ startMs: 500, endMs: 1200, offsetMs: 0 });
    const extended = service.trimEnd(shortened, { ...target, endMs: 9999 });
    expect(extended.shots[0]!.audioClips[0]!.endMs).toBe(2500);
    expect(service.remove(extended, target).assets).toEqual(extended.assets);
    expect(service.remove(extended, target).shots[0]!.audioClips).toEqual([]);
  });

  it.each([0, 0.5, 1, 1.5, 2])('preserves linear gain %s in persistence and shared contract', (volume) => {
    const project = service.setVolume(created(), { ...target, volume });
    const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(reopened.shots[0]!.audioClips[0]!.volume).toBe(volume);
    expect(audioClipGain(volume)).toBe(volume);
  });

  it.each([-1, 2.1, Number.NaN, Infinity])('rejects gain %s, never silently caps it', (volume) => {
    expect(() => audioClipGain(volume)).toThrow();
    expect(() => service.setVolume(created(), { ...target, volume })).toThrow();
  });

  it.each(['dialogue', 'bgm', 'sfx'] as const)('shares half-open timing and source position across %s', (role) => {
    const clip = { ...created().shots[0]!.audioClips[0]!, role, offsetMs: 100 };
    expect(isAudioClipActiveAtTime(clip, 499)).toBe(false);
    expect(isAudioClipActiveAtTime(clip, 500)).toBe(true);
    expect(isAudioClipActiveAtTime(clip, 2499)).toBe(true);
    expect(isAudioClipActiveAtTime(clip, 2500)).toBe(false);
    expect(isAudioClipActiveAtTime(clip, Number.NaN)).toBe(false);
    expect(audioClipSourceTimeMs(clip, 600)).toBe(200);
    expect(audioClipDurationMs(clip)).toBe(2000);
  });

  it('migrates every v7 clip to dialogue preserving timing/gain and Dialogue reference', () => {
    const dialogueService = new DialogueService();
    let project = dialogueService.create(fixture(), { shotId: IDS.shot, characterId: IDS.character, text: 'line', pointTimeMs: 500 });
    const dialogueId = project.shots[0]!.dialogues[0]!.id;
    project = dialogueService.setTiming(project, { shotId: IDS.shot, dialogueId, startMs: 500, endMs: 1500 });
    project = dialogueService.bindAudio(project, { shotId: IDS.shot, dialogueId, assetId: ASSET });
    const misbound = {
      ...project,
      shots: project.shots.map((shot) => ({ ...shot,
        audioClips: shot.audioClips.map((clip) => ({ ...clip, role: 'bgm' })),
      })),
    };
    expect(ProjectSchema.safeParse(misbound).success).toBe(false);
    project = service.create(project, { shotId: IDS.shot, assetId: ASSET, startMs: 700, role: 'sfx' });
    const legacy = { ...project, schemaVersion: 7, shots: project.shots.map((shot) => ({ ...shot,
      audioClips: shot.audioClips.map(({ role, ...clip }) => { void role; return { ...clip, volume: 1.7 }; }),
    })) };
    const before = structuredClone(legacy);
    const migrated = migrateProject(legacy);
    expect(legacy).toEqual(before);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.shots[0]!.dialogues).toEqual(project.shots[0]!.dialogues);
    expect(migrated.shots[0]!.audioClips).toEqual(legacy.shots[0]!.audioClips.map((clip) => ({ ...clip, role: 'dialogue' })));
    expect(() => service.remove(migrated, { shotId: IDS.shot, clipId: migrated.shots[0]!.audioClips[0]!.id })).toThrow();
  });

  it('records exactly one command per real edit, none for no-op; Undo/Redo restores each snapshot', () => {
    const editor = new EditorProjectStore();
    editor.open('D:\\audio.pandastage', fixture());
    const store = new AudioClipStore(editor, { getCurrentShotId: () => IDS.shot }, service, { select: () => undefined });
    const snapshots = [editor.getSnapshot()!.project];
    const id = store.create(ASSET, 'bgm', 500);
    snapshots.push(editor.getSnapshot()!.project);
    store.trimStart(id, 700); snapshots.push(editor.getSnapshot()!.project);
    store.trimEnd(id, 2000); snapshots.push(editor.getSnapshot()!.project);
    store.move(id, 1000); snapshots.push(editor.getSnapshot()!.project);
    store.setVolume(id, 1.8); snapshots.push(editor.getSnapshot()!.project);
    store.move(id, 1000); store.trimStart(id, 1000); store.trimEnd(id, 2300); store.setVolume(id, 1.8);
    expect(editor.history.getSnapshot().undoCount).toBe(5);
    store.remove(id); snapshots.push(editor.getSnapshot()!.project);
    expect(editor.history.getSnapshot().undoCount).toBe(6);
    for (let index = 5; index >= 0; index--) {
      expect(editor.undo()).toBe(true);
      expect(editor.getSnapshot()!.project).toEqual(snapshots[index]);
    }
    for (let index = 1; index <= 6; index++) {
      expect(editor.redo()).toBe(true);
      expect(editor.getSnapshot()!.project).toEqual(snapshots[index]);
    }
  });

  it('owns standalone selection independently and resets on deletion, Shot switch and same-path reopen', () => {
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const layers = new LayerSelectionStore(editor, shots);
    const dialogues = new DialogueSelectionStore(editor, shots, layers);
    const selection = new AudioClipSelectionStore(editor, shots, dialogues, layers);
    const project = created();
    editor.open('D:\\audio.pandastage', project);
    selection.select(CLIP);
    expect(selection.getSelectedAudioClipId()).toBe(CLIP);
    expect(dialogues.getSelectedDialogueId()).toBe(null);
    expect(editor.history.getSnapshot().undoCount).toBe(0);
    expect(editor.getSnapshot()!.dirty).toBe(false);
    layers.select(IDS.layerChar);
    expect(selection.getSelectedAudioClipId()).toBe(null);
    selection.select(CLIP);
    expect(layers.getSelectedLayerId()).toBe(null);
    editor.updateProject(service.remove(editor.getSnapshot()!.project, target));
    expect(selection.getSelectedAudioClipId()).toBe(null);
    editor.undo();
    selection.select(CLIP);
    editor.open('D:\\audio.pandastage', project);
    expect(selection.getSelectedAudioClipId()).toBe(null);
    selection.select(CLIP);
    shots.create({ name: 'second', durationMs: 1000 });
    expect(selection.getSelectedAudioClipId()).toBe(null);
    selection.dispose(); dialogues.dispose(); layers.dispose(); shots.dispose();
  });
});
