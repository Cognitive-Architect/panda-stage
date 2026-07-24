# Day 16 test receipt

## ✅ 工单 B-16/45 完成

### 提交信息

- 目标分支：`feat/day-16-asset-import`
- 基线：`origin/main@86df192f7fea5cff38aea1ab7b0a258d0d830b29`
- 提交标题：`feat(assets): import validated local media into project storage`
- M1 Gate：PASS，证据见 `docs/evidence/m1/results.json`
- Day 16 机器证据：`docs/evidence/day-16/results.json`
- Day 16 UI 截图：`docs/evidence/day-16/asset-import.png`

### 实际结果

- PNG/JPG：真实合成媒体 fixture 被识别、复制并以实际宽高写入 Asset。
- MP3/WAV：真实合成媒体 fixture 被识别并复制；未伪造 Day 17 范围的音频时长。
- 重复检测：固定使用流式 SHA-256；第二次导入同一内容返回 `duplicate`，无第二份文件或 Asset。
- 同名冲突：不同内容保留两份，冲突文件名使用内容 hash 前 8 位后缀且不覆盖。
- Unicode 文件名：`熊猫 图片.png`、`熊猫 照片.jpg`、`熊猫 声音.mp3`、`熊猫 声音.wav` 在 Windows 实测通过。
- 故障回滚：复制故障不保存模型；保存故障删除本事务的新文件，`project.json` SHA-256 与 Asset 数量均保持不变。
- 外部独立性：删除外部源文件后，项目内副本仍可读取；保存后重开项目仍包含四个相对路径 Asset。

### Fixture 与 hash

| Fixture | SHA-256 |
|---|---|
| `熊猫 图片.png` | `38714d8821ebd17405711e56a05711c05a87e6eeb9caf48a2543c1062a1c58fc` |
| `熊猫 照片.jpg` | `6d058147b8815dc23180e49b8cbfdadd511abed44b4ffccdee5cd3f5524b55ff` |
| `熊猫 声音.mp3` | `4e02a22d5f0781723e6f3f44c677114e838ed3f6e2d6d39278bddeccf52cf4da` |
| `熊猫 声音.wav` | `e9953ee0f8dcdbc4b2e4ad009e577007508e5f0f61cf86f0b69b052545903fbc` |

Fixtures 由仓库锁定的开发期 FFmpeg 二进制从合成颜色/正弦波生成，不包含第三方媒体。导入实现不调用 FFmpeg。

### 自动化检查

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test:unit` | PASS：36 files / 210 tests |
| `pnpm test:integration` | PASS：5 files / 35 tests |
| `pnpm build` | PASS |
| `pnpm verify:day16` | PASS |
| 格式 | ESLint 与 TypeScript 为仓库现有格式闸门；未配置 Prettier 脚本 |

### 刀刃表

| ID | 状态 | 证据 |
|---|---|---|
| FUNC-001 | PASS | 集成测试真实导入 PNG/JPG |
| FUNC-002 | PASS | 集成测试真实导入 MP3/WAV |
| FUNC-003 | PASS | `assets/` 文件存在、JSON 为 `assets/...` |
| FUNC-004 | PASS | 重复内容返回 `duplicate`，数量不增加 |
| CONST-001 | PASS | 文件读写仅在 Main 服务；Renderer 静态检查无 Node FS |
| CONST-002 | PASS | ProjectSchema 与集成断言拒绝绝对/越界路径 |
| CONST-003 | PASS | 同名不同内容 hash 后缀、文件 hash 不同 |
| CONST-004 | PASS | `HashService` 固定 `sha256` 流式计算 |
| NEG-001 | PASS | `.txt` fixture 返回 `rejected` |
| NEG-002 | PASS | 伪装 PNG、MIME 不符 fixture 返回 `rejected` |
| NEG-003 | PASS | copy fault 前后项目 hash 与 Asset 数量相同 |
| NEG-004 | PASS | save fault 回滚文件，模型和正式 JSON 不变 |
| UX-001 | PASS | 结构化结果与 UI 显示重复/拒绝/失败消息 |
| UX-002 | PASS | Windows Unicode/空格路径实测 |
| E2E-001 | PASS | 选择/导入事务、保存、重开完整集成覆盖 |
| HIGH-001 | PASS | 删除外部源后项目副本仍存在并可读取 |

### P4 自测

| 检查点 | 状态 | 说明 |
|---|---|---|
| CF | PASS | 四类媒体标准导入 |
| RG | PASS | M1 能力由最终 `verify:m1` 回归 |
| NG | PASS | 伪装、重复、冲突、copy/save 故障 |
| UX | PASS | 四态结果和可读提示 |
| E2E | PASS | 事务保存与重开 |
| High | PASS | 外部源删除测试 |
| 字段完整性 | PASS | fixture、hash、路径、结果已记录 |
| 需求映射 | PASS | 16 项刀刃逐项映射 |
| 自测执行 | PASS | Windows Unicode 文件名 |
| 范围边界与债务 | PASS | 未实现缩略图、素材库、角色或时长提取 |

### 决策与债务

- DECISION-001：使用自有小型二进制结构检查，三重核对扩展名、声明 MIME 与真实格式；无新增运行时依赖或许可证。
- DECISION-002：SHA-256 流式计算；内容去重，名称冲突使用 hash 前 8 位及必要的数字后缀。
- DECISION-003：临时复制、flush、排他提交、一次模型保存；保存失败回滚本事务新文件。
- DEBT-COMPLEXITY-B16-001：N/A。事务状态与回滚由单一 Main 服务和文件系统边界覆盖。
- DEBT-TEST-B16-001：N/A。四种真实 fixture、负向、故障注入、UI 与外部独立性均自动化。

### 回滚

发布后可使用 `git revert <Day 16 commit SHA>` 回滚，不改写共享分支历史。
