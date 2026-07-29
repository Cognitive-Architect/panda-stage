# Panda Stage M3 Editor Shell 设计 v1.4

> Issue #59 / #61 / #63 合同同步版
>
> 实施权威：`docs/design/stage1a-execution-contract.md`
>
> 状态：1A-1～1A-4 已完成；1A-5 尚未开始

## 1. 目标与边界

Panda Stage 当前是纵向功能展板，M3 需要连续 Editor Shell。Stage 1A 只建立
no-project/editor 状态、固定骨架、唯一 Controller、打开/最近/同窗口切换入口、
recovery banner、Grid 和 LegacyWorkspace。它不实现新建、预览/关闭确认、
正式模块迁移、双挂载修复或后续 Stage。

Issue #61 关闭 Issue #60 复核出的两项 HIGH：

- 打开/切换入口不再依赖可消失的 candidate Banner；
- root overflow hidden 后，Gate 可以导航 LegacyWorkspace 内部滚动区域。

## 2. 状态与组件结构

```text
no-project = editorProjectStore snapshot is null
editor     = editorProjectStore snapshot is non-null
```

```text
EditorShell
├─ StagePreview                              [gateA orthogonal]
├─ StartScreen                              [no-project]
│  ├─ ProjectOpenEntry                      [.recovery-open-row]
│  └─ RecentProjectsPanel
└─ EditorLayout                             [editor]
   ├─ EditorRecoveryRegion                  [.recovery-panel; wrapper markup]
   │  ├─ EditorTopBar
   │  │  ├─ ProjectSwitchEntry              [.recovery-open-row]
   │  │  └─ SaveStatus
   │  └─ RecoveryCandidateBanner            [optional; prompt/restore/ignore]
   └─ EditorBody
      ├─ LeftPlaceholder
      ├─ LegacyWorkspace                    [唯一旧树；内部滚动]
      ├─ RightPlaceholder
      └─ BottomPlaceholder
```

EditorRecoveryRegion 在 EditorShell 中直接组合，不新增组件文件或顶层 Stage。

## 3. Controller 设计

`ProjectSessionController owner = EditorShell`。StartScreen、TopBar、Banner、
LegacyWorkspace 与 ProjectRecoveryPanel 不得 new Controller。所有 open/recent/
switch callbacks 均来自唯一实例，现有 open→track→detect→store.open 顺序不变。
只有 EditorShell 最终卸载时 dispose。

## 4. recovery 与项目切换

### 唯一入口

```text
no-project → StartScreen / ProjectOpenEntry
editor     → EditorTopBar / ProjectSwitchEntry
```

两态互斥，运行时 `.recovery-open-row === 1`。candidate null/non-null 不影响 editor
切换入口。RecoveryCandidateBanner 只展示 `.recovery-prompt`、candidate details
和 restore/ignore，不能成为唯一 open source。

Day 20 / Day 24 在 editor 中切换第二项目，继续调用同一个 `switchProject`。

### Day 13 组合兼容

Day 13 在 editor candidate 出现后仍从 `.recovery-panel` 查询 heading、clean、
open row、prompt 和 save。EditorRecoveryRegion 提供共同 panel：

- TopBar 提供 heading、clean/dirty、open/switch row、save；
- Banner 提供 prompt、candidate、restore/ignore。

这样既保留旧 Gate，又不会在 candidate 消失时丢失项目切换入口。禁止隐藏 DOM。

## 5. LegacyWorkspace 与 Grid

产品设计继续保持根不可滚动，旧长页面只在 LegacyWorkspace 内滚动：

```tsx
<div className="legacy-workspace" data-testid="legacy-workspace-scroll">
```

```css
html, body, #root,
.editor-shell {
  overflow: hidden;
}

.legacy-workspace {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
```

LegacyWorkspace 只挂一次，承载原有旧树，不复制业务状态、不隐藏 Gate 目标。
Stage 1A 维持 CanvasStage=2、HistoryControls=2 的已知基线，但不得新增第三份。

## 6. Gate 兼容矩阵

| Gate | 保留入口/区域 | Stage 1A 导航合同 |
|---|---|---|
| Day 13 | 两态唯一 open row；editor 组合 recovery panel | 原断言不变 |
| Day 14 | 两态 recent；TopBar save/status | 原断言不变 |
| Day 16 | open 后 Legacy assets | 原断言不变 |
| Day 18 | Legacy assets | 原断言不变 |
| Day 19 | Legacy character manager | testid 存在时滚内部，否则 window fallback |
| Day 20 | Legacy shot manager；editor 第二项目切换 | 同一 switchProject |
| Day 21 | Legacy canvas | testid 存在时滚内部，否则 window fallback |
| Day 22 | Legacy canvas/layer | testid 存在时滚内部，否则 window fallback |
| Day 23 | Legacy canvas/layer | 原断言不变 |
| Day 24 | Legacy history + TopBar；第二项目切换 | 同一 switchProject |
| Gate A | 正交 StagePreview | 原证据合同不变 |

Day 19/21/22 的双路径均在滚动后等待稳定，验证目标与活动 viewport 相交，再执行
原业务断言。不得 skip、吞异常、放宽断言、恢复 root scrolling 或操作隐藏 DOM。

## 7. 选择器所有权

| 选择器 | no-project owner | editor owner |
|---|---|---|
| `.recovery-panel` | StartScreen | EditorRecoveryRegion |
| `.recovery-open-row` | ProjectOpenEntry | EditorTopBar / ProjectSwitchEntry |
| `.recovery-prompt` | 无 | RecoveryCandidateBanner（candidate 非空） |
| `.recovery-status-row` | 无 | EditorTopBar |
| `[data-testid="legacy-workspace-scroll"]` | 无 | LegacyWorkspace |

## 8. 文件与阶段

Issue #61 只修改三份合同文档和 Gate 19/21/22，不修改 `src`。Stage 1A 后续生产、
测试白名单及每个切片的停止条件，以执行合同为准。禁止进入 Stage 1B/2/3/4、
Day 26，禁止修复双挂载。

Issue #63 已把完整 production/test 白名单直接恢复到执行合同第 6 节；该正文表格
是唯一施工授权，不再外链旧 Issue。Stage 1A 生产范围严格限制为 App、styles、
ProjectRecoveryPanel 与 7 个 `shell/*` 文件；测试范围严格限制为执行合同列出的
6 个 contract/unit/integration 文件。任何越界都必须停止并新开授权 Issue。

### 1A-1 精确摘要

```text
production:
  src/renderer/App.tsx
  src/renderer/features/recovery/ProjectRecoveryPanel.tsx
  src/renderer/shell/EditorShell.tsx

tests:
  tests/unit/editor-shell-state.test.ts
  tests/unit/editor-shell-controller.test.ts
  tests/integration/editor-shell-project-session.test.ts
  tests/unit/project-session-controller.test.ts（仅既有行为回归）
```

1A-1 只建立 shell 状态边界、唯一 Controller owner、session 与 autosave
生命周期，并将 ProjectRecoveryPanel 最小 props presenter 化。当前 Electron UI
及 recovery selector 在本切片继续可用；不提前实现 StartScreen、Banner、
TopBar、Grid 或 LegacyWorkspace。

1A-1 必须是单一独立 commit，独立通过质量门禁、当前 Electron 启动和关键 Gate；
只需 revert 该 commit 即恢复到 Issue #61 后基线，且不得触碰 Day 19/21/22
nested-scroll 合同。完整 DoD、回滚步骤和停止条件以执行合同第 8 节为准。

```text
1A-1 Controller ownership implementation = completed
1A-2 no-project entry implementation        = completed
1A-3 candidate banner implementation        = completed
1A-4 editor switch/topbar implementation    = completed
1A-5 nested-scroll/grid implementation       = not started
```

M3 仍为 FAIL；以上状态不授权后续切片。

## 9. 验证

Issue #61 真实运行 Day 19/21/22，以及 typecheck、lint、unit、integration、build；
推送后等待 PR #56 Day 13～24 CI。静态审计确认三个 Gate 同时具有 nested/testid
与 window fallback，且没有 skip、弱化断言或异常吞噬。

Issue #63 还必须静态确认 production whitelist、test whitelist、1A-1 exact
scope/DoD/rollback 与 document regression guard 可从当前 HEAD 直接读取，并确认
本轮只有三份文档变化。

## 10. 文档修订治理

- 局部 Issue 只增量修改目标合同，不删除其他已验收章节；
- 精简前执行语义等价检查；
- production/test 白名单、slice DoD、rollback contract 不可省略；
- 当前施工授权不得只引用旧 Issue、聊天记录或历史 commit；
- selector/Gate 导航修订不得覆盖白名单或回滚合同；
- 修订后 grep 并通读核验上述章节仍存在。

## 11. 下一步

Issue #69 完成后停止；获得新的明确授权后才可开始 1A-5。
