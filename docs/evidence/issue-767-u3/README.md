# Issue #767 U3 验收证据

## 最终结果

Windows Electron 验收通过，运行于 `2026-10-13T11-54-33-540Z`，代码提交 `ee0e1bc59fea4c0a4f6beb32f875e867dfdd0985`。完整回执：[receipt.json](run-2026-10-13T11-54-33-540Z/receipt.json)。

主流程从真实 FLA 中选择 `神女-cilisucai.com/神女-cilisucai.com809` 第 0 帧，生成并导入一张透明 PNG（274 × 466，SHA-256 `d9e423464791a179de7766c7eb9b5aec0845bf0b64bd898c749f0f0dd8a25ed5`）。项目内保留来源 FLA、元件名、帧号和渲染目标 ID；素材库读取到真实缩略图（151 × 256）。镜头放置后保存、关闭并重开，图层仍引用该素材。重复导入返回 `duplicate`，`project.json` SHA 和 revision 均未变化。

原始文件 SHA-256 `86eb123fdd42f1dac80754c9260b793404072be70523b41d012598138c35c6d2`，验收前后相同。Main 规范化后的导入会话 SHA-256 为 `0b0c146f4f9bee5c336a2f8b3f8da92927111b2ee2adb9540afd2ab970a1b519`；两者是不同阶段的身份值。

## 截图

- [com809 第 0 帧预览](run-2026-10-13T11-54-33-540Z/bluehair-com809-preview.png)
- [导入前仅显式选择一个候选](run-2026-10-13T11-54-33-540Z/bluehair-com809-selected-one-before-import.png)
- [素材库缩略图状态](run-2026-10-13T11-54-33-540Z/asset-library-bluehair-thumbnail-state.png)
- [素材库来源详情](run-2026-10-13T11-54-33-540Z/asset-library-bluehair-character.png)
- [镜头放置](run-2026-10-13T11-54-33-540Z/shot-bluehair-character-placement.png)
- [项目重开后](run-2026-10-13T11-54-33-540Z/project-reopened-bluehair-character.png)

镜头截图里也显示了“背景预览不可用”提示；角色图像本身可见，保存重开断言通过。Owner hands-on 验收时需确认这个空背景状态是否符合预期。

## 场景与回归

U3 共 7 个场景、15 项断言全部通过：浏览取消无项目或源文件改动；角色组合导入和来源元数据；镜头保存重开与重复导入；缩略图读取；纯位图和混合 FLA 的单项导入；不支持内容不可选择、不可导入并显示原因；预览对象 URL 释放，背景渲染器不累积。

其他门禁也通过：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:unit`（347 个文件，2,532 项测试）
- `pnpm test:integration`（38 个文件，189 项测试）
- `pnpm verify:issue396-stage-d`
- `pnpm verify:issue767-u2`（7 个场景、15 项断言；[本次回执](../issue-767-u2/run-2026-10-13T11-50-16-932Z/receipt.json)）
- `pnpm verify:issue767-u3`

三个 `verify:*` 命令均包含 `pnpm build`；构建通过。U2 截图及回执保存在 [本次运行目录](../issue-767-u2/run-2026-10-13T11-50-16-932Z/)。

## 验收边界

以上是隔离的 Windows Electron 工程验收。Issue #767 仍需仓库 owner 亲自操作验收；此回执不代表 owner acceptance。静帧提交的事务与故障回滚由聚焦单测和 Stage D 回归覆盖。
