# Panda Stage Agent Task — Day 10

> **工单编号**：B-10/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 10  
> **分支建议**：`chore/day-10-gate-a`  
> **任务类型**：打包验证 + 技术 Gate + 决策文档  
> **唯一目标**：把 M0.5 探针打包到非开发启动路径，连续导出 3 次并以证据明确判定 Gate A 为 PASS 或 FAIL。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：打包探针 + 三次确定性复现 + Gate A
- **轰炸目标**：配置 Windows 打包与 FFmpeg 受控资源路径，在打包后的应用中执行完整探针；对三次导出的帧数、关键帧、字幕时点和音频时点进行一致性验证，形成不可含糊的 Gate A 结论。
- **任务性质**：打包验证 + 端到端验收 + 技术决策
- **输入基线**：Day 6～9 已完成逐帧捕获、H.264 编码、AAC 合成、Unicode 路径、取消与清理。
- **输出要求**：Windows 安装包或可分发构建产物 + 三次 MP4 + 关键帧比较 + ffprobe 报告 + `GATE-A.md` + PASS/FAIL 结论。
- **通用铁律**：
  1. 不允许写“基本通过”“大致一致”“开发机可用所以算通过”。
  2. Gate 判定只基于真实打包产物，不得用 `pnpm dev` 结果代替。
  3. 三次导出必须使用同一项目快照与同一配置。
  4. 任一高优先项失败，必须判 FAIL 并冻结 M1～M6。
  5. 不在本日修建完整编辑器功能；发现问题只允许修探针阻塞。

---

## 【模块2】输入基线（完整技术背景）

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 执行前记录实际分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Day 6～9 回执齐全；开发模式下探针可导出；Unicode 路径与取消已验证 | 回执路径 + 最近提交 | 必须 |
| 目标范围 | `electron-builder` 配置、生产环境资源路径、FFmpeg sidecar/资源处理、打包脚本、Gate 测试脚本与文档 | `git diff --name-only` | 必须 |
| 当前缺口 | 尚未证明打包应用能独立找到 FFmpeg、加载素材、导出和清理；确定性尚未做三次复现 | 打包前基线说明 | 必须 |
| 目标结果 | 非开发启动路径中连续导出 3 次；帧数一致；关键帧差异 <1%；字幕与音频时点一致；Unicode 路径、取消清理通过 | 自动化比较 + ffprobe + 手动证据 | 必须 |
| 技术约束 | Windows 优先；FFmpeg 路径必须基于生产资源目录解析；禁止依赖全局 Node/pnpm；若仍依赖全局 FFmpeg必须判 Gate 未通过 | 干净环境或隔离环境证据 | 必须 |
| 风险边界 | 不实现正式安装向导美化；不做代码签名；不做自动更新；不进入项目系统 M1 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + `pnpm dist` 当前真实结果 | 命令输出 | 必须 |
| 文档同步 | 创建 `docs/test-receipts/GATE-A.md`；失败时创建 `docs/decisions/M05-FAILURE-REPORT.md` | 文件与内容检查 | 必须 |
| 决策规则 | 结论只能是 `PASS` 或 `FAIL`；未验证的高优先项按 FAIL 处理 | Gate 文档 | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 开发模式链路已完成；生产资源路径与打包环境可能不同。 |
| 待确认问题 | FFmpeg 资源放置与定位方式；打包后隐藏窗口入口路径；关键帧自动比较工具；干净环境验证方式。 |
| 预期输出 | 一套可重复执行的 Gate A 验收流程，而不是一次性的人工演示。 |
| 停止条件 | Gate 所有高优先项获得真实证据并明确 PASS/FAIL。 |

---

## 【模块3】工单矩阵（通用高压版）

### 1）基础信息

- **工单编号**：B-10/45
- **角色**：Engineer
- **目标**：完成 Windows 打包探针、三次确定性导出和 Gate A 判定。
- **依赖关系**：依赖 Day 6～9 全部产出；Gate A 未通过时阻塞 Day 11～45。

### 2）输出交付物

- **预计变更文件**：
  - `electron-builder.yml` 或 `package.json` 中打包配置
  - `electron/main/` 下生产资源路径解析
  - `scripts/` 下关键帧提取/比较或 Gate 验证脚本
  - 必要打包测试与配置文件
  - `docs/test-receipts/GATE-A.md`
  - 失败时：`docs/decisions/M05-FAILURE-REPORT.md`
- **核心修改点**：
  - 配置 Windows 分发构建；
  - 将 FFmpeg 作为来源清晰、许可可追溯的受控资源处理；
  - 生产环境使用应用资源目录定位 FFmpeg，不使用开发机绝对路径；
  - 打包应用中运行完整探针；
  - 连续导出 3 次；
  - 提取帧 0、24、48、最后一帧；
  - 比较关键帧像素差异；
  - 比较帧数、字幕时点、音频起点与输出元数据；
  - 形成 PASS/FAIL Gate 文档。
- **必须包含**：
  - `pnpm dist` 成功；
  - 打包应用启动；
  - 打包应用独立定位 FFmpeg；
  - 三次导出帧数完全一致；
  - 关键帧差异 <1%；
  - 音频同步；
  - Unicode 路径成功；
  - 取消与清理成功；
  - Gate 结论唯一明确。
- **禁止包含**：
  - 用开发模式替代生产构建验证；
  - 依赖开发机绝对路径；
  - 只比较 MP4 文件大小；
  - 用肉眼“差不多”替代关键帧比较；
  - Gate 未通过仍开始 M1；
  - 顺手做项目系统、素材库、画布 UI。
- **交付证明**：
  - 构建产物路径和哈希；
  - 三次导出文件与 ffprobe 摘要；
  - 关键帧比较报告；
  - Unicode 路径与取消回归；
  - `GATE-A.md` 完整证据链接。

### 3）规模与复杂度观察

- 打包配置与资源路径解析应保持最小，不提前搭建完整发布系统。
- 关键帧比较可使用简单、可复现的像素差异脚本，不引入大型视觉测试平台。
- 若干净环境无法获得，必须声明 `DEBT-TEST-B10-001` 并判 Gate FAIL，而不是降低标准。
- 若 FFmpeg 分发许可或来源不清，必须声明并阻塞打包 Gate。

### 4）自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 应用构建与分发构建通过 | `pnpm build`；`pnpm dist` | Gate FAIL |
| TYPE | 类型检查通过 | `pnpm typecheck` | Gate FAIL |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增 lint error | `pnpm lint` | Gate FAIL |
| TEST | 单元测试与 Gate 脚本通过 | `pnpm test:unit` + Gate 脚本 | Gate FAIL |
| ARCH | 生产路径不依赖开发机绝对路径 | 静态搜索 + 打包实测 | Gate FAIL |
| REAL | 使用打包应用真实导出 3 次 | 输出文件、日志、ffprobe | Gate FAIL |
| DOC | Gate 文档完整且结论明确 | `GATE-A.md` 内容检查 | Gate FAIL |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | 检查点 ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | Windows 分发构建成功 | `pnpm dist` 输出 | [ ] |
| FUNC | FUNC-002 | 打包应用可启动 | 非开发启动证据 | [ ] |
| FUNC | FUNC-003 | 打包应用可定位 FFmpeg | 版本日志与真实导出 | [ ] |
| FUNC | FUNC-004 | 打包应用可导出含声 MP4 | 输出文件 + ffprobe | [ ] |
| CONST | CONST-001 | 三次导出使用同一快照与配置 | 配置哈希/日志 | [ ] |
| CONST | CONST-002 | 三次帧数完全一致 | ffprobe 或帧统计 | [ ] |
| CONST | CONST-003 | 关键帧差异 <1% | 比较脚本报告 | [ ] |
| CONST | CONST-004 | 生产资源路径无开发机绝对路径 | 静态搜索 + 日志 | [ ] |
| NEG | NEG-001 | Unicode 路径在打包应用中成功 | 真实输出 | [ ] |
| NEG | NEG-002 | 打包应用中取消可清理 | 日志与目录证据 | [ ] |
| NEG | NEG-003 | FFmpeg 资源缺失时有明确错误 | 受控缺失测试 | [ ] |
| NEG | NEG-004 | 未验证高优先项不会被写成 PASS | Gate 文档检查 | [ ] |
| UX | UX-001 | 打包应用错误可理解 | 错误截图/日志 | [ ] |
| UX | UX-002 | 取消后可再次导出 | 打包应用实测 | [ ] |
| E2E | E2E-001 | 安装/启动→探针→导出→播放全链路 | 视频与操作证据 | [ ] |
| High | HIGH-001 | Gate A 结论严格为 PASS 或 FAIL | `GATE-A.md` | [ ] |

---

## 【模块3-B】地狱红线（10 项）

1. 用 `pnpm dev` 结果冒充打包验证 → Gate FAIL。
2. 打包应用依赖开发机绝对 FFmpeg 路径 → Gate FAIL。
3. 只导出一次就宣称确定性 → Gate FAIL。
4. 只比较文件大小，不比较关键帧和时点 → Gate FAIL。
5. 关键帧差异未量化却写“一致” → Gate FAIL。
6. 未验证项写成 PASS → Gate FAIL。
7. Unicode 或取消失败却标记“非阻塞” → Gate FAIL。
8. Gate FAIL 后继续 M1～M6 → 严重违规。
9. FFmpeg 来源与许可不清仍打包分发 → 阻塞。
10. 通过顺手砍验收标准来制造成功 → 返工。

---

## 【模块4】P4 自测轻量检查表

| 检查点 | 自检问题 | 覆盖情况 | 相关用例 | 备注 |
|---|---|---|---|---|
| CF | 打包应用能否独立完成导出？ | [ ] | CF-B10-001 | |
| RG | Day 6～9 的帧、音频、路径、取消是否全部回归？ | [ ] | RG-B10-001 | |
| NG | 资源缺失、Unicode、取消是否覆盖？ | [ ] | NG-B10-001 | |
| UX | 失败提示是否能指导下一步？ | [ ] | UX-B10-001 | |
| E2E | 非开发启动到 MP4 是否完整跑通？ | [ ] | E2E-B10-001 | |
| High | 三次确定性和像素差异是否单独验证？ | [ ] | HIGH-B10-001 | |
| 字段完整性 | Gate 文档是否包含命令、输出、文件和风险？ | [ ] | `GATE-A.md` | |
| 需求映射 | 每项证据是否映射 Gate 条款？ | [ ] | 刀刃表 | |
| 自测执行 | 是否真实运行三次而非复制文件？ | [ ] | 三次 Job 日志 | |
| 范围边界与债务 | 环境与许可限制是否诚实申报？ | [ ] | 债务声明 | |

---

## 【模块5】收卷格式（强制结构）

```markdown
# Gate A — M0.5 Packaged Deterministic Export

## 结论
- Result: PASS / FAIL
- 判定时间:
- 执行分支:
- 基线 SHA:
- 结果 SHA:
- 打包产物:
- 产物哈希:

## 自动化质量检查
- `pnpm typecheck`: [真实摘要]
- `pnpm lint`: [真实摘要]
- `pnpm test:unit`: [真实摘要]
- `pnpm build`: [真实摘要]
- `pnpm dist`: [真实摘要]

## 打包环境验证
- 应用启动: PASS / FAIL
- FFmpeg 定位: PASS / FAIL
- 是否依赖全局 Node/pnpm/FFmpeg: 是 / 否
- Unicode 路径: PASS / FAIL
- 取消与清理: PASS / FAIL

## 三次导出对比
| 项目 | Run 1 | Run 2 | Run 3 | 是否一致 |
|---|---|---|---|---|
| 帧数 | | | | |
| 时长 | | | | |
| 视频编码 | | | | |
| 音频编码 | | | | |
| 字幕时点 | | | | |
| 音频起点 | | | | |

## 关键帧比较
| 帧 | Run1↔Run2 差异 | Run1↔Run3 差异 | 阈值 | 结果 |
|---|---:|---:|---:|---|
| 0 | | | <1% | |
| 24 | | | <1% | |
| 48 | | | <1% | |
| Last | | | <1% | |

## Gate 条款
- [ ] 预览与导出关键帧差异 <1%
- [ ] 三次导出帧数完全一致
- [ ] 三次关键位置和字幕时点一致
- [ ] 音频同步
- [ ] Unicode 路径成功
- [ ] 取消清理成功
- [ ] 打包应用可独立导出

## 债务与未验证项
- DEBT-TEST-B10-001: [无 / 具体内容]
- DEBT-PACKAGING-B10-001: [无 / 具体内容]
- DEBT-LICENSE-B10-001: [无 / 具体内容]

## 决策
- PASS：允许进入 Day 11。
- FAIL：冻结 M1～M6，只允许修复 M0.5，并创建 `docs/decisions/M05-FAILURE-REPORT.md`。
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| PACKAGE-B10-001 | 打包应用无法启动或无法定位资源 | 停止 Gate，修生产路径 | FAIL |
| DETERMINISM-B10-001 | 三次导出帧数/时点/关键帧不一致 | 冻结 M1～M6，定位非确定性 | FAIL |
| SYNC-B10-001 | 音频同步不稳定 | 回到时间基准与 mux 逻辑 | FAIL |
| PATH-B10-001 | Unicode 路径失败 | 回到路径处理 | FAIL |
| CLEANUP-B10-001 | 取消后残留当前任务资源 | 回到 Day 9 | FAIL |
| LICENSE-B10-001 | FFmpeg 来源或许可不可追溯 | 停止分发 | FAIL |
| TEST-B10-001 | 缺少真实打包环境验证 | 不允许降级为 PASS | FAIL |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 10：打包探针 + 三次确定性复现 + Gate A**！

### 验收铁律
- 使用打包应用，不得用开发模式替代；
- 连续导出 3 次；
- 帧数、时点和关键帧达到确定性要求；
- Unicode、取消、清理全部回归；
- FFmpeg 在生产路径可独立定位；
- 结论只能 PASS 或 FAIL。

Ouroboros 闭环启动，**B-10/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dist
ffprobe -v error -show_streams -show_format "path/to/run-1.mp4"
ffprobe -v error -show_streams -show_format "path/to/run-2.mp4"
ffprobe -v error -show_streams -show_format "path/to/run-3.mp4"
git diff --stat
git log --oneline -n 10
```
