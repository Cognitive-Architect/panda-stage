# Day 14 — Recent projects, unsaved close guard, and relocation

## ✅ 工单 B-14/45 完成并提交

- Commit: `feat(project): add recent projects and unsaved-close protection`
- 分支: `feat/day-14-recent-projects`
- 基线 SHA: `4e92ed3c45e319c4a495fc8777ffa6ab8e1e863b`
- 结果 SHA: 由最终交付记录（提交无法包含自身 SHA）

### 实际结果

- 最近项目: 成功 create/open/save 后写入
  `app.getPath('userData')/recent-projects.json`；最多 12 条，规范化去重。
- 失效路径: 列表标记 `missing`，配置记录保留；用户可明确移除或通过原生
  目录选择器重新定位。
- 保存/不保存/取消: Main 原生警告框三分支；取消阻止 window close 和
  app quit；重复关闭请求只产生一个决策流程。
- 保存失败保护: 原子保存故障时窗口保持打开，正式文件不变，并显示中文错误。
- 项目移动重定位: 真实 `rename` 中文/空格/emoji 项目目录后，以项目 ID
  校验新目录，再把最近记录切换为新根。
- 相对素材路径: 移动前后均为 `assets/角色 image 🐼.png`，未写入绝对根。
- recovery: recovery 文件随项目目录移动，重开新根后仍能检测到最新快照。
- Issue #23 放弃修改：停止 autosave 调度，等待在途恢复写入，并在同一
  `projectRoot` 协调器内清理和验证恢复文件；删除失败返回
  `discard-failed`，窗口保持打开且正式文件字节不变。
- Issue #23 最近项目身份：列表区分 `available`、`missing`、
  `mismatched`、`invalid`；Main 专用打开入口在点击时重新校验项目 ID，
  TOCTOU 替换不会改变 store、autosave 会话或最近项目记录。

### 自动化检查

- `pnpm typecheck`: PASS
- `pnpm lint`: PASS
- `pnpm test:unit`: PASS（32 files / 191 tests）
- `pnpm test:integration`: PASS（4 files / 28 tests）
- `pnpm build`: PASS
- `pnpm verify:day13`: PASS
- `pnpm verify:day14`: PASS
- Prettier: N/A；仓库未安装或定义 Prettier，使用 ESLint 与
  `git diff --check` 作为格式门禁。

### 刀刃表

| 类别 | ID | 结果 | 证据 |
|---|---|---|---|
| FUNC | FUNC-001 | PASS | project IPC record callback + service tests |
| FUNC | FUNC-002 | PASS | real Electron recent entry reopen |
| FUNC | FUNC-003 | PASS | unsaved-close integration |
| FUNC | FUNC-004 | PASS | real directory rename integration |
| CONST | CONST-001 | PASS | runtime userData config path evidence |
| CONST | CONST-002 | PASS | normalized de-duplication unit test |
| CONST | CONST-003 | PASS | moved-project JSON/asset assertion |
| CONST | CONST-004 | PASS | `PathService` + boundary tests |
| NEG | NEG-001 | PASS | missing entry list integration |
| NEG | NEG-002 | PASS | cancel window/app lifecycle tests |
| NEG | NEG-003 | PASS | injected save fault integration |
| NEG | NEG-004 | PASS | persisted missing-record assertion |
| UX | UX-001 | PASS | save/discard/cancel options evidence |
| UX | UX-002 | PASS | missing row relocate/remove screenshot |
| E2E | E2E-001 | PASS | dirty→cancel→save→close integration |
| High | HIGH-001 | PASS | moved relative asset remains readable |

总计：16/16。

### P4 自测

| 检查点 | 结果 | 证据 |
|---|---|---|
| CF | PASS | 最近列表、三分支关闭 |
| RG | PASS | Day 12/13 全量测试与 `verify:day13` |
| NG | PASS | missing、cancel、save fault |
| UX | PASS | Electron 截图、按钮语义 |
| E2E | PASS | dirty→cancel→save→close |
| High | PASS | 移动后 asset/recovery |
| 字段完整性 | PASS | 本回执 |
| 需求映射 | PASS | 16 项刀刃表 |
| 自测执行 | PASS | 真实目录 `rename` |
| 范围边界与债务 | PASS | 下列债务声明 |

### 决策与债务

- DECISION-001: 最近项目状态只存应用 userData，项目目录完全不承载该配置。
- DECISION-002: 缺失记录不自动删除；重定位必须重新 open 并匹配项目 ID。
- DECISION-003: 关闭保护读取 Main 已跟踪的最新 dirty snapshot，清理延迟到
  `will-quit`。
- DECISION-004: “不保存”不是直接退出；只有 autosave 停止、在途写入结束、
  recovery 清理和无残留验证全部成功后才允许关闭。
- DECISION-005: 最近项目的路径与项目 ID 组成身份约束；同路径不同 ID
  只能通过显式重定位/移除解决，普通 `record()` 不覆盖旧记录。
- DEBT-PLATFORM-B14-001: 实机 Windows 本地路径通过；UNC 只有规范化测试，
  未声明真实网络共享 I/O 通过。
- DEBT-TEST-B14-001: 原生关闭框的语义、按钮和分支自动化通过；未保存 OS
  模态框截图。

### 证据

- `docs/evidence/day-14/recent-projects.png`
- `docs/evidence/day-14/ui-results.json`
- `docs/evidence/day-14/results.json`
- `docs/m1-results.md`

### 回滚

- `git revert <Day 14 结果 SHA>`
