import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DialogueService,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
import {
  buildProductPreviewCues,
  listProductPreviewAssetIds,
} from '../../src/renderer/shell/productPreviewModel';
import { resolveProductPreviewAudio } from '../../src/renderer/shell/productPreviewAudio';
import { buildProject, IDS } from '../unit/domain/testProject';

const AUDIO_ID = '10000000-0000-4000-8000-000000000501';
const temporaryParents: string[] = [];

function addAudio(project: Project): Project {
  return ProjectSchema.parse({
    ...project,
    assets: [
      ...project.assets,
      {
        id: AUDIO_ID,
        kind: 'audio',
        name: '集成对白',
        relativePath: 'assets/integration.wav',
        mimeType: 'audio/wav',
        sha256: 'd'.repeat(64),
        durationMs: 2_000,
      },
    ],
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Dialogue audio Product Preview persistence integration', () => {
  it('saves and reopens a bound v6 Dialogue while preview consumes the same shared cue and clip', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-day29-audio-'),
    );
    temporaryParents.push(parent);
    const root = path.join(parent, 'dialogue-audio.pandastage');
    const projectService = new ProjectService({
      createId: (() => {
        let counter = 0;
        return () =>
          `d2950000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
    });
    const created = await projectService.create(root, {
      name: 'Day29 audio preview',
    });
    const dialogueService = new DialogueService({
      createId: (() => {
        let counter = 100;
        return () =>
          `d2950000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
      now: () => new Date('2026-08-17T12:30:00.000Z'),
    });
    let project = addAudio(
      ProjectSchema.parse({
        ...buildProject(),
        id: created.project.id,
        name: created.project.name,
        createdAt: created.project.createdAt,
        updatedAt: created.project.updatedAt,
      }),
    );
    project = dialogueService.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '集成对白',
      pointTimeMs: 500,
    });
    const dialogueId = project.shots[0]!.dialogues[0]!.id;
    project = dialogueService.setTiming(project, {
      shotId: IDS.shot,
      dialogueId,
      startMs: 500,
      endMs: 1_500,
    });
    project = dialogueService.bindAudio(project, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_ID,
    });
    await projectService.save(root, project, 1);

    const reopened = await projectService.open(root);
    const reopenedShot = reopened.project.shots[0]!;
    const reopenedDialogue = reopenedShot.dialogues[0]!;
    expect(reopened.project.schemaVersion).toBe(6);
    expect(reopenedDialogue.audioClipId).toBeDefined();
    expect(reopenedShot.audioClips).toHaveLength(1);
    expect(reopenedShot.audioClips[0]).toMatchObject({
      assetId: AUDIO_ID,
      startMs: reopenedDialogue.startMs,
      endMs: reopenedDialogue.endMs,
    });

    const cues = buildProductPreviewCues(reopenedShot);
    expect(evaluateSubtitleAtTime(cues, 750)?.id).toBe(dialogueId);
    expect(
      resolveProductPreviewAudio(
        reopened.project,
        reopenedShot,
        dialogueId,
      )?.clip.assetId,
    ).toBe(AUDIO_ID);
    expect(listProductPreviewAssetIds(reopened.project, reopenedShot)).toContain(
      IDS.assetChar,
    );

    const persisted = await readFile(path.join(root, 'project.json'), 'utf8');
    expect(persisted).not.toContain('"timeMs"');
    expect(persisted).not.toContain('"playing"');
    expect(persisted).not.toContain('"mouthSpeaking"');
    expect(created.project.schemaVersion).toBe(6);
  });
});
