# Panda Stage锛堢唺鐚墖鍦猴級

Panda Stage 鏄竴娆鹃潰鍚戜釜浜哄垱浣滆€呯殑 Windows Electron 妗岄潰缂栬緫鍣紝鐢ㄤ簬鎶婅鑹插浘鐗囥€佽儗鏅€佸鐧姐€侀煶棰戝拰绠€鍗曞姩浣滅粍缁囨垚鐭瘒 2D 绾哥墖浜哄姩鐢汇€備粨搴撳綋鍓嶇殑涓讳骇鍝侀潰鏄」鐩鐞嗐€佽祫婧愬伐浣滃尯銆侀暅澶寸紪杈戙€並onva 鐢诲竷銆佸浘灞傛鏌ュ櫒銆佹挙閿€/閲嶅仛銆佷繚瀛樹笌鎭㈠銆?
## 褰撳墠鑳藉姏涓庡紑鍙戠姸鎬?
褰撳墠 `main` 宸插寘鍚竴濂楄繛缁殑 Editor Shell锛?
- 椤圭洰涓績鏀寔鏂板缓銆佹墦寮€銆佹渶杩戦」鐩€侀」鐩垏鎹€侀」鐩枃浠跺す鍏ュ彛鍜屽簲鐢ㄥ唴鍏抽棴纭锛?- 缂栬緫鍣ㄦ敮鎸侀暅澶淬€佺礌鏉愬拰瑙掕壊璧勬簮宸ヤ綔鍖猴紝姝ｅ紡鐢诲竷鏀寔鑳屾櫙銆佸浘灞傞€夋嫨銆佷綅缃?鍙樻崲銆侀攣瀹氥€佹帓搴忓拰鍒犻櫎锛?- 鍙充晶妫€鏌ュ櫒鎵胯浇鑳屾櫙绠＄悊銆佸浘灞傚彉鎹笌鎺掑簭鎺у埗锛涚紪杈戝巻鍙叉敮鎸佹挙閿€銆侀噸鍋氬拰杩炵画鎷栨嫿鍚堝苟锛?- 椤圭洰淇濆瓨浣跨敤鐗堟湰涓庝慨璁㈠彿淇濇姢锛孧ain Process 鎻愪緵 autosave銆佹仮澶嶅€欓€夊拰鎭㈠鏂囦欢绠＄悊锛?- 鍔ㄤ綔棰勮鐨勯鍩熼€昏緫銆佹牎楠屻€佸巻鍙插拰鎸佷箙鍖栨ˉ鎺ュ凡缁忓瓨鍦紝褰撳墠 UI 浠嶄粠宸︿晶鈥滃吋瀹圭紪杈戝伐鍏封€濆叆鍙ｈ繘鍏ワ紱瀹冨悗缁縼绉诲埌姝ｅ紡妫€鏌ュ櫒鐨勫伐浣滃皻鏈垚涓?`main` 鐨勪氦浠樺唴瀹癸紱
- Main Process 浠嶄繚鐣欓殣钘?Renderer銆佸抚鍐欑洏鍜?FFmpeg/ffprobe 鐨勫鍑洪獙璇侀摼锛屼絾杩欐潯閾句笉绛夊悓浜庣紪杈戝櫒棣栭〉宸茬粡浜や粯姝ｅ紡瀵煎嚭 UI 鎴栧畨瑁呭寘 sidecar銆?
M3 鐨勬寮忚儗鏅€佸浘灞傚拰閫夋嫨鍚堝悓宸茬粡杩涘叆褰撳墠 `main`锛涘悗缁?Stage 3-B/3-C/4 浠嶆寜鍚勮嚜鐨勬巿鏉冦€丏raft 鐘舵€佸拰浜哄伐楠屾敹鎺ㄨ繘銆傛湰鏂囦笉鎶?M3銆丼tage 3-B銆丼tage 3-C 鎴?Stage 4 瀹ｅ竷涓哄畬鎴愶紝涔熶笉鎶婃棭鏈?Day 璁″垝褰撲綔褰撳墠浜у搧闃舵銆?
椤圭洰鏂囦欢鍥哄畾浣跨敤 1920脳1080銆?4 FPS 鍜屽綋鍓嶆寮?schema v5銆備繚瀛樼殑绱犳潗璺緞蹇呴』鐩稿浜庨」鐩洰褰曪紝鏃堕棿瀛楁浣跨敤鏁存暟姣銆?
## 鎶€鏈爤

- Electron
- React 19
- TypeScript
- Vite
- Konva / react-konva
- Zod
- Vitest
- ESLint
- pnpm

## 褰撳墠鏋舵瀯鎬昏

```text
App
鈹斺攢 EditorShell                                  鍞竴椤圭洰浼氳瘽涓庣敓鍛藉懆鏈熷叆鍙?   鈹溾攢 ProjectCenterScreen / StartScreen          鏃犻」鐩垨椤圭洰涓績椤?   鈹斺攢 Editor layout
      鈹溾攢 CompactProjectBar                       椤圭洰鐘舵€併€佷繚瀛樸€佸垏鎹€侀瑙堛€佸叧闂?      鈹溾攢 LeftWorkspace
      鈹? 鈹斺攢 ResourceActivityDock                 闀滃ご / 绱犳潗 / 瑙掕壊宸ヤ綔鍖?      鈹?    鈹溾攢 ProjectRecoveryPanel              鏈€杩戦」鐩笌鎭㈠鐩稿叧鍏ュ彛
      鈹?    鈹斺攢 LegacyCompatibilityActivity       鏆傜暀鐨勫姩浣滈璁惧吋瀹瑰叆鍙?      鈹溾攢 CanvasWorkspace
      鈹? 鈹斺攢 features/canvas/CanvasStage           姝ｅ紡 Konva 缂栬緫鐢诲竷
      鈹?    鈹斺攢 HistoryControls                    鎾ら攢 / 閲嶅仛
      鈹斺攢 RightInspector                           鑳屾櫙銆佸彉鎹€佹帓搴忔鏌ュ櫒
```

### 椤圭洰銆侀鍩熶笌娓叉煋

- `src/domain/` 鏄綋鍓嶆寮忛鍩熷叆鍙ｏ紝鍖呭惈 Project/Asset/Character/Shot/Layer/TimelineEvent 妯″瀷銆乻chema銆佽縼绉汇€乻elector銆乻ervice銆乿alidator銆佸嚑浣曡鍒欏拰鍔ㄤ綔棰勮銆?- `src/renderer/stores/EditorProjectStore.ts` 鏄?Renderer 涓?Project銆乣dirty` 鍜?`revision` 鐨勫敮涓€ owner锛沗src/history/` 鎻愪緵瀹冩墍鎸佹湁鐨勫唴瀛樺懡浠ゅ巻鍙层€?- `shotStore` 鍙繚瀛樺綋鍓嶉暅澶撮€夋嫨锛宍selectionStore` 鍙繚瀛樺綋鍓嶅浘灞傞€夋嫨锛涜繖浜涗細璇濈姸鎬佷笉鍐欏叆 `project.json`锛屽苟鍦ㄩ」鐩垨闀滃ご鏀瑰彉鏃堕噸鏂版牎楠屻€?- `CanvasStage` 浠庢寮?`src/domain` 鏋勫缓缂栬緫娓叉煋妯″瀷锛屼娇鐢ㄩ」鐩礌鏉愮殑鍙楁帶璇诲彇 API 鍜?1920脳1080 閫昏緫鍧愭爣锛涚敾甯冨彧璐熻矗鏄剧ず涓庝氦浜掓彁浜わ紝鎸佷箙鍖栧彉鏇寸粡 domain service 鍜?Project store 瀹屾垚銆?- `src/shared/domain/` 鏄棭鏈熸覆鏌撴帰閽?鍏煎妯″瀷锛屼粛琚巻鍙叉祴璇曟垨鑴氭湰浣跨敤锛屼絾涓嶆槸褰撳墠姝ｅ紡缂栬緫鍣ㄦā鍨嬬殑鎺ㄨ崘鍏ュ彛銆?
### Main銆丳reload銆両PC 涓庨」鐩敓鍛藉懆鏈?
```text
Renderer stores / UI
        鈹?        鈻?Preload allowlist + runtime Zod validation
        鈹?        鈻?Trusted-window IPC handlers
        鈹?        鈻?Main services
  ProjectService       project.json 鐨勫垱寤恒€佹墦寮€銆佽縼绉汇€佹牎楠屻€佸師瀛愪繚瀛?  AutosaveService      姣忎釜椤圭洰涓€涓仮澶嶈皟搴︿細璇?  RecoveryService      鎭㈠鏂囦欢鐨勬娴嬨€佽鍙栥€佷繚鐣欎笌娓呯悊
  Asset services       瀵煎叆銆佸厓鏁版嵁銆佺缉鐣ュ浘鍜岀敾甯冨浘鐗囪鍙?  ExportService        闅愯棌 Renderer銆佸抚鍐欑洏涓?FFmpeg/ffprobe
```

`EditorShell` 鍙瀯閫犱竴涓?`ProjectSessionController`锛岃礋璐ｆ墦寮€銆佸垏鎹€佸叧闂€乤utosave 鐢熷懡鍛ㄦ湡鍜?recovery candidate銆傛寮忎繚瀛樼敱 Renderer 鐨?`saveCurrentProject()` 涓?Main 鐨?`ProjectService` 鍏卞悓瀹屾垚锛涢」鐩繚瀛樸€佹仮澶嶅啓鍏ュ拰娓呯悊鎸夐」鐩牴鐩綍鍏变韩鍗忚皟鍣紝涓嶄娇鐢ㄧ浜屽椤圭洰 session銆?
## 鐩綍缁撴瀯

```text
src/
鈹溾攢鈹€ main/                  Electron Main銆両PC handler銆佺獥鍙ｅ拰鏂囦欢鏈嶅姟
鈹溾攢鈹€ preload/               涓荤獥鍙ｅ拰闅愯棌绐楀彛鐨勭櫧鍚嶅崟妗?鈹溾攢鈹€ export-renderer/        闅愯棌瀵煎嚭 Renderer 鍏ュ彛
鈹溾攢鈹€ renderer/
鈹?  鈹溾攢鈹€ shell/             Project Center銆丒ditorShell 鍜屼笁鏍忕紪杈戝竷灞€
鈹?  鈹溾攢鈹€ features/          canvas銆乤ssets銆乧haracters銆乻hots銆乸roperties 绛夊姛鑳?鈹?  鈹溾攢鈹€ stores/            Project銆丼hot銆丩ayer selection 绛?Renderer store
鈹?  鈹斺攢鈹€ stage/             棰勮/楠岃瘉鐢ㄨ垶鍙板叆鍙?鈹溾攢鈹€ domain/                褰撳墠姝ｅ紡 schema銆佽縼绉汇€佹湇鍔°€佹牎楠屽拰鍔ㄤ綔棰嗗煙
鈹溾攢鈹€ history/               鍛戒护鍘嗗彶涓?ProjectCommand
鈹斺攢鈹€ shared/                IPC/API 鍚堝悓銆佹覆鏌撳悎鍚屽拰鍘嗗彶 probe 鍚堝悓
tests/                     unit銆乮ntegration銆乧ontract 鍜?Electron verifier 娴嬭瘯
scripts/                   Gate銆丏ay/Issue verifier銆乫ixture 鍜屾瀯寤鸿緟鍔╄剼鏈?docs/                      鏋舵瀯銆佸紑鍙戠害鏉熴€佽璁°€乭andoff銆佽瘉鎹拰鍘嗗彶鍥炴墽
```

## 鏈湴寮€鍙?
鐜瑕佹眰锛歐indows 10/11銆丯ode.js `>=22.12.0 <25`銆乸npm 10锛堢増鏈敱 `packageManager` 瀛楁绾︽潫锛夈€傚鏋滄湰鏈哄皻鏈惎鐢?pnpm锛?
```powershell
corepack enable
corepack install
```

瀹夎渚濊禆骞跺惎鍔ㄥ紑鍙戠幆澧冿細

```powershell
pnpm install
pnpm dev
```

`pnpm dev` 浼氬惎鍔?Vite Renderer 鍜?Electron銆俉indows 璺緞銆佷腑鏂囥€佺┖鏍煎拰 Unicode 鏄甯告敮鎸佸満鏅紱澶т綋绉獙鏀舵暟鎹紭鍏堟斁鍦?`D:\PandaStage-Acceptance\` 绛変笓鐢ㄧ洰褰曘€?
## 璐ㄩ噺妫€鏌ヤ笌楠岃瘉

### 鏍稿績鍛戒护

浠ヤ笅鍛戒护鍧囨潵鑷綋鍓?`package.json`锛?
```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

Electron 鎴栦笓椤归棬绂佹寜鏀瑰姩鑼冨洿閫夋嫨褰撳墠鑴氭湰涓殑 verifier锛屼緥濡傦細

```powershell
pnpm verify:gate-a
pnpm verify:day13
pnpm verify:day16
pnpm verify:day17
pnpm verify:day18
pnpm verify:day19
pnpm verify:day20
pnpm verify:day21
pnpm verify:day22
pnpm verify:day23
pnpm verify:day24
pnpm verify:issue76
pnpm verify:issue109-resource-workspace
pnpm verify:issue125
```

楠岃瘉閫夋嫨鍘熷垯锛?
- Markdown-only 鏀瑰姩鑷冲皯鎵ц `git diff --check`锛屾牳瀵逛粨搴撳唴鐩稿閾炬帴銆佸懡浠ゅ悕銆佽繃鏈熺姸鎬佹弿杩板拰鎺堟潈鏂囦欢鑼冨洿锛涗笉鍥犱负鏂囨。鏀瑰姩铏氭瀯瀹屾暣 Electron 浜哄伐楠屾敹锛?- Renderer/domain 鏀瑰姩鎵ц `typecheck`銆乣lint`銆乣test:unit`銆乣build`锛屾秹鍙婅法灞傛垨鎸佷箙鍖栨椂鍔?`test:integration`锛?- Main/Preload/IPC/autosave/recovery 鏀瑰姩鎵ц鏍稿績妫€鏌ャ€侀泦鎴愭祴璇曘€佹瀯寤哄拰鏈€鐩稿叧鐨?Electron verifier锛涢渶瑕佺湡浜洪獙鏀舵椂锛岃嚜鍔ㄥ寲缁撴灉涓嶈兘鏇夸唬 Windows Electron 杩愯锛?- 瀹屾暣浜や粯鎴?PR gate 浠ュ綋鍓?`package.json` 涓浉鍏?`verify:*` 鑴氭湰鍜?CI 涓哄噯锛屼笉闄嶄綆瀹夊叏妫€鏌ユ垨娴嬭瘯闂ㄦ鎹㈠彇閫氳繃銆?
## Electron銆両PC 涓庢暟鎹畨鍏ㄥ師鍒?
- Main window 鍜岄殣钘?Renderer 浣跨敤 `contextIsolation: true`銆乣nodeIntegration: false`銆乣sandbox: true`銆?- Renderer 涓嶇洿鎺ヨ闂?Node.js銆乣fs`銆乣path` 鎴栧瓙杩涚▼锛涙枃浠剁郴缁熷拰 FFmpeg 鑳藉姏鍙湪 Main Process銆?- Preload 鍙€氳繃鍐荤粨鐨勭櫧鍚嶅崟 API 鏆撮湶鑳藉姏锛汭PC 閫氶亾鍚嶉泦涓湪 `src/shared/ipc/channels.ts`銆?- IPC 璇锋眰鍜屽搷搴斿湪 Preload 涓?Main 涓や晶浣跨敤涓ユ牸 Zod schema 鏍￠獙锛孧ain handler 杩樹細鏍稿鍙戦€佺獥鍙ｇ殑 `webContents.id`銆?- 椤圭洰淇濆瓨浣跨敤椤圭洰 ID銆乻chema銆乺evision 鍜屽師瀛愬啓鍏ヤ繚鎶わ紱鎭㈠鏂囦欢鏄?autosave 鐨勬仮澶嶈瘉鎹紝涓嶆槸瀵?`project.json` 鐨勯潤榛樻浛浠ｃ€?- 椤圭洰鍐呯礌鏉愯矾寰勫繀椤讳繚鎸佺浉瀵硅矾寰勶紝涓嶅厑璁搁€氳繃璺緞閬嶅巻绂诲紑椤圭洰鏍圭洰褰曘€?
## 鏂囨。瀵艰埅

- [AGENTS.md](./AGENTS.md)锛歝oding agent 鐨勭ǔ瀹氬伐浣滆鍒欏拰楠岃瘉鐭╅樀銆?- [docs/architecture.md](./docs/architecture.md)锛氳繘绋嬭竟鐣屻€佹暟鎹ā鍨嬨€佹覆鏌撲笌鐢熷懡鍛ㄦ湡鐨勬灦鏋勮鏄庯紱閬囧埌鐗堟湰鍖栧巻鍙茬珷鑺傛椂浠ュ綋鍓嶄唬鐮佷负鍑嗐€?- [docs/development.md](./docs/development.md)锛氶」鐩敓鍛藉懆鏈熴€乤utosave/recovery銆佺礌鏉愬拰寮€鍙戦獙璇佺害鏉熴€?- [docs/ipc.md](./docs/ipc.md)锛欼PC 閫氶亾銆乸ayload銆佸彲淇?sender 鍜屽鍑鸿竟鐣屻€?- [package.json](./package.json)锛氬綋鍓嶅彲鐢ㄧ殑寮€鍙戙€佹祴璇曘€佹瀯寤哄拰 verifier scripts銆?- [ROADMAP.md](./ROADMAP.md)锛氫骇鍝佽寖鍥淬€佹灦鏋勫師鍒欏拰閲岀▼纰戣鍒掞紝涓嶈嚜鍔ㄨ瘉鏄庢煇闃舵宸蹭氦浠樸€?- [DAILY_PLAN.md](./DAILY_PLAN.md)锛氶€愭棩璁″垝锛岄€傚悎鏌ュ巻鍙蹭换鍔¤儗鏅紝涓嶆槸褰撳墠瀹炵幇鍏ュ彛銆?- [agent task/README.md](./agent%20task/README.md)锛氶€愭棩 Agent 宸ュ崟锛涙墽琛屽墠浠嶉渶浠ュ綋鍓?Issue/PR 鍜屼唬鐮佷负鍑嗐€?- [M3 Editor Shell design](./docs/design/m3-editor-shell-design.md)锛歁3 璁捐涓庤縼绉诲悎鍚岋紝灞炰簬璁捐/浜ゆ帴鏉愭枡锛屼笉鑳芥浛浠ｅ綋鍓嶄唬鐮佸璁°€?- [FFmpeg 鏂囨。](./docs/ffmpeg.md)锛氬獟浣撳伐鍏风殑閰嶇疆銆佹潵婧愬拰璁稿彲璇佽鏄庛€?
Issue/PR 鏄綋鍓嶄换鍔¤寖鍥村拰浜や粯鐘舵€佺殑浜嬪疄鏉ユ簮锛涙棫 handoff銆佽璁＄銆丏ay 璁″垝鍜屾祴璇曞洖鎵ф槸鏈変环鍊肩殑涓婁笅鏂囨垨璇佹嵁锛屼絾涓庡綋鍓嶄唬鐮佸啿绐佹椂涓嶈嚜鍔ㄤ紭鍏堛€?
## 鍘嗗彶楠岃瘉涓?test receipts

Day 03鈥?9 鐨?IPC銆佸叡浜垶鍙般€丄udioContext 棰勮銆侀殣钘忕獥鍙ｆ崟鑾枫€丠.264/AAC 鎺㈤拡鍥炴墽锛屼互鍙婂悗缁?Day 11鈥?4銆丮1銆丮2銆丮3 鍜?Gate A 璁板綍閮戒繚鐣欏湪 [`docs/test-receipts/`](./docs/test-receipts/) 涓€傚畠浠敤浜庤拷婧綋鏃剁殑楠岃瘉鑼冨洿銆佺幆澧冮檺鍒跺拰鍥炲綊璇佹嵁锛屼笉浠ｈ〃褰撳墠椤圭洰浠嶅浜庡搴旂殑 Day 闃舵銆?
灏ゅ叾涓嶈鎶?Day 08 鎴?Day 09 鐨勫獟浣撴帰閽堝洖鎵у綋鎴愬綋鍓嶄骇鍝佺姸鎬侊紱褰撳墠鐘舵€佸簲浠ユ湰 README 鐨勮兘鍔涙瑙堛€佸綋鍓嶆簮鐮併€乣package.json` 鍜屾椿鍔?Issue/PR 涓哄噯銆?
GitHub锛?https://github.com/Cognitive-Architect/panda-stage>

<!-- temporary CI docs-only validation -->
