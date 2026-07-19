# Panda Stage Agent Task — Day 01

> 类型：Engineer
> 来源：DAILY_PLAN.md Day 1
> 目标：建立可运行、可测试、可构建的 Electron + React + TypeScript 工程。

---

## 模块1：饱和攻击头部

- 火力配置：1 Agent（Engineer）
- 任务名称：Panda Stage 工程基线初始化
- 轰炸目标：初始化 Electron Main / Preload / Renderer 分层结构，建立 TypeScript、Vite、测试与构建基础。
- 任务性质：功能开发 + 工程初始化
- 输出要求：可运行工程 + 自动化验证 + 结构化收卷。

通用铁律：
1. 禁止扩大范围。
2. 禁止提前实现画布、时间轴、素材库。
3. 所有验证必须来自真实命令输出。
4. 不允许伪成功或占位实现。

---

## 模块2：输入基线

| 输入项 | 内容 |
|---|---|
| Git坐标 | 执行前运行 `git rev-parse HEAD` |
| 当前状态 | 仓库尚未形成完整应用工程 |
| 目标范围 | package.json、Electron入口、React入口、构建配置、测试配置 |
| 技术约束 | contextIsolation=true；nodeIntegration=false |
| 风险边界 | 不创建编辑器功能 |
| 测试基线 | 初始化后建立 typecheck/lint/test/build |

---

## 模块3：工单矩阵

### 工单 B-01/45

角色：Engineer

目标：完成 Panda Stage 基础工程骨架。

交付物：

- Electron 主进程
- Preload 安全桥
- React Renderer
- TypeScript 配置
- Vitest 配置
- CI 配置

必须包含：

- `pnpm dev`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:unit`
- `pnpm build`

禁止包含：

- 画布
- 时间轴
- FFmpeg
- 素材系统

---

## 自动化质量闸门

| 闸门 | 命令 |
|---|---|
| BUILD | `pnpm build` |
| TYPE | `pnpm typecheck` |
| LINT | `pnpm lint` |
| TEST | `pnpm test:unit` |

---

## 刀刃表

| ID | 检查 | 验证 |
|-|-|-|
| FUNC-001 | Electron启动 | `pnpm dev` |
| FUNC-002 | React渲染 | 手动截图 |
| CONST-001 | 安全隔离 | 检查配置 |
| NEG-001 | 无Node暴露 | 静态检查 |
| E2E-001 | 应用启动 | 手动验证 |
| HIGH-001 | 不提前扩范围 | diff审查 |

---

## 收卷格式

完成后必须报告：

- Commit
- 修改文件
- 执行命令及结果
- 未验证项
- 风险
- 下一步

---

## 技术熔断

若工程初始化无法通过：

- 停止后续功能开发。
- 修复基础工程。
- 不允许通过跳过测试继续推进。
