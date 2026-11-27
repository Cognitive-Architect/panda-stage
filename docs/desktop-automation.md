# 桌面自动化

打开要编辑的项目，在 **工具 → 桌面自动化** 中复制读取命令。命令使用本机的 Node.js 和当前窗口的会话文件。安装版自带 `panda-live.cjs`，源码工作区也可用 `pnpm automation:cli` 调用同一入口。

## 读取、改台词、撤销

在 PowerShell 中，把工具面板命令里的两个路径分别填入 `$PandaCli` 和 `$PandaSessionFile`。先打开一段有台词的镜头。

```powershell
$PandaCli = '复制命令中的 panda-live.cjs 路径'
$PandaSessionFile = '复制命令中的会话 JSON 路径'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$read = node $PandaCli --session-file $PandaSessionFile state | ConvertFrom-Json
if (!$read.ok -or !$read.data.shot.dialogues.Count) { throw '请打开一个有台词的镜头' }
$session = $read.data.session
$shotId = $read.data.shot.id
$lineId = $read.data.shot.dialogues[0].id

@{ session = $session; shotId = $shotId; dialogueId = $lineId; text = '修改后的台词' } |
  ConvertTo-Json -Depth 8 -Compress |
  node $PandaCli --session-file $PandaSessionFile dialogue.update -

@{ session = $session } |
  ConvertTo-Json -Depth 8 -Compress |
  node $PandaCli --session-file $PandaSessionFile undo -
```

`state` 返回工程版本、当前镜头、播放头、选区、目标 ID 和可用预设。修改会立即显示在桌面窗口中，并进入当前工程的撤销历史。要保留修改，可在桌面应用中正常保存工程。

## 应用预设或配方

从 `state` 的 `shot.layers` 和 `presets` 选择目标。用 `preset.apply` 写动作时可以提交 `parameters`，如 `startMs` 和 `durationMs`。

```powershell
# 先在桌面选一个可编辑的非背景图层，再重新读取状态
$read = node $PandaCli --session-file $PandaSessionFile state | ConvertFrom-Json
@{
  session = $read.data.session
  shotId = $read.data.shot.id
  layerId = $read.data.selection.layerId
  presetId = 'fade-in'
  parameters = @{ startMs = $read.data.shot.playheadMs; durationMs = 250 }
} | ConvertTo-Json -Depth 8 -Compress | node $PandaCli --session-file $PandaSessionFile preset.apply -
```

`recipe.preview` 和 `recipe.apply` 使用同一组参数 `session`、`shotId`、`layerId`、`recipeId`、`startMs` 和 `bindings`。从 `state.recipes` 取得配方和步骤 ID，从目标图层的 `characterId` 找到 `state.characters` 中的目标表情或动作 ID。`bindings` 以步骤 ID 为键，以对应目标 ID 为值，`null` 表示跳过该步骤。没有需重绑定的步骤时可传空对象。`recipe.preview` 在桌面打开现有预览，`recipe.apply` 写入一次历史记录。

## 会话和批量结果

- 编辑命令需要传入 `state` 返回的 `session`。切换、关闭或重开工程后，重新读取 `state`。旧会话的排队编辑会返回 `STALE_SESSION`。
- 编辑会等活动拖动结束，再检查工程和目标。等待超过命令期限会返回 `TIMEOUT`。
- `batch` 接收 `session` 和 `operations`。每项带 `name` 及该编辑的参数，整组使用一次提交和撤销。某一步失败时返回失败步骤，项目保持批次开始前的状态。
- `sequence` 也接收 `session` 和 `operations`，每项独立执行并按顺序返回结果，支持把 `undo` 作为一步。已经成功的编辑仍记录在对应历史中。
- `script.plan` 与 `script.apply` 共用与界面一致的多镜头剧本/表演规划与提交服务。输入 `session`、`script`（含 `镜头`、`背景`、`出场`、`站位`、`对白`、`表演` 块），可选 `audioByOrdinal`、`excludedDirectiveIds`、`extendShotForPerformance`，以及 `script.apply` 的 `allowPartialConfirm`（默认 `false`，存在行级问题时拒绝提交而不修改工程）。`script.plan` 仅返回行级预览结果，`script.apply` 一次提交进入撤销历史。
- 调用返回一行 JSON。`changed`、`revision` 和 `dirty` 反映当前桌面工程状态，`undo` 返回实际撤销的标签。会话凭据文件位于本机应用数据目录，由当前窗口的工具面板提供调用路径。
