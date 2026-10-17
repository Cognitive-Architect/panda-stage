# Issue #707 — Coherent Nested Character Reconstruction

Date: 2026-10-05
Status: source-derived prototype complete; acceptance blocked on independent visual evidence and maintainer review
Mother PR: #677
Primary issue: #707

## Result

The prototype reconstructs one complete, source-derived character composition from the primary FLA at the explicit Graphic state `性感修仙女-cilisucai.com/性感修仙女-cilisucai.com1@0`. It preserves the five active nested Graphic instances, their source ownership, source transforms, visibility, and existing layer/painter order. The selected nested children are all at frame 0.

The output is deterministic across two runs and the Black #703 control reproduces under the current build. **Issue #707 remains blocked for acceptance**: no independent reference image or Animate-visible evidence for the selected primary state was available, and maintainer visual review is pending. The prototype image is not itself independent evidence of visual correspondence.

## Source and selected state

- Primary source: `D:\表情合集\性感修仙女.fla`
- Expected SHA-256 before and after both runs: `91c9331b68b49fb43cf720a7acacf45ebb26142c28b9d586b7fcf69d5d8cb64f`
- Production inspection completed successfully. The FLA recovery classifier identified an archive whose EOCD central-directory size is short by 54 bytes. The existing recovery helper normalized that field in memory only; the original FLA was not written. Normalized in-memory archive SHA-256: `ceb98294790cf64a564d3ceb4ce012964859909d4a5473fd0f18e40808af018e`; strict post-normalization preflight passed.
- Selected parent: `性感修仙女-cilisucai.com/性感修仙女-cilisucai.com1@0`, 30 frames.
- Each of its five visible layers authors a held `[0,30)` span with `tweenType=none` at frame 0.
- No deeper symbol instances are active in the selected child frame 0 contexts.

| Parent layer | Source instance | Playback input | Child frame count | Selected frame | Source transform `(a,b,c,d,tx,ty)` |
| --- | --- | --- | ---: | ---: | --- |
| 4 | `性感修仙女-cilisucai.com/性感修仙女-cilisucai.com5` | Loop; no first/last frame | 1 | 0 | `(1,0,0,1,304.7,492.1)` |
| 3 | `性感修仙女-cilisucai.com/性感修仙女-cilisucai.com4` | Loop; no first/last frame | 8 | 0 | `(1,0,0,1,102.1,683.45)` |
| 2 | `性感修仙女-cilisucai.com/性感修仙女-cilisucai.com3` | Loop; no first/last frame | 1148 | 0 | `(1,0,0,1,249.4,735.2)` |
| 1 | `性感修仙女-cilisucai.com/性感修仙女-cilisucai.com2` | Loop; no first/last frame | 7 | 0 | `(1,0,0,1,395.95,682.4)` |
| 0 | `性感修仙女-cilisucai.com/性感修仙女-cilisucai.com6` | Loop; no first/last frame | 2 | 0 | `(1,0,0,1,252.1,228.75)` |

The detailed receipt records each adapter source address (`root @0 / layer-N-frame-0 / element 0`), child library identity, selected frame, and source transform. No manual frame choice or alignment was applied. The existing display-list resolver and vector/SVG builder perform composition; the existing adapter/painter-order behavior is unchanged.

## Timing and transform classification

The implementation is a bounded internal prototype. “Proven” below applies only to the named evidence boundary, not to general Animate playback.

| Semantic | Classification | Evidence and boundary |
| --- | --- | --- |
| Default Loop, omitted first/last frame, containing span starts at 0, no wrap | **PROVEN** | #703 tested the parent-span-relative rule on Black parent frames 0, 6, and 7; current primary selection is at parent frame 0/span start 0, so each selected child is frame 0. The primary render uses only this boundary. |
| Single Frame with an explicit `firstFrame` | **UNKNOWN for Issue #707 acceptance** | The prototype maps the authored attribute to a child frame and unit tests cover per-instance selection. Such attributes occur in other primary-source states, but they are not used in the chosen render and have no independent Animate/reference confirmation in this evidence set. Do not treat the branch as graduated product support. |
| Loop with nonzero containing-span origin | **UNKNOWN; fail-closed** | The primary file has a `com3@4` path into nested `com8`, but #703 does not establish nonzero-origin behavior. The selector rejects it. |
| Loop wrap, explicit Loop bounds, Play Once, missing/unknown playback mode | **UNSUPPORTED; fail-closed** | No source-backed acceptance evidence was collected for these cases. The selector rejects them rather than guessing. |
| Tween-interior state | **UNSUPPORTED; fail-closed** | This slice selects authored frame starts only. No tween interpolation was added. |
| MovieClip, Button, or ActionScript behavior | **UNSUPPORTED** | No independent runtime or script execution was added. |
| Identity and translation in the five selected nested matrices | **PROVEN for this state** | All five transforms are read from the source XFL and recorded above. The broader rotation/scale/matrix semantics were not expanded by this slice. |

Adobe's documentation describes Graphic symbol timelines as tied to their containing timeline and describes Loop, Play Once, and Single Frame controls. Those documents informed the research vocabulary; they do not by themselves graduate a semantic to supported behavior. [Adobe Animate: Elements in Animate](https://helpx.adobe.com/ph_il/animate/desktop/using/elements.html), [Adobe Learn: Types of symbols](https://www.adobe.com/learn/animate/web/types-of-symbols).

## Render evidence

Two runs used identical source bytes and arguments. Each produced 72 vector shapes, 0 bitmap instances, 5 expanded symbols, 165 resolved nodes, and a 527×1115 PNG.

| Artifact | SHA-256 | Bytes |
| --- | --- | ---: |
| SVG, both runs | `e10664bb1002b304f3ef0452ad58fa004a284c80fed555e2eff0e36ed327a817` | 1,410,403 |
| PNG, both runs | `d754bd0046c2f19c05a4f9a826b4a1b374c5b727c2e70516ae98012070f20e1a` | 421,460 |
| Completion receipt, both runs | `8a80c758d1a2b1c1105f5ee009c6b4927d2d25702e933b1a9aa7d43116b4ffb5` | 5,763 |

External artifacts:

- `D:\PandaStage-Acceptance\issue707-coherent-character-20261005\run-2\coherent-character.svg`
- `D:\PandaStage-Acceptance\issue707-coherent-character-20261005\run-2\coherent-character.png`
- `D:\PandaStage-Acceptance\issue707-coherent-character-20261005\run-2\completion-receipt.json`
- Equivalent byte-identical files are in `D:\PandaStage-Acceptance\issue707-coherent-character-20261005\run-3\`.

The output reads as one complete character composition in an agent visual inspection. The face is blank in the source-derived render. This inspection does not establish correspondence to the intended Animate state or replace maintainer review.

## Black positive control

The existing #703 prototype was rerun using the current build and a new external output directory. The source FLA, normalized archive input, and reference hashes matched the recorded #702/#703 values before and after the run.

| Black parent frame | Nested selection | SVG SHA-256 | PNG SHA-256 | Repeat render |
| ---: | --- | --- | --- | --- |
| 0 | `补间 1@0 / 补间 2@0 / 补间 3@0` | `f78ff2af1894f595a5d3ba5844b9e9603d3e515bcba4e89713f7d7eb41a4afff` | `a049f7554b33a645398d981394e6c11fcff183197c512d7ebab3c4f3015b0900` | identical |
| 6 | `补间 1@0 / 补间 2@6 / 补间 3@0` | `fa52b27026dbe5b0bb4066fc73d2c31ab6b794e13fc248d05567d974037d1a5f` | `5bc7c406ba126fb6e503978caccee1e28d27032905458cd09989d0d8e87067df` | identical |
| 7 | `补间 1@0 / 补间 2@7 / 补间 3@0` | `e2a532e2fd78f5d056777b7f221e54923f6966c16b6780f84f2a48517342605e` | `09ec439047388fe48ba95fe83041f0e48a333e6e1e4f05d81ee1af49c29527be` | identical |

Receipt and derived SVG/PNG outputs are under `D:\PandaStage-Acceptance\issue707-black-control-20261005\`. The repeated hashes match the accepted #703 receipt. Black maintainer visual acceptance remains governed by #703/#705.

## Scope and safety

- Source FLA mutation: **NO**.
- Project mutation: **NONE**; the runner inspected the FLA and did not call a project commit API.
- Manual alignment or frame selection: **NO**.
- Tween interpolation, MovieClip runtime, ActionScript execution: **NO**.
- Product UI, persisted Character schema, Action/Pose model: **NO**.
- #698 geometry and #700 painter-order implementation: unchanged.
- Main/Preload parsing and hidden rasterization ran through the existing production services. The raster window retained `sandbox=true`, `contextIsolation=true`, `nodeIntegration=false`.

## Required completion receipt

```text
Issue: #707 Stage B5-A Coherent Nested Character Reconstruction
parents: #696 / #701
evidence: #703 / #706
mother PR: #677 (existing draft; no new PR)

primary fixture: D:\表情合集\性感修仙女.fla
source hash before/after: 91c9331b68b49fb43cf720a7acacf45ebb26142c28b9d586b7fcf69d5d8cb64f / unchanged
reference / Animate evidence: unavailable for this selected state; independent evidence required

selected authored state: 性感修仙女-cilisucai.com/性感修仙女-cilisucai.com1@0
source address: root Graphic frame 0; five active instances at layer indices 4, 3, 2, 1, 0
parent/nested hierarchy: parent Graphic -> com5, com4, com3, com2, com6 -> authored child frame 0

nested timing modes encountered: five default Loop instances; no firstFrame/lastFrame
proven timing semantics: zero-origin, no-wrap default Loop; selected child frame 0
unsupported/unknown timing semantics: nonzero Loop origin UNKNOWN; wrap, bounds, Play Once, tween interior, MovieClip/AS UNSUPPORTED/fail-closed; Single Frame not graduated

instance transforms encountered: source-authored identity matrices plus translations, recorded above
proven transform semantics: source-authored transforms for this selected composition
unsupported/unknown transform semantics: no broader transform semantics claimed

Black control: #703 frames 0/6/7 reproduced; source/reference unchanged; repeated SVG/PNG hashes identical
primary fixture SVG: e10664bb1002b304f3ef0452ad58fa004a284c80fed555e2eff0e36ed327a817
primary fixture PNG: d754bd0046c2f19c05a4f9a826b4a1b374c5b727c2e70516ae98012070f20e1a
determinism: PASS across two identical runs
human visual: PENDING maintainer review; independent target evidence missing

source mutation: NO
manual repair: NO
tween interpolation added: NO
MovieClip runtime added: NO
script execution added: NO

result: BLOCKED for Issue acceptance; coherent source-derived prototype output exists
exact gap: independent reference or Animate-visible evidence and maintainer visual PASS
next single action: maintainer reviews the run-2 PNG against an approved reference/Animate state
```

## Reproduction

Run from the repository root after building. Choose a new external output directory for each run; the runner refuses repository-local output and protects existing artifacts from overwrite.

```powershell
pnpm build
pnpm exec electron scripts/research/issue707-coherent-nested-character.cjs `
  --source 'D:\表情合集\性感修仙女.fla' `
  --expected-sha256 91c9331b68b49fb43cf720a7acacf45ebb26142c28b9d586b7fcf69d5d8cb64f `
  --root-symbol-name '性感修仙女-cilisucai.com/性感修仙女-cilisucai.com1' `
  --root-frame-index 0 `
  --out 'D:\PandaStage-Acceptance\issue707-coherent-character-20261005\run-4'
```

The current Black control was reproduced with:

```powershell
pnpm exec electron scripts/research/issue703-nested-graphic-sync-prototype.cjs `
  --source 'D:\表情合集\黑衣修仙男.fla' `
  --archive 'D:\PandaStage-Acceptance\issue702-black-census-20261004\normalized-source.fla' `
  --reference 'D:\PandaStage-Acceptance\issue702-black-census-20261004\reference.jpg' `
  --out 'D:\PandaStage-Acceptance\issue707-black-control-20261005'
```

## Next action

Keep PR #677 in draft. A maintainer should review the primary output against an approved independent reference or Animate-visible state and record PASS/FAIL. Do not start B5-B or close Issue #707 before that acceptance.
