# Panda Stage Agent Task — Day 04

> 类型：Engineer
> 来源：DAILY_PLAN.md Day 4
> 目标：建立共享 StageRenderer，让主窗口和隐藏窗口渲染同一逻辑。

---

## 模块1：饱和攻击头部

- 任务名称：共享舞台渲染探针
- 轰炸目标：接入 Konva，实现固定逻辑坐标舞台。
- 任务性质：渲染架构开发。

铁律：
- 不复制两套 renderer。
- 不实现时间轴。
- 不实现素材管理。

---

## 模块2：输入基线

| 输入项 | 内容 |
|-|-|
| Git坐标 | git rev-parse HEAD |
| 当前状态 | IPC 与窗口基础完成 |
| 范围 | StageRenderer、CanvasStage、probe素材 |
| 约束 | 1920×1080逻辑坐标 |
| 风险 | 不进入完整编辑器 |

---

## 模块3：工单矩阵

### 工单 B-04/45

目标：完成共享渲染层。

交付物：

- StageRenderer
- CanvasStage
- probe project
- 主/隐藏窗口共享渲染

必须包含：

- 透明 PNG 渲染
- 背景渲染
- 坐标一致性

禁止包含：

- 时间轴
- 动作系统
- 导出编码

---

## 自动化质量闸门

| 闸门 | 命令 |
|-|-|
| BUILD | pnpm build |
| TYPE | pnpm typecheck |
| TEST | pnpm test:unit |
| REAL | pnpm dev截图验证 |

---

## 刀刃表

| ID | 检查 | 验证 |
|-|-|-|
| FUNC-001 | Stage显示 | 截图 |
| FUNC-002 | 双窗口一致 | 对比截图 |
| CONST-001 | 坐标固定 | 测试 |
| NEG-001 | 缺素材错误 | 手测 |
| E2E-001 | 应用启动 | pnpm dev |
| HIGH-001 | 无重复渲染逻辑 | diff |

---

## 技术熔断

若预览和隐藏窗口出现两套逻辑，立即停止扩展。
