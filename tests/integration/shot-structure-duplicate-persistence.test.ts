import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  ProjectSchema,
  ShotService,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';

const temporaryParents: string[] = [];

async function tempProjectRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-wf06-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, 'WF06 结构复制.pandastage');
}

function shotService(): ShotService {
  let counter = 0;
  return new ShotService({
    createId: () =>
      `e1416100-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-27T10:30:00.000Z'),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('WF-06 structure-only shot duplication persistence', () => {
  it('persists structure-only copies across save and reopen with intact source shot and shared assets', async () => {
    const root = await tempProjectRoot();
    const projectService = new ProjectService({
      now: () => new Date('2026-11-27T10:25:00.000Z'),
    });
    const created = await projectService.create(root, { name: 'WF06 persistence' });

    const now = '2026-11-27T10:25:00.000Z';
    const audioAssetId = 'e1416100-0000-4000-8000-900000000010';
    const bgAssetId = 'e1416100-0000-4000-8000-900000000011';
    const subtitleStyleId = 'e1416100-0000-4000-8000-900000000012';
    const shotId = 'e1416100-0000-4000-8000-900000000013';
    const bgLayerId = 'e1416100-0000-4000-8000-900000000014';
    const dialogueClipId = 'e1416100-0000-4000-8000-900000000015';
    const dialogueId = 'e1416100-0000-4000-8000-900000000016';
    const bgmClipId = 'e1416100-0000-4000-8000-900000000001';
    const overrideId = 'e1416100-0000-4000-8000-900000000002';

    const initialProject = ProjectSchema.parse({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: created.project.id,
      name: 'WF06 persistence',
      width: PROJECT_WIDTH,
      height: PROJECT_HEIGHT,
      fps: PROJECT_FPS,
      assets: [
        {
          id: bgAssetId,
          kind: 'image',
          name: 'Stage BG',
          relativePath: 'assets/images/stage-bg.png',
          mimeType: 'image/png',
          sha256: '1'.repeat(64),
          width: 1920,
          height: 1080,
          usage: 'background',
          keywords: [],
        },
        {
          id: audioAssetId,
          kind: 'audio',
          name: 'Scene Audio',
          relativePath: 'assets/audio/scene-audio.wav',
          mimeType: 'audio/wav',
          sha256: '2'.repeat(64),
          durationMs: 3_000,
        },
      ],
      animations: [],
      characters: [],
      voiceProfiles: [],
      subtitleStyles: [
        {
          id: subtitleStyleId,
          name: 'Default',
          fontFamily: 'Microsoft YaHei',
          fontSize: 42,
          textColor: '#ffffff',
          strokeColor: '#000000',
          strokeWidth: 4,
          backgroundColor: '#00000080',
          position: 'bottom',
          align: 'center',
          maxWidth: 1600,
        },
      ],
      shots: [
        {
          id: shotId,
          name: 'Opening',
          durationMs: 3_000,
          defaultSubtitleStyleId: subtitleStyleId,
          backgroundLayerId: bgLayerId,
          layers: [
            {
              id: bgLayerId,
              name: 'Background',
              source: { kind: 'asset', assetId: bgAssetId },
              anchor: 'center',
              x: 960,
              y: 540,
              scaleX: 1,
              scaleY: 1,
              rotationDeg: 0,
              opacity: 1,
              visible: true,
              locked: true,
              flipX: false,
              zIndex: 0,
            },
          ],
          audioClips: [
            {
              id: dialogueClipId,
              name: 'Narrator Voice',
              assetId: audioAssetId,
              role: 'dialogue',
              startMs: 100,
              endMs: 1_200,
              offsetMs: 0,
              volume: 1,
            },
            {
              id: bgmClipId,
              name: 'Scene BGM',
              assetId: audioAssetId,
              role: 'bgm',
              startMs: 0,
              endMs: 2_500,
              offsetMs: 0,
              volume: 0.6,
            },
          ],
          dialogues: [
            {
              id: dialogueId,
              speakerType: 'narrator',
              audioClipId: dialogueClipId,
              subtitleStyleId,
              startMs: 100,
              endMs: 1_200,
              text: '开场旁白',
            },
          ],
          timelineEvents: [],
          camera: {
            mode: 'hybrid',
            keys: [
              {
                timeMs: 0,
                centerX: 960,
                centerY: 540,
                zoom: 1,
                rotationDeg: 0,
                interpolationToNext: 'linear',
              },
              {
                timeMs: 1_500,
                centerX: 900,
                centerY: 520,
                zoom: 1.2,
                rotationDeg: 2,
                interpolationToNext: 'linear',
              },
            ],
            overrides: [
              {
                id: overrideId,
                startMs: 250,
                endMs: 1_500,
                blendInMs: 200,
                blendOutMs: 200,
              },
            ],
            autoFraming: { zoom: 1.3, targetU: 0.5, targetV: 0.45 },
          },
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const editor = new EditorProjectStore();
    const store = new ShotStore(editor, shotService());
    editor.open(root, initialProject);

    store.duplicate(shotId, { mode: 'structure-only' });
    store.duplicate(shotId, {
      mode: 'structure-only',
      includeNonDialogueAudio: true,
    });

    const beforeSave = editor.getSnapshot()!.project;
    expect(beforeSave.shots).toHaveLength(3);
    await projectService.save(root, beforeSave, editor.getSnapshot()!.revision);

    const reopened = await projectService.open(root);
    expect(reopened.project.shots).toEqual(beforeSave.shots);
    expect(reopened.project.assets).toEqual(initialProject.assets);

    const [reopenedSource, copyWithBgm, copyWithoutAudio] = reopened.project.shots;
    expect(reopenedSource!.dialogues).toEqual(initialProject.shots[0]!.dialogues);
    expect(copyWithoutAudio!.name).toBe('Opening 结构副本');
    expect(copyWithoutAudio!.dialogues).toEqual([]);
    expect(copyWithoutAudio!.audioClips).toEqual([]);
    expect(copyWithoutAudio!.camera?.autoFraming).toEqual({
      zoom: 1.3,
      targetU: 0.5,
      targetV: 0.45,
    });
    expect(copyWithoutAudio!.camera?.overrides?.[0]?.id).not.toBe(overrideId);

    expect(copyWithBgm!.name).toBe('Opening 结构副本 2');
    expect(copyWithBgm!.dialogues).toEqual([]);
    expect(copyWithBgm!.audioClips).toHaveLength(1);
    expect(copyWithBgm!.audioClips[0]!.role).toBe('bgm');
    expect(copyWithBgm!.audioClips[0]!.id).not.toBe(bgmClipId);

    store.dispose();
  });
});
