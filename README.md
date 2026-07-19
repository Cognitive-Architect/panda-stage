# Panda Stage（熊猫片场）

Panda Stage 是一款面向个人创作者的 Windows 桌面纸片人动画工具。项目计划让用户通过透明角色图片、背景、对白、音频和简单动作，制作并导出短动画。

当前分支已完成 **Day 02：项目领域 Schema 与最小时间轴求值基础**。在 Day 01 的安全桌面壳之上，项目现在具备可验证、可序列化且与 UI/Electron 解耦的数据合同；仍不包含画布、编辑器交互、素材服务或视频导出。

## 技术栈

- Electron
- React
- TypeScript
- Vite
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

`pnpm dev` 会同时启动 Vite 开发服务器和 Electron。窗口中出现 **Panda Stage — Bootstrap Ready** 即表示工程基线启动成功。

## 质量检查

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

生产构建输出：

- Renderer：`dist/renderer/`
- Electron Main / Preload：`dist-electron/`

## 目录结构

```text
src/
├── main/       # Electron Main Process
├── preload/    # 安全 Preload 桥
├── renderer/   # React Renderer
└── shared/     # 与运行环境无关的共享代码
```

## 安全基线

Electron 窗口固定使用：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

Renderer 不直接访问 Node.js、文件系统或子进程。后续跨进程能力必须通过受控 Preload API 和经过运行时校验的 IPC 实现。

## 开发计划

- [ROADMAP.md](./ROADMAP.md)：产品范围、架构原则和里程碑
- [DAILY_PLAN.md](./DAILY_PLAN.md)：45 个开发日计划
- [agent task](./agent%20task/README.md)：逐日 Agent 工单

GitHub：<https://github.com/Cognitive-Architect/panda-stage>
