# Day 02 验收记录

日期：2026-07-19
分支：`codex/day-02-domain-schema`
基线提交：`6162667900853a909ad3ca75d7d1f32a9c69840e`

## 交付内容

- `ProjectSchema`
- `AssetSchema`
- `LayerSchema`
- `ShotSchema`
- `TimelineEventSchema`（当前为 move 事件）
- `evaluateShotAtTime()` 纯函数求值器
- 领域 Schema 与 move 求值单元测试

## 领域约束

- `schemaVersion=1`
- 固定 `1920×1080 / 24 FPS`
- 所有时间字段为非负或正整数毫秒
- Layer 使用 `anchor: "center"`，x/y 表示视觉中心坐标
- 素材路径必须为项目内相对路径，禁止绝对路径和 `..` 穿越
- TimelineEvent 必须引用当前 Shot 中存在的 Layer
- TimelineEvent 结束时间不得超过 Shot 时长
- Layer 只能引用 Project 中存在的图片素材
- 项目数据可以安全执行 `JSON.stringify()`

## 自动化验证

| 命令 | 结果 |
|---|---|
| `pnpm install` | 通过，Zod 和 lockfile 已更新 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm test:unit` | 通过，3 个测试文件、17 个测试 |
| `pnpm build` | 通过 |

测试覆盖：

- 合法项目解析与 Schema 默认值；
- 固定分辨率、帧率和 Schema 版本；
- 小数毫秒、非法引用和越界路径拒绝；
- move 事件前、中、后的中心坐标；
- 超出 Shot 时长的求值钳制；
- 非法求值时间拒绝；
- 重复求值结果确定性。

## 启动验收

- `pnpm dev` 成功启动 Vite 与 Electron；
- Electron 主窗口标题为 `Panda Stage`；
- Day 01 Renderer 未被领域代码改动。

## 范围审查

- 未创建新的 UI 或 React 状态；
- Domain 未导入 DOM、Electron、Konva 或文件系统；
- 未实现 Canvas、素材服务或视频导出。

## 未验证项

- GitHub Actions 需要分支推送后由远端执行。

## 结论

Day 02 工单要求均有代码、自动化测试或真实启动证据，可以进入后续安全 IPC 任务。
