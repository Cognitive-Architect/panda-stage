import { describe, expect, it } from 'vitest';
import {
  applyAutoScenePlan,
  parseAndPlanAutoScenes,
  ProjectSchema,
  ShotService,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ScenePreviewStore } from '../../src/renderer/stores/scenePreviewStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { buildProject } from '../unit/domain/testProject';

describe('WF-03 Auto Scene integration flow (preview, cancel, single-commit Undo/Redo, save/reopen)', () => {
  it('switches read-only preview across planned shots with zero Project mutation and cancel leaves project untouched', () => {
    const project = buildProject();
    const editorStore = new EditorProjectStore();
    editorStore.open('C:/projects/wf03-test', project);
    const previewStore = new ScenePreviewStore({ editorStore });

    const input = [
      '镜头：预览镜头一',
      '背景：背景',
      '出场：熊猫',
      '---',
      '镜头：预览镜头二',
      '背景：无',
      '出场：熊猫',
    ].join('\n');

    const res = parseAndPlanAutoScenes(editorStore.getSnapshot()!.project, input);
    expect(res.plan?.applicableCount).toBe(2);
    const plan = res.plan!;

    // Preview shot 1
    const ok1 = previewStore.setPreview({
      previewProject: plan.candidateProject!,
      previewShotId: plan.blocks[0]!.createdShotId!,
      previewShotName: plan.blocks[0]!.shotName,
      shotIndex: 0,
      shotCount: 2,
    });
    expect(ok1).toBe(true);
    expect(previewStore.getSnapshot()?.previewShotName).toBe('预览镜头一');

    // Switch preview to shot 2
    const ok2 = previewStore.setPreview({
      previewProject: plan.candidateProject!,
      previewShotId: plan.blocks[1]!.createdShotId!,
      previewShotName: plan.blocks[1]!.shotName,
      shotIndex: 1,
      shotCount: 2,
    });
    expect(ok2).toBe(true);
    expect(previewStore.getSnapshot()?.previewShotName).toBe('预览镜头二');

    // Cancel clears preview with ZERO mutation to EditorProjectStore or HistoryStore
    previewStore.clear();
    expect(previewStore.getSnapshot()).toBeNull();
    const snap = editorStore.getSnapshot()!;
    expect(snap.dirty).toBe(false);
    expect(snap.revision).toBe(0);
    expect(snap.project.shots).toHaveLength(project.shots.length);
    expect(editorStore.history.getSnapshot().undoCount).toBe(0);

    previewStore.dispose();
  });

  it('commits multi-shot batch in ONE updateProject (1 Undo / 1 Redo), selects newly created shot, and roundtrips save/reopen', () => {
    const project = buildProject();
    const editorStore = new EditorProjectStore();
    editorStore.open('C:/projects/wf03-commit', project);
    const shotStore = new ShotStore(editorStore, new ShotService());
    const previewStore = new ScenePreviewStore({ editorStore });

    const input = [
      '镜头：正式镜头一',
      '背景：背景',
      '出场：熊猫',
      '时长：3s',
      '---',
      '镜头：正式镜头二',
      '背景：背景',
      '出场：熊猫',
      '时长：4s',
    ].join('\n');

    const res = parseAndPlanAutoScenes(editorStore.getSnapshot()!.project, input);
    const plan = res.plan!;
    previewStore.setPreview({
      previewProject: plan.candidateProject!,
      previewShotId: plan.blocks[0]!.createdShotId!,
      previewShotName: plan.blocks[0]!.shotName,
      shotIndex: 0,
      shotCount: 2,
    });

    const applied = applyAutoScenePlan(editorStore.getSnapshot()!.project, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    // Single updateProject commit
    editorStore.updateProject(applied.project, '自动布景（2 个镜头）');
    shotStore.select(applied.firstShotId);

    // Preview auto-cleared on revision bump
    expect(previewStore.getSnapshot()).toBeNull();

    const afterCommit = editorStore.getSnapshot()!;
    expect(afterCommit.revision).toBe(1);
    expect(afterCommit.dirty).toBe(true);
    expect(afterCommit.project.shots).toHaveLength(project.shots.length + 2);
    expect(shotStore.getCurrentShotId()).toBe(applied.firstShotId);
    expect(editorStore.history.getSnapshot().undoCount).toBe(1);

    // 1 Undo removes BOTH newly created shots cleanly
    editorStore.undo();
    expect(editorStore.getSnapshot()!.project.shots).toHaveLength(project.shots.length);
    expect(editorStore.history.getSnapshot().undoCount).toBe(0);
    expect(editorStore.history.getSnapshot().redoCount).toBe(1);

    // 1 Redo restores BOTH shots cleanly
    editorStore.redo();
    expect(editorStore.getSnapshot()!.project.shots).toHaveLength(project.shots.length + 2);

    // Save & reopen roundtrip preserves normal editable shots/layers
    const serialized = JSON.stringify(editorStore.getSnapshot()!.project);
    const reopened = ProjectSchema.parse(JSON.parse(serialized));
    editorStore.open('C:/projects/wf03-commit', reopened);
    expect(editorStore.getSnapshot()!.project.shots.map((s) => s.name)).toContain(
      '正式镜头一',
    );
    expect(editorStore.getSnapshot()!.project.shots.map((s) => s.name)).toContain(
      '正式镜头二',
    );

    // Verify reopened shot is normal editable data
    const newShotId = editorStore
      .getSnapshot()!
      .project.shots.find((s) => s.name === '正式镜头一')!.id;
    shotStore.rename(newShotId, '正式镜头一（已手动改名）');
    expect(
      editorStore
        .getSnapshot()!
        .project.shots.find((s) => s.id === newShotId)?.name,
    ).toBe('正式镜头一（已手动改名）');

    previewStore.dispose();
    shotStore.dispose();
  });
});
