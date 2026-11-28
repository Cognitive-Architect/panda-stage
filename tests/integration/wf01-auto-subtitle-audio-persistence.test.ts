import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AutoSubtitleAudioService,
  DialogueService,
  ProjectSchema,
  matchDialogueAudioRows,
  type AudioAsset,
  type Character,
  type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { DialogueStore } from '../../src/renderer/stores/dialogueStore';
import { buildProductPreviewCues } from '../../src/renderer/shell/productPreviewModel';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
import { buildProject, IDS } from '../unit/domain/testProject';

const TIGER_ID = '20000000-0000-4000-8000-000000000088';
const TIGER_EXPR_ID = '20000000-0000-4000-8000-000000000087';
const TIGER_VOICE_ID = '30000000-0000-4000-8000-000000000088';
const temporaryParents: string[] = [];

function audioAsset(index: number, name: string, durationMs: number): AudioAsset {
  return {
    id: `10000000-0000-4000-8000-${String(800 + index).padStart(12, '0')}`,
    kind: 'audio',
    name,
    relativePath: `assets/${name}.wav`,
    mimeType: 'audio/wav',
    sha256: String(index % 10).repeat(64),
    durationMs,
  };
}

function buildIntegrationProject(projectId: string, assets: readonly AudioAsset[]): Project {
  const base = buildProject();
  const tiger: Character = {
    id: TIGER_ID,
    name: '老虎',
    mode: 'single-image',
    baseAssetId: IDS.assetChar,
    defaultVoiceProfileId: TIGER_VOICE_ID,
    expressions: [{ id: TIGER_EXPR_ID, name: '正常', assetId: IDS.assetChar }],
    defaultExpressionId: TIGER_EXPR_ID,
    defaultScale: 1,
    defaultFlipX: false,
  };
  return ProjectSchema.parse({
    ...base,
    id: projectId,
    assets: [...base.assets, ...assets],
    characters: [{ ...base.characters[0]!, name: '熊猫' }, tiger],
    voiceProfiles: [
      ...base.voiceProfiles,
      {
        ...base.voiceProfiles[0]!,
        id: TIGER_VOICE_ID,
        characterId: TIGER_ID,
        name: '老虎默认音色',
      },
    ],
    shots: [{ ...base.shots[0]!, durationMs: 3_000 }],
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('WF-01 auto subtitle & audio batch Undo/Redo and persistence integration', () => {
  it('commits batch + shot extension in 1 Undo/Redo, preserves save/reopen editability, and keeps plain batch working', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-wf01-'),
    );
    temporaryParents.push(parent);
    const root = path.join(parent, 'wf01.pandastage');

    const projectService = new ProjectService();
    const created = await projectService.create(root, { name: 'WF-01 Integration' });
    const assets = [
      audioAsset(1, '1_旁白', 1_200),
      audioAsset(2, '2_熊猫', 1_800),
      audioAsset(3, '3_老虎', 1_500),
    ];
    const initialProject = buildIntegrationProject(created.project.id, assets);

    const editorStore = new EditorProjectStore();
    editorStore.open(root, initialProject);
    const selectedIds: string[] = [];
    const dialogueStore = new DialogueStore(
      editorStore,
      { getCurrentShotId: () => IDS.shot },
      new DialogueService(),
      { getSnapshot: () => ({ currentTimeMs: 0 }) },
      { select: (id) => selectedIds.push(id) },
    );

    const match = matchDialogueAudioRows(
      initialProject,
      [
        { draftRowId: 'd1', ordinal: 1, sourceLineNumber: 1, text: '片头旁白', speakerType: 'narrator', speakerName: '旁白' },
        { draftRowId: 'd2', ordinal: 2, sourceLineNumber: 2, text: '你好老虎', speakerType: 'character', characterId: IDS.character, speakerName: '熊猫', sourceStartMs: 200, sourceEndMs: 1_600 },
        { draftRowId: 'd3', ordinal: 3, sourceLineNumber: 3, text: '你好熊猫', speakerType: 'character', characterId: TIGER_ID, speakerName: '老虎' },
      ],
      { shotId: IDS.shot },
    );
    expect(match.allReady).toBe(true);

    // Pure preview does not dirty store or push History.
    const planner = new AutoSubtitleAudioService();
    const plan = planner.plan(initialProject, {
      shotId: IDS.shot,
      startMs: 0,
      rows: match.readyRows.map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        audioAssetId: row.audioAssetId!,
        sourceStartMs: row.sourceStartMs!,
        sourceEndMs: row.sourceEndMs!,
      })),
    });
    expect(plan.needsShotExtension).toBe(true);
    expect(plan.extensionToMs).toBe(4_100);
    expect(editorStore.history.getSnapshot().undoCount).toBe(0);
    expect(editorStore.getSnapshot()!.dirty).toBe(false);

    // One-click apply -> 1 Undo entry.
    const result = dialogueStore.applyAudioBatch({
      startMs: 0,
      rows: plan.rows.map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        audioAssetId: row.audioAssetId,
        sourceStartMs: row.sourceStartMs,
        sourceEndMs: row.sourceEndMs,
      })),
      extendShotToMs: 4_100,
    });
    expect(result.dialogueIds).toHaveLength(3);
    expect(editorStore.history.getSnapshot().undoCount).toBe(1);
    expect(editorStore.getSnapshot()!.project.shots[0]!.durationMs).toBe(4_100);
    expect(selectedIds[0]).toBe(result.dialogueIds[0]);

    // 1 Undo restores original project (no dialogues, no clips, original 3000ms shot).
    expect(editorStore.undo()).toBe(true);
    expect(editorStore.getSnapshot()!.project).toEqual(initialProject);

    // 1 Redo restores the entire generated batch + shot extension.
    expect(editorStore.redo()).toBe(true);
    const restored = editorStore.getSnapshot()!.project;
    expect(restored.shots[0]!.durationMs).toBe(4_100);
    expect(restored.shots[0]!.dialogues).toHaveLength(3);
    expect(restored.shots[0]!.audioClips[1]).toMatchObject({
      startMs: 1_200,
      endMs: 2_600,
      offsetMs: 200,
    });

    // Save and reopen from disk.
    await projectService.save(root, restored, 1);
    const reopened = (await projectService.open(root)).project;
    expect(reopened.shots[0]!.durationMs).toBe(4_100);
    expect(reopened.shots[0]!.dialogues).toHaveLength(3);
    expect(reopened.shots[0]!.audioClips).toHaveLength(3);
    expect(
      evaluateSubtitleAtTime(buildProductPreviewCues(reopened.shots[0]!), 1_500)?.text,
    ).toBe('你好老虎');

    // Reopened dialogues remain normally editable, and plain subtitle batch add still works.
    const edited = new DialogueService().update(reopened, {
      shotId: IDS.shot,
      dialogueId: reopened.shots[0]!.dialogues[1]!.id,
      text: '你好老虎（已修改）',
    });
    expect(edited.shots[0]!.dialogues[1]!.text).toBe('你好老虎（已修改）');

    dialogueStore.createMany([{ speakerType: 'narrator', text: '纯字幕补充' }]);
    expect(editorStore.getSnapshot()!.project.shots[0]!.dialogues).toHaveLength(4);
  });
});
