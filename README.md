# Panda Stage（熊猫片场）

Panda Stage 是一款面向个人创作者的 Windows 桌面纸片人动画工具。项目计划让用户通过透明角色图片、背景、对白、音频和简单动作，制作并导出短动画。

当前分支已完成 **Day 04：共享舞台渲染探针**。主窗口和隐藏窗口现在复用同一套 `CanvasStage → StageRenderer` 渲染链，能够在固定 1920×1080 逻辑坐标中显示背景、透明 PNG 角色和字幕，并播放 3 秒移动探针；仍不包含完整编辑器、素材管理、动作系统或导出编码。

## 技术栈

- Electron
- React
- TypeScript
- Vite
- Konva / react-konva
- Vitest
- ESLint
- pnpm

## 领域数据基线

`src/shared/domain/` 提供：

- `ProjectSchema`、`AssetSchema`、`LayerSchema`、`ShotSchema`；
- 当前仅包含 move 的 `TimelineEventSchema`；
- 纯函数 `evaluateShotAtTime()`；
- 固定 `schemaVersion=1`、`1920×1080`、`24 FPS`；
- 整数毫秒时间字段；
- `anchor: "center"` 明确的图层中心坐标语义；
- 项目内相对素材路径和跨引用校验。

领域模型不依赖 React、DOM、Electron 或 Konva，可在 Node.js 环境直接执行单元测试。

## 环境要求

- Windows 10/11
- Node.js `>=22.12.0 <25`
- pnpm 10（版本由 `packageManager` 字段固定）

若本机尚未启用 pnpm，可运行：

```powershell
corepack enable
corepack install
```

## 本地启动

```powershell
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动 Vite 开发服务器和 Electron。舞台初始停在 1.5 秒共享快照，可使用播放、暂停和重播控制 3 秒探针；点击“测试安全 IPC”返回 `pong` 表示 IPC 正常，终端出现 `Hidden window ready` 表示隐藏窗口已使用同一渲染器完成首帧。

## 质量检查

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm verify:day03
pnpm verify:day04
```

生产构建输出：

- Renderer：`dist/renderer/`
- Electron Main / Preload：`dist-electron/`

## 目录结构

```text
src/
├── main/       # Electron Main Process、IPC handler 与窗口管理
├── preload/    # 主窗口和隐藏窗口的白名单桥
├── renderer/   # React Renderer 与隐藏窗口入口
└── shared/     # 领域模型、IPC 数据合同和共享舞台模型
```

## 共享舞台架构

- `src/shared/probe/` 定义经过 Schema 校验的固定探针项目；
- `evaluateShotAtTime()` 是唯一的移动坐标求值入口；
- `src/shared/stage/` 将求值快照转换成渲染模型，并对缺失素材返回可读错误；
- `CanvasStage` 只负责等比显示，Konva 画布始终保持 1920×1080 逻辑坐标；
- `StageRenderer` 只消费已求值图层，不自行计算时间轴或动作；
- 主窗口 `StagePreview` 和隐藏窗口 `HiddenApp` 直接复用同一个 `CanvasStage` 与 `StageRenderer`。

## IPC 架构

- 所有通道名集中定义在 `src/shared/ipc/channels.ts`；
- 请求和响应均由 `src/shared/ipc/contracts.ts` 中的严格 Zod Schema 校验；
- 主窗口只暴露 `window.pandaStage.app.ping()`；
- 隐藏窗口只暴露 `window.pandaStageHidden.ready()`；
- Main Process 校验消息来源窗口，并在退出前注销 handler、关闭隐藏窗口；
- 两个 Preload 均构建为独立的沙箱兼容 bundle，不向 Renderer 暴露 Node.js。

## 安全基线

Electron 窗口固定使用：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

Renderer 不直接访问 Node.js、文件系统或子进程。后续跨进程能力必须通过受控 Preload API 和经过运行时校验的 IPC 实现。

实施与验证记录：

- [Day 03：安全 IPC](./docs/day-03-results.md)
- [Day 04：共享舞台渲染](./docs/day-04-results.md)

## 开发计划

- [ROADMAP.md](./ROADMAP.md)：产品范围、架构原则和里程碑
- [DAILY_PLAN.md](./DAILY_PLAN.md)：45 个开发日计划
- [agent task](./agent%20task/README.md)：逐日 Agent 工单

GitHub：<https://github.com/Cognitive-Architect/panda-stage>
