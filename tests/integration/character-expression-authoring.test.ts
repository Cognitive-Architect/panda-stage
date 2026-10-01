import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSchema, evaluateShotAtTime } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { expressionAuthoringStore } from '../../src/renderer/features/properties/expressionAuthoringStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { projectProductPreviewMouth } from '../../src/renderer/shell/productPreviewModel';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { buildProject, IDS } from '../unit/domain/testProject';

const temporaryParents: string[] = [];

afterEach(async () => {
  editorProjectStore.clear();
  selectionStore.clear();
  await Promise.all(temporaryParents.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe('Issue #627 Character Expression editor bridge', () => {
  it('creates, replaces, deletes and replays one History step per action', () => {
    const base = buildProject();
    editorProjectStore.open('expression-history.pandastage', base);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);
    timelineUiStore.seek(1_000, 3_000);
    const before = editorProjectStore.getSnapshot()!;

    expect(expressionAuthoringStore.setAtCurrentTime(IDS.expressionAngry)).toMatchObject({ ok: true, changed: true });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    const first = editorProjectStore.getSnapshot()!;
    const event = first.project.shots[0]!.timelineEvents[0]!;
    expect(event).toMatchObject({ type: 'expression', layerId: IDS.layerChar, startMs: 1_000 });
    expect(first.dirty).toBe(true);
    expect(first.revision).toBe(before.revision + 1);

    expect(expressionAuthoringStore.setAtCurrentTime(IDS.expressionAngry)).toMatchObject({ ok: true, changed: false });
    expect(editorProjectStore.getSnapshot()).toBe(first);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);

    timelineUiStore.seek(2_000, 3_000);
    const historyBeforeInheritedNoOp = editorProjectStore.history.getSnapshot();
    expect(expressionAuthoringStore.setAtCurrentTime(IDS.expressionAngry)).toMatchObject({ ok: true, changed: false });
    expect(editorProjectStore.getSnapshot()).toBe(first);
    expect(editorProjectStore.history.getSnapshot()).toEqual(historyBeforeInheritedNoOp);
    expect(first.project.shots[0]!.timelineEvents).toHaveLength(1);
    timelineUiStore.seek(1_000, 3_000);

    expect(expressionAuthoringStore.setAtCurrentTime(IDS.expressionNormal)).toMatchObject({ ok: true, changed: true });
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents).toHaveLength(1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
    expect(editorProjectStore.undo()).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents[0]).toMatchObject({
      id: event.id, expressionId: IDS.expressionAngry,
    });
    expect(editorProjectStore.redo()).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents[0]).toMatchObject({
      id: event.id, expressionId: IDS.expressionNormal,
    });

    expect(expressionAuthoringStore.delete(event.id)).toMatchObject({ ok: true, changed: true });
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents).toHaveLength(0);
    expect(editorProjectStore.undo()).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents).toHaveLength(1);
    expect(editorProjectStore.redo()).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents).toHaveLength(0);
  });

  it('rejects missing/ordinary image selections and shot end without a write', () => {
    editorProjectStore.open('expression-guards.pandastage', buildProject());
    const initial = editorProjectStore.getSnapshot()!;
    expect(expressionAuthoringStore.setAtCurrentTime(IDS.expressionAngry).ok).toBe(false);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerAsset);
    expect(expressionAuthoringStore.setAtCurrentTime(IDS.expressionAngry).ok).toBe(false);
    selectionStore.select(IDS.layerChar);
    timelineUiStore.seek(3_000, 3_000);
    expect(expressionAuthoringStore.setAtCurrentTime(IDS.expressionAngry).ok).toBe(false);
    expect(editorProjectStore.getSnapshot()).toBe(initial);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
  });

  it('saves and reopens the authored occurrence/event through ProjectService', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-expression-'));
    temporaryParents.push(parent);
    const root = path.join(parent, '表情验收.pandastage');
    const service = new ProjectService();
    const created = await service.create(root, { name: '表情验收' });
    const base = buildProject();
    editorProjectStore.open(root, ProjectSchema.parse({ ...base, id: created.project.id }));
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);
    timelineUiStore.seek(1_000, 3_000);
    expect(expressionAuthoringStore.setAtCurrentTime(IDS.expressionAngry).ok).toBe(true);
    const authored = editorProjectStore.getSnapshot()!;
    await service.save(root, authored.project, authored.revision);
    editorProjectStore.clear();
    const reopened = await service.open(root);
    const event = reopened.project.shots[0]!.timelineEvents[0]!;
    expect(event).toMatchObject({ type: 'expression', layerId: IDS.layerChar, expressionId: IDS.expressionAngry });
    expect(evaluateShotAtTime(reopened.project.shots[0]!, 1_000, reopened.project).layers.find(
      (layer) => layer.id === IDS.layerChar,
    )?.currentExpressionId).toBe(IDS.expressionAngry);
  });

  it('projects one audio-relative Mouth cadence over an authored Expression switch without writes', () => {
    const mouthId = '10000000-0000-4000-8000-000000000901';
    const audioId = '10000000-0000-4000-8000-000000000902';
    const clipId = '70000000-0000-4000-8000-000000000901';
    const dialogueId = '80000000-0000-4000-8000-000000000901';
    const base = buildProject();
    const project = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets,
        { id: mouthId, kind: 'image', name: 'Mouth', relativePath: 'assets/mouth.png',
          mimeType: 'image/png', width: 640, height: 640 },
        { id: audioId, kind: 'audio', name: 'Speech', relativePath: 'assets/speech.wav',
          mimeType: 'audio/wav', durationMs: 3_000 },
      ],
      characters: base.characters.map((character) => ({ ...character, mouthOpenAssetId: mouthId })),
      shots: base.shots.map((shot) => ({
        ...shot,
        durationMs: 5_000,
        dialogues: [{
          id: dialogueId, characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile, subtitleStyleId: IDS.subtitle,
          audioClipId: clipId, startMs: 1_000, endMs: 4_200, text: 'Speech',
        }],
        audioClips: [{
          id: clipId, name: 'Speech', assetId: audioId,
          role: 'dialogue', startMs: 1_000, endMs: 4_000, offsetMs: 0, volume: 1,
        }],
      })),
    });
    editorProjectStore.open('mouth-expression-cadence.pandastage', project);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);
    timelineUiStore.seek(3_000, 5_000);
    expect(expressionAuthoringStore.setAtCurrentTime(IDS.expressionAngry)).toMatchObject({
      ok: true, changed: true,
    });
    const authored = editorProjectStore.getSnapshot()!;
    const history = editorProjectStore.history.getSnapshot();
    const shot = authored.project.shots[0]!;
    const readyAssetIds = new Set([IDS.assetBg, IDS.assetChar, IDS.assetChar2, mouthId]);

    for (const [timeMs, expectedAssetId, expectedExpressionId] of [
      [2_160, IDS.assetChar, IDS.expressionNormal],
      [3_000, mouthId, IDS.expressionAngry],
      [3_160, IDS.assetChar2, IDS.expressionAngry],
      [3_000, mouthId, IDS.expressionAngry],
      [4_000, IDS.assetChar2, IDS.expressionAngry],
    ] as const) {
      timelineUiStore.seek(timeMs, shot.durationMs);
      const editor = buildEditorTemporalCanvasModel({
        project: authored.project, shot, currentTimeMs: timeMs,
        activeDialogueId: dialogueId, readyAssetIds, previousVisuals: new Map(),
      });
      const preview = projectProductPreviewMouth(
        authored.project, shot, evaluateShotAtTime(shot, timeMs, authored.project), dialogueId,
      );
      const editorLayer = editor.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar);
      const previewLayer = preview.layers.find((layer) => layer.id === IDS.layerChar);
      expect(editorLayer).toEqual(previewLayer);
      expect(editorLayer).toMatchObject({
        assetId: expectedAssetId, currentExpressionId: expectedExpressionId,
        mouthOverrideAssetId: expectedAssetId === mouthId ? mouthId : null,
      });
    }
    expect(editorProjectStore.getSnapshot()).toBe(authored);
    expect(editorProjectStore.history.getSnapshot()).toEqual(history);
    expect(authored).toMatchObject({ revision: 1, dirty: true });
  });
});
