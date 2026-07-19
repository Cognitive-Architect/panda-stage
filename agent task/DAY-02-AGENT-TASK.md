# Panda Stage Agent Task — Day 02

> 类型：Engineer
> 来源：DAILY_PLAN.md Day 2
> 目标：建立版本化项目领域模型与最小时间轴求值基础。

---

## 模块1：饱和攻击头部

- 火力配置：1 Agent（Engineer）
- 任务名称：Panda Stage Domain Schema 初始化
- 轰炸目标：定义 Project、Asset、Layer、Shot、TimelineEvent 等核心数据结构。
- 任务性质：架构基础 + 类型设计
- 输出要求：可验证 schema + evaluator 基础。

铁律：
1. 不创建 UI。
2. 不绑定 Electron/Konva。
3. 时间统一使用整数毫秒。
4. 数据模型必须可序列化。

---

## 模块2：输入基线

| 输入项 | 内容 |
|---|---|
| Git坐标 | 执行前运行 git rev-parse HEAD |
| 当前状态 | Day01 工程骨架完成 |
| 目标范围 | shared domain、schema、unit tests |
| 技术约束 | TypeScript + Zod；1920×1080；24FPS |
| 风险边界 | 不实现编辑器交互 |

---

## 模块3：工单矩阵

### 工单 B-02/45

目标：建立 Panda Stage 项目数据合同。

交付物：

- ProjectSchema
- AssetSchema
- LayerSchema
- ShotSchema
- TimelineEventSchema
- evaluateShotAtTime()

必须包含：

- schemaVersion
- 毫秒时间字段
- layer 中心坐标语义
- move 事件测试

禁止包含：

- React 状态
- Canvas 绘制
- 文件系统

---

## 自动化质量闸门

| 闸门 | 命令 |
|-|-|
| TYPE | pnpm typecheck |
| LINT | pnpm lint |
| TEST | pnpm test:unit |
| BUILD | pnpm build |

---

## 刀刃表

| ID | 检查 | 验证 |
|-|-|-|
| FUNC-001 | Schema 可解析 | unit test |
| FUNC-002 | evaluator 时间计算 | unit test |
| CONST-001 | 固定分辨率约束 | schema test |
| NEG-001 | 非法数据拒绝 | negative test |
| E2E-001 | 工程仍可启动 | pnpm dev |
| HIGH-001 | 无 UI 耦合 | diff review |

---

## 收卷要求

必须报告：

- Commit
- 修改文件
- 测试命令结果
- 未验证项
- 风险
- 下一步

---

## 技术熔断

若 schema 设计无法稳定支持后续编辑器：暂停 UI 开发，重新收敛数据模型。
