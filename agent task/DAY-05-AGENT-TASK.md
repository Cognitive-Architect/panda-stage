# Panda Stage Agent Task — Day 05

> 类型：Engineer
> 来源：DAILY_PLAN.md Day 5
> 目标：完成 3～5 秒预览探针：移动、字幕、音频同步。

---

## 模块1：饱和攻击头部

- 任务名称：Preview Probe
- 轰炸目标：让角色动画、字幕和音频由统一时间源驱动。
- 任务性质：预览系统开发。

铁律：
- 不实现完整时间轴。
- 不实现 TTS。
- 不绕过 domain evaluator。

---

## 模块2：输入基线

| 输入项 | 内容 |
|-|-|
| Git坐标 | git rev-parse HEAD |
| 当前状态 | StageRenderer 已存在 |
| 范围 | preview store、subtitle、audio clock |
| 约束 | AudioContext 主时钟 |
| 风险 | 不提前做导出 |

---

## 模块3：工单矩阵

### 工单 B-05/45

目标：完成可播放探针。

交付物：

- preview controller
- subtitle engine
- audio playback
- deterministic motion

必须包含：

- play/pause/stop
- 时间同步
- 重复播放恢复初始状态

禁止包含：

- FFmpeg
- 完整timeline UI
- AI功能

---

## 自动化质量闸门

| 闸门 | 命令 |
|-|-|
| BUILD | pnpm build |
| TYPE | pnpm typecheck |
| TEST | pnpm test:unit |
| REAL | pnpm dev 播放验证 |

---

## 刀刃表

| ID | 检查 | 验证 |
|-|-|-|
| FUNC-001 | 动画移动 | 手测 |
| FUNC-002 | 字幕显示 | 手测 |
| CONST-001 | 时间来源统一 | code review |
| NEG-001 | 重复播放不叠音 | 手测 |
| E2E-001 | 3秒流程完成 | 视频证据 |
| HIGH-001 | 无导出逻辑混入 | diff |

---

## 收卷要求

必须提交：

- commit
- 修改文件
- 命令输出
- 手测结果
- 未验证项

---

## 技术熔断

若预览时间轴和音频无法保持一致，暂停后续导出开发。
