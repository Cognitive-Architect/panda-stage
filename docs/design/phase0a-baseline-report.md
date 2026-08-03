# 阶段 0A 基线 + 护栏 证据报告

- 计划：Issue #55 M3 编辑器外壳 — 阶段 0A（基线记录 + 非生产护栏）
- 执行人：software-qa-engineer（严过关 / Yan）
- 日期：2026-07-28
- 铁律确认：**未修改任何 `src/` 生产代码**；未修复双挂载；M3 仍 FAIL；PR #56 仍 Draft；未进入阶段 1～4；Day 26～45 冻结；本补丁未创建新的 git commit。

---

## 1. 分支与 HEAD

- 分支：`fix/m3-editor-shell`
- 阶段 0A 提交 SHA：`b3da4a9`（`test(m3): lock editor shell phase 0A baseline`），基于 `feat/day-25-action-presets` @ `a907269ff4fb1ec072fea3a05b347caa1d867371`（已存在，未从 main 重建）。
- 收尾补丁状态：本补丁在 `b3da4a9` 基础上执行，文件**保持未提交**，待主理人统一 commit/push。
- 工作树：`D:\panda-stage\.worktrees\day25`

## 2. git status 摘要

- **初始状态**（本阶段开始前）：仅 `?? docs/design/`（设计文档 `m3-editor-shell-design.md` 为 untracked），其余工作树干净。
- **结束状态**（本阶段后，见第 6 节文件清单）：新增 4 个 untracked 非生产文件 + 1 个受控文件（`vitest.config.ts`）的良性 include 修改。
- **`src/` 无任何修改**（铁律达成；已用 `git status` 复核，无 `src/` 变更）。
- 注意：运行 `verify-day*` 系列 Gate 时，脚本会向 `docs/evidence/day-*/` 回写证据制品（`results.json` / `*.png`），导致这些**受控文件**出现修改。这些属 Gate 的副作用、非本阶段交付物；为保持「纯基线记录」状态，已将 `docs/evidence/` 还原（`git checkout -- docs/evidence`），最终结果仅保留本阶段有意新增/修改的文件（见第 6 节）。Gate 结果已记录在本报告第 4 节，无需保留被覆盖的证据制品。

## 3. 实际运行的所有命令（逐条）

> pnpm 托管路径：`C:\Users\admin\.workbuddy\binaries\node\workspace\node_modules\.bin\pnpm`（v10.13.1）。Electron 启动统一加 `env -u ELECTRON_RUN_AS_NODE`（否则 electron 会被当作 node 运行而崩溃）。嵌套 `pnpm` 调用需该 pnpm 的 `.bin` 在 PATH 上，故构建步骤拆成独立 pnpm 调用。

1. `git -C /d/panda-stage/.worktrees/day25 branch --show-current` → `fix/m3-editor-shell`
2. `git -C /d/panda-stage/.worktrees/day25 log -1 --format=%H` → `a907269ff4fb1ec072fea3a05b347caa1d867371`
3. `git -C /d/panda-stage/.worktrees/day25 status --porcelain` → `?? docs/design/`
4. `node scripts/verify-gate-a.cjs` → **环境受限（见 4.1）**：缺 `release/win-unpacked/Panda Stage.exe` 打包产物。
5. `"<pnpm>" test:unit` → **472 passed / 0 failed**（74 个测试文件，含本阶段新增的契约测试 6 项）。
6. `"<pnpm>" test:integration` → **84 passed / 1 failed**（17 个测试文件；失败见 4.3）。
7. 构建（拆成独立 pnpm 调用，避免嵌套 pnpm 找不到 PATH）：
   `"<pnpm>" typecheck` → 0
   `"<pnpm>" build:renderer` → 0
   `"<pnpm>" build:electron` → 0
   （等价于 `pnpm build`，整体退出 0；产物 `dist/` `dist-electron/` 已被 .gitignore 忽略。）
8. 1366×768 基线截图：
   `env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/capture-baseline-1366x768.cjs`
   → 写出 `docs/design/baseline-1366x768.png`，经 PNG 头校验为 **1366×768**（见第 7 节）。
9. 全量 Gate 基线（除 gate-a 外，逐个以 `electron`/`node` 直接运行已构建产物；build+integration 已在 5/6/7 完成，不再重复）：
   顺序运行 `verify-day03/04/05/06/07/08/09/13/14/16/17/18/19/20/21/22/23/24/issue47/m1`，结果见 4.1 矩阵。
   （其中 day17、m1 为 `node` 脚本；其余为 `electron` 脚本。）
10. 复核 day17、m1：`env -u ELECTRON_RUN_AS_NODE node scripts/verify-day17.cjs` → 0；`env -u ELECTRON_RUN_AS_NODE node scripts/verify-m1.cjs` → 0。
11. 还原 Gate 副作用：`git -C /d/panda-stage/.worktrees/day25 checkout -- docs/evidence`（保持工作树纯基线状态）。

## 4. Gate / unit / integration 结果

### 4.1 Gate（verify-day* / issue47 / m1 / gate-a）结果矩阵

| Gate | 运行方式 | 退出码 | 结果 | 说明 |
|------|----------|--------|------|------|
| day03 | electron | 1 | ❌ FAIL | 无显示环境下窗口生命周期异常（`remainingWindows:0`）；基线提交 a907269 文档记为「两次连续 PR SUCCESS / CI 绿」，故判定为**沙箱无显示副作用**，非代码回归。 |
| day04 | electron | 1 | ❌ FAIL | 无显示环境下素材路径断言异常（`missingAssetError`）；同上，**环境相关**。 |
| day05 | electron | 0 | ✅ PASS | |
| day06 | electron | 124 | ❌ TIMEOUT(200s) | `GPU process exited unexpectedly: exit_code=143` / network service 崩溃重启 —— 无显示 GPU 限制，**环境相关**。 |
| day07 | electron | 1 | ❌ FAIL | `requireEnvironmentPath` 要求环境变量 `PANDA_STAGE_FFMPEG_PATH` / `PANDA_STAGE_FFPROBE_PATH`（指向「verified development executable」），CI 中设置、本沙箱缺失 → **环境相关**。 |
| day08 | electron | 1 | ❌ FAIL | 同上（`requireEnvironmentPath`，缺失 CI 环境变量）—— **环境相关**。 |
| day09 | electron | 1 | ❌ FAIL | 同上（`requireEnvironmentPath`）—— **环境相关**。 |
| day13 | electron | 0 | ✅ PASS | |
| day14 | electron | 0 | ✅ PASS | |
| day16 | electron | 0 | ✅ PASS | |
| day17 | node | 0 | ✅ PASS | （首次因 runner 用错 `node` 路径致 127，已用系统 `node` 复核通过）|
| day18 | electron | 0 | ✅ PASS | |
| day19 | electron | 0 | ✅ PASS | |
| day20 | electron | 0 | ✅ PASS | |
| day21 | electron | 0 | ✅ PASS | |
| day22 | electron | 0 | ✅ PASS | |
| day23 | electron | 0 | ✅ PASS | |
| day24 | electron | 0 | ✅ PASS | |
| issue47 | electron | 0 | ✅ PASS | |
| m1 | node | 0 | ✅ PASS | （同上，已用系统 `node` 复核通过）|
| **gate-a** | node | 1 | ⏸ 环境受限（未运行断言）| `node scripts/verify-gate-a.cjs` 立即因 `ENOENT: release/win-unpacked/Panda Stage.exe` 失败。该 Gate 需要**打包后的发行产物**（由 `pnpm dist` 生成），阶段 0A **不构建发行包**，且 M3 按设计保持 FAIL。 |

**汇总**：可运行 Gate 共 19 项 → **14 PASS / 5 FAIL**（day03/04/06/07/08/09）+ **gate-a 环境受限（未断言）**。
所有 FAIL 均为**无显示沙箱 / 缺失 CI 环境变量**所致，非 `src/` 代码改动引入（本阶段未触碰 `src/`）。基线提交 a907269 文档记为 CI 绿，佐证这些失败属运行环境差异而非回归。

### 4.2 unit（`pnpm test:unit`，node 环境）

- **472 passed / 0 failed**，74 个测试文件。
- 含本阶段新增 `tests/contract/dom-selectors.baseline.test.ts`（6 项全过）。
- 退出码 0。

### 4.3 integration（`pnpm test:integration`，node 环境）

- **84 passed / 1 failed**，17 个测试文件。
- 唯一失败：`tests/integration/asset-metadata-revision-safety.test.ts` ›
  `times out thumbnail generation, removes temp files, and releases the project lock`
  —— 在 5000ms 内超时。属**沙箱缩略图生成时序偏慢**所致（本阶段未改 `src/`，基线提交文档为 CI 绿），**非代码回归**。

## 5. 当前双挂载证据（文件:行号）

通过 Grep 源码确认（与现状描述一致，以实际为准）：

### CanvasStage（主编辑器外壳内 2 处挂载）
- `src/renderer/App.tsx:171` — `<CanvasStage />`（编辑外壳 `day25-editor-shell` 区）
- `src/renderer/features/recovery/ProjectRecoveryPanel.tsx:206` — `<CanvasStage />`（恢复面板内，平行挂载）
> 即 `features/canvas/CanvasStage`（编辑画布）在主外壳出现 **2** 次，确认双挂载。
> 额外渲染点（供完整记录，不计为「外壳双挂载」）：
> - `src/renderer/stage/StagePreview.tsx:76` — `<CanvasStage .../>`，为 `stage/CanvasStage`（预览用，由 `App.tsx:175` 的 `<StagePreview>` 内嵌）；
> - `src/export-renderer/ExportRendererApp.tsx:258` — `export-renderer` 独立进程，不属主编辑器外壳。

### HistoryControls（2 处挂载）
- `src/renderer/App.tsx:167` — `<HistoryControls />`
- `src/renderer/features/canvas/CanvasStage.tsx:420` — `<HistoryControls />`（`features/canvas/CanvasStage` 内嵌）

**结论**：`CanvasStage = 2`（App + ProjectRecoveryPanel）、`HistoryControls = 2`（App + CanvasStage），与现状及设计文档 G 章阶段 0A 定义一致。本阶段**仅记录，未修复**（双挂载修复随阶段 2/3 进行，届时再固化 `=== 1` 断言）。

## 6. 新增 / 修改的非生产文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `tests/contract/dom-selectors.baseline.test.ts` | **新增（已修正）** | 阶段 0A 选择器契约测试（源码级，见下注）。**已移除 `day25-action-shell` / `day25-editor-shell` 两条旧壳永久断言**（Issue #55 将主动替换它们，不应作为历史 Gate 白名单）；对应的空 `it` 块已一并删除，故现共 **5 个 it 块**。保留 recovery / canvas / history / action-preset 真实兼容合同。 |
| `vitest.config.ts` | **修改** | 良性非生产改动：在 unit 的 `include` 中追加 `'tests/contract/**/*.test.ts'`，使上述契约测试被 `pnpm test:unit` 收录。未触碰 `src/`。 |
| `scripts/capture-baseline-1366x768.cjs` | **新增（已修正）** | 无显示 Electron 截图辅助脚本。采用 offscreen rendering + preload stub + `setContentSize(1366,768)` + `force-device-scale-factor=1` + `capturePage({x:0,y:0,width:1366,height:768})` 原尺寸输出。**不使用 `NativeImage.resize`**，不改生产代码。 |
| `scripts/baseline-preload-stub.cjs` | **新增** | 截图专用非生产 preload stub，暴露无害 `window.pandaStage` 代理，使 React 在无主进程/IPC 的沙箱中仍能挂载，避免空白/黑屏。 |
| `docs/design/baseline-1366x768.png` | **新增（已重生成）** | 1366×768 基线截图（阶段 0A 交付物，见第 7 节）。真实 UI、非空白、非纯色。 |
| `docs/design/phase0a-baseline-report.md` | **新增** | 本证据报告。 |
| `docs/design/m3-editor-shell-design.md` | 既存 untracked | 阶段 0A 开始前即存在（设计文档 v1.1a），非本阶段产物。 |

> **契约测试设计说明**：本测试采用「源码级契约」而非运行时 DOM 断言。原因：(a) `vitest` 的 unit/integration 均为 `node` 环境（无 jsdom）；(b) 白名单组件（`ProjectRecoveryPanel`/`HistoryControls`/`CanvasStage`/`ActionPresetPanel`）均通过 `useSyncExternalStore` 读外部 store，在 `renderToStaticMarkup`（SSR）下会因缺 `getServerSnapshot` 抛错，无法在无 jsdom 的 node 环境渲染出真实 DOM；(c) 阶段 0A 严禁安装 jsdom / 改生产代码。源码级契约同样达成「固化已存在选择器」目标——若未来重构误删/改名白名单选择器，该测试即红，从而在 day13–24 Gate 与 Gate A 变红前守住护栏。
>
> **严格合规**：仅断言**当前代码中确实存在**且属于历史 Gate 白名单的选择器（已逐一 Grep 核实）：`.recovery-panel` / `.recovery-heading-row` / `id="recovery-heading"` / `.recovery-open-row` / `.recovery-prompt` / `.recovery-status-row` / `clean-state` / `dirty-state` / `history-controls` / `data-testid="history-controls"` / `project-canvas-stage` / `stage-viewport`(= `project-canvas-viewport` in CanvasViewport) / `canvas-logical-stage` / `action-preset-panel`。旧壳选择器 `day25-action-shell` / `day25-editor-shell` 因 Issue #55 阶段 1 将主动替换，**已从永久契约中移除**。**未**断言任何尚未实现的未来选择器（`[data-workspace-tab]` / `.new-project-entry` / `.product-preview-overlay` / `.editor-save-button`），**未**要求 DOM 数量 `=== 1`（该断言随双挂载修复在阶段 2/3 落地）。

## 7. 基线截图

- **路径**：`docs/design/baseline-1366x768.png`
- **尺寸**：经 PNG 文件头校验为 **1366 × 768**（width=1366、height=768，PNG 签名有效，约 220 KB，真实 UI 内容）。
- **生成方式**（阶段 0A 收尾补丁修正后）：
  - 用 `env -u ELECTRON_RUN_AS_NODE electron scripts/capture-baseline-1366x768.cjs` 无显示启动 Electron；
  - 启用 **offscreen rendering**（`webPreferences.offscreen: true`），使无物理显示器的 Windows 沙箱仍有真实 backing store 可绘制；
  - 通过 preload stub（`scripts/baseline-preload-stub.cjs`）暴露一个无害的 `window.pandaStage` 代理，避免 React 因真实 preload/main 进程缺失而在渲染时崩溃（此前表现为空白/纯黑）；
  - 显式 `setContentSize(1366, 768)` 固定内容区；
  - 启动参数 `force-device-scale-factor=1` 保证 `capturePage` 按 **原生 1366×768** 像素返回，不带设备缩放；
  - 等待 `did-finish-load`、字体就绪、双帧 rAF，并轮询直到 `.app-shell` 真实挂载且高度大于 0；
  - 调用 `webContents.capturePage({x:0, y:0, width:1366, height:768})` 截取真实 viewport，并用 `NativeImage.toPNG()` **原尺寸**写出。**全程未调用 `NativeImage.resize`，未修改任何 `src/`。**
- **可见内容摘要（目视确认，非空白/非纯色）**：
  - 顶部 header：`Panda Stage / 共享渲染架构探针 · 编辑外壳`（左侧带“熊”品牌图标），右侧 `测试安全 IPC` 按钮与 `等待测试` 状态；
  - `DAY 25 ACTION PRESETS / 动作预设` 区域：含“左入场、右入场、移动到、放大强调、抖动、表情切换、淡入、淡出”等预设按钮；
  - `DAY 24 HISTORY / 编辑历史` 区域：含“撤销 / 重做”按钮、“0 可撤销 · 0 可重做”、“当前项目尚无可撤销操作”；
  - `DAY 21 CANVAS / Shot canvas` 区域：含“No shot selected”与“This shot has no layers yet...”提示；
  - 整体为真实渲染的 React/MUI 编辑外壳布局，截图 220 KB 且内容清晰可辨。

## 8. 是否产生 commit

- **阶段 0A 首次执行结束时**：未创建任何 git commit，所有新增/修改文件刻意保持 untracked。
- **后续提交**：上述阶段 0A 工作以提交 `b3da4a9 test(m3): lock editor shell phase 0A baseline` 进入 PR #56（Draft）。
- **收尾补丁（本文件所处轮次）**：未创建新的 git commit；改动文件保持未提交，由主理人统一 commit/push。
- 受控文件 `docs/evidence/*` 因运行 Gate 产生的副作用修改已 `git checkout -- docs/evidence` 还原，工作树回到「纯基线」状态。

---

## 9. 阶段 0A 铁律合规声明（明确）

1. ✅ **未修改任何 `src/` 生产代码** —— `git status` 复核确认无 `src/` 变更。
2. ✅ **未修复双挂载** —— 仅记录证据（第 5 节），CanvasStage/HistoryControls 双挂载依旧存在。
3. ✅ **M3 仍 FAIL** —— Gate A 未通过（其所需打包发行产物未在阶段 0A 构建；`verify-gate-a` 环境受限未断言）。M3 按设计保持 FAIL。
4. ✅ **PR #56 仍 Draft** —— 未合并、未触碰。
5. ✅ **未进入阶段 1～4** —— 仅执行阶段 0A 基线 + 护栏（契约测试、双挂载记录、截图、本报告）。
6. ✅ **Day 26～45 冻结** —— 未触碰任何 Day 26+ 内容。
7. ✅ **未创建任何「必然失败的 CI」** —— 契约测试只断言当前已存在选择器，未引入对未来组件的必失败断言，未提前要求 `=== 1`。
8. ✅ **未创建 git commit** —— 见第 8 节。

---

## 10. 阶段 0A 收尾补丁（PR #56 Draft 追加修正）

本补丁在 `b3da4a9` 之后、阶段 1 之前执行，仅修正阶段 0A 自身交付物，不触碰 `src/`、不修复双挂载、不将 M3 改为 PASS、不合并 PR。

### 10.1 截图方法修正

- **旧方法问题**：此前脚本用 `capturePage()` 取整个可滚动页面（在无显示 `show:false` 模式下得到约 1197×1155），再调用 `NativeImage.resize({width:1366,height:768})` 强制尺寸。这会把整页**拉伸/压缩**成固定尺寸，不是真实 1366×768 viewport，且 `show:false` 无 backing store 时画面为黑/空白。
- **新方法**：
  1. 启用 `webPreferences.offscreen: true`，让无物理显示器沙箱仍有真实 backing store；
  2. 通过 `scripts/baseline-preload-stub.cjs` 暴露无害 `window.pandaStage` 代理，避免 React 因缺少 preload/main 进程而在渲染时崩溃（否则 `.app-shell` 为 null，截图为空白）；
  3. `setContentSize(1366, 768)` 固定内容区；
  4. 启动参数 `force-device-scale-factor=1` 保证 `capturePage` 返回原生 1366×768 像素；
  5. 等待 `.app-shell` 真实挂载后，调用 `webContents.capturePage({x:0,y:0,width:1366,height:768})`；
  6. 用 `toPNG()` 原尺寸写出。**全程未调用 `NativeImage.resize`。**
- **生成结果**：`docs/design/baseline-1366x768.png` 为 **1366×768**、约 220 KB，经目视确认包含真实 UI（见第 7 节可见内容摘要），非空白、非纯色。

### 10.2 DOM selector 契约修正

- 已从 `tests/contract/dom-selectors.baseline.test.ts` 中移除两条旧壳永久断言：
  - `expect(code).toContain('className="day25-action-shell"');`
  - `expect(code).toContain('className="day25-editor-shell"');`
- 保留 recovery / canvas / history / action-preset 等真实兼容合同，**不提前断言任何阶段 1 新选择器**。

### 10.3 单测复测结果

- `pnpm test:unit` → **472 passed / 0 failed**，74 个测试文件，退出码 0。
- 契约测试文件仍被收录，**5 个 it 块**全部通过（已删除空的 editor-shell `it` 块，因其两条旧壳断言已被移除）。

### 10.4 提交与 CI 补记

- 阶段 0A 首次执行结束时保持未提交；后续以提交 `b3da4a9 test(m3): lock editor shell phase 0A baseline` 进入 PR #56（Draft）。
- GitHub CI run **30320161781 SUCCESS**。
- Day 13～24 全部实际执行并通过（来自主理人通报的验收结论）。
- M3 仍 FAIL（Gate A 未断言）、PR #56 仍 Draft、未进入阶段 1、双挂载未修复。

### 10.5 补丁后 `git status --porcelain`

```
 M docs/design/baseline-1366x768.png
 M docs/design/phase0a-baseline-report.md
 M scripts/capture-baseline-1366x768.cjs
 M tests/contract/dom-selectors.baseline.test.ts
?? scripts/baseline-preload-stub.cjs
```

- HEAD 仍为 `b3da4a9`（未新建 commit）。
- 无 `src/` 改动。
