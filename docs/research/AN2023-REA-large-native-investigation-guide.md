# AN2023 / REA 大型原生程序逆向调查指南（Codex 执行手册）

> 2026-10-13 · **方法论/研究指南，不是授权直接执行 R1/R2/R3**  
> 项目：[Issue #768](https://github.com/Cognitive-Architect/panda-stage/issues/768) · 基线：[R0 实验收据](../evidence/issue-768-r0/README.md) · 当前 R0 = **PARTIAL / STOP**。  
> 适用：REA 6.4.0 + Ghidra 12.1.4 + JDK 21 + Windows x64；所有具体 CLI/MCP 参数必须在本机安装版本的 `--help` / 工具 schema 核实。  
> 核心目的：调查 **Animate 对 FLA 中 Scene / Symbol / Graphic / Instance / Shape 的可观察处理规则**，独立实现 Panda 兼容性；不追求还原整个商业软件。

## 0. 先记住这 10 条

1. **先问一个精确问题，再分析一处代码。** 一个失败的人物姿势、一个 source-address、一个可证伪假设；不启动“扫描全部 447 个 PE”或“反编译整个 AN”任务。
2. **语义真值不等于反编译结果。** 同一 FLA、同一 Scene/Graphic/Frame 在本机 AN2023 与 Panda 的可观察差异是主验收缝；REA 只是补充机制证据。
3. **只读。** 不修改 AN/FLA 原件，不绕过授权/签名/DRM，不下载或运行来历不明的补丁，不传播商业二进制或反编译源码。仅在具备适用分析权限时开展；目标内容一律按不可信数据处理。
4. **HashMismatch 不是 REA 性能报错。** 本机只有一套修改过签名的 AN2023；本地 SHA 只用于样本身份和未变更证明，不能声称其行为等同官方原版。
5. **`open_binary` ≠ 已完成 Ghidra 分析。** 首个 `binary_overview` 等 Ghidra 查询才可能触发导入、自动分析、Bridge 就绪；不能凭 open PASS 宣布函数级 PASS。
6. **MCP 客户端和 REA provider 有不同的超时。** 客户端等待上限、REA Ghidra startup、JVM 资源是三个独立问题，逐一测量。
7. **REA snapshot ≠ 完整 Ghidra 工程缓存。** 它只缓存符合匹配条件的已完成查询；新问题仍可能触发冷启动。
8. **每次只改变一个变量。** 超时、JVM heap、分析对象和自动分析策略不要同时改，否则无法解释改善来源。
9. **保存原始错误和最小收据，而非数十 MB 伪代码。** 错误码、阶段、子操作、时长、证据 ID/路径、程序身份和完整性足够先行。
10. **任何阶段发现新事实，先更新 #768 正文，停在当前 Gate。** 这份指南不自动放行 R1/R2，也不改 #767 或 PR #677。

## 1. R0 基线：事实和未证实猜测

| 项目 | 2026-10-13 已观察结果 | 可信边界 |
| --- | --- | --- |
| REA | 6.4.0，MCP 初始化约 170 tools | 工具注册不等于 provider 就绪 |
| Ghidra / JDK | 12.1.4 / Temurin 21.0.12.1+1 | 本机临时 stdio MCP 验证 |
| 正常 Codex MCP | `binary_session` 报 Ghidra `not_configured` | **持久 MCP 尚未配 Ghidra** |
| 临时 MCP | 进程级环境含 `GHIDRA_INSTALL_DIR`、`JAVA_HOME`、`REA_ANALYSIS_PROVIDER=ghidra` | 修改没有写入 Codex 持久配置 |
| 小程序 | `where.exe` 实际返回 197 procedures、入口伪代码、2 个 callees | 证明小 PE 的原生静态分析可用 |
| Animate.exe | 23.0.0.407、约 64 MB、PE x86-64；`open_binary` 成功 | 只证明目标识别与选取 |
| MCP overview | 客户端约 120s 截止；provider 约 150.6s 后 error、**原始错误正文未保留** | 不能归因“只是客户端等太短” |
| CLI | `provider_timeout` / `list_documents` 330,000ms | 说明另一条链也无法完成 |
| 资源检查 | `resource_constraint`（4096 entry 限制） | 不等于目标被拒绝或资源少于限制 |
| JVM | `GHIDRA_HEADLESS_MAXMEM=512M` | 只在小 PE 上已证可行；AN 是否因 heap/CPU/I/O 受限 **未知** |

**R0 目前的结论：MCP/Ghidra 小文件函数级 PASS；AN2023 函数级 UNKNOWN；整体 PARTIAL/STOP。** 不能把猜测写成结论。

## 2. 大程序的分层分析架构

```text
S0 冻结问题：AN/Panda 的同一 FLA、同一 root、同一 frame、同一姿势
  ↓
S1 环境准备：provider 健康 + 超时链 + RAM/JVM 确认 + 小 PE 对照
  ↓
S2 静态侦察：文件/节/资源/导入表/模块元数据（尽量不启动 Ghidra）
  ↓
S3 模块筛选：候选依据明确，最多一两个 PE；不可由文件名断言职责
  ↓
S4 单目标 Ghidra：受控冷启动 → 可复用的同会话函数/字符串/引用定位
  ↓
S5 机制假设：给出 2 个可证伪解释，预测新样本
  ↓
S6 AN2023 + JSFL + XFL（必要时 SWF）交叉证据 → 定规则或 NO-GO
```

实际执行以 #768 的 R0→R1→R2→R3 授权门禁为准。S0/S1/S2 这里是操作技术分层，不替代任务阶段。

### S0 — 先定问题，不要一开始搜汇编

使用一个 **已证明存在底层语义分歧** 的目标：
- 推荐候选 `黑衣修仙男.fla`，但首先确认原件路径/SHA。不要与 `黑袍大师兄（四视角）.fla` 混为同一素材。
- 冻结 Scene、Symbol/Graphic、nested instance、source address、authoring frame、期望姿势、AN 截图/JSFL、Panda 同目标 SVG/PNG。
- 清楚归因：“候选未列出 / 预览被 fail-closed 阻断 / 真正错误帧或变换 / 像素不对 / UI 路由挡住了完整人物”。最后一种属于 #767，不属于本研究。
- 从 #693/#736/#737/#743 复用有对应原件及地址的旧证据；旧结论不自动变成现值。

**输出：** 一个确切 tuple、一个可复现差异、一个首要技术问题。若找不到真实分歧，停止，不靠直觉逆向。

### S1 — 判断为何 Ghidra 启动失败，而不是无限延长等待

1. 检查当前 REA 包 `rea --version`、`rea doctor --provider ghidra --json`、`rea providers --json` 与 Codex MCP 的 `binary_session`；记录版本/available/reason。**`doctor` healthy 不是目标 analyze PASS。**
2. 明确执行通道：持久 MCP 是否已真正重启并继承 provider 环境？若未配置，实验可继续沿用**已验证的临时 MCP**；配置变更需单独审批与记录。
3. 首次查询请单独设置 **客户端调用 deadline**，不要在 `binary_overview` 的工具参数里臆造 `timeout`。REA 文档示例使用 MCP SDK `client.callTool(request, { timeout: 240000, onprogress })`；**240s 是示例，不是适用于 64 MB AN 的万能值。** REA 的独立 Ghidra 启动默认是约 330s。
4. 为一次受控实验同时记录：`client_wait_ms`、`provider_startup_limit_ms`、`actual_elapsed_ms`、`current_phase`、`error.code`、`details.diagnostics.failure_cause`、`partial_observation`、cleanup 结果。捕捉 stdout/stderr 的敏感信息需脱敏。
5. 检查当前会话真实启动的 Ghidra Java 进程的**有效** `-Xmx`、峰值 RSS、系统可用 RAM、CPU 争用与磁盘 I/O。设置了环境变量≠证明 JVM 使用了它。
6. 记录 512M 是曾用的小测试预算。若宿主内存许可，可经明确批准**只改 heap 一项**做有限对照（例如从 512M 调到 2G），但不要保证提升，更不能未经测量“越大越好”。JVM heap 限制不等于整个进程组 RAM 上限。
7. 失败须区分：`provider_unavailable` / `provider_timeout` / `resource_constraint` / Java OOM / native loader/bridge failure / client cancellation / permission或路径限制。使用 REA 完整结构化错误，不用“一律超时”概括。
8. 超时之后先查 `binary_session.analysis_activity`、已有 evidence 或 partial observations；客户端不等于引擎已停止。按官方顺序 **`close_binary` → 确认 cleanup → 重新 `open_binary`**。遇 `cleanup_incomplete` 不要继续叠加新会话或粗暴 kill 不属于自己的进程。

**最多进行一次有参数记录的基线重现及一次“只改一个变量”的诊断试验**，仍失败即判 `STOP: LARGE_TARGET_IMPORT_UNRESOLVED`，保留下一次要验证的单一假设；不循环刷模型额度。

### S2 — 不依赖完整自动分析的外围情报

**先做便宜且局部的取证：**

| 需要证实的问题 | 优先渠道 | 不得声称 |
| --- | --- | --- |
| PE 类型、位数、节、导入/导出表 | OS/PE 静态元数据、REA 受支持的离线结构检查 | 看见 DLL 名就证明负责 FLA |
| 哪个模块与 XML/ZIP/XFL/Graphic/Shape 相关 | 导入、字符串、文件版本和已知库证据交叉 | 某个字符串必然是业务逻辑 |
| 是主程序过大还是 provider 冷启动问题 | 同环境更小且合法分析的 PE 对照 | 小样本通过就证明 AN 可分析 |
| 可否缩小资源输出 | 查精确工具 schema 中的分页/limit 参数 | `resource_constraint` 就是文件坏了 |
| 异常模块是否可分析 | 单模块版本、SHA、导入证据与一次有界函数查询 | 所有 447 个 DLL 自动扫一遍 |

模块筛选规则：必须有 **至少两类独立弱信号**（例如导入表 + 字符串 / 安装元数据 + API 引用）才进入下一轮；只是一个 DLL 叫做 `PIE` / `Color` 不能证明它负责角色合成。候选最多 1–2 个；无充分候选时 `UNKNOWN`。

**不要在无法确认是否支持时试图用 REA 的 `open_binary` “跳过 Ghidra 自动分析”。** 默认工作流会在第一次 Ghidra 查询中自动分析；REA 文档有 `REA_GHIDRA_DISABLED_ANALYZERS`，但必须先从日志证明是**某个具名 analyzer**造成问题，记录分析 profile 变化与信息损失。不要凭猜测全关。

### S3 — 如果 REA 首个 overview 始终卡住：两条受控备选路径

**路径 A（优先）— 已获支持的 REA/Ghidra 小范围会话**

- 在一个已打开且 ready 的 Ghidra session 内，优先 `list_procedures` / 搜索特定字符串 / `analyze_function` / `procedure_references` / `get_call_graph` 的**具体、可证伪目标**。
- 只看短名单，先函数名/地址/引用，后伪代码。每个函数给出 module hash、RVA/VA、来源、xref 和可信等级；跳转深度由问题决定，不开启全程序递归。
- 不要因为 `get_call_graph` 返回空就证明没有路径：覆盖可能是 partial/unknown。

**路径 B（需另行授权）— 脱离 REA 用 Ghidra 官方 Headless 独立侦察**

- 如果 REA Bridge/import 层始终报错，但本机 Ghidra 本身能够可靠导入，才考虑隔离的 *Ghidra analyzeHeadless* 作一次有限分析验证；这是 **独立工具路径**，不是声称“REA 已经可用”。
- 分析输出限定为自有临时项目中的 import/log / 目标少数 section 或有限导出与候选分析统计；避免一次 dump 全部函数和反编译文本。
- 独立 Ghidra 工程数据库、REA 的 snapshot、REA Evidence Bundle **不是同一种格式，不能宣称直接互通**。只有经过可复核的 module SHA + 地址/RVA + 证据桥接才能相互佐证。
- 若任何原生工具要求注入/绕过保护、执行修改版程序或外传商业二进制，停止并上报；该动作不在当前授权内。

**路径 C（真正研究意义上的保底）— 暂时不碰二进制**

- 优先 JSFL、Raw XFL、发布 SWF、AN 截图与最小 A/B 实验来定位语义。即使暂时没有函数级证据，也能形成独立可验证的 Panda 修复候选，但必须如实标注没有 REA 内部证据，并按 #768 门禁走。

### S4 — 由“二进制线索”变成“可验证的 FLA 语义”

对于首个确切差异，至少写出：
1. `H1` / `H2`：两种**互斥或可区分**的机制解释；
2. 哪个 Raw XFL 字段/元件地址会触发差异；
3. 哪个 native 候选函数或字节/引用与该字段有关，以及为何它不是简单的偶然字符串；
4. **在执行前写出**对一个新姿势或独立第二样本的预测；
5. 用本机 AN2023 真值（JSFL/画面；必要时 SWF）判定支持或推翻；
6. 最后只给 `BEHAVIOR_SUPPORTED` / `INCONCLUSIVE` / `NO_GO`，不能把静态伪代码直接升级为全部 AN 的行为规则。

禁忌：看见 Open-Fill 就人工补边、端点吸附、按素材名特判；看见多帧就强制第 0 帧；看见父子绑定就双重乘矩阵。此前项目已经证明这类猜测会制造假 PASS。

## 3. 给 Codex/Luna 的 Token 和工具预算

**默认一次只完成一个小任务，先返回 1 页收据，不需模型朗读大段日志。**

| 层级 | 最多做什么 | 下一跳的门禁 |
| --- | --- | --- |
| T0 元数据 | 单目标哈希/版本/PE 分类、现有回执索引 | 目标身份明确 |
| T1 Provider | 一次 doctor / session / 受控启动测试 | 获得完整 success/error |
| T2 候选侦察 | 1–2 个目标模块、少量结构/字符串/引用 | 有可靠关联证据 |
| T3 单函数 | 有地址的少量函数 dossier/xref，短列表 | 可证伪行为假设 |
| T4 语义 | 一个真实 FLA tuple + 一个独立对照 | OWNER Gate |

“少量”由具体任务的验证范围确定；**不可为了凑数字扩散目标**。每次在开始前写：`question`、`expected_evidence`、`max_calls`、`stop_condition`。每次工具错误不要试 4 种同义命令；先看错误诊断。完整工具输出存本地收据，给模型只返回指标、关键片段和证据定位。

### 每轮回执格式（必须）

```text
SCOPE: R0 / one exact subtask
TARGET: local path (redactable), SHA256, version, PE type
QUESTION: one falsifiable technical question
ENV: REA / Ghidra / JDK / heap / client timeout / provider timeout
CALLS: operation, parameters digest, elapsed_ms, outcome
EVIDENCE: evidence_id / receipt_path / module:RVA / exact source address
FACTS: directly observed only
INFERENCE: hypothesis and confidence
UNKNOWN: missing/error/partial coverage; never convert null into PASS
CLEANUP: close_binary result, owned resources (no broad kill)
RESULT: PASS / PARTIAL / STOP / NO-GO
NEXT: exactly one bounded proposed action; owner release required
```

**精简上下文模板：** “本轮已知事实 5 行 + 证据 ID/文件位置 5 行 + 未解决问题 2 行 + 下一刀 1 行”。不要反复全文贴 2 万行反编译结果。

## 4. R0-B 建议实验计划（仅供下一次授权，不自动执行）

**B0：稳定复现当前配置差异。** `where.exe` 再确认一次 tool/provider 基线，核对持久 MCP 的 Ghidra 是否还是 `not_configured`；不能直接改用户长期配置。

**B1：捕获完整错误。** 为单次 AN overview 记录客户端 120s 与 provider 330s 的真实差异、进程资源、错码/嵌套 cause；明确当前失败正文缺失。只读，无二进制运行/修改。

**B2：单变量资源对照。** 如 B1 显示 heap 受限并且宿主资源允许，单独调整 heap；如显示 client deadline 先到，仅针对客户端 deadline；如 Ghidra 自动分析失败则调查**具名** analyzer。无日志不做“盲调 10 次”。

**B3：有证据才选择模块。** 从外围数据缩到 1 个 PE；不用 447 个 PE 批量试错。确需离线 Ghidra 原生工具时，请维护者另行授权。

**B4：结束条件。** 一个本地 AN2023 模块返回至少一个真实函数/引用/伪代码及其完整证据 → 可以提 R0 函数级 PASS 申请；若仍失败，就保留 R0 PARTIAL/STOP，建议在明确授权后转向 R1 的 JSFL/视觉差异定位，不伪造二进制成功。

## 5. 后续执行时可直接贴给 Codex 的任务书

> 请阅读 #768、R0 收据和本指南。**本轮只执行维护者额外授权的 R0-B 单步诊断**；若无明确放行，只产出一份计划，不调用 AN 原生分析引擎、不修改代码。
>
> 优先解释此前 Animate.exe 的 `binary_overview` 150.6s error、CLI `list_documents` 330s provider_timeout 与客户端先结束之间的关系。不要猜根因；先查 REA 6.4.0 / Ghidra 的结构化错误字段、工具 schema 和生命周期。保持目标文件不变；HashMismatch 仅作身份说明，不作为失败原因。
>
> 单次试验必须固定版本和目标，只改变**一个**预算或查询参数。保存完整脱敏错误和 Evidence 引用、计时/CPU/内存与 close 结果。连续两次失败或无法辨别失败阶段 → STOP，给出单一下一步；不扫全部 DLL、不 dump 反编译源码、不改生产代码、不碰 #767/#677、不合并 PR。更新 #768 **正文**，而非开新评论。
>
> 输出：事实 / 推断 / 未知三栏 + 一页回执 + PASS/PARTIAL/STOP + 是否需要维护者批准下一刀。

## 6. 官方参考与证据等级

- [REA Windows Ghidra P0](https://github.com/morluto/rea/blob/main/docs/windows-ghidra-p0.md)：Windows 支持条件、provider 接线、只读边界及可用性声明。
- [REA MCP Contracts — Ghidra first-query deadlines](https://github.com/morluto/rea/blob/main/docs/mcp-contracts.md#ghidra-first-query-deadlines-and-recovery)：`open_binary` 与首次查询差别、双超时、进度与 close/reopen。
- [REA Installation — Ghidra heap/CPU](https://github.com/morluto/rea/blob/main/docs/installation.md#ghidra-heap-and-cpu-controls)：优先级、512M 小样本限制、实际 JVM 验证和内存风险。
- [REA CLI and Evidence](https://github.com/morluto/rea/blob/main/docs/cli.md#save-and-reuse-analysis-snapshots)：原生 CLI、session/snapshot、缓存语义。
- [REA Native Investigation](https://github.com/morluto/rea/blob/main/docs/native-investigation.md)：函数、引用、反编译、缺失关系的可信边界。
- [Panda #768](https://github.com/Cognitive-Architect/panda-stage/issues/768)：授权来源、技术门禁。
- [Panda R0 Receipt](../evidence/issue-768-r0/README.md)：此文所有本机事实的原始摘要；本指南不是一份新实验报告。

**政策：研究和验证只在合法许可范围内进行；不得绕过授权、破解安全保护、执行未知二进制或把商业程序反编译产物作为 Panda 代码直接移植。**
