import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../src/main/services/ProjectService';
import { buildProject, IDS } from '../unit/domain/testProject';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('schema v5 dialogue persisted migration', () => {
  it('migrates a real v5 project with an audio-backed dialogue and preserves it across save/reopen', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-v5-'),
    );
    temporaryRoots.push(parent);
    const projectRoot = path.join(parent, 'schema-v5.pandastage');
    const projectFile = path.join(projectRoot, 'project.json');

    // Build a genuine v5-persisted document: start from the valid project
    // fixture (a v6 project), downgrade to schemaVersion 5, and attach a real
    // audio asset + clip + an audio-backed dialogue. At v5 audioClipId is
    // mandatory, so this exercises the actual v5 -> current migration entry.
    const base = JSON.parse(
      JSON.stringify(buildProject()),
    ) as Record<string, unknown>;
    const audioAssetId = '70000000-0000-4000-8000-000000000001';
    const audioClipId = '80000000-0000-4000-8000-000000000001';
    const dialogueId = '90000000-0000-4000-8000-000000000001';

    const assets = base.assets as Record<string, unknown>[];
    assets.push({
      id: audioAssetId,
      kind: 'audio',
      name: '配音片段',
      relativePath: 'voice.wav',
      mimeType: 'audio/wav',
      durationMs: 5000,
    });

    const shots = base.shots as Record<string, unknown>[];
    shots[0] = {
      ...shots[0],
      audioClips: [
        {
          id: audioClipId,
          name: '片段',
          assetId: audioAssetId,
          startMs: 0,
          endMs: 2000,
          offsetMs: 0,
          volume: 1,
        },
      ],
      dialogues: [
        {
          id: dialogueId,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          audioClipId,
          subtitleStyleId: IDS.subtitle,
          startMs: 0,
          endMs: 0,
          text: '你好，世界',
        },
      ],
    };
    base.schemaVersion = 5;

    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      projectFile,
      `${JSON.stringify(base, null, 2)}\n`,
      'utf8',
    );

    const service = new ProjectService();
    const opened = await service.open(projectRoot);
    expect(opened).toMatchObject({
      sourceVersion: 5,
      migrated: true,
      project: { schemaVersion: 6 },
    });

    const dialogue = opened.project.shots[0]!.dialogues[0]!;
    expect(dialogue.id).toBe(dialogueId);
    expect(dialogue.characterId).toBe(IDS.character);
    expect(dialogue.text).toBe('你好，世界');
    expect(dialogue.audioClipId).toBe(audioClipId);
    expect(dialogue.voiceProfileId).toBe(IDS.voiceProfile);
    expect(dialogue.subtitleStyleId).toBe(IDS.subtitle);

    // save then reopen must keep schemaVersion 6 and not re-migrate; the
    // audio-backed dialogue data is preserved exactly.
    await service.save(projectRoot, opened.project, 1);
    const serialized = JSON.parse(await readFile(projectFile, 'utf8'));
    expect(serialized.schemaVersion).toBe(6);

    const reopened = await service.open(projectRoot);
    expect(reopened).toMatchObject({
      sourceVersion: 6,
      migrated: false,
      project: { schemaVersion: 6 },
    });
    const reopenedDialogue = reopened.project.shots[0]!.dialogues[0]!;
    expect(reopenedDialogue.id).toBe(dialogueId);
    expect(reopenedDialogue.characterId).toBe(IDS.character);
    expect(reopenedDialogue.text).toBe('你好，世界');
    expect(reopenedDialogue.audioClipId).toBe(audioClipId);
    expect(reopenedDialogue.voiceProfileId).toBe(IDS.voiceProfile);
    expect(reopenedDialogue.subtitleStyleId).toBe(IDS.subtitle);
  });
});
