# Panda Stage（熊猫片场）

Panda Stage 是一款面向个人创作者的 Windows Electron 桌面编辑器，用于把角色图片、背景、对白、音频和简单动作组织成短篇 2D 纸片人动画。仓库当前的主产品面是项目管理、资源工作区、镜头编辑、Konva 画布、图层检查器、撤销/重做、保存与恢复。

## 当前能力与开发状态

当前 `main` 已包含一套连续的 Editor Shell：

- 项目中心支持新建、打开、最近项目、项目切换、项目文件夹入口和应用内关闭确认；
- 编辑器支持镜头、素材和角色资源工作区，正式画布支持背景、图层选择、位置/变换、锁定、排序和删除；
- 右侧检查器承载背景管理、图层变换与排序控制；编辑历史支持撤销、重做和连续拖拽合并；
- 项目保存使用版本与修订号保护，Main Process 提供 autosave、恢复候选和恢复文件管理；
- 动作预设的领域逻辑、校验、历史和持久化桥接已经存在，当前 UI 仍从左侧“兼容编辑工具”入口进入；它后续迁移到正式检查器的工作尚未成为 `main` 的交付内容；
- Main Process 仍保留隐藏 Renderer、帧写盘和 FFmpeg/ffprobe 的导出验证链，但这条链不等同于编辑器首页已经交付正式导出 UI 或安装包 sidecar。

M3 的正式背景、图层和选择合同已经进入当前 `main`；后续 Stage 3-B/3-C/4 仍按各自的授权、Draft 状态和人工验收推进。本文不把 M3、Stage 3-B、Stage 3-C 或 Stage 4 宣布为完成，也不把早期 Day 计划当作当前产品阶段。

项目文件固定使用 1920×1080、24 FPS 和当前正式 schema v5。保存的素材路径必须相对于项目目录，时间字段使用整数毫秒。

## 技术栈

- Electron
- React 19
- TypeScript
- Vite
- Konva / react-konva
- Zod
- Vitest
- ESLint
- pnpm

## 当前架构总览

```text
App
└─ EditorShell                                  唯一项目会话与生命周期入口
   ├─ ProjectCenterScreen / StartScreen          无项目或项目中心页
   └─ Editor layout
      ├─ CompactProjectBar                       项目状态、保存、切换、预览、关闭
      ├─ LeftWorkspace
      │  └─ ResourceActivityDock                 镜头 / 素材 / 角色工作区
      │     ├─ ProjectRecoveryPanel              最近项目与恢复相关入口
      │     └─ LegacyCompatibilityActivity       暂留的动作预设兼容入口
      ├─ CanvasWorkspace
      │  └─ features/canvas/CanvasStage           正式 Konva 编辑画布
      │     └─ HistoryControls                    撤销 / 重做
      └─ RightInspector                           背景、变换、排序检查器
```

### 项目、领域与渲染

- `src/domain/` 是当前正式领域入口，包含 Project/Asset/Character/Shot/Layer/TimelineEvent 模型、schema、迁移、selector、service、validator、几何规则和动作预设。
- `src/renderer/stores/EditorProjectStore.ts` 是 Renderer 中 Project、`dirty` 和 `revision` 的唯一 owner；`src/history/` 提供它所持有的内存命令历史。
- `shotStore` 只保存当前镜头选择，`selectionStore` 只保存当前图层选择；这些会话状态不写入 `project.json`，并在项目或镜头改变时重新校验。
- `CanvasStage` 从正式 `src/domain` 构建编辑渲染模型，使用项目素材的受控读取 API 和 1920×1080 逻辑坐标；画布只负责显示与交互提交，持久化变更经 domain service 和 Project store 完成。
- `src/shared/domain/` 是早期渲染探针/兼容模型，仍被历史测试或脚本使用，但不是当前正式编辑器模型的推荐入口。

### Main、Preload、IPC 与项目生命周期

```text
Renderer stores / UI
        │
        ▼
Preload allowlist + runtime Zod validation
        │
        ▼
Trusted-window IPC handlers
        │
        ▼
Main services
  ProjectService       project.json 的创建、打开、迁移、校验、原子保存
  AutosaveService      每个项目一个恢复调度会话
  RecoveryService      恢复文件的检测、读取、保留与清理
  Asset services       导入、元数据、缩略图和画布图片读取
  ExportService        隐藏 Renderer、帧写盘与 FFmpeg/ffprobe
```

`EditorShell` 只构造一个 `ProjectSessionController`，负责打开、切换、关闭、autosave 生命周期和 recovery candidate。正式保存由 Renderer 的 `saveCurrentProject()` 与 Main 的 `ProjectService` 共同完成；项目保存、恢复写入和清理按项目根目录共享协调器，不使用第二套项目 session。

## 目录结构

```text
src/
├── main/                  Electron Main、IPC handler、窗口和文件服务
├── preload/               主窗口和隐藏窗口的白名单桥
├── export-renderer/        隐藏导出 Renderer 入口
├── renderer/
│   ├── shell/             Project Center、EditorShell 和三栏编辑布局
│   ├── features/          canvas、assets、characters、shots、properties 等功能
│   ├── stores/            Project、Shot、Layer selection 等 Renderer store
│   └── stage/             预览/验证用舞台入口
├── domain/                当前正式 schema、迁移、服务、校验和动作领域
├── history/               命令历史与 ProjectCommand
└── shared/                IPC/API 合同、渲染合同和历史 probe 合同
tests/                     unit、integration、contract 和 Electron verifier 测试
scripts/                   Gate、Day/Issue verifier、fixture 和构建辅助脚本
docs/                      架构、开发约束、设计、handoff、证据和历史回执
```

## 本地开发

环境要求：Windows 10/11、Node.js `>=22.12.0 <25`、pnpm 10（版本由 `packageManager` 字段约束）。如果本机尚未启用 pnpm：

```powershell
corepack enable
corepack install
```

安装依赖并启动开发环境：

```powershell
pnpm install
pnpm dev
```

`pnpm dev` 会启动 Vite Renderer 和 Electron。Windows 路径、中文、空格和 Unicode 是正常支持场景；大体积验收数据优先放在 `D:\PandaStage-Acceptance\` 等专用目录。

## 质量检查与验证

### 核心命令

以下命令均来自当前 `package.json`：

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

Electron 或专项门禁按改动范围选择当前脚本中的 verifier，例如：

```powershell
pnpm verify:gate-a
pnpm verify:day13
pnpm verify:day16
pnpm verify:day17
pnpm verify:day18
pnpm verify:day19
pnpm verify:day20
pnpm verify:day21
pnpm verify:day22
pnpm verify:day23
pnpm verify:day24
pnpm verify:issue76
pnpm verify:issue109-resource-workspace
pnpm verify:issue125
```

验证选择原则：

- Markdown-only 改动至少执行 `git diff --check`，核对仓库内相对链接、命令名、过期状态描述和授权文件范围；不因为文档改动虚构完整 Electron 人工验收；
- Renderer/domain 改动执行 `typecheck`、`lint`、`test:unit`、`build`，涉及跨层或持久化时加 `test:integration`；
- Main/Preload/IPC/autosave/recovery 改动执行核心检查、集成测试、构建和最相关的 Electron verifier；需要真人验收时，自动化结果不能替代 Windows Electron 运行；
- 完整交付或 PR gate 以当前 `package.json` 中相关 `verify:*` 脚本和 CI 为准，不降低安全检查或测试门槛换取通过。

## Electron、IPC 与数据安全原则

- Main window 和隐藏 Renderer 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- Renderer 不直接访问 Node.js、`fs`、`path` 或子进程；文件系统和 FFmpeg 能力只在 Main Process。
- Preload 只通过冻结的白名单 API 暴露能力；IPC 通道名集中在 `src/shared/ipc/channels.ts`。
- IPC 请求和响应在 Preload 与 Main 两侧使用严格 Zod schema 校验，Main handler 还会核对发送窗口的 `webContents.id`。
- 项目保存使用项目 ID、schema、revision 和原子写入保护；恢复文件是 autosave 的恢复证据，不是对 `project.json` 的静默替代。
- 项目内素材路径必须保持相对路径，不允许通过路径遍历离开项目根目录。

## 文档导航

- [AGENTS.md](./AGENTS.md)：coding agent 的稳定工作规则和验证矩阵。
- [docs/architecture.md](./docs/architecture.md)：进程边界、数据模型、渲染与生命周期的架构说明；遇到版本化历史章节时以当前代码为准。
- [docs/development.md](./docs/development.md)：项目生命周期、autosave/recovery、素材和开发验证约束。
- [docs/ipc.md](./docs/ipc.md)：IPC 通道、payload、可信 sender 和导出边界。
- [package.json](./package.json)：当前可用的开发、测试、构建和 verifier scripts。
- [ROADMAP.md](./ROADMAP.md)：产品范围、架构原则和里程碑规划，不自动证明某阶段已交付。
- [DAILY_PLAN.md](./DAILY_PLAN.md)：逐日计划，适合查历史任务背景，不是当前实现入口。
- [agent task/README.md](./agent%20task/README.md)：逐日 Agent 工单；执行前仍需以当前 Issue/PR 和代码为准。
- [M3 Editor Shell design](./docs/design/m3-editor-shell-design.md)：M3 设计与迁移合同，属于设计/交接材料，不能替代当前代码审计。
- [FFmpeg 文档](./docs/ffmpeg.md)：媒体工具的配置、来源和许可证说明。

Issue/PR 是当前任务范围和交付状态的事实来源；旧 handoff、设计稿、Day 计划和测试回执是有价值的上下文或证据，但与当前代码冲突时不自动优先。

## 历史验证与 test receipts

Day 03–09 的 IPC、共享舞台、AudioContext 预览、隐藏窗口捕获、H.264/AAC 探针回执，以及后续 Day 11–24、M1、M2、M3 和 Gate A 记录都保留在 [`docs/test-receipts/`](./docs/test-receipts/) 中。它们用于追溯当时的验证范围、环境限制和回归证据，不代表当前项目仍处于对应的 Day 阶段。

尤其不要把 Day 08 或 Day 09 的媒体探针回执当成当前产品状态；当前状态应以本 README 的能力概览、当前源码、`package.json` 和活动 Issue/PR 为准。

GitHub：<https://github.com/Cognitive-Architect/panda-stage>

<!-- temporary CI docs-only validation v3 -->
