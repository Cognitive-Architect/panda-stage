# Codex 接管交接文档 — M3 Editor Shell

> 仓库：`Cognitive-Architect/panda-stage`
>
> 分支：`fix/m3-editor-shell`
>
> 本轮修订基线：`0652eda3cf0ac8ba2261b6631b9cef2b12ed36e4`
>
> 权威合同：`docs/design/stage1a-execution-contract.md`
>
> 本版：Issue #63 恢复权威白名单与 1A-1 回滚合同；不含生产代码

## 0. 接管结论

Issue #59 统一了 Stage 1A 的五项基础合同。Issue #60 复核时仍发现两项 HIGH：

1. editor 的项目打开/切换入口错误地依赖 candidate Banner；
2. 根滚动关闭后，Day 19/21/22 仍只滚 window。

Issue #61 的处理结论：

```text
no-project open owner = StartScreen / ProjectOpenEntry
editor switch owner   = EditorTopBar / ProjectSwitchEntry
runtime .recovery-open-row count = 1

production root scroll = hidden
production legacy scroll container =
  [data-testid="legacy-workspace-scroll"]
Gate 19/21/22 = nested container when present, window fallback otherwise

1A-1～1A-5 contract = READY
Stage 1A implementation = not started
1A-1 authorization = pending
```

M3 仍为 FAIL；PR #53 / #56 仍为 Draft；Day 26～45 继续冻结。

## 1. Git 与 PR 拓扑

```text
fix/m3-editor-shell
        → PR #56 (Draft)
feat/day-25-action-presets
        → PR #53 (Draft)
main
```

PR #56 不得转 Ready、不得合并；当前动态 HEAD 和 CI 必须以 git / GitHub 实跑为准。

## 2. 项目与目标

Panda Stage 是 Electron + React + Konva 的本地 2D 动画短片编辑器。Day 21～25
领域逻辑已有候选实现，但真实 UI 仍是纵向功能展板。M3 需要固定 Editor Shell；
Stage 1A 只搭骨架并把旧树放入唯一 LegacyWorkspace，不重写领域逻辑。

## 3. Stage 1A 范围

允许：

- no-project/editor；
- StartScreen、EditorShell、EditorTopBar；
- open/recent/editor 同窗口 switch；
- debug/gateA 正交 flag；
- CSS Grid、LegacyWorkspace；
- editor RecoveryCandidateBanner；
- EditorShell 唯一 ProjectSessionController；
- 白名单内测试与 Gate 兼容。

禁止：

- ProductPreviewOverlay、CloseConfirmDialog、新建项目；
- `project.createAt`、Renderer 路径拼接；
- Store / Controller / IPC / evaluator 修改；
- 双挂载修复；
- Stage 1B/2/3/4、Day 26。

## 4. 权威结构

```text
EditorShell
├─ StartScreen [no-project]
│  └─ ProjectOpenEntry [.recovery-open-row]
└─ EditorLayout [editor]
   ├─ EditorRecoveryRegion [.recovery-panel; EditorShell wrapper]
   │  ├─ EditorTopBar
   │  │  ├─ ProjectSwitchEntry [.recovery-open-row]
   │  │  └─ SaveStatus
   │  └─ RecoveryCandidateBanner [optional; prompt/restore/ignore]
   └─ LegacyWorkspace
      [class=legacy-workspace]
      [data-testid=legacy-workspace-scroll]
```

EditorRecoveryRegion 不新增文件或顶层 Stage。

## 5. 唯一 Controller 与切换

`ProjectSessionController owner = EditorShell`。所有子组件只接 callbacks；open /
recent / editor switch 都走同一 Controller。现有 open→track→detect→store.open
行为不变，只有 EditorShell 最终卸载时 dispose。

Day 20 / Day 24 的第二项目必须在同一窗口由 EditorTopBar 的 ProjectSwitchEntry
触发；candidate 是否存在不能影响入口。

## 6. recovery 兼容

`.recovery-open-row` 是状态级唯一入口：

| 状态 | owner |
|---|---|
| no-project | StartScreen / ProjectOpenEntry |
| editor | EditorTopBar / ProjectSwitchEntry |

RecoveryCandidateBanner 只负责 `.recovery-prompt`、candidate details、
restore / ignore。它不得拥有 open row，candidate null 时也不能让 editor switch
消失。

为兼容 Day 13，editor 的 EditorRecoveryRegion 用同一个 `.recovery-panel` 包含：

- TopBar：heading、clean/dirty、open/switch row、save；
- Banner：prompt、candidate、restore/ignore。

candidate 出现时 Gate 能从一个 panel 读到完整合同；candidate 消失时 TopBar 仍在。
StartScreen 与 EditorLayout 互斥，因此运行时 open row 始终恰好一个。

## 7. LegacyWorkspace 与 Gate

产品保持：

```css
html, body, #root, .editor-shell { overflow: hidden; }
.legacy-workspace { overflow-y: auto; overflow-x: hidden; }
```

未来生产标记必须是：

```tsx
<div className="legacy-workspace" data-testid="legacy-workspace-scroll">
```

Day 19/21/22 已在 Issue #61 范围内迁移为：

```text
有 legacy-workspace-scroll → 滚 nested container
无 testid（当前旧 UI）      → window.scrollTo fallback
→ 等待 fonts + 两帧布局
→ 断言 target 与 active viewport 相交
→ 执行原业务断言
```

Day 19 继续验证原顶部偏移。不得 skip、吞异常、弱化断言、恢复根滚动或隐藏 DOM。
Day 13/14/16 脚本不修改。

## 8. 数量与状态基线

```text
ProjectSessionController owner = 1
LegacyWorkspace = 1
ActionPresetPanel = 1
CanvasStage = 2
HistoryControls = 2
```

Stage 1A 不收敛现有 CanvasStage / HistoryControls 双挂载，但不得增加第三份。

## 9. Issue #61 精确文件范围

```text
docs/design/stage1a-execution-contract.md
docs/design/m3-editor-shell-design.md
docs/handoff/CODEX-HANDOFF-M3-EDITOR-SHELL-2026-07-28.md
scripts/verify-day19.cjs
scripts/verify-day21.cjs
scripts/verify-day22.cjs
```

本次 `src changes = none`。不得借本 Issue 开始 1A 实现。

## 10. 切片合同状态

```text
1A-1 Shell state / sole Controller owner = READY
1A-2 StartScreen / no-project open        = READY
1A-3 Banner prompt / restore / ignore     = READY
1A-4 TopBar editor switch / save          = READY
1A-5 Grid / nested LegacyWorkspace scroll = READY
```

READY 是合同就绪，不是代码完成。

## 11. Stage 1A 白名单与 1A-1 精确摘要

完整、逐文件的允许/禁止表以执行合同第 6 节正文为唯一施工授权，不得回看旧
Issue 或历史 commit 补全。

Stage 1A production 白名单：

```text
src/renderer/App.tsx
src/renderer/styles.css
src/renderer/features/recovery/ProjectRecoveryPanel.tsx
src/renderer/shell/EditorShell.tsx
src/renderer/shell/StartScreen.tsx
src/renderer/shell/EditorTopBar.tsx
src/renderer/shell/NewProjectEntry.tsx
src/renderer/shell/LegacyWorkspace.tsx
src/renderer/shell/RecoveryCandidateBanner.tsx
src/renderer/shell/useDebugFlag.ts
```

Stage 1A test 白名单：

```text
tests/contract/dom-selectors.baseline.test.ts
tests/unit/editor-shell-state.test.ts
tests/unit/editor-shell-controller.test.ts
tests/unit/project-session-controller.test.ts（仅需时）
tests/integration/editor-shell-project-session.test.ts
tests/integration/editor-shell-layout.test.ts
```

1A-1 只允许：

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

该切片只提升 shell 状态、唯一 Controller owner、session/autosave 生命周期，并把
ProjectRecoveryPanel 最小 presenter 化。当前 UI 和 recovery selector 必须在
1A-1 单独完成后继续启动、编译和通过关键 Gate；StartScreen、Banner、TopBar、
Grid/LegacyWorkspace 均不得提前实现。

1A-1 必须是单一独立 commit。回滚只 revert 该 commit，恢复到 Issue #61 后基线，
不得撤销 Day 19/21/22 nested-scroll Gate 合同。需要改 Controller 生产实现、
Store/IPC、后续切片或任何白名单外文件时立即停止。

## 12. 文档修订防回归

1. 局部 Issue 只增量修改目标合同，不删除其他已验收章节；
2. 精简前必须完成语义等价检查；
3. production/test whitelist、slice DoD、rollback contract 不可省略；
4. 禁止仅引用旧 Issue、聊天记录或历史 commit 作为施工授权；
5. selector/Gate 修订不得覆盖白名单或回滚合同；
6. 修订后必须 grep 并通读核验四类章节仍存在。

## 13. 验证清单

Issue #61：

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

同时静态审计：

- 三份文档的 owner、selector、READY 状态一致；
- 三个 Gate 同时包含 nested testid 与 window fallback；
- 滚动后先验证活动 viewport 可见性；
- diff 中无 skip、断言弱化、异常吞噬；
- 无 `src/` 变更。

推送后等待 PR #56 的 Day 13～24 GitHub Actions 成功。

Issue #63 还要求从当前三份文档直接核验白名单、1A-1 exact scope/DoD/rollback
和防回归规则，并确认本轮只有三份文档改动。

## 14. 一分钟级最终核对

Issue #63 和 CI 完成后，只做一次一分钟级最终核对：

1. 核对 production/test 白名单可直接从执行合同读取；
2. 核对 1A-1 exact scope、DoD、单 commit/rollback 和停止条件；
3. 核对 Issue #61 两项 HIGH 合同仍完整；
4. 核对 PR #56 仍是 Draft；
5. 得到主理人明确授权后才开始 1A-1。

不得因合同 READY 自动开始生产实现，也不得把 M3 改为 PASS。
