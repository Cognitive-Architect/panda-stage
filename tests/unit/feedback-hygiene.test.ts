import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { buildEditorStageRenderModel, migrateProject, ProjectSchema } from '../../src/domain';
import {
  CANVAS_PENDING_FEEDBACK_DELAY_MS,
  failedRequiredCanvasLayers,
  scheduleCanvasPendingFeedback,
  type CanvasPendingFeedbackScheduler,
} from '../../src/renderer/features/canvas/canvasReadinessFeedback';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';
import { ShotManager } from '../../src/renderer/features/shots/ShotManager';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';
import { buildProject, IDS } from './domain/testProject';

function createScheduler(): {
  scheduler: CanvasPendingFeedbackScheduler;
  advance(ms: number): void;
  pendingCount(): number;
} {
  let now = 0;
  let nextHandle = 0;
  const pending = new Map<number, { dueAt: number; callback: () => void }>();
  return {
    scheduler: {
      setTimeout(callback, delayMs) {
        const handle = ++nextHandle;
        pending.set(handle, { dueAt: now + delayMs, callback });
        return handle;
      },
      clearTimeout(handle) {
        pending.delete(handle);
      },
    },
    advance(ms) {
      now += ms;
      for (const [handle, task] of pending) {
        if (task.dueAt > now) continue;
        pending.delete(handle);
        task.callback();
      }
    },
    pendingCount: () => pending.size,
  };
}

describe('Issue #641 feedback hierarchy', () => {
  it('suppresses fast Canvas pending copy without delaying readiness', () => {
    const clock = createScheduler();
    let shown = false;
    const dispose = scheduleCanvasPendingFeedback(() => { shown = true; }, clock.scheduler);
    expect(CANVAS_PENDING_FEEDBACK_DELAY_MS).toBe(300);
    clock.advance(299);
    expect(shown).toBe(false);
    dispose(); // resources became ready before the grace period ended
    clock.advance(1_000);
    expect(shown).toBe(false);
    expect(clock.pendingCount()).toBe(0);
  });

  it('shows one compact neutral Canvas status for sustained waiting and cancels stale callbacks', () => {
    const clock = createScheduler();
    let shows = 0;
    const dispose = scheduleCanvasPendingFeedback(() => { shows += 1; }, clock.scheduler);
    clock.advance(299);
    expect(shows).toBe(0);
    clock.advance(1);
    expect(shows).toBe(1);
    dispose();
    clock.advance(1_000);
    expect(shows).toBe(1);

    const canvas = readFileSync('src/renderer/features/canvas/CanvasStage.tsx', 'utf8');
    const styles = readOrderedStylesheetSource();
    expect(canvas).toContain('return scheduleCanvasPendingFeedback(() => {');
    expect(canvas).toContain('routineVisualPending && visiblePendingKey === pendingFeedbackKey');
    expect(canvas).toContain('className="canvas-stage-message canvas-stage-pending"');
    expect(canvas).toContain('正在准备素材…');
    expect(canvas).toContain('hasRequiredVisualFailure || hasMouthVisualDegradation');
    expect(canvas).toContain('角色素材读取失败');
    expect(styles).toContain('.canvas-stage-pending {');
    expect(styles).toContain('color: var(--ui-color-text-secondary);');
  });

  it('keeps known ordinary-image and Character required-resource failures immediate', () => {
    const base = buildProject();
    const project = ProjectSchema.parse({
      ...base,
      shots: [{
        ...base.shots[0]!,
        layers: base.shots[0]!.layers.map((layer) => layer.id === IDS.layerAsset
          ? { ...layer, source: { kind: 'asset', assetId: IDS.assetChar2 } }
          : layer),
      }],
    });
    const stage = buildEditorStageRenderModel(project, project.shots[0]!);
    const ordinaryFailed = failedRequiredCanvasLayers(stage.layers, new Set([IDS.assetChar2]));
    expect(ordinaryFailed.map(({ layer }) => layer.id)).toContain(IDS.layerAsset);
    expect(ordinaryFailed.map(({ layer }) => layer.id)).not.toContain(IDS.layerBg);
    const characterFailed = failedRequiredCanvasLayers(stage.layers, new Set([IDS.assetChar]));
    expect(characterFailed.map(({ layer }) => layer.id)).toContain(IDS.layerChar);
    expect(failedRequiredCanvasLayers(stage.layers, new Set([IDS.assetBg]))).toEqual([]);
    expect(failedRequiredCanvasLayers(stage.layers, new Set())).toEqual([]);

    const canvas = readFileSync('src/renderer/features/canvas/CanvasStage.tsx', 'utf8');
    expect(canvas).toContain('failedRequiredCanvasLayers(');
    expect(canvas).toContain('failedRequiredVisualLayers.length > 0');
    expect(canvas).toContain('素材读取失败');
    expect(canvas).toContain('角色素材读取失败');
    expect(canvas).toContain('!hasRequiredVisualFailure &&');
  });

  it('keeps local Character/Shot statuses for errors, not routine success or save state', () => {
    const project = migrateProject(exampleProject);
    const snapshot = {
      projectRoot: 'D:/issue-641.pandastage',
      project,
      dirty: false,
      revision: 0,
    };
    const characterMarkup = renderToStaticMarkup(createElement(CharacterManager, { snapshot }));
    const shotMarkup = renderToStaticMarkup(createElement(ShotManager, { snapshot }));
    expect(characterMarkup).not.toContain('character-manager-status');
    expect(shotMarkup).not.toContain('shot-manager-status');

    const character = readFileSync('src/renderer/features/characters/CharacterManager.tsx', 'utf8');
    const shot = readFileSync('src/renderer/features/shots/ShotManager.tsx', 'utf8');
    expect(character).not.toContain('项目尚未保存');
    expect(shot).not.toContain('项目尚未保存');
    expect(character).toContain('reportError(error);');
    expect(character).toContain('角色装配草稿已失效');
    expect(character).toContain('默认表情素材不可用');
    expect(character).toContain('<output aria-live="polite" className="character-manager-status">');
    expect(shot).toContain("error instanceof ShotServiceError || error instanceof Error");
    expect(shot).toContain('镜头修改失败。');
    expect(character).toContain('character-binding-reminder');
  });

  it('records a general feedback contract without changing the project save owner', () => {
    const design = readFileSync('DESIGN.md', 'utf8');
    const agents = readFileSync('AGENTS.md', 'utf8');
    const saveOwner = readFileSync('src/renderer/shell/CompactProjectBar.tsx', 'utf8');
    for (const phrase of ['操作结果已在界面中直接可见', '极短的加载', '用户确实需要等待', '错误、动作受阻']) {
      expect(design).toContain(phrase);
    }
    expect(design).toContain('项目保存状态属于项目级保存界面');
    expect(design).toContain('真正耗时的任务仍需保留有意义的进度');
    expect(agents).toContain('Before adding or changing visible status');
    expect(agents).toContain('项目尚未保存');
    expect(agents).toContain('Do not delete a status');
    for (const phrase of ['已保存', '有未保存更改', '保存中', '保存失败']) {
      expect(saveOwner).toContain(phrase);
    }
  });

  it('leaves long-running progress and save/recovery failures explicit', () => {
    const assets = readFileSync('src/renderer/features/assets/AssetLibrary.tsx', 'utf8');
    const preview = readFileSync('src/renderer/shell/ProductPreviewOverlay.tsx', 'utf8');
    const shell = readFileSync('src/renderer/shell/EditorShell.tsx', 'utf8');
    const closeFlow = readFileSync('src/renderer/shell/closeProjectFlow.ts', 'utf8');
    expect(assets).toContain('正在重新读取素材并生成缩略图…');
    expect(preview).toContain('正在准备预览…');
    expect(preview).toContain('预览素材加载中');
    expect(shell).toContain('恢复失败。');
    expect(closeFlow).toContain('保存失败，项目未关闭');
  });
});
