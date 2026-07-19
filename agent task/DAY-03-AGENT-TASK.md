# Panda Stage Agent Task — Day 03

> 类型：Engineer
> 来源：DAILY_PLAN.md Day 3
> 目标：建立 Main / Preload / Renderer 之间的安全 IPC 基础。

---

## 模块1：饱和攻击头部

- 任务名称：安全 IPC 与隐藏窗口通信
- 轰炸目标：建立白名单 IPC 通道和隐藏窗口握手。
- 任务性质：工程架构开发。

铁律：
- 不暴露 Node API。
- 不绕过 Preload。
- 所有输入必须校验。

---

## 模块2：输入基线

| 输入项 | 内容 |
|-|-|
| Git坐标 | git rev-parse HEAD |
| 当前状态 | Electron 基础工程存在 |
| 范围 | ipc channels、preload、window 管理 |
| 约束 | contextIsolation=true |
| 风险 | 不开发导出功能 |

---

## 模块3：工单矩阵

### 工单 B-03/45

目标：完成安全 IPC 通信。

交付物：

- ipc channel 定义
- preload API
- hidden window 创建
- ping/ready 握手

必须包含：

- Zod 校验
- 白名单 API
- 退出时资源清理

禁止包含：

- FFmpeg
- 视频导出
- 编辑器逻辑

---

## 自动化质量闸门

| 闸门 | 命令 |
|-|-|
| BUILD | pnpm build |
| TYPE | pnpm typecheck |
| TEST | pnpm test:unit |
| REAL | pnpm dev 手测窗口通信 |

---

## 刀刃表

| ID | 检查 | 验证 |
|-|-|-|
| FUNC-001 | IPC ping | 手测 |
| FUNC-002 | hidden window ready | 日志 |
| CONST-001 | preload隔离 | 配置检查 |
| NEG-001 | Node不可访问 | 静态检查 |
| E2E-001 | 应用退出清理 | 手测 |
| HIGH-001 | 无越权 API | diff |

---

## 收卷要求

提交真实命令输出，不允许“应该通过”。

---

## 技术熔断

若 IPC 边界不稳定，禁止进入渲染和导出阶段。
