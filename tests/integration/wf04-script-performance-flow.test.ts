import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BrowserWindow, IpcMain } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LayerService,
  ProjectSchema,
  ShotService,
  applyPresetEvents,
  applyScriptPerformancePlan,
  createPresetEvents,
  planScriptPerformance,
  type AudioAsset,
  type Character,
  type Project,
} from '../../src/domain';
import { startDesktopAutomation } from '../../src/main/ipc/desktop-automation';
import { executeDesktopAutomation } from '../../src/renderer/shell/desktopAutomationCommands';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ScenePreviewStore } from '../../src/renderer/stores/scenePreviewStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { DesktopAutomationRendererRequestSchema } from '../../src/shared/desktop-automation-api';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import { IDS, buildProject } from '../unit/domain/testProject';

const exec = promisify(execFile);

const SESSION_ID = '14141000-0000-4000-8000-000000000001';
const REQUEST_ID = '14141000-0000-4000-8000-000000000002';

function makeAudioAsset(
  id: string,
  name: string,
  durationMs: number,
): AudioAsset {
  return {
    id,
    kind: 'audio',
    name,
    relativePath: `assets/audio/${name}.wav`,
    mimeType: 'audio/wav',
    sha256: id.replaceAll('-', '').padEnd(64, 'b').slice(0, 64),
    durationMs,
  };
}

const CHAR2_VOICE_ID = '14141000-0000-4000-8000-000000000104';

function buildIntegrationProject(): Project {
  const base = buildProject();
  const char1: Character = {
    ...base.characters[0]!,
    name: '师兄',
  };
  const char2: Character = {
    id: '14141000-0000-4000-8000-000000000101',
    name: '小师妹',
    mode: 'single-image',
    baseAssetId: IDS.assetChar,
    defaultVoiceProfileId: CHAR2_VOICE_ID,
    defaultScale: 1,
    defaultFlipX: false,
    defaultExpressionId: '14141000-0000-4000-8000-000000000102',
    expressions: [
      {
        id: '14141000-0000-4000-8000-000000000102',
        name: '开心',
        assetId: IDS.assetChar,
      },
      {
        id: '14141000-0000-4000-8000-000000000103',
        name: '生气',
        assetId: IDS.assetChar2,
      },
    ],
  };

  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      makeAudioAsset('14141000-0000-4000-8000-000000000201', '1_师兄', 1_800),
      makeAudioAsset('14141000-0000-4000-8000-000000000202', '2_小师妹', 2_400),
      makeAudioAsset('14141000-0000-4000-8000-000000000203', '3_小师妹', 1_600),
      makeAudioAsset('14141000-0000-4000-8000-000000000204', '4_师兄', 1_500),
    ],
    characters: [char1, char2],
    voiceProfiles: [
      ...base.voiceProfiles,
      {
        id: CHAR2_VOICE_ID,
        name: '小师妹配音',
        characterId: char2.id,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ],
  });
}

const TWO_SHOT_SCRIPT = [
  '镜头：宗门大厅',
  '背景：背景',
  '出场：师兄、小师妹',
  '站位：双人对话',
  '对白：',
  '师兄：听我解释。',
  '小师妹：你又偷懒了！',
  '表演：',
  '1｜抖动',
  '2｜表情｜生气',
  '---',
  '镜头：花园',
  '背景：背景',
  '出场：师兄、小师妹',
  '站位：双人对话',
  '对白：',
  '小师妹：快去修炼。',
  '师兄：知道了。',
  '表演：',
  '3｜淡入',
  '4｜移动｜x=1260｜y=760',
].join('\n');

function extractSemanticSignature(project: Project) {
  return project.shots.slice(1).map((shot) => ({
    name: shot.name,
    durationMs: shot.durationMs,
    layerCount: shot.layers.length,
    dialogues: shot.dialogues.map((d) => ({
      text: d.text,
      startMs: d.startMs,
      endMs: d.endMs,
      characterId: d.characterId,
      hasAudioClip: Boolean(d.audioClipId),
    })),
    audioClips: shot.audioClips.map((c) => ({
      assetId: c.assetId,
      startMs: c.startMs,
      endMs: c.endMs,
      offsetMs: c.offsetMs,
      role: c.role,
    })),
    events: shot.timelineEvents.map((e) => ({
      type: e.type,
      startMs: e.startMs,
      endMs: e.endMs,
    })),
  }));
}

afterEach(() => {
  editorProjectStore.clear();
});

describe('WF-04 integration: UI single-commit + post-apply editing + Undo/Redo + save/reopen + CLI equivalence', () => {
  it('previews without mutating Project, commits in 1 Undo/Redo, supports post-apply keyframe/camera editing and save/reopen', () => {
    const project = buildIntegrationProject();
    editorProjectStore.open('C:/projects/wf04-ui.pandastage', project);
    const previewStore = new ScenePreviewStore({ editorStore: editorProjectStore });

    // Preview & cancel never writes Project
    const plan = planScriptPerformance(
      editorProjectStore.getSnapshot()!.project,
      TWO_SHOT_SCRIPT,
    );
    expect(plan.candidateProject).not.toBeNull();
    previewStore.setPreview({
      previewProject: plan.candidateProject!,
      previewShotId: plan.createdShotIds[0]!,
      previewShotName: '宗门大厅',
      shotIndex: 0,
      shotCount: 2,
    });
    previewStore.clear();
    expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
    expect(editorProjectStore.getSnapshot()!.dirty).toBe(false);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

    // Apply in ONE updateProject commit
    const applied = applyScriptPerformancePlan(
      editorProjectStore.getSnapshot()!.project,
      plan,
      { allowPartialConfirm: false },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    editorProjectStore.updateProject(applied.project, '剧本表演生成');
    shotStore.select(applied.firstShotId);
    expect(editorProjectStore.getSnapshot()!.revision).toBe(1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);

    // Post-apply ordinary editing: layer transform + extra timeline event + camera update
    const generatedShot = editorProjectStore
      .getSnapshot()!
      .project.shots.find((s) => s.name === '宗门大厅')!;
    const charLayer = generatedShot.layers.find(
      (l) => l.source.kind === 'character',
    )!;
    const withTransform = new LayerService().updateTransform(
      editorProjectStore.getSnapshot()!.project,
      generatedShot.id,
      charLayer.id,
      {
        x: 700,
        y: 500,
        scale: charLayer.scaleX,
        rotationDeg: charLayer.rotationDeg,
        flipX: charLayer.flipX,
        opacity: charLayer.opacity,
      },
    );
    const extraEvents = createPresetEvents(
      withTransform,
      generatedShot.id,
      charLayer.id,
      'fade-in',
      { startMs: 0, durationMs: 400 },
    );
    const withExtraAction = applyPresetEvents(
      withTransform,
      generatedShot.id,
      extraEvents,
    );
    const withCamera = new ShotService().setCameraAutoFraming(
      withExtraAction,
      generatedShot.id,
      { zoom: 1.2 },
    );
    editorProjectStore.updateProject(withCamera, '手动微调图层、动作与相机');

    // Save & reopen roundtrip preserves generated shots, dialogues, audio, actions, and manual edits
    const reopened = ProjectSchema.parse(
      JSON.parse(JSON.stringify(editorProjectStore.getSnapshot()!.project)),
    );
    const reopenedShot = reopened.shots.find((s) => s.name === '宗门大厅')!;
    expect(reopenedShot.camera?.autoFraming?.zoom).toBe(1.2);
    expect(reopenedShot.dialogues).toHaveLength(2);
    expect(reopenedShot.audioClips).toHaveLength(2);
    expect(reopenedShot.timelineEvents).toHaveLength(3);
    expect(
      reopenedShot.layers.find((l) => l.id === charLayer.id),
    ).toMatchObject({ x: 700, y: 500 });

    // Undo manual edit, then 1 Undo removes the entire WF-04 script batch cleanly
    editorProjectStore.undo();
    editorProjectStore.undo();
    expect(editorProjectStore.getSnapshot()!.project.shots).toHaveLength(1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

    // 1 Redo restores the entire WF-04 script batch cleanly
    editorProjectStore.redo();
    expect(editorProjectStore.getSnapshot()!.project.shots).toHaveLength(3);

    previewStore.dispose();
  });

  it('produces semantically equivalent editable Project via real desktop CLI (panda-live.cjs) with session check and 1 Undo', async () => {
    const project = buildIntegrationProject();

    // Direct UI/domain baseline
    const uiPlan = planScriptPerformance(project, TWO_SHOT_SCRIPT);
    const uiApplied = applyScriptPerformancePlan(project, uiPlan, {
      allowPartialConfirm: false,
    });
    expect(uiApplied.ok).toBe(true);
    if (!uiApplied.ok) return;

    // Real CLI + desktop automation socket server
    editorProjectStore.open('C:/projects/wf04-cli.pandastage', project);
    shotStore.select(IDS.shot);

    const dir = await mkdtemp(path.join(tmpdir(), 'panda-wf04-cli-'));
    const senderFrame = { routingId: 17 };
    const ipc = Object.assign(new EventEmitter(), {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    });
    const previewFn = vi.fn(() => true);
    const sender = {
      id: 21,
      mainFrame: senderFrame,
      isLoadingMainFrame: () => false,
      send: vi.fn((channel: string, raw: unknown) => {
        expect(channel).toBe(IPC_CHANNELS.DESKTOP_AUTOMATION_REQUEST);
        const request = DesktopAutomationRendererRequestSchema.parse(raw);
        const result = executeDesktopAutomation(request, previewFn);
        ipc.emit(
          IPC_CHANNELS.DESKTOP_AUTOMATION_RESPONSE,
          { sender, senderFrame },
          { requestId: request.requestId, result },
        );
      }),
    };

    const cli = path.resolve('scripts/panda-live.cjs');
    const close = await startDesktopAutomation({
      ipcMain: ipc as unknown as IpcMain,
      userData: dir,
      cliFile: cli,
      appVersion: '0.1.0',
      getWindow: () =>
        ({ isDestroyed: () => false, webContents: sender }) as unknown as BrowserWindow,
    });

    try {
      const descriptorName = (await readdir(dir)).find((name) =>
        name.startsWith('desktop-automation-'),
      )!;
      const descriptorFile = path.join(dir, descriptorName);

      // 1. Read session state
      const stateOut = await exec(process.execPath, [
        cli,
        '--session-file',
        descriptorFile,
        'state',
      ]);
      const stateJson = JSON.parse(stateOut.stdout);
      expect(stateJson.ok).toBe(true);
      const session = stateJson.data.session;

      // 2. script.plan (read-only, changed=false)
      const planOut = await exec(process.execPath, [
        cli,
        '--session-file',
        descriptorFile,
        'script.plan',
        JSON.stringify({ session, script: TWO_SHOT_SCRIPT }),
      ]);
      const planJson = JSON.parse(planOut.stdout);
      expect(planJson).toMatchObject({
        ok: true,
        data: {
          command: 'script.plan',
          changed: false,
          applicableBlockCount: 2,
          scheduledDialogueCount: 4,
          readyPerformanceCount: 4,
          hasIssues: false,
        },
      });
      expect(editorProjectStore.getSnapshot()!.revision).toBe(0);

      // 3. script.apply commits in ONE History entry
      const applyOut = await exec(process.execPath, [
        cli,
        '--session-file',
        descriptorFile,
        'script.apply',
        JSON.stringify({ session, script: TWO_SHOT_SCRIPT }),
      ]);
      const applyJson = JSON.parse(applyOut.stdout);
      expect(applyJson).toMatchObject({
        ok: true,
        data: {
          command: 'script.apply',
          changed: true,
          revision: 1,
          dirty: true,
          scheduledDialogueCount: 4,
          readyPerformanceCount: 4,
        },
      });
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);

      // 4. Semantic equivalence between UI/domain result and CLI result (ignoring UUIDs)
      const cliProject = editorProjectStore.getSnapshot()!.project;
      expect(extractSemanticSignature(cliProject)).toEqual(
        extractSemanticSignature(uiApplied.project),
      );

      // 5. CLI undo rolls back the entire batch in 1 step
      const undoOut = await exec(process.execPath, [
        cli,
        '--session-file',
        descriptorFile,
        'undo',
        JSON.stringify({ session }),
      ]);
      expect(JSON.parse(undoOut.stdout)).toMatchObject({ ok: true });
      expect(editorProjectStore.getSnapshot()!.project.shots).toHaveLength(1);

      // 6. Stale session check still enforced for script.apply
      editorProjectStore.open('C:/projects/wf04-cli-other.pandastage', project);
      const staleRes = executeDesktopAutomation(
        DesktopAutomationRendererRequestSchema.parse({
          requestId: REQUEST_ID,
          sessionId: SESSION_ID,
          deadlineMs: Date.now() + 5_000,
          appVersion: '0.1.0',
          command: { name: 'script.apply', session, script: TWO_SHOT_SCRIPT },
        }),
        previewFn,
      );
      expect(staleRes).toMatchObject({ ok: false, code: 'STALE_SESSION' });
    } finally {
      close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('R3: keeps UI planner and desktop CLI semantically equivalent for manual audio swap, explicit source range, and explicit unlink', () => {
    const project = buildIntegrationProject();
    const audio1Id = '14141000-0000-4000-8000-000000000201';
    const audio4Id = '14141000-0000-4000-8000-000000000204';
    const singleShotScript = [
      '镜头：手选源区间验证',
      '背景：背景',
      '出场：师兄、小师妹',
      '站位：双人对话',
      '对白：',
      '师兄：第一句换音并裁区间。',
      '小师妹：第二句显式留草稿。',
    ].join('\n');

    // Direct UI/domain path
    const initialUi = planScriptPerformance(project, singleShotScript);
    const uiPlan = planScriptPerformance(project, singleShotScript, {
      previousDialogueRows: initialUi.dialogueDraftRows,
      overrides: {
        audioByDraftRowId: {
          [initialUi.dialogues[0]!.draftRowId]: {
            audioAssetId: audio4Id,
            sourceStartMs: 250,
            sourceEndMs: 1_150,
          },
          [initialUi.dialogues[1]!.draftRowId]: {
            audioAssetId: null,
          },
        },
      },
    });
    const uiApplied = applyScriptPerformancePlan(project, uiPlan, {
      allowPartialConfirm: true,
    });
    expect(uiApplied.ok).toBe(true);
    if (!uiApplied.ok) return;

    // CLI / desktop automation path
    editorProjectStore.open('C:/projects/wf04-r3-cli.pandastage', project);
    shotStore.select(IDS.shot);
    const session = {
      sessionId: SESSION_ID,
      projectId: project.id,
      instanceId: editorProjectStore.getProjectInstanceId()!,
    };
    const cliRes = executeDesktopAutomation(
      DesktopAutomationRendererRequestSchema.parse({
        requestId: REQUEST_ID,
        sessionId: SESSION_ID,
        deadlineMs: Date.now() + 5_000,
        appVersion: '0.1.0',
        command: {
          name: 'script.apply',
          session,
          script: singleShotScript,
          allowPartialConfirm: true,
          audioByOrdinal: {
            '1': {
              audioAssetId: audio4Id,
              sourceStartMs: 250,
              sourceEndMs: 1_150,
            },
            '2': {
              audioAssetId: null,
            },
          },
        },
      }),
      () => true,
    );
    expect(cliRes.ok).toBe(true);
    const cliProject = editorProjectStore.getSnapshot()!.project;
    expect(extractSemanticSignature(cliProject)).toEqual(
      extractSemanticSignature(uiApplied.project),
    );
    const createdShot = cliProject.shots.find((s) => s.name === '手选源区间验证')!;
    expect(createdShot.dialogues).toHaveLength(1);
    expect(createdShot.audioClips[0]).toMatchObject({
      assetId: audio4Id,
      offsetMs: 250,
      startMs: 0,
      endMs: 900,
    });
    expect(createdShot.audioClips[0]!.assetId).not.toBe(audio1Id);
  });
});
