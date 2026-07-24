# Day 13 — Autosave and crash recovery

## ✅ 工单 B-13/45 完成并提交

### 提交信息

- Commit: `feat(project): add autosave and crash recovery workflow`
- 分支: `feat/day-13-autosave-recovery`
- 基线 SHA: `01651213d7d0e9a0593f35f7ba14b663eab3062b`
- 实现结果 SHA: `1bcd5f23d69c7520037c1776a36a9b563c2798e9`
- Gate 前置: Day 12 单元 136/136、集成 12/12、完整门禁 PASS

### 本轮目标与实际结果

- Main Process 实现单一 30 秒 scheduler；clean 不写，dirty 新 revision
  只写一次，同项目写入不重入。
- recovery 文件严格包含项目 ID、整数毫秒时间戳和完整正式项目，并采用
  同目录临时文件、sync、close、rename。
- 打开项目后检测 ID 匹配、schema 合法且晚于正式文件的最新 recovery。
- 恢复只加载内存并标 dirty；忽略保留证据；两者都不覆盖正式文件。
- 只有用户主动正式保存才写 `project.json`，成功后清理同项目 recovery。
- 项目切换、Renderer 卸载和应用退出均释放 timer。
- 提供最小恢复提示：项目名、恢复时间、文件路径、恢复/忽略与主动保存。
- 未实现（按范围排除）：版本历史、无限快照、云备份、最近项目、冲突合并。

### 关键决策记录

- DECISION-001: timer 位于 Main，Renderer 只通过严格 IPC 提供中央 dirty
  store 的最新 snapshot/revision；首次 track 还会校验磁盘项目 ID。
- DECISION-002: 每项目只保留最新一份 recovery。新副本原子提交成功后才
  删除旧副本；写失败保留旧副本。
- DECISION-003: 恢复和忽略都是只读正式项目操作。恢复后的唯一状态是
  “内存已恢复 + dirty”，必须由用户点击正式保存才能提交。
- DECISION-004: 当前无最近项目能力，因此启动时没有可推断的项目上下文；
  recovery 检测在用户明确打开项目后立即执行。

### 自动化质量检查报告

- 变更前 `pnpm typecheck`: PASS
- 变更前 `pnpm lint`: PASS
- 变更前 `pnpm test:unit`: PASS（20 文件，136 测试）
- 变更前 `pnpm test:integration`: PASS（1 文件，12 测试）
- 变更前 `pnpm build`: PASS
- 最终 `pnpm typecheck`: PASS
- 最终 `pnpm lint`: PASS
- 最终 `pnpm test:unit`: PASS（24 文件，148 测试）
- 最终 `pnpm test:integration`: PASS（2 文件，19 测试）
- 最终 `pnpm build`: PASS
- `pnpm verify:day13`: PASS；实际 Electron UI/API/沙箱证据已生成
- 格式门禁: 仓库无 Prettier 脚本；使用 ESLint 与 `git diff --check`

### 异常退出与恢复证据

- 模拟链路：修改 → autosave → 丢弃进程内服务 → 新建服务模拟重启 →
  检测 → 恢复到中央 store → 忽略保留 → 用户正式保存。
- recovery:
  `a0000000-0000-4000-8000-000000000001.4102444800000.recovery.json`
- restore 前正式文件 SHA-256:
  `4208705efec87e01dfac69b4288dd9b36c5805165f5f5bcbdbc5aa2531aaa677`
- restore 后、用户保存前正式文件 SHA-256:
  `4208705efec87e01dfac69b4288dd9b36c5805165f5f5bcbdbc5aa2531aaa677`
- 恢复内容等于最后 autosave，中央 store `dirty=true`。
- ignore 后 recovery 仍存在；用户正式保存后 recovery 数量为 0。
- 故障注入后旧 recovery hash 不变，`.tmp` 数量为 0。
- 机器证据:
  - `docs/evidence/day-13/recovery-results.json`
  - `docs/evidence/day-13/ui-results.json`
  - `docs/evidence/day-13/recovery-panel.png`

### 刀刃表摘要

| 类别 | 覆盖 | 关键证据 |
|---|---:|---|
| FUNC | 4/4 | 30 秒、clean skip、检测最新、restore dirty |
| CONST | 4/4 | ID+时间文件名、串行、schema、timer 释放 |
| NEG | 4/4 | corrupt、写故障、ignore retain、重复 tick |
| UX | 2/2 | 实际 Electron 项目/时间提示与明确选择 |
| E2E | 1/1 | autosave→异常退出→重启→恢复→正式保存 |
| High | 1/1 | restore 前后正式文件 SHA-256 不变 |

总计：16/16。

### 债务声明

- DEBT-STATE-B13-001: 无。当前正式编辑器尚未展开，Day 13 引入唯一
  `EditorProjectStore`，后续编辑功能必须接入该来源而非复制 dirty 判断。
- DEBT-TEST-B13-001: 无。fake timer、真实文件、故障注入、模拟异常退出、
  重启恢复和实际 Electron UI 均有证据。
- DEBT-DOC-B13-001: 无。架构、开发说明、回执和机器证据均已同步。

### 风险与回滚点

- 主要风险: timer 重入或恢复时静默覆盖正式项目。单项目 in-flight
  锁和“恢复只入内存”状态机分别阻断两个风险。
- 回滚方式: `git revert 1bcd5f23d69c7520037c1776a36a9b563c2798e9`。

## Issue #19 follow-up — save/autosave serialization and transactional switching

- Formal save and autosave recovery writes now share a project-root-scoped
  coordinator. Different roots remain independent.
- Controlled scenario A pauses recovery after temporary-file sync, queues a
  formal revision-2 save, then releases recovery. The final formal document is
  revision 2, recovery is empty, the session stays live and clean, and a later
  dirty revision 3 produces recovery normally.
- Controlled scenario B injects `EIO` before the formal temporary write. The
  original `SAVE_FAILED` retains the injected cause; the formal SHA-256, prior
  recovery SHA-256, dirty session, and subsequent revision-3 autosave all
  remain valid.
- Project switching now prepares open/track/detect before stopping the old
  session and committing the store. Missing paths and track/detect/stop
  failures preserve the prior store and timer; successful switches leave one
  aligned session. Same-path dirty reopen is rejected explicitly.
- Final verification: typecheck PASS; lint PASS; unit 26 files / 156 tests;
  integration 2 files / 21 tests; build PASS; `verify:day13` PASS.
- Machine-readable follow-up evidence:
  `docs/evidence/day-13/issue-19-results.json`. The final commit SHA is recorded
  in GitHub Issue #19 because a commit cannot contain its own SHA.
