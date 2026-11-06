# Issue #768 R0：REA / Ghidra 可行性记录

日期：2026-10-13
结论：**PARTIAL / STOP**；R1 仍待维护者明确放行。
范围：只读验证 REA MCP 与本机 AN2023 PE 的静态分析可达性，不开始 FLA 行为对照或代码实现。

本记录将 [Issue #768](https://github.com/Cognitive-Architect/panda-stage/issues/768) 中的 R0 结果保存为仓库内证据摘要。Issue 正文保留阶段状态与完整路线约束。

## 环境

- Windows Server 2022 Datacenter 10.0.20348 x64；Node 24.19.0。
- REA 6.4.0（MCP 初始化报告 170 个工具）；Ghidra 12.1.4；Eclipse Temurin JDK 21.0.12.1+1。
- REA 持久 MCP 的 `binary_session` 报告 Ghidra 为 `not_configured`。为验证 MCP 全链路，另启动一次性 stdio MCP 子进程，并仅为该进程设置 `GHIDRA_INSTALL_DIR`、`JAVA_HOME`、`REA_ANALYSIS_PROVIDER=ghidra` 和 `GHIDRA_HEADLESS_MAXMEM=512M`。Codex 持久配置没有变更。
- [REA Windows Ghidra P0 指引](https://github.com/morluto/rea/blob/main/docs/windows-ghidra-p0.md) 描述 repository main 上的实验性只读 Windows x64 边界，并列出 Node 22.19+/24.11+、Ghidra 12.1.x、JDK 21+ 与原生 PE 条件；该页同时提示已发布 npm 包需核对各自的发行边界。因此，本机 REA MCP 6.4.0 的可用性结论依据下述实际 MCP 调用结果。

## 无害 PE：MCP 函数级分析成功

以 Windows 系统 `where.exe` 的只读副本验证。样本 SHA-256：`38486A18E168D8B9A7657F29CA8E38C5EBA707A5777BF6F55EED31EE9D982444`。

- 临时 stdio MCP 的 `open_binary`、`binary_overview` 与 `analyze_function` 成功；概览给出 8 个 segments、197 个 procedures、152 个 strings。
- 对入口函数 `0x140007e10` 的分析返回伪代码及 2 个 callees。
- 持久 MCP 的 `inspect_pe_resources` 对该样本返回完整资源树：9 个 entries、3 个 resources。
- REA Evidence：overview `ev_9366de53d65b0c995d36c98c86851c118c67e6a945b8f7d94763bfb8d89eddfb`；函数 `ev_a1fe26098f39788d8aaf0c0bbf22c6fe1ad4eb3d3b9598c13f05fe42167ea7e9`；资源 `ev_fd9b71ed503695babb6cac09541d8afccd6f7eeda25408ec40b505a38723d1be`。

这证明当前主机上的临时 Ghidra 配置可以经 MCP 对小型、无害 PE 返回真实函数级静态分析结果；它本身不证明 Animate 的内部行为。

## 本机 AN2023：身份确认成功，函数级结果未取得

唯一目标为 `D:\AN2023\Adobe Animate 2023\Animate.exe`：

- FileVersion `23.0.0.407`；64,035,336 bytes；SHA-256 `0F869BD383E679611C6F85D887F72FE636B16403A5B98F79DF87F6F563ED3838`。
- Authenticode `HashMismatch` 仅作为该本地构建的描述信息。按维护者对 #768 的说明，它不构成静态分析门禁。
- 临时 MCP 的 `open_binary` 接受该文件为 PE / x86-64，返回的 SHA-256 与目标一致。分析前后 SHA-256 未变；没有启动 Animate.exe。
- MCP `binary_overview` 在约 150.6 秒后以错误结束，没有可用 Evidence。REA CLI 检查以 `provider_timeout` 结束，报告操作 `list_documents` 超时（330,000 ms）。持久 MCP 的资源检查在 `max_entries=4096` 时返回 `resource_constraint`，没有部分资源清单。
- 因此没有 Animate 函数、交叉引用或伪代码证据。当前结果是大目标分析路径受限，不能据此推断 Animate 的实现语义。

### 有界 PE 候选清单

安装目录的只读文件元数据盘点发现 447 个 EXE/DLL（其中 58 个 EXE）。下列条目是身份候选，**没有证据确认它们承担 FLA 渲染职责**。

| 相对路径 | 观察到的版本/元数据 | SHA-256 |
| --- | --- | --- |
| `Animate.exe` | 23.0.0.407 | `0F869BD383E679611C6F85D887F72FE636B16403A5B98F79DF87F6F563ED3838` |
| `Players\FlashPlayer.exe` | 35.0.0.204 | `532D65A8B3317CBA67E005000A019B4437B37FF1B353A53C11CD9122C2523456` |
| `AdobePIE.dll` | 52,068,360 bytes；无 PE FileVersion | `882F441491773CA71F5D26231FAB4C9715A00821C4475732D6F1EDB7B1EAF939` |
| `ACE.dll` | Adobe Color Engine 3.5.0.51378 | `93E85FE5A44A3FA19E3AB7E43F645EB3FD772D5773D2BF8CD9AA7014BA6A3308` |
| `AdobeOwl.dll` | 5.5.0 | `1712FA8D5F6ECC16BF24E2CF5CE6AE139C09DEAEB3B3D20B7CE32BA46BBA1522` |
| `System\AIRes.dll` | Adobe Illustrator 2023，27.0.0 | `8A20CFEE70C4DE0932BD63F1B3F33DE8F9C54A84EFA8C0924BDBB73411261C9C` |
| `CEPHtmlEngine\CEPHtmlEngine.exe` | 11.5.3 | `4AB5DFDB7C08A07457E6FAE5754CC3CD7C69ED4C3ABBBC157F6967707EFA9DD5` |

## 阶段结论与后续边界

**R0 = PARTIAL / STOP。** 无害 PE 已证明临时 MCP/Ghidra 链路能产生函数级证据；唯一本机 Animate.exe 已按当前样本身份完成只读打开和哈希核对，但分析时限内没有函数级结果。此结论针对本机当前构建，不外推为 Adobe 官方通用实现。R1 仍为 **BLOCKED**，需要维护者明确放行。

获准进入 R1 后，建议先核验候选 `黑衣修仙男.fla` 的精确路径与原始 SHA-256，再固定一个已通过姿势作 control 和一个可复现缺陷姿势，记录相同 Scene/Symbol/Instance/frame 的本机 Animate 与 Panda 对照。本记录没有开始该工作。

## 本机收据

原始 CLI / MCP 收据保存在专用验收目录 `D:\PandaStage-Acceptance\REA-R0-20261013-111134\receipts\`，包括 `where-inspect.json`、`mcp-stdio-binary-overview.json`、`mcp-stdio-analyze-function.json`、`animate-inspect.json`、`mcp-animate-open-binary.json` 与 `animate-module-inventory.json`。收据引用的是本机 Evidence 和目标路径；本 PR 不包含可执行文件、FLA、完整 MCP 会话转储或反编译正文。
