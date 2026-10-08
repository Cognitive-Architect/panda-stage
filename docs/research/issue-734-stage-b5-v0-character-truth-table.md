# Issue #734 — Stage B5-V0 Static Character Truth Table

**Result:** research-only V0 complete at baseline `93fe7fac21c6c0872eb92efba079c81abf611116`.

## Outcome

```text
CHARACTER CORPUS: 11
S1 COMPLETE_STATIC_CHARACTER: 5
S2 COMPLETE_ENGINE_OUTPUT_PRODUCT_IDENTITY_GAP: 0
S3 PARTIAL_CHARACTER_RENDER: 0
S4 FRAGMENT_ONLY: 0
S5 BLOCKED: 5
S6 REVIEW_PENDING: 1
```

The five S1 controls are 黑袍大师兄, 红伞蝶衣, 蓝白古装男, 修仙大长老, and 修仙宗门圣女. 蓝发修仙女 has a plausible rendered Scene candidate but remains S6 because large red source-authored shapes make visual intent unclear without a reference. 汉服修仙女, 魔修, 浅蓝修仙女, 青绫修仙女, and 修仙男 have no source-proven complete candidate through the current production renderer; each has an exact root/Scene blocker. Three of those also have renderable fragments, which are retained as diagnostic evidence and are not counted as characters.

## Method and limits

Each FLA was read through the existing inspect, bounded catalog, Scene/root discovery, production display-list, SVG builder, and sandbox PNG preview paths. The scan considered Scene frame 0, direct Scene-root Graphics, and authored states of near-root nested Graphics; a generic Graphic contact sheet did not determine any status. Static evidence is source-derived; no frame was chosen only because it was frame 0.

The scan produced 254 candidate-state records across the 11 FLAs. Candidate records and full composition counts are preserved in each per-file `static-truth-probe.json` under the external evidence directory listed below. The batch index's candidate-count field was incomplete, so this report uses the 11 per-file receipts as the source of truth.

For S1/S6 decisions, the PNGs and prioritized contact sheets were visually inspected. S1 means the selected production output shows one coherent, recognizable character composition. It does not claim maintainer acceptance against an external reference. The S6 output needs human judgment about whether its large red shapes are intended artwork or an output defect.

## Per-file truth table

The source hash is repeated in the integrity table below. Every row here identifies the Scene/root evidence, the best complete candidate or explicit `none`, catalog status, V0 result, blocker, composition, view evidence, and review artifact.

### 01 — 汉服修仙女.fla — S5 BLOCKED

- **Source/roots:** 1 Scene, 10 timelines, 51 frames, 9 Graphics; one visible Scene root `修仙女-cilisucai.com/修仙女-cilisucai.com1`, exposed in the 10-target catalog. Fifteen Scene/root/nested authored candidate states were examined.
- **Best complete candidate:** none. Scene frame 0 and the root Graphic frame 0 are the strongest source compositions; both stop before SVG output. The 12 authored frames of a near-root nested Graphic were also checked.
- **First blocker / family A:** `Shape fla-shape-9420f0fcb052d77956ea920f FillStyle 1 has an open fill boundary` on the Scene and direct root. No fill repair was attempted. A lower candidate also reports unsupported horizontal stroke scale mode, after the stronger root candidate is already blocked.
- **Composition/views:** no display-list composition was emitted for the blocked candidates; 9 source Graphics are present. No coherent view was rendered.
- **Artifacts:** no candidate SVG/PNG and no review sheet; the exact blocker and source hierarchy are in `character-01/static-truth-probe.json`.

### 02 — 黑袍大师兄（四视角）.fla — S1 COMPLETE_STATIC_CHARACTER

- **Source/roots:** 1 Scene, 13 timelines, 62 frames, 12 Graphics; the Scene references three catalog-exposed roots. Twenty-seven candidate states were examined.
- **Selected state:** catalog-exposed Graphic `大师兄-cilisucai.com1`, authored frame 0, candidate `C734-85AF59526B7E24D43637D3A0`. Its five authored symbol placements resolve into a full black-robed figure with head, body, limbs, and outfit detail; this is a single complete character candidate.
- **Composition/output:** 97 resolved nodes, 44 vector shapes, 5 expanded nested symbols, 0 bitmap instances. SVG `renders/C734-85AF59526B7E24D43637D3A0.svg` SHA-256 `dca50e894a72572086c29fcb45e825942c00be4676346041f5b5c690e430923c`; PNG `renders/C734-85AF59526B7E24D43637D3A0.png` SHA-256 `92783f6fb5d7a8803769443f3b2a1bc44b3aaab4df7a073e2e5ac7e4c23c607d` (438×958). Independent repeat matched both hashes.
- **Multi-view/review:** the authored Scene output shows three complete character views. The prioritized review sheet is `character-02/review-sheet-01.png` (SHA-256 `6d2f70c9f296f29b4e5d819dac370f9f2e9838dfc321493a41d19c3c967be23d`). The filename's fourth view is not claimed as verified.

### 03 — 红伞蝶衣（四视角）.fla — S1 COMPLETE_STATIC_CHARACTER

- **Source/roots:** 1 Scene, 11 timelines, 29 frames, 10 Graphics; 11 Scene root placements were traversed, including one catalog identity gap (`元件 12`). Seventeen candidates were examined.
- **Selected state:** catalog-exposed near-root Graphic `修仙女-cilisucai.com1/元件 2`, authored frame 0, candidate `C734-E5AAE552C028340C8C18F0BE`. The production output contains one coherent umbrella-woman composition with body, head, clothing, and umbrella accessory.
- **Composition/output:** 99 resolved nodes, 48 vector shapes, 2 expanded nested symbols, 0 bitmap instances. SVG `renders/C734-E5AAE552C028340C8C18F0BE.svg` SHA-256 `364360d5e03ff2cef497159f8e73b10e6b0d13a6f40f353f4f7dc9283dd86abc`; PNG `renders/C734-E5AAE552C028340C8C18F0BE.png` SHA-256 `8ea1f57ef152081cc135f57409468fd668babe55c5b8d7783f417cc9f10dc393` (708×988). Independent repeat matched both hashes.
- **Views/blocker/review:** the Scene candidate itself stops at open FillStyle 1, but the selected root candidate renders completely; this is not a file-level blocker. Other rendered roots are fragments. The four-view filename does not prove four complete views. Review sheet: `character-03/review-sheet-01.png` (SHA-256 `3b36c02aea905892ace36c859f2efbf6fb1ded6da21f462eff61d5b24584fe1b`).

### 04 — 蓝白古装男.fla — S1 COMPLETE_STATIC_CHARACTER

- **Source/roots:** 1 Scene, 13 timelines, 49 frames, 12 Graphics; one catalog-exposed root `蓝衣修士-cilisucai.com/蓝衣修士-cilisucai.com1`. Twenty-four candidates were examined.
- **Selected state:** root Graphic frame 0, candidate `C734-60D88285064C3789BE7CBF20`. Its five symbol placements produce one coherent full-body character with head, clothing, arms, and legs.
- **Composition/output:** 78 resolved nodes, 35 vector shapes, 5 expanded nested symbols, 0 bitmap instances. SVG `renders/C734-60D88285064C3789BE7CBF20.svg` SHA-256 `ca84102177179e4f96eb2f4369aca0b86507966885636b4bbdd68d4360c35940`; PNG `renders/C734-60D88285064C3789BE7CBF20.png` SHA-256 `0baf01e46b240a44b131a8e91e919eca0c29c32e1ea8a31efb51634e8dca14f4` (349×994). Independent repeat matched both hashes.
- **Views/review:** one complete root view is established. Review sheet: `character-04/review-sheet-01.png` (SHA-256 `4f66fa1cf17d43b35ac3ae1f78d2c7db6a9899467f784f599d1969d3357d2a2e`).

### 05 — 蓝发修仙女.fla — S6 REVIEW_PENDING

- **Source/roots:** 1 Scene, 690 timelines, 2,749 frames, 689 Graphics. The bounded catalog contains 64 targets. Source Scene frame 0 references `神女-cilisucai.com/神女-cilisucai.com809`, which has no catalog target; 14 Scene/root/nested candidates were examined.
- **Best available candidate:** exposed Scene frame 0, candidate `C734-5964612EA45272BB4EAF6F8F`. The 1,095-node output includes a recognizable full-body character composition, 711 vector shapes, 204 expanded nested symbols, and 100 bitmap instances. The source SVG contains large `#FF0000` rectangles over portions of the figure. Their authored presence is verifiable, but their intended visual role cannot be determined from this corpus alone.
- **Catalog/output/repeat:** the Scene is exposed and renders; the referenced root Graphic is not. There is no renderer exception; the first unresolved decision is whether the source-authored red shapes are intended. SVG `renders/C734-5964612EA45272BB4EAF6F8F.svg` SHA-256 `9e56103b600e1b58eae1a9bd5ad634af0e74a7940c6b9fe5fddb22ea471ea6e1`; PNG `renders/C734-5964612EA45272BB4EAF6F8F.png` SHA-256 `abb55f39cf063ec5008ac4d6b511b6bda822effa8a8cbe272c5a31cabbf6342a` (1280×720). Independent repeat matched both hashes.
- **Family C/review:** catalog/root exposure is confirmed, but S2 is not justified because the root itself is not shown to produce a coherent output and the Scene has unresolved red shapes. Human review sheet: `character-05/review-sheet-01.png` (SHA-256 `e6ce437515ccf964847a42065185471765c4117bbea3ea1501268d9e166fd68d`). No separate candidate/composition identity-only failure was proven.

### 06 — 魔修.fla — S5 BLOCKED

- **Source/roots:** 1 Scene, 39 timelines, 184 frames, 38 Graphics; its Scene root is catalog exposed. Twenty-six candidates were examined.
- **Best complete candidate:** none. The Scene and root Graphic frame 0 are the strongest compositions and stop on the same unsupported stroke semantics. A separately renderable `魔修-cilisucai.com/魔修-cilisucai.com2` frame 0 is a hair-only fragment.
- **First blocker / family B:** `Shape fla-shape-a3aacadd5f397144144d6bcb StrokeStyle 2 has unsupported linear stroke fill; P2-C03 supports normal SolidStroke semantics only` (Scene and root). Other lower candidates also encounter open fills; the root-level linear-stroke failure is first for the complete composition.
- **Fragment evidence:** the hair-only fragment has 9 resolved nodes, 4 vector shapes, 0 expanded nested symbols, and 0 bitmap instances. Its PNG is `renders/C734-25E823B6A805D71E9CFF26B7.png` (SHA-256 `f466f0008d350b3c39fcb364e4a11abfe94e2e3ecaba2b3e63abddb815381adc`); SVG SHA-256 `8166c4ad612d1da728aa58d90bc2555b4095394c5d9e39e281bb43d4b239a310`.
- **Review:** diagnostic-only sheet `character-06/review-supplement/diagnostic-review-sheet.png` (SHA-256 `2f59af9ed17454655b780f423db27bf378ef03c3bb804ff77ab2d76713f960ab`). The fragment is not classified as a character.

### 07 — 浅蓝修仙女.fla — S5 BLOCKED

- **Source/roots:** 1 Scene, 9 timelines, 36 frames, 8 Graphics; the visible Scene root is catalog exposed. Twenty-four candidates were examined; one leaf-like near-root item was kept in source evidence but omitted from the prioritized sheet because it has only two shapes and no nested Graphic.
- **Best complete candidate:** none. The Scene/root frame 0 is the strongest candidate and is blocked. Twenty-one lower states render, but reviewed outputs are isolated sleeve, torso/dress, and back-hair parts; none composes the head and body into a defensible complete character.
- **First blocker / family B:** `Shape fla-shape-003835638464417fb5cb0346 StrokeStyle 3 has unsupported linear stroke fill; P2-C03 supports normal SolidStroke semantics only` on the Scene and root.
- **Composition/views/review:** the renderer reaches multiple vector fragments, but no complete candidate; no bitmap-based assembly was performed. Representative near-root candidate `C734-D339CB3C5454A13D58931D62` at frame 1 has 88 resolved nodes, 66 vector shapes, 0 expanded nested symbols, and 0 bitmaps; its PNG SHA-256 is `5f117b1a894a90f344c033f4d89d9c67fb1340a07c150a31a092f9a6e5074df2` and SVG SHA-256 is `4e5f2794a9a5e9059dc211d7bd339e4d4b57e684b2b4b8daccd3407137a1a7f6`. Diagnostic sheet: `character-07/review-supplement/diagnostic-review-sheet.png` (SHA-256 `5f11e6d15769dd5dfa3d31d25b8af43181a847da9a6a7a755b69214b1b41e50d`).

### 08 — 青绫修仙女（四视角）.fla — S5 BLOCKED

- **Source/roots:** 1 Scene, 24 timelines, 91 frames, 23 Graphics; 10 visible Scene root placements are catalog exposed. Forty-nine Scene/root/nested authored states were examined.
- **Best complete candidate:** none. The Scene and every inspected root/near-root candidate stop before a reviewable SVG/PNG. Two distinct large root compositions are visible in source, but neither can be visually classified through the current production renderer.
- **First blocker / family A:** `Shape fla-shape-944dedeb2bb14b160532f675 FillStyle 1 has an open fill boundary` on Scene frame 0; inspected root candidates also stop on open FillStyle boundaries. No endpoint snapping, epsilon closure, connector, or geometry invention was used.
- **Composition/views/review:** no renderable composition or complete multi-view evidence. No review sheet can be generated from a renderer output; receipts retain the source roots and exact blockers at `character-08/static-truth-probe.json`.

### 09 — 修仙大长老（三视角）.fla — S1 COMPLETE_STATIC_CHARACTER

- **Source/roots:** 1 Scene, 14 timelines, 50 frames, 13 Graphics; two catalog-exposed Scene roots (`老者-cilisucai.com2` and `元件 1`). Fifteen candidates were examined.
- **Selected state:** root Graphic `老者-cilisucai.com2`, frame 0, candidate `C734-C593CFAD4DB6C1FA7130EDF4`, renders one complete elder figure.
- **Composition/output:** 113 resolved nodes, 55 vector shapes, 3 expanded nested symbols, 0 bitmap instances. SVG `renders/C734-C593CFAD4DB6C1FA7130EDF4.svg` SHA-256 `0528493e1e125b44c07be6ae62dbf50df5e5506bcba71f1026055435e3ebd31e`; PNG `renders/C734-C593CFAD4DB6C1FA7130EDF4.png` SHA-256 `aa321e2f1ab67cfa54c1f67fd46c8d512bdd53a1842ba6c5a9c2572442517fc4` (484×816). Independent repeat matched both hashes.
- **Views/review:** the Scene output contains two complete elder figures. The third view implied by the filename is not established. Review sheet: `character-09/review-sheet-01.png` (SHA-256 `6e0feae6c303885d09d0a04d10fc26afa3106a5c134f4e76aeb65780897e19fc`).

### 10 — 修仙男.fla — S5 BLOCKED

- **Source/roots:** 1 Scene, 13 timelines, 65 frames, 12 Graphics; one catalog-exposed visible root. Twenty-five candidates were examined.
- **Best complete candidate:** none. Scene and root frame 0 are blocked. A near-root Graphic `白发修仙男-cilisucai.com/白发修仙男-cilisucai.com4` frame 5 renders a head/hair accessory fragment only.
- **First blocker / family A:** `Shape fla-shape-196ba2d2358441409a8b4dce FillStyle 1 has an open fill boundary` on the Scene and root. The near-root fragment does not supersede the blocked character composition.
- **Fragment/review:** the frame-5 fragment has 8 resolved nodes, 4 vector shapes, 0 expanded nested symbols, and 0 bitmap instances. PNG `renders/C734-B80E43A08F66FD1AE376745A.png` SHA-256 `619993c4621e7f579cd2bd01597b37d405643e4187065b86c8703347427e8b81`; SVG SHA-256 `3e7a345bf27c5e4964148a2d6fe134ddfc90100b9486e9195109f0d22fe247b2`. Diagnostic sheet: `character-10/review-supplement/diagnostic-review-sheet.png` (SHA-256 `9c7dd406225921fb697741c7bfaf6755c49ed8d735808595e3936ea45247cfc7`).

### 11 — 修仙宗门圣女（四视角）.fla — S1 COMPLETE_STATIC_CHARACTER

- **Source/roots:** 1 Scene, 15 timelines, 62 frames, 14 Graphics; two catalog-exposed Scene roots. Eighteen candidates were examined.
- **Selected state:** root Graphic `修仙女-cilisucai.com/修仙女-cilisucai.com1`, frame 0, candidate `C734-95840C6ABA241C1D5805F2F3`, renders one complete female character.
- **Composition/output:** 424 resolved nodes, 186 vector shapes, 5 expanded nested symbols, 0 bitmap instances. SVG `renders/C734-95840C6ABA241C1D5805F2F3.svg` SHA-256 `a0675d586a1848c9d63f886672313b07618caa3361ce70f2ef0aa1a1935483f5`; PNG `renders/C734-95840C6ABA241C1D5805F2F3.png` SHA-256 `3828dbe9056dc071240e57f7a350c94fa073dc82c8ef1a7c3bc34ea26b7db076` (678×963). Independent repeat matched both hashes.
- **Views/review:** the Scene shows three complete female views; the other selected root is a hair fragment. The four-view filename is not treated as proof of four complete views. Review sheet: `character-11/review-sheet-01.png` (SHA-256 `3aed1874b4131a01cbe40d5a3133ad9e7d0e1a7de04de950a984a9a461a76606`).

## Source integrity

All hashes below are the frozen #732 controls. The per-file receipts record identical before/after hashes for all 11 source files.

| FLA | SHA-256 before = after | Unchanged |
| --- | --- | --- |
| 汉服修仙女.fla | `6af14990029d4ced2c4e305721321835180c1bf041178a8799e1d14a1f62e535` | YES |
| 黑袍大师兄（四视角）.fla | `3ae497bf13e1af8fdfb755cf70cf16d3e94176ea463d5621ae011c83dec53456` | YES |
| 红伞蝶衣（四视角）.fla | `76c8b1ceb22e427a43d2b6b39502316208dd34fec3b1786b3063640386852781` | YES |
| 蓝白古装男.fla | `0d4aecbc159990ce54b9d0d8c31ea0f3354cd7ed86df77bac19a562dfc761fa2` | YES |
| 蓝发修仙女.fla | `86eb123fdd42f1dac80754c9260b793404072be70523b41d012598138c35c6d2` | YES |
| 魔修.fla | `c16792991c9704b6b29b8798c8e1030bf868963b51c6f0e9018113a4b641aa79` | YES |
| 浅蓝修仙女.fla | `050e222cd536b28ed07466c77a87f0dbabf66eaa993be25d803ef12bee3a55b1` | YES |
| 青绫修仙女（四视角）.fla | `d0958d4432decbf6c54566ba15a2f5e97bd88c82d75dcb2f84603e9b2273f0e4` | YES |
| 修仙大长老（三视角）.fla | `78e4c1106114eb8f153ddefe64418a0023b018a414f6a9ad603e15b0cae49472` | YES |
| 修仙男.fla | `565c5609a7610ef64ed9f98b09d98dd82d5a45255adb4d3d410a5a365e0ef4a5` | YES |
| 修仙宗门圣女（四视角）.fla | `c2c1a41dfb58eb7b4998cb7e4f35d56a34e39a11777442121ca5c7340605e18d` | YES |

## Blocker families and V1 decision

- **A — Open fill:** 汉服修仙女, 青绫修仙女, 修仙男. 红伞蝶衣's Scene also stops on open fill, while a separate catalog-exposed root renders a complete umbrella character. #693 remains authoritative: no endpoint snapping, epsilon closure, synthetic connector, or guessed geometry.
- **B — Linear stroke fill:** 魔修 and 浅蓝修仙女. Both strongest complete compositions stop at unsupported `linear stroke fill`; each is a distinct source FLA and the exact C03 boundary is repeated at Scene/root level.
- **C — Catalog/root exposure:** 蓝发修仙女. The Scene root Graphic is absent from the 64-target catalog, while the Scene itself is exposed and renders. The output still needs human visual judgment.
- **D — Candidate/composition identity:** no independent D-only failure was established. Cases either expose a complete root, stop on renderer semantics, or are the C catalog/root case above.
- **E — New family:** none.

**Multi-view evidence:** coherent authored Scene groupings were observed for 黑袍大师兄 (3 complete views), 修仙大长老 (2 complete figures), and 修仙宗门圣女 (3 complete views). No fourth view is claimed for files whose names imply four views. The remaining titles/states do not establish a complete multi-view set.

**Largest renderer gap:** open-fill cases still fail closed under the accepted #693 disposition; the distinct repeated linear-stroke blocker is localized in two complete character compositions.

**Largest candidate/product gap:** the missing catalog entry for 蓝发修仙女's referenced root. The Scene render provides a candidate output but cannot resolve whether the red source shapes are intended.

**V1 readiness: GO for a focused, bounded linear-stroke research Issue.** Two independent character files hit the same precise production semantic boundary at their strongest compositions. This justifies a research contract to inspect the authored linear stroke semantics and define a bounded support/no-support decision. It does not authorize renderer implementation inside #734. Open-fill implementation remains NO-GO under #693.

## Required output summary

- **Complete character candidates:** 黑袍大师兄 `C734-85AF59526B7E24D43637D3A0`; 红伞蝶衣 `C734-E5AAE552C028340C8C18F0BE`; 蓝白古装男 `C734-60D88285064C3789BE7CBF20`; 修仙大长老 `C734-C593CFAD4DB6C1FA7130EDF4`; 修仙宗门圣女 `C734-95840C6ABA241C1D5805F2F3`. 蓝发修仙女 `C734-5964612EA45272BB4EAF6F8F` is a separate S6 review candidate.
- **Fragment-only outputs:** 魔修 (hair fragment), 浅蓝修仙女 (21 lower-state fragments), and 修仙男 (frame-5 head/hair accessory fragment). None is promoted to a complete character.
- **First-blocker families:** A open-fill — 汉服修仙女, 青绫修仙女, 修仙男, plus 红伞蝶衣's blocked Scene alternative; B linear stroke — 魔修 and 浅蓝修仙女; C catalog/root exposure — 蓝发修仙女; D candidate/composition identity — none independently proven; E new family — none.
- **Multi-view files with coherent authored grouping:** 黑袍大师兄 (3 complete views), 修仙大长老 (2 complete figures), 修仙宗门圣女 (3 complete views).
- **Current biggest renderer gap:** unsupported open-fill boundaries remain fail-closed under #693; the shared linear-stroke blocker is the next bounded research target.
- **Current biggest candidate/product gap:** 蓝发修仙女's referenced root is absent from the 64-target catalog while its exposed Scene has unresolved red source shapes.
- **V1 readiness:** GO — bounded linear-stroke research justified; tracked in #735.
- **Production changes:** 0.

## Evidence and delivery receipt

- Production evidence directory: `D:\PandaStage-Acceptance\issue734-character-static-20261008-v1\`
- Independent repeat directory: `D:\PandaStage-Acceptance\issue734-character-static-repeats-20261008-v1\`
- Per-file receipts: `<evidence directory>\character-01\static-truth-probe.json` through `<evidence directory>\character-11\static-truth-probe.json`.
- Six independently repeated candidates: five S1 candidates plus the S6 blue-hair Scene candidate; all six reproduced exact SVG and PNG hashes.
- `production files changed: NO`
- `source FLA mutation: NO`
- `manual character assembly: NO`
- `invented geometry: NO`
- `Full CI manually triggered: NO`
- `pnpm verify:project: NO`
- `PR #677 remains Draft/open: YES`
- `New PR opened: NO`

**Next single action:** completed — opened [Issue #735](https://github.com/Cognitive-Architect/panda-stage/issues/735) for bounded, research-only linear-stroke semantics. No implementation is authorized by that Issue.
