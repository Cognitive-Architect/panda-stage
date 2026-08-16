/**
 * Issue #54 — Day 20 shot 复制回归测试（方案2，防双挂载/复制逻辑回归）
 *
 * 测试策略：node 环境（vitest 全局 `environment: 'node'`，无 jsdom）。
 *   经核查，本仓库 `node_modules` 中 **不存在** `jsdom` 与 `@testing-library/react`，
 *   且本环境刚把 Day 16~24 全部跑绿；为不破坏 CI 安装，**不新增任何依赖**。
 *
 * 因此分两层覆盖用户要求的 5 条断言：
 *   - store 层（核心，对应断言 2/4/5）：直接调用 `shotStore.duplicate(firstShotId)`，
 *     验证 shots 1→2、新副本成为 currentShotId、内容完整复制且所有 ID 全部刷新。
 *   - 渲染层（对应断言 1/3 的部分 + 防双挂载）：用 `renderToStaticMarkup` 断言
 *     ShotManager 对单 shot 项目只渲染 **1** 个 `.shot-list-item`（防 Day20 双挂载导致
 *     DOM 翻倍），并已含 `复制镜头` 真实按钮；对含 `Opening 副本` 的项目渲染出该文本。
 *
 * 断言 1（"点击真实复制按钮"）的交互路径由现有 CI Electron 门禁脚本
 *   `scripts/verify-day20.cjs`（Day 20 shot management M2 gate）兜底，该脚本已通过。
 *   本单测覆盖"复制"的产物正确性与渲染不重复，是更稳、更快的回归护栏。
 *
 * 本文件**不修改任何业务代码 / 断言脚本**，仅新增测试。
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { ProjectSchema, migrateProject, ShotService, type Shot } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { ShotManager } from '../../src/renderer/features/shots/ShotManager';

// 可预测 id 生成器（与现有 shot-store.test.ts 同源，符合 schema 的 UUID 校验）
function predictableCreateId() {
  let counter = 0;
  return () =>
    `d2020000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}

// 单 shot 项目：深度克隆 exampleProject 后仅保留 shots[0]（name === 'Opening'）。
// 深度克隆避免 migrateProject 的回填（如 backgroundLayerId）污染导入的共享 fixture。
function makeSingleShotSource() {
  const clone = JSON.parse(JSON.stringify(exampleProject));
  return {
    ...clone,
    id: 'd2020000-0000-4000-8000-000000000050',
    name: 'Day25 regression single-shot project',
    shots: [clone.shots[0]],
  };
}

function setup() {
  const editor = new EditorProjectStore();
  const service = new ShotService({ createId: predictableCreateId() });
  const store = new ShotStore(editor, service);
  editor.open('D:\\镜头 项目.pandastage', migrateProject(makeSingleShotSource()));
  return { editor, store };
}

function stripIds(shot: Shot) {
  // 去掉所有 id / id 引用（以及预期变化的 name），仅保留"内容"，
  // 用于原镜头与副本的内容相等性比对。
  return {
    durationMs: shot.durationMs,
    defaultSubtitleStyleId: shot.defaultSubtitleStyleId,
    layers: shot.layers.map((l) => ({ ...l, id: undefined })),
    dialogues: shot.dialogues.map((d) => ({
      ...d,
      id: undefined,
      audioClipId: undefined,
    })),
    audioClips: shot.audioClips.map((c) => ({ ...c, id: undefined })),
    timelineEvents: shot.timelineEvents.map((e) => ({
      ...e,
      id: undefined,
      layerId: undefined,
    })),
  };
}

// 收集 shot 自身及所有子实体的 id（不含 backgroundLayerId 引用，
// 因为它是指向某个 layer 的引用，已包含在该 layer 的 id 中）。
function allIds(shot: Shot): string[] {
  return [
    shot.id,
    ...shot.layers.map((l) => l.id),
    ...shot.audioClips.map((c) => c.id),
    ...shot.dialogues.map((d) => d.id),
    ...shot.timelineEvents.map((e) => e.id),
  ];
}

function snapshotOf(project: ProjectLike): EditorProjectSnapshot {
  return {
    projectRoot: 'D:\\镜头 项目.pandastage',
    project: project as unknown as EditorProjectSnapshot['project'],
    dirty: false,
    revision: 0,
  };
}

// 仅用于渲染测试的轻量类型别名（避免重复 import 整个 Project 类型）
type ProjectLike = ReturnType<typeof ProjectSchema.parse>;

function countShotItems(markup: string): number {
  // 每个 ShotListItem 渲染一个 <li data-shot-id="...">，按此计数最精确，
  // 不受选中态 className（shot-list-item shot-list-item-selected）干扰。
  return (markup.match(/data-shot-id=/g) ?? []).length;
}

describe('Day20 shot 复制回归 — store 层（断言 2/4/5）', () => {
  it('duplicate: project shots 1 → 2 且新副本成为当前选中镜头', () => {
    const { editor, store } = setup();
    const firstId = editor.getSnapshot()!.project.shots[0]!.id;

    store.duplicate(firstId);

    const snap = editor.getSnapshot()!;
    expect(snap.project.shots.length).toBe(2); // 断言 2: 1 → 2

    const copyId = store.getCurrentShotId();
    expect(copyId).not.toBe(firstId); // 断言 4: 新副本被选中
    const copy = snap.project.shots.find((s) => s.id === copyId)!;
    expect(copy.name).toBe('Opening 副本');
    expect(copy.id).toBe(copyId);
    store.dispose();
  });

  it('duplicate: 副本内容完整复制，但所有 ID 全部刷新且嵌套引用重映射', () => {
    const { editor, store } = setup();
    const firstId = editor.getSnapshot()!.project.shots[0]!.id;
    store.duplicate(firstId);

    const snap = editor.getSnapshot()!;
    const original = snap.project.shots[0]!;
    const copy = snap.project.shots[1]!;

    const origIds = new Set(allIds(original));
    const copyIds = new Set(allIds(copy));
    // 断言 5: 原镜头与新副本之间没有任何共享 id
    for (const id of copyIds) expect(origIds.has(id)).toBe(false);
    // 副本内部 id 唯一（不重复）
    expect(copyIds.size).toBe(allIds(copy).length);

    const copyLayerIds = new Set(copy.layers.map((l) => l.id));
    // timelineEvent.layerId 指向副本自身的新 layer id（非原镜头）
    for (const e of copy.timelineEvents) {
      expect(copyLayerIds.has(e.layerId)).toBe(true);
      expect(origIds.has(e.layerId)).toBe(false);
    }
    const copyClipIds = new Set(copy.audioClips.map((c) => c.id));
    // dialogue.audioClipId 指向副本自身的新 audioClip id
    for (const d of copy.dialogues) {
      expect(copyClipIds.has(d.audioClipId)).toBe(true);
      expect(origIds.has(d.audioClipId)).toBe(false);
    }
    if (copy.backgroundLayerId) {
      expect(copyLayerIds.has(copy.backgroundLayerId)).toBe(true);
    }
    // 内容（除 id 外）与原镜头完全一致
    expect(stripIds(copy)).toEqual(stripIds(original));
    store.dispose();
  });

  it('REGRESSION GUARD: duplicate 产出"选中 + 内容相等 + id 全刷新"的副本（Day20 门禁的单测形态）', () => {
    const { editor, store } = setup();
    const firstId = editor.getSnapshot()!.project.shots[0]!.id;

    const project = store.duplicate(firstId);

    // 断言 4: 副本被选中
    const copyId = store.getCurrentShotId();
    expect(copyId).not.toBe(firstId);
    expect(project.shots.some((s) => s.id === copyId)).toBe(true);
    // 断言 2: 数量 1 → 2
    expect(project.shots.length).toBe(2);
    // 断言 5: 内容相等 + id 全部刷新
    const original = project.shots.find((s) => s.id === firstId)!;
    const copy = project.shots.find((s) => s.id === copyId)!;
    expect(copy.name).toBe('Opening 副本');
    expect(stripIds(copy)).toEqual(stripIds(original));
    expect(new Set(allIds(copy))).not.toEqual(new Set(allIds(original)));
    store.dispose();
  });
});

describe('Day20 shot 复制回归 — 渲染层（断言 1/3 + 防双挂载）', () => {
  it('ShotManager 对单 shot 项目只渲染 1 个镜头项（防双挂载导致 DOM 翻倍）且存在真实复制按钮', () => {
    const project = migrateProject(makeSingleShotSource());
    const markup = renderToStaticMarkup(
      createElement(ShotManager, { snapshot: snapshotOf(project) }),
    );

    expect(countShotItems(markup)).toBe(1); // 关键防回归：双挂载会让此处变成 2
    expect(markup).toContain('Opening'); // 原镜头名出现在 DOM
    expect(markup).toContain('复制镜头'); // 断言 1 部分：真实复制按钮存在
  });

  it('ShotManager 对已含 "Opening 副本" 的项目渲染出该副本名（断言 3 的 DOM 文本）', () => {
    // 用真实 ShotService.duplicate 生成含合法 UUID 的 "Opening 副本" 双 shot 项目
    const service = new ShotService({ createId: predictableCreateId() });
    const base = migrateProject(makeSingleShotSource());
    const twoShotProject = service.duplicate(base, base.shots[0]!.id);

    expect(twoShotProject.shots.length).toBe(2);
    expect(twoShotProject.shots[1]!.name).toBe('Opening 副本');

    const markup = renderToStaticMarkup(
      createElement(ShotManager, { snapshot: snapshotOf(twoShotProject) }),
    );

    expect(markup).toContain('Opening 副本'); // 断言 3: DOM 出现 "Opening 副本"
    expect(countShotItems(markup)).toBe(2); // 复制后应有 2 个镜头项
  });
});
