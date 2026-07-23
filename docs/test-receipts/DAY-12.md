# Day 12 — Project lifecycle and atomic persistence

## ✅ 工单 B-12/45 完成并提交

### 提交信息

- Commit: `feat(project): add atomic create open and save lifecycle`
- 分支: `feat/day-12-project-lifecycle`
- Gate A: PASS（`docs/test-receipts/GATE-A.md`）
- 基线 SHA: `0d64cd39b5b9999cb18846dae2e2aba41517236f`
- 结果 SHA: 以包含实现的上述 commit 为准

### 本轮目标与实际结果

- 新建严格的 `.pandastage` 项目目录，包含 `project.json` 和
  `assets/cache/exports/recovery`；目标已存在时明确拒绝，不做合并。
- 打开时依次执行 JSON 解析、版本检测、v0 内存迁移和正式 v1 schema
  校验；打开过程不写盘。
- 保存时先校验完整项目，再写同目录唯一临时文件，执行
  write → sync → close → rename；失败时清理临时文件并保留旧文件。
- Preload 只暴露 `project.create/open/save`，Main IPC 校验来源窗口及
  严格请求结构，Renderer 不获得 Node/文件系统能力。
- 未实现（按范围排除）：自动保存、最近项目、未保存提醒、素材导入
  UI、云同步。

### 关键决策记录

- DECISION-001: 项目根目录必须以 `.pandastage` 结尾；创建目标已存在
  时返回 `PROJECT_ALREADY_EXISTS`，避免覆盖或混合未知内容。
- DECISION-002: `ProjectFileSystemService` 是唯一原子保存实现。正式文件
  只在临时文件完整写入、flush 并关闭后才通过同目录 rename 替换。
- DECISION-003: `ProjectService` 只编排 create/open/save 与迁移、校验；
  IPC 只负责白名单、来源验证、运行时合同和标准化错误响应。

### 自动化质量检查报告

- 变更前 `pnpm typecheck`: PASS
- 变更前 `pnpm lint`: PASS
- 变更前 `pnpm test:unit`: PASS（18 文件，128 测试）
- 变更前 `pnpm build`: PASS
- 最终 `pnpm typecheck`: PASS
- 最终 `pnpm test:unit`: PASS（20 文件，134 测试）
- 最终 `pnpm test:integration`: PASS（1 文件，9 测试）
- 最终 `pnpm lint`: PASS
- 最终 `pnpm build`: PASS
- 格式门禁: 仓库无 Prettier 脚本；使用 ESLint 与 `git diff --check`

### 原子保存与真实路径证据

- Windows 真实临时目录：
  `熊猫 项目 with spaces 🐼.pandastage`
- 创建目录树：`assets/ cache/ exports/ recovery/ project.json`
- 已有正式文件的同目录 rename 替换并重开：PASS
- `afterTemporarySync` 故障：
  - before SHA-256:
    `24bba17b588caedac0095121f47bea3ab2ec534cc020b2a09040b0af9bd1a037`
  - after SHA-256:
    `24bba17b588caedac0095121f47bea3ab2ec534cc020b2a09040b0af9bd1a037`
- `beforeAtomicReplace` 故障的 before/after SHA-256 同上。
- 不可写目标（注入 `EACCES`）返回 `PROJECT_NOT_WRITABLE`，旧 hash 不变。
- 故障后 `.tmp` 残留数量：0。
- 机器可读证据：`docs/evidence/day-12/results.json`

### 刀刃表摘要

| 类别 | 覆盖 | 关键证据 |
|---|---:|---|
| FUNC | 4/4 | create/open/v0 migration/save-reopen |
| CONST | 4/4 | Main-only write、relative path、Zod IPC、temp-first |
| NEG | 4/4 | invalid JSON、faults、EACCES、future version |
| UX | 2/2 | 路径化错误、Unicode/空格/emoji |
| E2E | 1/1 | 新建→修改→保存→重开 |
| High | 1/1 | 两个提交前故障点 hash 不变 |

总计：16/16。

### 债务声明

- DEBT-COMPLEXITY-B12-001: 无；业务编排与唯一文件写入实现已分层。
- DEBT-PLATFORM-B12-001: 无；目标 Windows 平台已真实验证覆盖已有文件的
  同目录 rename 行为。
- DEBT-TEST-B12-001: 无；真实路径、迁移、无效输入、未来版本、不可写和
  两个写入中断点均有自动化覆盖。

### 风险与回滚点

- 主要风险: Windows 文件替换和进程中断。当前把 rename 设为唯一提交点，
  并用真实 Windows 集成测试验证；提交点之前的失败保持旧文件。
- 回滚方式: `git revert <Day 12 实现 commit SHA>`。
