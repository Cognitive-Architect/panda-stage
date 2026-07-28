# Panda Stage Stage 1A 执行合同

> Issue：#59 / #61
>
> 分支：`fix/m3-editor-shell`
>
> 合同修订基线：`c020a79b9a5d4da88148a59b6b852a5ddb84d0eb`
>
> 适用范围：Issue #55 的 Stage 1A
>
> 状态：合同已就绪；本文本身不授权生产实现

## 0. 冻结结论

Issue #59 统一了 Stage 1A 的范围、Controller 所有权、过渡挂载和白名单。
Issue #60 的复核又发现两个 HIGH 阻塞；Issue #61 在合同和 Gate 导航层将其关闭：

1. `.recovery-open-row` 在 `no-project` 与 `editor` 两态均有且只有一个明确来源；
2. 根页面继续禁止滚动，Day 19/21/22 Gate 同时支持当前 window 滚动和未来
   `LegacyWorkspace` 内部滚动。

以下只表示施工合同具备可执行性，不表示任何切片已经实现：

```text
1A-1 contract = READY
1A-2 contract = READY
1A-3 contract = READY
1A-4 contract = READY
1A-5 contract = READY

M3 = FAIL
PR #53 = Draft
PR #56 = Draft
Day 26~45 = frozen
Stage 1A implementation = not started
```

没有新增顶层 Stage，也没有授权 Stage 1B、2、3、4。

## 1. 唯一范围

### 1.1 Stage 1A 允许

- `no-project | editor` 两个基础状态；
- StartScreen、固定 EditorShell、EditorTopBar；
- 打开项目、最近项目、editor 同窗口切换项目；
- debug / gateA 正交 flag；
- CSS Grid 与一个 `LegacyWorkspace` 过渡容器；
- recovery candidate 只在 editor 中显示；
- `ProjectSessionController` 由 EditorShell 唯一持有；
- 本合同白名单内测试与 Gate 兼容。

### 1.2 Stage 1A 禁止

- ProductPreviewOverlay、CloseConfirmDialog 新实现；
- 真正的新建项目、`project.createAt`、Renderer 拼接 projectRoot；
- Canvas / Left / Right / Bottom / History / ActionPreset 的正式迁移；
- 修复 CanvasStage / HistoryControls 现有双挂载；
- 修改 Store、Controller、IPC、domain evaluator 行为；
- Stage 1B、2、3、4 或 Day 26。

Stage 1A 的 NewProjectButton 必须禁用并标明后续阶段启用，不得调用 create API。

## 2. 最终组件树

```text
App
└─ EditorShell
   ├─ StagePreview                              [gateA 正交 overlay]
   ├─ StartScreen                              [no-project]
   │  ├─ NewProjectEntry
   │  ├─ ProjectOpenEntry                      [.recovery-open-row]
   │  └─ RecentProjectsPanel
   └─ EditorLayout                             [editor]
      ├─ EditorRecoveryRegion                  [.recovery-panel]
      │  ├─ EditorTopBar
      │  │  ├─ ProjectSwitchEntry              [.recovery-open-row]
      │  │  └─ SaveStatus                      [.recovery-status-row
      │  │                                      + .editor-save-button]
      │  └─ RecoveryCandidateBanner            [optional;
      │                                         .recovery-prompt;
      │                                         restore / ignore]
      └─ EditorBody
         ├─ LeftPlaceholder
         ├─ LegacyWorkspace                    [唯一旧树入口;
         │                                      data-testid=
         │                                      legacy-workspace-scroll]
         │  └─ existing legacy modules
         ├─ RightPlaceholder
         └─ BottomPlaceholder
```

`EditorRecoveryRegion` 是 `EditorShell.tsx` 中组合 TopBar 与可选 Banner 的 wrapper
markup，不新增文件，也不是新 Stage。

## 3. Controller 与 recovery 合同

### 3.1 唯一所有权

```text
ProjectSessionController owner = EditorShell
```

只有 EditorShell 可以构造、保存 snapshot、调用 switchProject /
switchRecentProject，并在 shell 最终卸载时 dispose。StartScreen、TopBar、Banner、
LegacyWorkspace 和改造后的 ProjectRecoveryPanel 只能接收同一组 callbacks。

保持现有顺序不变：

```text
project.open
→ autosave.track
→ recovery.detect
→ old autosave.stop（切换项目时）
→ editorProjectStore.open
→ 返回 trackedProjectRoot / recoveryCandidate
→ EditorShell 更新 session snapshot
→ editor
```

restore / ignore 只清除同一 session snapshot 中的 candidate；不得建立第二份
recovery state，也不得延迟 `store.open()`。

### 3.2 `.recovery-open-row` 唯一归属

这是运行时不变量：

| 基础状态 | 唯一来源 | candidate 为 null 的影响 |
|---|---|---|
| `no-project` | StartScreen / ProjectOpenEntry | 无；入口仍存在 |
| `editor` | EditorTopBar / ProjectSwitchEntry | 无；切换入口仍存在 |

- 任一时刻 `.recovery-open-row` 数量必须等于 1；
- RecoveryCandidateBanner 只拥有 candidate 状态、restore、ignore 和
  `.recovery-prompt`，绝不拥有唯一打开/切换入口；
- candidate 出现或消失不得增删 editor 的 ProjectSwitchEntry；
- Day 20 / Day 24 的同窗口第二项目切换继续复用 EditorShell 的同一
  `switchProject` callback；
- StartScreen 与 EditorLayout 互斥，禁止隐藏 DOM 冒充唯一性。

### 3.3 Day 13 兼容外壳

Day 13 在 candidate 出现后从 `.recovery-panel` 查询：

```text
#recovery-heading
.clean-state
.recovery-open-row input + Open and check recovery
.recovery-prompt
Save recovered project
```

editor 态由 `EditorRecoveryRegion.recovery-panel` 包住 TopBar 和可选 Banner：

- TopBar 提供 heading、clean/dirty、永久 ProjectSwitchEntry、save status；
- Banner 只提供 prompt、candidate details、restore / ignore；
- candidate 非空时，Day 13 在同一 panel 内仍能读到完整合同；
- candidate 为空时，TopBar 和 ProjectSwitchEntry 不消失；
- 所有控件默认可见，不得使用 `display:none`。

## 4. LegacyWorkspace 与滚动合同

LegacyWorkspace 是 editor 态旧模块树的唯一入口。它只挂载一次，不复制旧树，
内部 `overflow-y:auto`，根保持不可滚动：

```tsx
<div
  className="legacy-workspace"
  data-testid="legacy-workspace-scroll"
>
```

```css
html, body, #root {
  height: 100%;
  margin: 0;
  overflow: hidden;
}

.editor-shell {
  height: 100vh;
  overflow: hidden;
}

.legacy-workspace {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
```

ProjectRecoveryPanel 只允许移除 Controller 私有所有权、已迁到 StartScreen /
EditorTopBar 的打开入口、已迁到 Banner 的 candidate UI 和已迁到 TopBar 的
save UI。RecentProjectsPanel 继续存在于 editor，callbacks 来自唯一 Controller。
不得借机修复双挂载或改变业务行为。

数量基线：

```text
ProjectSessionController owner = 1
LegacyWorkspace = 1
ActionPresetPanel = 1
CanvasStage = 2
HistoryControls = 2
```

## 5. Gate 与选择器合同

### 5.1 选择器来源

- StartScreen：`.recovery-panel`、`#recovery-heading`、
  `.recovery-open-row`、`.recent-projects-panel`；
- EditorRecoveryRegion：`.recovery-panel`、`.recovery-heading-row`；
- EditorTopBar：`#recovery-heading`、`.clean-state/.dirty-state`、
  `.recovery-open-row`、`Open and check recovery`、
  `.recovery-status-row`、`.editor-save-button`、`Save recovered project`；
- RecoveryCandidateBanner：`.recovery-prompt`、candidate details、
  restore、ignore；
- LegacyWorkspace：`[data-testid="legacy-workspace-scroll"]` 以及既有
  `.recent-projects-panel`、`.asset-library`、`.character-manager`、
  `.shot-manager`、`.project-canvas` 和既有 data-testid。

### 5.2 Day 19/21/22 双路径导航

Issue #61 只授权修改 `scripts/verify-day19.cjs`、
`scripts/verify-day21.cjs`、`scripts/verify-day22.cjs` 的滚动导航：

```text
若 [data-testid="legacy-workspace-scroll"] 存在
→ 滚动该 nested container
否则
→ 使用当前旧 UI 的 window.scrollTo fallback
→ 等待字体和两帧布局稳定
→ 断言目标矩形与活动 viewport 相交
→ 继续原业务断言
```

Day 19 还保留原有目标顶部偏移断言。三个脚本均不得放宽业务断言、增加 skip、
吞异常、恢复根滚动或操作隐藏 DOM。Day 13/14/16 不修改。

## 6. 精确白名单

Stage 1A 后续生产与测试白名单仍以 Issue #59 为准；Issue #61 本次只允许：

```text
docs/design/stage1a-execution-contract.md
docs/design/m3-editor-shell-design.md
docs/handoff/CODEX-HANDOFF-M3-EDITOR-SHELL-2026-07-28.md
scripts/verify-day19.cjs
scripts/verify-day21.cjs
scripts/verify-day22.cjs
```

本次不得修改任何 `src/`。后续 Stage 1A 实施也不得把上述 Gate 脚本再作为
业务断言调整入口，只需运行它们。

## 7. 测试与验收

Stage 1A 新增测试必须覆盖：

- 两态分别且始终只有一个 `.recovery-open-row`；
- editor candidate null/non-null 都保留 TopBar ProjectSwitchEntry；
- Banner 不拥有打开入口，只负责 restore / ignore；
- Day 13 editor recovery region 的组合兼容；
- Day 20/24 同窗口切换第二项目；
- LegacyWorkspace 唯一且包含 `data-testid="legacy-workspace-scroll"`；
- 根 overflow hidden、legacy 内部滚动；
- Controller owner = 1，旧挂载数量不增加；
- debug/gateA 不写 Project，Stage 1A 不调用 create API。

Issue #61 必须真实运行：

```bash
pnpm verify:day19
pnpm verify:day21
pnpm verify:day22
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

推送后必须等待 PR #56 的 Day 13～24 GitHub Actions 成功。

## 8. 1A-1～1A-5 合同状态

### 1A-1：Shell 状态与 Controller 所有权 — READY

EditorShell 是唯一 Controller owner；null/non-null snapshot 对应
no-project/editor。不改 Controller、Store、IPC 行为。

### 1A-2：StartScreen + 入口 — READY

StartScreen 拥有 no-project 唯一 ProjectOpenEntry；open / recent 使用 shell
callbacks；NewProjectButton 禁用。

### 1A-3：RecoveryCandidateBanner — READY

Banner 只在 editor candidate 非空时出现，只拥有 prompt、restore、ignore；
它不拥有 `.recovery-open-row`，也不建立第二份 candidate state。

### 1A-4：EditorTopBar — READY

TopBar 在 editor 态永久拥有 ProjectSwitchEntry、clean/dirty、save status；
candidate null 不移除切换入口；Day 20/24 同窗口切换保持可用。

### 1A-5：Grid + LegacyWorkspace — READY

根 overflow hidden；唯一 LegacyWorkspace 内滚动并声明
`data-testid="legacy-workspace-scroll"`；Day 19/21/22 使用已迁移的双路径导航。

每个切片仍须独立实现、测试、提交和回滚。需要改 Store / Controller / IPC、
双挂载、Stage 1B/2/3/4 或 Day 26 时必须停止并重新授权。

## 9. 当前唯一下一步

Issue #61 完成、PR #56 CI 成功后，只执行一次短版 Stage 1A 开工复核，确认两项
HIGH 阻塞已关闭且白名单无漂移。复核通过并获得主理人明确授权后，才可开始
1A-1；不得自动进入生产实现。
