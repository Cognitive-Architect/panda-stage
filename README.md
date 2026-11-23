# Panda Stage（熊猫片场）

Panda Stage 是一款面向个人创作者的 Windows Electron 桌面编辑器，用于把角色图片、背景、对白、音频和简单动作组织成短篇 2D 纸片人动画。当前 `main` 已有项目中心、镜头与资源工作区、Konva 编辑画布、时间轴、角色与 FLA 相关工作流、产品预览及正式视频导出入口。

## 当前能力与开发状态

以下记录截至 **2026-11-23** `main` 已有的功能入口和代码实现。当前支持范围以源码、专项验收与 Issue/PR 为准；旧 Day、M3、Stage 计划是历史记录，不等于当前产品仍处在那个阶段。

### 项目、画布与工作区

- **项目中心**：新建、打开、最近项目、切换项目、打开项目文件夹和未保存更改时的关闭确认。
- **编辑器布局**：镜头、素材、角色资源工作区，Konva 画布、右侧检查器、底部时间轴；布局包括横向与窄屏／竖向自适应界面，产品仍是 Windows Electron 桌面应用。
- **图层编辑**：背景、选择、拖拽、位置与变换、锁定、排序、删除，以及角色／Graphic 的部分结构与属性编辑。
- **编辑历史与项目安全**：撤销／重做、连续编辑合并、版本／修订号保护、正式保存、autosave、恢复候选和恢复文件管理。

### 时间轴、对白、音频与动作

- **正式时间轴**（`TimelineDock`）：镜头时间标尺、播放头、定位、缩放／滚动；对白、独立音频、位置、图层动作和角色动作轨道。
- **对白与字幕**：对白编辑、说话者关联、字幕样式与预览渲染。
- **音频**：MP3/WAV 资源、音频片段、预览和正式导出混音相关逻辑；支持范围受素材及项目校验约束。
- **动画**：角色部件／节点运动、关键帧相关能力；旧动作预设入口仍作为兼容工具保留，不代表新动作功能全部停留在旧 UI。

### 角色、素材与 FLA

- 素材导入、资源管理、元数据、缩略图及受控画布图片读取。
- 角色、表情、组合角色和 Adaptive Parts（可适应部件）的管理与编辑。
- **FLA（Adobe Animate）**：已有 FLA 检查／解析、预览、Graphic 元件／部件导入、角色创建、结构树、部分矢量形状／填充编辑、部件变换和布局复用相关代码与入口。
- FLA 能力取决于可识别结构、具体目标和操作路径，**不代表任意 FLA 或全部动画语义都能完整导入与导出**。连续帧工作台提交的静态图片不会自动变成镜头动画。

### 预览和正式视频导出

- 编辑器已有产品预览（`ProductPreviewOverlay`）与导出视频（`QuickActionDrawer`）入口。
- 正式导出链路包含输出位置选择、工程和素材预检查、候选快照、隐藏 Renderer 帧绘制、PNG 写盘、FFmpeg/ffprobe 编码与结果检查。
- `ExportTaskSurface` 提供任务状态、进度、取消、结果与适用状态下的重试功能。
- 当前正式 MP4 目标为 **1920×1080、24 FPS**；多镜头、音频、镜头模式、媒体类型与导出限制见 [导出支持矩阵](./docs/export-support-matrix.md)。已有产品 UI 和自动化证据，不等于所有 Windows 环境及安装包 sidecar 均已完成人工验收。

### 项目数据约定

- 正式项目版本已更新为 **`PROJECT_SCHEMA_VERSION = 23`**，见 [`src/domain/constants.ts`](./src/domain/constants.ts)。旧工程通过显式迁移与 Zod 校验进入当前模型；早期文档出现的 v5 或 v13 是历史版本。
- 固定 1920×1080、24 FPS，时间字段采用整数毫秒，素材文件路径相对于项目目录。
- `EditorProjectStore` 是 Renderer 正式项目、`dirty`、`revision` 的唯一 owner；镜头选择、图层选择和撤销历史属于会话状态，不直接存入 `project.json`。

## 技术栈

- Electron
- React 19
- TypeScript
- Vite
- Konva / react-konva
- Zod
- Vitest
- ESLint
- pnpm 10
- FFmpeg / ffprobe（媒体导出）
- JSZip、pako（相关素材与 FLA 工作流）

## 当前架构总览

```text
App / Renderer
└─ EditorShell                        唯一项目会话与生命周期入口
   ├─ ProjectCenterScreen            项目中心
   └─ Editor layout
      ├─ QuickActionDrawer           保存、切换、预览、导出等快捷操作
      ├─ ResourceActivityDock        镜头 / 素材 / 角色 / FLA 入口
      ├─ CanvasWorkspace
      │  └─ CanvasStage              Konva 画布、图层交互
      ├─ RightInspector              图层、角色与 Graphic 属性
      ├─ BottomWorkspace
      │  └─ TimelineDock             时间轴、对白、音频与动作
      ├─ ProductPreviewOverlay       产品预览
      └─ ExportTaskSurface           导出任务与结果
```

`CompactProjectBar.tsx` 仍是源码文件名，但当前产品快捷操作使用其中的 `QuickActionDrawer`；`AdaptiveWorkspaceSwitcher` 等组件负责自适应工作区切换。

### 项目、领域与渲染

- `src/domain/` 是正式领域入口，包含 Project/Asset/Character/Shot/Layer、动画、音频和 TimelineEvent 模型、schema、迁移、selector、service、validator 与几何逻辑。
- `src/renderer/stores/EditorProjectStore.ts` 负责 Project、`dirty`、`revision` 和内存命令历史；`src/history/` 为历史命令提供实现。`shotStore` 和 `selectionStore` 分别维护当前镜头与图层选择。
- `CanvasStage` 从正式领域模型构建渲染数据，使用项目素材的受控读取 API 和 1920×1080 逻辑坐标；持久化更改经 domain service 与 Project store 完成。
- `src/shared/domain/` 是旧渲染 probe 的兼容模型，不是新编辑功能的推荐入口。

### Main、Preload、IPC 与项目生命周期

```text
Renderer stores / UI
        │
        ▼
Preload 白名单 API + Zod 校验
        │
        ▼
可信窗口 IPC handlers
        │
        ▼
Main services
  ProjectService             创建、打开、迁移、校验、原子保存
  Autosave / Recovery        恢复候选与恢复文件管理
  Asset / FLA services       素材、预览、Graphic 和角色创建
  ExportPreparationService   内容预检查与候选快照
  ExportService              隐藏 Renderer、帧写盘、FFmpeg/ffprobe
```

`EditorShell` 只构造一个 `ProjectSessionController`，负责打开、切换、关闭、autosave 生命周期与恢复候选。正式保存由 Renderer 的 `saveCurrentProject()` 和 Main 的 `ProjectService` 协作完成；项目保存、恢复写入及清理按项目根目录协调。

## 目录结构

```text
src/
├── main/                  Electron Main、IPC handler、窗口和文件服务
├── preload/               主窗口和隐藏窗口的白名单桥
├── export-renderer/        隐藏导出 Renderer 入口
├── renderer/
│   ├── shell/             Project Center、EditorShell、时间轴与自适应工作区布局
│   ├── features/          canvas、timeline、dialogue、assets、characters、fla-import 等功能
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

核心命令均来自当前 `package.json`：

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

Electron 专项验证按改动范围选择，例如 `pnpm verify:gate-a`、`pnpm verify:issue606-product-preview`、`pnpm verify:issue816-dl01` 和 `pnpm verify:issue819-dl02`。具体可用脚本及执行范围以 [package.json](./package.json) 和 [AGENTS.md](./AGENTS.md) 为准，无需每次重跑全部历史 Day/Issue 验证。

Markdown-only 改动核对相对链接、脚本名、当前状态和 `git diff --check`；Renderer/domain、Main/IPC、持久化及导出改动执行相关类型检查、测试、构建与最相关的 verifier。自动化结果不冒充 Windows Electron 人工验收。

## Electron、IPC 与数据安全原则

- Main window 和隐藏 Renderer 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- Renderer 不直接访问 Node.js、`fs`、`path` 或子进程；文件系统和 FFmpeg 能力只在 Main Process。
- Preload 只通过冻结的白名单 API 暴露能力；IPC 通道名集中在 `src/shared/ipc/channels.ts`。
- IPC 请求和响应在 Preload 与 Main 两侧使用严格 Zod schema 校验，Main handler 还会核对发送窗口的 `webContents.id`。
- 项目保存使用项目 ID、schema、revision 和原子写入保护；恢复文件是 autosave 的恢复证据，不是对 `project.json` 的静默替代。
- 项目内素材路径必须保持相对路径，不允许通过路径遍历离开项目根目录。

## 文档导航

- [AGENTS.md](./AGENTS.md)：coding agent 的稳定工作规则和验证矩阵。
- [DESIGN.md](./DESIGN.md)：repository-level UI/UX design guidance and design red lines。
- [docs/architecture.md](./docs/architecture.md)：进程边界、数据模型、渲染与生命周期的架构说明；遇到版本化历史章节时以当前代码为准。
- [docs/development.md](./docs/development.md)：项目生命周期、autosave/recovery、素材和开发验证约束。
- [docs/ipc.md](./docs/ipc.md)：IPC 通道、payload、可信 sender 和导出边界。
- [docs/export-support-matrix.md](./docs/export-support-matrix.md)：媒体格式支持、预检查与正式导出证据。
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
