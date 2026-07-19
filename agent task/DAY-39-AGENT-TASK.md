# Panda Stage Agent Task — Day 39

> **工单编号**：B-39/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 39  
> **分支建议**：`docs/day-39-release-docs`  
> **任务类型**：用户文档 + 开发文档 + 许可合规  
> **唯一目标**：完成面向用户、开发者和发布接管者的文档闭环，使新用户能按文档打开演示并导出，新开发者能按文档启动、测试和构建，同时让第三方许可与已知问题可追溯。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Release Documentation + Third-Party Notices + Known Issues
- **轰炸目标**：更新 README、用户指南、开发指南、架构、FFmpeg、项目格式、失败日志说明、第三方许可与已知问题，并实际执行文档中的命令和用户流程。
- **任务性质**：文档工程 + 合规整理 + 可接管性验证
- **输入基线**：Gate C PASS；Day 36 演示项目、Day 37 测试套件、Day 38 Windows 安装包与干净环境证据可用。
- **输出要求**：用户可照文档操作 + 开发者可照文档启动测试 + 许可可追溯 + 已知问题不隐藏 + 命令有真实运行证据 + 16 项刀刃表。
- **通用铁律**：
  1. 文档中的版本、命令、路径、安装包行为和限制必须与当前仓库/产物一致。
  2. 未实际运行的命令不得写成“已验证”；必须标记未验证或给出替代证据。
  3. 第三方依赖、FFmpeg、字体、演示素材与音频许可必须可追溯。
  4. 已知问题必须包含影响、规避方法和证据，不得只写“有一些小问题”。
  5. 用户指南优先使用普通语言，技术细节放开发文档，不让新用户先学架构才能导出。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | Gate C PASS；Day 36～38 回执与产物存在 | Gate/回执/artifacts | 必须 |
| 当前文档 | 盘点 README、architecture、development、ffmpeg、license、known issues 与项目格式说明 | `git ls-files README.md docs THIRD_PARTY_NOTICES.md KNOWN_ISSUES.md` | 必须 |
| 目标范围 | README、用户/开发/架构/FFmpeg/格式/日志/许可/已知问题与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 新用户可打开演示并导出；新开发者可启动测试构建；许可可追溯；已知问题有规避；命令实际运行 | walkthrough evidence | 必须 |
| 技术约束 | 不写未来功能成现有能力；版本/脚本来自仓库；路径示例兼容 Windows；日志说明尊重隐私 | 文档审查 | 必须 |
| 风险边界 | 不重写业务代码；不新增功能；不伪造截图/结果；不承诺未验证平台；不复制大段第三方许可证正文替代 notices | diff 审查 | 必须 |
| 测试基线 | 运行文档涉及的基础命令和最小用户流程 | 命令输出/录屏 | 必须 |
| 文档同步 | 本任务本身即文档闭环；新建 `docs/test-receipts/DAY-39.md` | 文档 diff | 必须 |
| 历史债务 | Day 36～38 的签名、杀软、CI、平台限制必须进入 KNOWN_ISSUES 或 debt | 对照表 | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 发布文档需要覆盖安装、首次运行、项目制作、导出、开发、架构、FFmpeg、许可和故障处理。 |
| 待确认问题 | 当前依赖许可清单生成方式；日志导出入口；项目格式版本说明位置；安装包名称和版本。 |
| 预期输出 | 一套不依赖口头传承、可由新用户和新开发者复现的文档包。 |
| 停止条件 | 用户 walkthrough、开发 walkthrough、许可审查和已知问题对照全部完成。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-39/45
- **角色**：Engineer
- **依赖关系**：依赖 Gate C 与 Day 36～38 的真实产物和限制。

### 输出交付物

- **预计变更文件**：
  - `README.md`
  - `docs/user-guide.md`
  - `docs/development.md`
  - `docs/architecture.md`
  - `docs/ffmpeg.md`
  - `docs/project-format.md` 或仓库等价文件
  - `docs/troubleshooting.md` 或失败日志说明
  - `THIRD_PARTY_NOTICES.md`
  - `KNOWN_ISSUES.md`
  - `docs/test-receipts/DAY-39.md`
- **核心修改点**：
  - README：产品定位、系统要求、安装、快速开始、当前限制；
  - 用户指南：打开演示、新建项目、导入素材、角色/镜头/动作/对白、预览、保存、导出、恢复；
  - 开发指南：依赖、安装、启动、测试、构建、打包、目录结构；
  - 架构：Main/Preload/Renderer、项目模型、预览/导出共享链路、数据流与安全边界；
  - FFmpeg：来源、版本、资源路径、参数数组、常见错误、许可；
  - 项目格式：schemaVersion、相对路径、迁移和兼容性；
  - 故障处理：日志位置、导出失败日志、如何脱敏后提交；
  - 第三方 notices：依赖名、版本/来源、许可证、用途；
  - KNOWN_ISSUES：P1/P2、影响、规避、证据和计划。
- **必须包含**：
  - 用户按文档从安装到打开演示并导出；
  - 用户按文档创建最小项目并保存重开；
  - 开发者按文档执行 install/dev/typecheck/lint/unit/build；
  - E2E/dist 命令的适用环境和限制；
  - Windows 中文路径/用户名说明；
  - FFmpeg 随包策略和版本来源；
  - 日志/项目文件分享前的隐私提示；
  - 项目格式和 migration 说明；
  - 演示素材、字体、音频许可；
  - 未签名/SmartScreen/杀软提示；
  - 已知问题不能写成空泛占位；
  - 所有命令逐条记录真实结果或 N/A + 原因。
- **禁止包含**：
  - 把 Backlog 功能写成已支持；
  - 复制过期命令或不存在脚本；
  - 宣称支持未验证的 macOS/Linux；
  - 隐瞒签名、杀软或平台限制；
  - 日志指南鼓励上传完整隐私路径/项目内容；
  - 为写文档顺手重构业务代码。
- **交付证明**：用户 walkthrough 记录、开发命令原始摘要、文档链接检查、许可来源表、KNOWN_ISSUES 对照 Day 36～38 debt、截图/产物路径。

### 规模与复杂度观察

- 文档按读者分层，README 只做导航和快速开始，避免塞成百科全书。
- 架构文档解释稳定边界，不逐文件抄代码；项目格式文档聚焦兼容与迁移。
- notices 可由依赖清单辅助生成，但必须人工检查 FFmpeg、字体和演示素材，不能只列 npm 包。
- 若文档中的某条流程不能复现，应修文档或标记问题，不得为了文档好看隐瞒。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 文档所述 build/dist 命令与当前仓库一致 | `pnpm build`；适用时 `pnpm dist` | 返工 |
| TYPE | 文档变更后类型检查仍通过 | `pnpm typecheck` | 返工 |
| FMT | Markdown/Prettier 检查通过或 N/A + 原因 | `pnpm exec prettier --check .` | 返工或声明 |
| LINT | lint 通过 | `pnpm lint` | 返工 |
| TEST | 文档中的测试命令真实运行 | unit/integration/E2E 适用命令 | 返工 |
| ARCH | 文档不宣称不存在能力；安全/数据边界一致 | code-doc cross-check | 返工 |
| REAL | 新用户与新开发者 walkthrough 实际完成 | 录屏/记录 | 返工 |
| DOC | 链接、许可、已知问题和回执完整 | link/license audit | 返工 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | README 快速开始可复现 | user walkthrough | [ ] |
| FUNC | FUNC-002 | 用户指南覆盖完整核心流程 | checklist/recording | [ ] |
| FUNC | FUNC-003 | 开发指南命令可运行 | command outputs | [ ] |
| FUNC | FUNC-004 | 故障/日志指南可定位导出失败 | simulated failure | [ ] |
| CONST | CONST-001 | 架构/项目格式与代码一致 | cross-check | [ ] |
| CONST | CONST-002 | 第三方许可可追溯 | notices audit | [ ] |
| CONST | CONST-003 | 不宣称 Backlog 或未验证平台 | static review | [ ] |
| CONST | CONST-004 | 文档版本/命令来自真实仓库 | package/script evidence | [ ] |
| NEG | NEG-001 | 失效链接/不存在命令被发现 | link/script check | [ ] |
| NEG | NEG-002 | 隐私敏感日志有脱敏说明 | docs review | [ ] |
| NEG | NEG-003 | 签名/杀软/平台限制不被隐藏 | known issues audit | [ ] |
| NEG | NEG-004 | Day 36～38 debt 均有落点 | debt mapping | [ ] |
| UX | UX-001 | 新用户不用技术术语即可导出演示 | walkthrough | [ ] |
| UX | UX-002 | 错误排查给出下一步而非术语堆砌 | troubleshooting review | [ ] |
| E2E | E2E-001 | 安装→演示→导出与开发→测试→构建双流程 | complete evidence | [ ] |
| High | HIGH-001 | 所有许可/限制陈述可提供来源证据 | audit table | [ ] |

---

## 【模块3-B】地狱红线

1. 把未实现 Backlog 写成已支持 → 返工。
2. 文档命令不存在或未运行却声称验证 → 返工。
3. 宣称支持未验证平台 → 返工。
4. 隐瞒未签名、杀软或干净机限制 → 返工。
5. 第三方许可只列 npm 包、不含 FFmpeg/素材/字体 → 返工。
6. 已知问题写成空泛占位 → 返工。
7. 日志指南泄露敏感本地信息 → 返工。
8. 为文档顺手重构业务代码 → 范围失控。
9. 未做用户/开发 walkthrough 就声称可接管 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 用户、开发、架构、FFmpeg、许可文档是否完整？ | [ ] | CF-B39-001 |
| RG | 文档是否与 Gate C 和 Day 36～38 实际一致？ | [ ] | RG-B39-001 |
| NG | 失效命令、链接、隐私和遗漏 debt 是否覆盖？ | [ ] | NG-B39-001 |
| UX | 新用户能否不懂技术完成演示导出？ | [ ] | UX-B39-001 |
| E2E | 用户/开发双 walkthrough 是否走通？ | [ ] | E2E-B39-001 |
| High | 许可和限制是否逐项可追溯？ | [ ] | HIGH-B39-001 |
| 字段完整性 | 回执是否记录所有命令与文档路径？ | [ ] | DAY-39.md |
| 需求映射 | 是否覆盖 Day 39 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否由“新环境视角”走读？ | [ ] | walkthrough 证据 |
| 范围边界与债务 | 未验证命令/平台是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-39/45 完成并提交
- Commit: `docs: complete user development FFmpeg and license guides`
- 分支: `docs/day-39-release-docs`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 文档结果
- README:
- User guide:
- Development guide:
- Architecture:
- FFmpeg:
- Project format/migration:
- Troubleshooting/logs:
- THIRD_PARTY_NOTICES:
- KNOWN_ISSUES:

### Walkthrough
- 新用户安装→演示→导出:
- 新用户最小项目→保存重开:
- 新开发者 install→dev→test→build:
- 失败日志定位:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration/E2E:
- `pnpm build`:
- `pnpm dist`:
- Markdown/link checks:

### 决策与债务
- DECISION-001: [文档信息架构]
- DECISION-002: [许可清单维护]
- DECISION-003: [KNOWN_ISSUES 分级]
- DEBT-DOC-B39-001:
- DEBT-LICENSE-B39-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| TRUTH-B39-001 | 文档与实际产品行为冲突 | 以实际证据修正文档 | 阻塞 |
| LICENSE-B39-001 | 任一依赖/素材许可无法确认 | 停止发布，补证据或替换 | 阻塞 |
| WALKTHROUGH-B39-001 | 新用户/开发者无法按文档完成流程 | 修文档或登记真实缺陷 | 返工 |
| PRIVACY-B39-001 | 日志说明可能泄露敏感信息 | 加脱敏规则和示例 | 阻塞 |
| TEST-B39-001 | 无法运行某文档命令 | 标记 N/A + 原因，不得声称验证 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 39：Release Documentation + Third-Party Notices + Known Issues**！

验收铁律：文档与实际一致；命令真实运行；用户能导出演示；开发者能启动测试构建；许可可追溯；已知问题含影响与规避；不冒充支持未验证平台。

Ouroboros 闭环启动，**B-39/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git ls-files README.md docs THIRD_PARTY_NOTICES.md KNOWN_ISSUES.md
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm dist
pnpm exec prettier --check .
git diff --stat
```
