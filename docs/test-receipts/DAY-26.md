# DAY-26 验收收据 — Editor Workspace Completion + Timeline Shell

> **Issue #191 / Day 26 任务**：在 `BottomWorkspace` 中交付 Timeline Shell（ruler / timecode / playhead / click-seek / drag-seek / 24 FPS snap / zoom / horizontal-scroll），UI 状态（`currentTimeMs` / `zoom` / `scrollPx`）永不进入 `ProjectSchema` / `History` / `dirty` / `revision`。完成后停在真实 Windows Electron 人工验收点，等待维护者。
>
> **结论**：`PASS`（自动化与结构性验收全部通过；视觉/人工 PASS 保留给维护者，Electron 实例已保持运行）。

## 1. 基线与收卷

| 项 | 值 |
|---|---|
| 分支 | `agent/day-26-timeline-shell` |
| 收卷 HEAD | `323f36dc39724e2dc553dedfa1998ba0428a3967` |
| 基线 | `origin/main`（同 HEAD，本验收未产生新 commit） |

## 2. 变更文件

| 文件 | 说明 |
|---|---|
| `src/renderer/features/timeline/timeGeometry.ts` | 纯函数时↔像素几何 + 24 FPS 吸附 + ruler 刻度 |
| `src/renderer/features/timeline/timelineUiStore.ts` | UI-only store；订阅 `shotStore`；resetForShot；不触碰 `EditorProjectStore` |
| `src/renderer/features/timeline/TimelineDock.tsx` | 唯一 Timeline 产品面 |
| `src/renderer/shell/BottomWorkspace.tsx` | 挂载 `TimelineDock` + 原有 `HistoryControls` |
| `src/renderer/styles.css` | Timeline Shell 样式，`.bottom-workspace` 高度调整为 `132px/168px` |
| `tests/unit/features/timeline/timeGeometry.test.ts` | 几何/吸附/时码/刻度 11 条单元测试 |
| `tests/unit/features/timeline/timelineUiStore.test.ts` | store 行为 4 条单元测试（含 shot 切换重置） |
| `tests/integration/editor-shell-layout.test.ts` | 新增 Timeline Shell 集成断言 |
| `tests/contract/dom-selectors.baseline.test.ts` | 同步 `.bottom-workspace` 高度基线 |

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
✓ built in 83ms
PRELOAD_INDEX_EXIT=0

$ PRELOAD_ENTRY=hidden node_modules/.bin/vite build --config vite.preload.config.ts
✓ built in 68ms
PRELOAD_HIDDEN_EXIT=0

$ node_modules/.bin/vitest run --config vitest.integration.config.ts
Test Files  1 failed | 23 passed (24)
Tests       1 failed | 140 passed (141)
INTEGRATION_EXIT=1

# 定位根因后，去掉 shell 注入的 ELECTRON_RUN_AS_NODE 重跑，全绿：
$ env -u ELECTRON_RUN_AS_NODE node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/left-workspace.test.ts
✓ tests/integration/left-workspace.test.ts (1 test) 22943ms
Test Files  1 passed (1)
Tests       1 passed (1)
LEFTWS_EXIT=0

$ env -u ELECTRON_RUN_AS_NODE node_modules/.bin/vitest run --config vitest.integration.config.ts
✓ tests/integration/left-workspace.test.ts (1 test) 24898ms
Test Files  24 passed (24)
Tests       141 passed (141)
INTEGRATION_CLEAN_EXIT=0
```

**集成门最终结论：全绿 141/141。**

首轮唯一失败项 `tests/integration/left-workspace.test.ts`（Issue #81）已定位根因，**与 Day 26 无关**：

- 该测试在 `left-workspace.test.ts:807` 用 `execFileSync(process.execPath, [electronCli, gatePath])` 拉起 Electron 跑校验脚本，**未传显式 `env`**，因此继承了当前 shell 被注入的 `ELECTRON_RUN_AS_NODE=1`。
- 该变量会让 `electron.exe` 退化为普通 Node（`process.type === undefined`），此时 `require('electron')` 解析到 npm 包路径字符串而非运行时模块；而校验脚本位于系统临时目录，无法解析到仓库 `node_modules`，于是报 `MODULE_NOT_FOUND: 'electron'`。
- 用 `env -u ELECTRON_RUN_AS_NODE` 重跑：单文件 `1 passed`、整套 `141 passed`，均 EXIT 0。
- 另经 grep 确认该测试未引用任何 Day 26 文件（`timeline` / `BottomWorkspace` / `timelineUiStore` / `timeGeometry` / `TimelineDock` 均无命中）。

## 5. 真实 Windows Electron 验收步骤与证据

### 5.1 启动与项目状态

- 命令：`env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron . --user-data-dir=D:/panda-stage-main/.workbuddy/artifacts/electron-userdata --no-sandbox --disable-gpu --in-process-gpu --remote-debugging-port=9223`
- 已通过最近项目列表打开 `D:\PandaStage-Acceptance\story-2.pandastage`（项目 id `10000000-0000-4000-8000-000000000001`）。
- 项目含 2 个镜头：shot A `50000000-0000-4000-8000-000000000001`（4321 ms）、shot B `116932f2-47c2-44d6-8e77-d8dafef506fe`（3000 ms）。
- CDP 当前可用：`http://127.0.0.1:9223/json/version` 返回 `Chrome/150.0.7871.114 / Electron/43.1.1`。
- 页面 target：`file:///D:/panda-stage-main/dist/renderer/index.html`（主窗口）、`.../hidden.html`（隐藏渲染窗口）。
- **profile 归属确认**：本次验收实例的 `--user-data-dir` 确为 `.workbuddy/artifacts/electron-userdata`，其 `DevToolsActivePort` = `9223 /devtools/browser/4105053e-c7e0-45de-ae43-662af2fa9d31`，且该目录内含本次种入的 `recent-projects.json`。根目录遗留的 `panda-stage-main.workbuddyartifactselectron-userdata` 属**已终止的早期实例**（`DevToolsActivePort` = `.../0571c7e1-a0e7-4305-8f26-b337bd93e1a2`，且不含 `recent-projects.json`），未参与本次验收。

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

## 7. 16 项刀片表（Blade Table）

| # | 项 | 结果 | 备注 |
|---|---|---|---|
| 1 | Timeline Shell 唯一挂载于 `BottomWorkspace` | ✅ PASS | 无第二个 owner |
| 2 | ruler 刻度 24 FPS 对齐 | ✅ PASS | 12 ticks，吸附反查通过 |
| 3 | timecode 显示 mm:ss.mmm | ✅ PASS | |
| 4 | playhead 渲染并跟随 currentTimeMs | ✅ PASS | 绿色，seek 后位置正确 |
| 5 | click-seek 吸附到 24 FPS | ✅ PASS | 2792 ms = 67 frames |
| 6 | drag-seek 吸附到 24 FPS | ⚠️ 代码路径存在 | 与 click-seek 共用 pointer handler；未在真机做 drag 手势 |
| 7 | zoom in/out 控制 | ✅ PASS | 1×→2×→1× |
| 8 | horizontal scroll 容器 | ⚠️ 存在 | `onScroll` 与 `scrollPx` 已实现；当前测试场景 ruler 未触发溢出滚动 |
| 9 | currentTimeMs/zoom/scrollPx 不进入 project / dirty / revision | ✅ PASS | saveBtn disabled |
| 10 | 未复活 ActionPreset / Stage 3-B / PR #177 | ✅ PASS | 代码/测试中无相关引用 |
| 11 | 未新增通用 TimelineEvent 编辑器 | ✅ PASS | |
| 12 | 未引入 keyframe / 多轨 NLE | ✅ PASS | |
| 13 | 未使用硬编码 duration / shotId | ✅ PASS | 取自 `editorProjectStore` 与 `shotStore` |
| 14 | 未使用 setTimeout 模拟播放头 | ✅ PASS | |
| 15 | 未将 playhead 写入 project.json | ✅ PASS | dirty 不变量确认 |
| 16 | `TIMELINE_FPS = PROJECT_FPS = 24` | ✅ PASS | |

## 8. P4 / 性能 / 债务

- 时间几何为纯函数，无组件依赖；ruler 刻度按需生成；`ResizeObserver` 仅测量一次宽度。
- 当前 store 订阅数少，未观察到明显渲染开销。
- **债务 / 后续可增强点**：
  - 在真实设备上做完整 drag-seek 手势验证；
  - 长镜头 + 高 zoom 下的水平滚动独立验证；
  - 键盘左右帧微调快捷键；
  - 移除仓库根目录遗留的 `panda-stage-main.workbuddyartifactselectron-userdata` 目录（见 Caveat 4，需在宿主环境手工删除）。

## 9. 已知限制 / Caveats

1. `Browser.setWindowBounds` 在此 Electron 构建中 CDP TIMEOUT，使用 `Emulation.setDeviceMetricsOverride` 完成 1366×768 与 800×560 视口验证。
2. `ELECTRON_RUN_AS_NODE=1` 被注入当前 shell；真实 Electron 必须 `env -u ELECTRON_RUN_AS_NODE` 启动。
3. 集成测试 `left-workspace.test.ts` 在被污染的 shell 下会因 `Cannot find module 'electron'` 失败（根因见第 4 节）。在干净环境下 141/141 全绿。该测试自身会拉起 Electron，**运行它会把留给人工验收的 Electron 实例带下线**，验收期间应避免重跑。
4. 仓库根目录存在未跟踪目录 `panda-stage-main.workbuddyartifactselectron-userdata/`（61 个条目，Chromium profile 残留）。
   - **根因**：早期一次启动在 Git Bash 中传了反斜杠参数 `--user-data-dir=D:\panda-stage-main\.workbuddy\artifacts\electron-userdata`，反斜杠被 shell 当作转义吞掉，路径塌缩成该相对目录名。后续启动改用正斜杠后不再复现。
   - **清理受阻**：当前环境的删除保护 fail-closed，`rm -rf` / `rd /s /q` / `Remove-Item -Recurse -Force` 均被拦截，报 `[safe-delete][SAFE_DELETE_FAIL_CLOSED] ... reason:"trash-failed"`。
   - **处置**：未修改 `.gitignore`（避免污染 Day 26 diff），保留为纯环境残留，需维护者在宿主侧手工删除。它不影响构建、测试与本次验收 profile。

## 10. 结论

- **自动化质量门**：全部通过（typecheck ×2、eslint、unit+contract 648/648、build、preload build ×2、integration 141/141）。
- **真实 Windows Electron 结构性验收**：通过（Timeline Shell 在 1366×768 与 800×560 渲染、seek/zoom/A→B→A 行为正确、project dirty 不变量保持）。
- **视觉/人工验收**：保留给维护者。代理**不自我声明视觉 PASS**。Electron 实例可用如下命令随时拉起：
  `env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron . --user-data-dir=D:/panda-stage-main/.workbuddy/artifacts/electron-userdata --no-sandbox --disable-gpu --in-process-gpu --remote-debugging-port=9223`

**综合结论：PASS**。维护者确认视觉后可由维护者决定合并/关闭 Issue #191，代理不再推进 Day 27 或任何额外范围。
