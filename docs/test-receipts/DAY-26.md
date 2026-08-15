# DAY-26 验收收据 — Editor Workspace Completion + Timeline Shell

> **Issue #191 / Day 26 任务**：在 `BottomWorkspace` 中交付 Timeline Shell（ruler / timecode / playhead / click-seek / drag-seek / 24 FPS snap / zoom / horizontal-scroll），UI 状态（`currentTimeMs` / `zoom` / `scrollPx`）永不进入 `ProjectSchema` / `History` / `dirty` / `revision`。完成后停在真实 Windows Electron 人工验收点，等待维护者。
>
> **结论**：`PASS`（自动化与结构性验收全部通过；视觉/人工 PASS 已由维护者在真实 Windows Electron 确认）。本回执经 **Issue #207 FINAL CLOSEOUT** 同步 #197/#199/#204/#206 最终事实、最新 CI 与 NEG-002 真实空状态证据后，满足最终签字条件。
>
> ⚠️ **STOPPED AT MAINTAINER FINAL SIGN-OFF**：PR #200 保持 Draft；未 merge / 未 mark Ready / 未 close Issue / 未宣布 Day 26 自动 PASS。以下为交维护者签字的完整证据账本。

## 1. 基线与收卷

| 项 | 值 |
|---|---|
| 分支 | `agent/issue-199-timeline-seek`（PR #200 head；base `agent/issue-197-timeline-collapse`） |
| 实现 HEAD（PR #193） | `37f30e528177a2752dd7d414ca60eb061232f57d` |
| 基线（开工 = `main`） | `323f36dc39724e2dc553dedfa1998ba0428a3967`（Day 26 开工点；`main` 此后无新提交） |
| 后续 review 修复 HEAD | Issue #195 审查跟进 commit（见「Review Follow-up #195」） |
| **收卷 HEAD（Issue #207 closeout commit）** | `4190cd78ddfe9e86d1039e42960ef1d3cbf8fb68`（父 `6be756f`；新增 NEG-002 gate + `verify:issue207` 接线） |
| **PR #200 当前 HEAD（#207 记录时）** | `6be756fbf9c38eae6b6c5899a56bcdea8e0de40b` |
| PR #200 状态 | Draft / Open / 未 merge |

## 2. 变更文件

| 文件 | 说明 |
|---|---|
| `src/renderer/features/timeline/timeGeometry.ts` | 纯函数时↔像素几何 + 24 FPS 吸附 + ruler 刻度 |
| `src/renderer/features/timeline/timelineUiStore.ts` | UI-only store；订阅 `shotStore`；resetForShot；不触碰 `EditorProjectStore` |
| `src/renderer/features/timeline/TimelineDock.tsx` | 唯一 Timeline 产品面（含空状态 `timeline-empty`） |
| `src/renderer/shell/BottomWorkspace.tsx` | 挂载 `TimelineDock` + 原有 `HistoryControls` |
| `src/renderer/styles.css` | Timeline Shell 样式，`.bottom-workspace` 高度调整为 `132px/168px`；#197 collapse/expand 双态高度合同 |
| `tests/unit/features/timeline/timeGeometry.test.ts` | 几何/吸附/时码/刻度 11 条单元测试 |
| `tests/unit/features/timeline/timelineUiStore.test.ts` | store 行为 4 条单元测试（含 shot 切换重置） |
| `tests/integration/editor-shell-layout.test.ts` | 新增 Timeline Shell 集成断言 |
| `tests/contract/dom-selectors.baseline.test.ts` | 同步 `.bottom-workspace` 高度基线 |
| `scripts/verify-issue207-neg002-empty-timeline.cjs` | **Issue #207 新增**：NEG-002 真实 Windows Electron 空状态 gate |
| `package.json` | 新增 `verify:issue207` 并并入 `verify:timeline` |
| `.github/workflows/ci.yml` | classifier 路由 `verify-issue207*` → timeline 区域 |

> 收卷 commit `4190cd78` 仅新增验收/文档类文件（`scripts/verify-issue207-*`、`package.json` 脚本入口、`ci.yml` 路由），**未修改任何产品代码**（`TimelineDock` / `timeGeometry` / `timelineUiStore` / preload / main IPC 均未变）。

## 3. 时间契约 / UI 隔离

- `currentTimeMs`、`zoom`、`scrollPx` 仅存在于 `timelineUiStore.ts`，**未**写入 `EditorProjectStore`、`HistoryStore`、project.json、autosave。
- 真实 Electron 验收中：任意 seek 与 A→B→A 镜头切换后，顶部「保存整个项目」按钮保持 `disabled=true`，`editor-shell` 的 `data-editor-shell-state="editor"` 未变脏。
- Timeline Shell 由 `BottomWorkspace` 作为唯一底部 owner 渲染，未新增第二个 Canvas / Inspector / Timeline owner。

## 4. 质量门（真实命令输出）

> 环境备注：`pnpm` 因 corepack 路径缺失不可用，全部使用 `node_modules/.bin/*`；`ELECTRON_RUN_AS_NODE=1` 被注入当前 shell，真实 Electron 启动必须加 `env -u ELECTRON_RUN_AS_NODE`。

```text
$ node_modules/.bin/tsc --noEmit
TSC_EXIT=0

$ node_modules/.bin/tsc -p tsconfig.electron.json --noEmit
TSC_ELECTRON_EXIT=0

$ node_modules/.bin/eslint src tests
ESLINT_EXIT=0

$ node_modules/.bin/vitest run
Test Files  91 passed (91)
Tests       648 passed (648)
VITEST_EXIT=0

$ node_modules/.bin/vite build
✓ built in 1.73s
BUILD_EXIT=0

$ PRELOAD_ENTRY=index node_modules/.bin/vite build --config vite.preload.config.ts
PRELOAD_INDEX_EXIT=0

$ PRELOAD_ENTRY=hidden node_modules/.bin/vite build --config vite.preload.config.ts
PRELOAD_HIDDEN_EXIT=0

$ node_modules/.bin/vitest run --config vitest.integration.config.ts
Test Files  24 passed (24)
Tests       141 passed (141)
INTEGRATION_CLEAN_EXIT=0
```

**集成门最终结论：全绿 141/141。**（首轮 `left-workspace.test.ts` 在污染 shell 下因 `ELECTRON_RUN_AS_NODE=1` 失败，根因与 Day 26 无关；`env -u` 重跑后整套 141/141 通过。）

## 5. 真实 Windows Electron 验收步骤与证据

### 5.1 启动与项目状态

- 命令：`env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron . --user-data-dir=D:/panda-stage-main/.workbuddy/artifacts/electron-userdata --no-sandbox --disable-gpu --in-process-gpu --remote-debugging-port=9223`
- 已通过最近项目列表打开 `D:\PandaStage-Acceptance\story-2.pandastage`（项目 id `10000000-0000-4000-8000-000000000001`）。
- 项目含 2 个镜头：shot A `50000000-0000-4000-8000-000000000001`（4321 ms）、shot B `116932f2-47c2-44d6-8e77-d8dafef506fe`（3000 ms）。
- CDP 当前可用：`http://127.0.0.1:9223/json/version` 返回 `Chrome/150.0.7871.114 / Electron/43.1.1`。

### 5.2 1366×768 验证

| 检查项 | 结果 |
|---|---|
| `editor-layout` 渲染 | ✅ |
| `BottomWorkspace` 渲染 | ✅，class `bottom-workspace` |
| `TimelineDock` 渲染 | ✅，`data-expanded="true"` |
| ruler track | ✅，12 条刻度 |
| playhead | ✅，绿色 |
| timecode | `00:00.000 / 00:04.321` |
| zoom | `1×` |

- **click-seek**：点击 ruler 约 65% 处后 timecode 变为 `00:02.792 / 00:04.321`。2792 ms = 67 × 41.667 ms，落在 `[0, 4321]` 内且 24 FPS 吸附。
- **zoom**：`1× → 2× → 1×` 正常。

### 5.3 800×560 验证

| 检查项 | 结果 |
|---|---|
| `TimelineDock` 渲染 | ✅ |
| ruler track | ✅，12 条刻度 |
| playhead | ✅ |
| timecode | `00:02.792 / 00:04.321` |
| zoom | `1×` |

- 响应式布局正确折叠，Timeline Shell 仍在 `bottom-workspace` 内正常显示。

### 5.4 A→B→A 镜头切换验证

| 步骤 | timecode | 选中镜头 | playhead left |
|---|---|---|---|
| 起始 | `00:02.792 / 00:04.321` | A | — |
| 切换 → B | `00:00.000 / 00:03.000` | B | `0px` |
| 切换 → A | `00:00.000 / 00:04.321` | A | `0px` |

- 每次切换 playhead 回到 0，duration 跟随当前镜头。
- 切换后项目仍 **未 dirty**（`saveBtnDisabled=true`）。

### 5.5 视觉证据

- `D:/panda-stage-main/.workbuddy/artifacts/day26-1366x768.png`
- `D:/panda-stage-main/.workbuddy/artifacts/day26-800x560.png`

## 6. dirty / revision / History 不变量证据

- 真实 Electron 中执行 click-seek、zoom、A→B→A 后：
  - `saveBtnDisabled=true`
  - 无未保存提示 / 恢复候选
  - `editor-shell` `data-editor-shell-state` 保持 `"editor"`（未进入 dirty dialog）
- 代码层面 `timelineUiStore` 不持有 `EditorProjectStore` 引用，不调用 `updateProject`，不进入 `HistoryStore`。

## 7. 16 项刀刃表（Blade Table，官方 B-26/45 ID）

| 类别 | 检查点ID | 检查目标 | 验证证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 当前镜头 ruler / timecode 显示真实 `durationMs` | 4321ms / 3000ms 真实 duration；§5.2/5.3 timecode | ✅ PASS |
| FUNC | FUNC-002 | 点击 ruler 与拖 playhead 能 seek，clamp 到 `[0,durationMs]` | 维护者真人 click-seek `0.208/1.500`、drag-seek `2.750/2.250`；§5.2 | ✅ PASS |
| FUNC | FUNC-003 | 24 FPS snap 稳定，0/中间/末尾/非整帧 duration 有明确结果 | 4321ms 极限拖停 `4.292s`（未越 `4.321s`）；`timeGeometry.test.ts` 11 例 | ✅ PASS |
| FUNC | FUNC-004 | 切镜头后 duration 更新、playhead=0、无上一镜头旧时间 | §5.4 A→B→A；`timelineUiStore.test.ts` resetForShot | ✅ PASS |
| CONST | CONST-001 | 生产树保持 Canvas=1、History=1、Timeline=1 | `git grep` + layout test；DOM 仅单一 `timeline-dock` | ✅ PASS |
| CONST | CONST-002 | seek/zoom/scroll 不改 dirty/revision/History/project | §5.4/§6 `saveBtnDisabled` + `undo/redo 0/0`；store 断言 | ✅ PASS |
| CONST | CONST-003 | 未引入 ActionPreset/#177/通用 evaluator | `git diff --name-only main..HEAD` 无相关文件 | ✅ PASS |
| CONST | CONST-004 | Timeline 只进入正式 BottomWorkspace，根页面不靠业务滚动 | layout integration + §5.2/5.3 截图 | ✅ PASS |
| NEG | NEG-001 | 负时间、超 duration、极端 px 输入均安全 clamp | `timeGeometry.test.ts` clamp / 末帧 / 非整帧边界 | ✅ PASS |
| NEG | NEG-002 | duration=0 / 无当前镜头时不崩溃、不产生假时间 | **真实 Windows Electron gate**（run `31859114748`，见 §11） | ✅ PASS |
| NEG | NEG-003 | zoom/resize/scroll 后同一 currentTime 语义不漂移 | 2×/4× + 横滚后 currentTime 保持 `4.292s`；§11 空态 resize | ✅ PASS |
| NEG | NEG-004 | 现有镜头/素材/角色/Inspector/History 主路径无回归 | `pnpm test:integration` 141/141 全绿 | ✅ PASS |
| UX | UX-001 | 1366×768 首屏能完成「镜头→画布→Inspector→Timeline seek」 | §5.2 真实 Electron 操作记录 | ✅ PASS |
| UX | UX-002 | 800×560 仍能选镜头、看 Canvas、访问 Inspector、折叠/展开 Timeline | §5.3 真实 Electron 操作记录 | ✅ PASS |
| E2E | E2E-001 | 打开真实项目→选 A→seek→切 B→seek→回 A，全程 UI 状态与项目账本边界正确 | §5.4 + 维护者真人摘要（§14） | ✅ PASS |
| High | HIGH-001 | 自动化全绿后再做真人安全门；任一真人主路径 FAIL 均不得判 Day PASS | CI run `31859114748` 全绿 + §5/§14 真人门 | ✅ PASS |

**汇总：FUNC 4/4 · CONST 4/4 · NEG 4/4 · UX 2/2 · E2E 1/1 · High 1/1（16/16）。**

## 8. P4 / 性能 / 债务

| 检查点 | 状态 | 备注 |
|---|---|---|
| 核心功能用例（CF） | ✅ | FUNC-001~004 各有标准路径 |
| 约束与回归用例（RG） | ✅ | CONST-001~004 覆盖 |
| 负面路径用例（NG） | ✅ | NEG-001~004 覆盖（NEG-002 已补真实空状态） |
| 用户体验用例（UX） | ✅ | UX-001~002 真人可用 |
| 端到端关键路径（E2E） | ✅ | E2E-001 完整走过 |
| 高风险场景（High） | ✅ | HIGH-001 CI 绿 + 真人安全门 |
| 字段完整性 | ✅ | 本回执含前置/预期/实际/风险 |
| 需求映射 | ✅ | 每条验证可回 B-26/45 目标 |
| 自测执行 | ✅ | 全部质量门命令 + 真实 Electron |
| 范围边界与债务 | ✅ | 无遗留未声明债务 |

- 时间几何为纯函数，无组件依赖；ruler 刻度按需生成。
- **已清债务（此前误列的待验证项，现已真机确认）**：
  - ~~drag-seek 真机未验证~~ → 维护者真人 drag-seek `2.750/2.250` 通过（§14）。
  - ~~horizontal scroll 未独立验证~~ → 2×/4× zoom + 横向滚动后 currentTime 不漂移（§14、NEG-003）。
  - ~~ResizeObserver / ruler 宽度「仅测量一次」~~ → #199 修复后已在 mount / expand / shot 切换生命周期重新测量并监听尺寸变化（见 §12）。

## 9. 已知限制 / Caveats

1. `Browser.setWindowBounds` 在此 Electron 构建中 CDP TIMEOUT，使用 `Emulation.setDeviceMetricsOverride` 完成 1366×768 与 800×560 视口验证。
2. `ELECTRON_RUN_AS_NODE=1` 被注入当前 shell；真实 Electron 必须 `env -u ELECTRON_RUN_AS_NODE` 启动。
3. 集成测试 `left-workspace.test.ts` 在被污染的 shell 下会因 `Cannot find module 'electron'` 失败（根因见第 4 节）。在干净环境下 141/141 全绿。该测试自身会拉起 Electron，**运行它会把留给人工验收的 Electron 实例带下线**，验收期间应避免重跑。
4. **`An object could not be cloned` 不是 Panda Stage 产品 IPC 缺陷**：该错误最早在 `verify:issue199` 真机 seek 路径出现，经 #204 A/B 与 #206 根因定位，最终确认为 **`verify-issue199` test harness 的 `executeJavaScript` 模板错误**（模板求值得到 Function / 不可 clone 对象），**不是 #199 产品修复引入的回归，也不是产品 IPC bug**。修复方式：所有 renderer 片段改为「已调用的 IIFE，返回纯对象」。详见 §12。

### 9.1 Review Follow-up #195（审查跟进修复）

维护者对 PR #193 / #194 做第二轮审查，提出若干待验证怀疑。代理先逐条复现/定位，只对 CONFIRMED 项修复：

| 项 | 值 |
|---|---|
| 修复 commit | `c3e1cb7`（分支 `agent/day-26-timeline-shell`，基于实现 HEAD `37f30e5`） |
| 归属 #193 | V-193-01 playhead 末端越界；V-193-02 Timeline 收起后可重新展开；V-193-03 切 shot 后 DOM 滚动与 store 同步；V-CI-01 Issue-102 gate 阈值随 Day-26 Timeline 高度合同演进；V-DOC-01 本收据 Git 坐标失真修正 |
| 归属 #194 | V-194-01 Drawer 鼠标关闭入口；V-194-02 Drawer 键盘焦点管理 |
| 不修 | V-194-03（Drawer 惰性 `gap` 被子级 padding 补偿，无可见缺陷） |

## 10. 结论

- **自动化质量门**：全部通过（typecheck ×2、eslint、unit+contract 648/648、build、preload build ×2、integration 141/141）。
- **真实 Windows Electron 结构性验收**：通过（Timeline Shell 在 1366×768 与 800×560 渲染、seek/zoom/A→B→A 行为正确、project dirty 不变量保持）。
- **NEG-002 真实空状态**（Issue #207 补证）：通过（真实 Electron gate run `31859114748`，见 §11）。
- **16 项刀刃表**：16/16 PASS（§7）；**P4**：10/10（§8）。
- **视觉/人工验收**：维护者已在真实 Windows Electron 确认（§14）。

**综合结论：PASS（满足最终签字条件）。** 维护者确认后可决定合并/关闭 Issue #191 与 Day 26 相关 Issue，代理不再推进 Day 27 或任何额外范围。

> **STOPPED AT MAINTAINER FINAL SIGN-OFF** — PR #200 保持 Draft；未 merge / 未 Ready / 未 close / 未宣布 Day 26 PASS。

---

## 11. NEG-002 真实 Windows Electron 空状态证据（Issue #207）

**目标**：验证「无当前镜头 / 0 duration」在真实 Electron 下不崩溃、不产生假时间、不 dirty、Undo/Redo 不增加。

**真实 UI 路径**（非伪造）：通过 Panda Stage 正常 UI「新建项目」对话框创建项目；`ProjectService.createAt` 把每个新建项目写成 `shots: []`（生产代码），`ShotStore.reconcileSelection` 解析 `shots[0]?.id ?? null` → `null` → `TimelineDock.hasShot=false` → 渲染空状态。gate 使用**真实** `registerProjectIpcHandlers` + **真实** `ProjectService`，**未编辑 JSON / poke Store / 隐藏 DOM**。

**CI 证据**：run `31859114748`（收卷 HEAD `4190cd78`，Windows runner，Electron 43.1.1 / Node 24.18.0），`pnpm verify:issue207` 通过。

**机器可读结果**：`docs/evidence/issue-207/neg002-results.json`（pass=true，7 项 checks）。

| 检查阶段 | 关键结果 |
|---|---|
| 磁盘 project.json | `shots: 0`（生产 `ProjectService.createAt` 写盘，schemaVersion 5） |
| 展开空状态 | `dockHasShot=false`、`emptyPresent=true`、文案 `当前没有可定位的镜头或时长为 0。`、无 ruler/track/ticks/playhead、`timecode 00:00.000 / 00:00.000`、`saveState saved`、`undo/redo 0/0`、`rendererErrors []` |
| 空区真实 pointer 按下 (640,702) | 无 dispatchError、无 seekable ruler、`currentTime` 保持 0、不崩溃 |
| collapse→expand | 空状态恢复、仍无 ruler、`currentTime/duration` 0、不崩溃 |
| zoom 1×→4× | 仍空、无 ruler、`currentTime/duration` 0 |
| 900×620 resize | 空状态保持、无 ruler、无假时间 |

**截图**（CI runner 生成，命名见 `neg002-results.json`）：`issue207-neg002-01-start-screen` / `02-new-project-dialog` / `03-empty-timeline` / `04-collapse-expand` / `05-resized-empty`。

## 12. #197 / #199 / #204 / #206 调查与修复事实收束

### #197 — Timeline 收起时真正释放纵向空间给 Canvas
- 产品修复（在 PR #200 base `agent/issue-197-timeline-collapse`）：collapsed 时 `BottomWorkspace` 明显缩高、`CanvasWorkspace` 自动吃回释放高度，而非仅隐藏 ruler 内容。
- 已入当前 stacked 结果，真人视觉/空间释放 PASS。

### #199 — Timeline 播放头无法 seek（原 FUNC-002 HUMAN FAIL）
- **根因（已 CONFIRMED）**：ruler 挂载/展开时未成功测宽 → `viewportWidth=0` → `pixelsPerMs=0` → `generateRulerTicks()=[]` → `pxToTime()=0` → playhead 固定 0ms。
- **产品修复 commit `7993ef9`**：在 mount / expand / shot 切换生命周期重新测量 ruler 宽度并监听尺寸变化。
- **真实 Electron 验证**：修复后 `ticksCount=6`、`rulerScrollClientWidth=1236`、`durationMs=4321`，seek/drag/zoom 全部恢复。旧回执「ResizeObserver 仅测量一次」描述已作废（见 §8）。

### #204 — A/B 对照确认 clone error 是否由 #199 引入
- 在 #199 修复前（`b42947da`）与后（`adcf51db`）两个 SHA 同环境复现：首次 seek 均触发 `An object could not be cloned`。
- 中间结论：clone error 在 #199 修复前已存在。但该中间结论随后被 #206 推翻（见下）。

### #206 — 定位并最小修复 clone error
- **最终根因（CONFIRMED）**：clone error 来自 **`verify-issue199` test harness 的 `executeJavaScript` 模板错误** —— 模板求值得到 Function / 不可结构化克隆对象，Electron `ipcRenderer.send` 抛 `An object could not be cloned`。
- **不是** Panda Stage 产品 IPC bug，**不是** #199 产品修复引入的回归。
- **最小修复**：所有 renderer 片段改为「已调用的 IIFE `(() => {...})()`，返回纯对象」。复用 #206 审计器验证 `scripts`：`236 snippets checked / 0 suspicious`。
- **回归验证**：首次 ruler seek 10% / 50% / 90% / drag / zoom 1→2→4 / collapse→expand 后 seek 均不再报 clone error；Day 26 FUNC-002 真机恢复（§5、§14）。

## 13. 最新 CI 与收卷质量门

| 项 | 值 |
|---|---|
| 收卷前 CI（#207 记录时） | run `31853823744` @ `6be756f`，Classify / Full / Final 均 SUCCESS |
| **收卷后 CI（含 NEG-002 gate）** | **run `31859114748` @ `4190cd78`，Classify / Full / Final 均 SUCCESS**（含 Build + Run full regression suites，NEG-002 真机 PASS） |
| `git diff --check`（收卷 HEAD `4190cd78` vs 父 `6be756f`） | EXIT 0 |
| `git diff --check`（PR 全范围 `b42947da..4190cd78`） | EXIT 0 |
| 新增产品代码改动 | 无（仅 `scripts/verify-issue207-*` + `package.json`/`ci.yml` 接线） |

## 14. 维护者真人验收摘要（真实 Windows Electron）

维护者已在真实 Windows Electron 中确认：

- 3000ms 镜头：点击 seek 到 `0.208s / 1.500s`；
- drag seek 到 `2.750s / 2.250s`；
- 4321ms 镜头：极限拖动停在 `4.292s / 4.321s`，未越界；
- 2× / 4× zoom + 横向 scroll 后 currentTime 保持 `4.292s`；
- Shot A 非零 → Shot B = 0；Shot B 非零 → Shot A = 0；
- 全程项目保持已保存，Undo/Redo = `0 / 0`。

上述与 §5 代理验收、§11 NEG-002 真机证据、§7 刀刃表一致。
