# Issue #735 — Bounded Linear Stroke Research

**Date:** 2026-10-08

**Scope:** Research only. No production, renderer, source FLA, fill-topology, or geometry changes were made.

## Decision

**NO-GO for an implementation slice that claims faithful support for both selected shapes.** Adobe's authoring API confirms that a solid stroke can carry a gradient fill, so the current Panda Stage boundary is narrower than Animate's authoring model. However, the two frozen FLA records do not provide enough source-proven information to resolve their complete stroke appearance without relying on undocumented defaults or assumptions:

- `魔修.fla` explicitly marks its `SolidStroke` as `solidStyle="hairline"` while also recording `weight="0.05"`. Adobe documents Hairline and Solid as distinct stroke styles, but the consulted primary sources do not define how this exact XFL record combines those fields or how its weight affects the rendered hairline.
- `浅蓝修仙女.fla` omits `solidStyle`, caps, joins, miter limit, and pixel hinting. Adobe's API exposes these as separate stroke properties, but the consulted sources do not define the XFL meaning of these omitted attributes for these records.
- Both records omit gradient spread/interpolation attributes and per-stop alpha. Their raw matrices also omit `b` and `c`. Adobe documents the relevant gradient concepts, but the primary evidence found does not map these omitted XFL fields to defaults for the exact source records.

A later bounded implementation could support `SolidStroke` with `LinearGradient` paint only after the ordinary-solid versus hairline mapping and every required omitted-field behavior are established. It should require `scaleMode="normal"`, reject hairline and unsupported/unknown stroke variants, and keep unknown attributes fail-closed. Neither selected fixture is ready for that contract today: the Magic record is explicitly hairline, and the Blue Lady record still depends on unresolved omitted-field semantics. No filename-based behavior is justified.

## Frozen source records

Both original archives were read-only throughout inspection. Their SHA-256 values matched the frozen values in Issue #735 after inspection.

| Source | Original SHA-256 | Production in-memory recovery | Normalized archive SHA-256 |
| --- | --- | --- | --- |
| `D:\表情合集\新人物\魔修.fla` | `c16792991c9704b6b29b8798c8e1030bf868963b51c6f0e9018113a4b641aa79` | `RECOVERY_CANDIDATE`, `EOCD.centralDirectorySize`, delta `54`; bytes not written | `c81234a7508a2cb05bc4f7a0bcdcb6b9eb46b0f9b8713887ef60c9506137d5c2` |
| `D:\表情合集\新人物\浅蓝修仙女.fla` | `050e222cd536b28ed07466c77a87f0dbabf66eaa993be25d803ef12bee3a55b1` | `RECOVERY_CANDIDATE`, `EOCD.centralDirectorySize`, delta `54`; bytes not written | `e4d4211299343c5d84abe8b18c3ca532418236af7941d13944fb2a3bcacca0da` |

The recovered library XML was inspected through the existing production XFL adapter's `shapeBlocks` extraction. The following source addresses and XML-block hashes identify the exact selected shapes:

| Source | Library XML entry | Symbol / frame / source path | Shape ID | `StrokeStyle` | Referencing edges | Shape-block SHA-256 |
| --- | --- | --- | --- | --- | ---: | --- |
| `魔修.fla` | `LIBRARY/魔修-cilisucai.com/魔修-cilisucai.com4.xml` | `graphic:魔修-cilisucai.com/魔修-cilisucai.com4/layer-0-frame-0/0/0/0/0` | `fla-shape-a3aacadd5f397144144d6bcb` | `2` | 2 | `123832601a57dd059e9e99adf44a5e219417a8d0bcd112da6d7717c7d683c555` |
| `浅蓝修仙女.fla` | `LIBRARY/修仙女-cilisucai.com/修仙女-cilisucai.com3.xml` | `graphic:修仙女-cilisucai.com/修仙女-cilisucai.com3/layer-0-frame-0/0/8/0` | `fla-shape-003835638464417fb5cb0346` | `3` | 1 | `8589d73f3cb3365129df72a3c97cca9434dd0460db70ab03f673dd4d7e962bf2` |

## Exact authored stroke payloads

### `魔修.fla`, shape `fla-shape-a3aacadd5f397144144d6bcb`, style 2

```xml
<StrokeStyle index="2">
  <SolidStroke scaleMode="normal" weight="0.05" solidStyle="hairline">
    <fill>
      <LinearGradient>
        <matrix><Matrix a="0.0041656494140625" d="0.0317535400390625" tx="1187.15" ty="498.5"/></matrix>
        <GradientEntry color="#A16213" ratio="0"/>
        <GradientEntry color="#E5BF6A" ratio="0.156862745098039"/>
        <GradientEntry color="#A65F1A" ratio="0.325490196078431"/>
        <GradientEntry color="#BB8D3A" ratio="0.470588235294118"/>
        <GradientEntry color="#CDAE5D" ratio="0.611764705882353"/>
        <GradientEntry color="#FBEA90" ratio="0.705882352941177"/>
        <GradientEntry color="#FFFDC9" ratio="0.831372549019608"/>
        <GradientEntry color="#8C5219" ratio="1"/>
      </LinearGradient>
    </fill>
  </SolidStroke>
</StrokeStyle>
```

Source-proven facts: the style tag is `SolidStroke`; the nested paint is `LinearGradient`; `scaleMode` is `normal`; raw `weight` is `0.05`; and the source explicitly records `solidStyle="hairline"`. There are eight ordered color stops and two edges reference this style.

### `浅蓝修仙女.fla`, shape `fla-shape-003835638464417fb5cb0346`, style 3

```xml
<StrokeStyle index="3">
  <SolidStroke scaleMode="normal" weight="0.5">
    <fill>
      <LinearGradient>
        <matrix><Matrix a="0.05517578125" d="0.067779541015625" tx="383.9" ty="249.8"/></matrix>
        <GradientEntry color="#DAF0F1" ratio="0.396078431372549"/>
        <GradientEntry color="#C7C1E0" ratio="0.72156862745098"/>
        <GradientEntry color="#DDD7F9" ratio="1"/>
      </LinearGradient>
    </fill>
  </SolidStroke>
</StrokeStyle>
```

Source-proven facts: the style tag is `SolidStroke`; the nested paint is `LinearGradient`; `scaleMode` is `normal`; raw `weight` is `0.5`; and `solidStyle` is absent. There are three ordered color stops and one edge references this style.

### Fields absent from both payloads

Neither selected `SolidStroke` records `caps`, `joints`, `miterLimit`, or `pixelHinting`. Neither gradient records `spreadMethod` or `interpolationMethod`, and none of the listed `GradientEntry` elements records `alpha`. Each gradient matrix records `a`, `d`, `tx`, and `ty`; `b` and `c` are absent. These are absences in the source XML, not proven values. In particular, this report does not assign round caps/joins, miter defaults, alpha `1`, spread `pad`, interpolation `rgb`, or zero values for missing matrix components.

## Authored transform records

The transform path was selected by the source paths above. Values below are the exact attributes present in the XFL; no missing matrix entries are filled in by this report.

| Source | Ancestor transform records, outer to inner | Shape transform record |
| --- | --- | --- |
| `魔修.fla` | Two outer `DOMGroup` nodes have no direct matrix. The innermost `DOMGroup` records `a=-1.338134765625, b=0.0411529541015625, c=0.0788116455078125, d=1.33705139160156, tx=1563.35, ty=-765.2`. | The `DOMShape` repeats the same six matrix attributes. |
| `浅蓝修仙女.fla` | The outer `DOMGroup` records `tx=-251.05, ty=-224.1`. Its nested `DOMGroup` records `tx=-515.65, ty=-277.15`. | The `DOMShape` repeats `tx=-515.65, ty=-277.15`. |

The current adapter localizes leaf matrices against their group parent; the existing grouped-matrix test asserts that a grouped child matrix is not applied twice. This describes Panda Stage's current interpretation, not an Adobe Animate visual comparison for these specific shapes. The gradient's own matrix is separately authored inside `LinearGradient`; Adobe's API describes that matrix as controlling gradient placement, orientation, and scale. Exact final gradient orientation/placement under Animate's full source transform chain remains unverified until the source files are compared in Animate.

## What Adobe's primary sources establish

- Adobe's `ISolidStrokeStyle` API exposes thickness, fill style, join, cap, scale type, and stroke hinting. It explicitly allows `GetFillStyle` to return a solid, gradient, or bitmap fill style. This establishes that a `SolidStroke` can carry gradient paint in Animate's authoring model; it does not define the omitted XFL fields in these two files. [Adobe `ISolidStrokeStyle` reference](https://helpx.adobe.com/animate/CPSDevKit/APIDocs/class_d_o_m_1_1_stroke_style_1_1_i_solid_stroke_style.html)
- Adobe's feature matrix lists `Solid` and `Hairline` as distinct stroke-style values and lists `Normal`, `Horizontal`, `Vertical`, and `None` scale values. This supports treating `solidStyle="hairline"` as a material distinction; it does not define the rendered meaning of `weight="0.05"` on that record. [Adobe `IFeatureMatrix` reference](https://helpx.adobe.com/animate/CPSDevKit/APIDocs/class_doc_type_1_1_i_feature_matrix.html)
- Adobe's gradient API exposes a transform matrix, gradient stop data, and spread mode. Adobe's current authoring guide describes linear gradients as a color change along an axis and documents stroke weight, cap, and join controls. These sources establish the concepts and available properties, not the mapping of this FLA's omitted attributes to effective values. [Adobe `IGradientFillStyle` reference](https://helpx.adobe.com/animate/CPSDevKit/APIDocs/class_d_o_m_1_1_fill_style_1_1_i_gradient_fill_style.html), [Adobe Animate stroke and gradient guide](https://helpx.adobe.com/animate/desktop/multimedia-and-video/strokes-fills-gradients.html)
- Adobe documents Hairline migration differently by output format (for example, conversion to Solid for HTML5 Canvas and fill publication for WebGL). Those are migration/export behaviors, not a source-rendering specification for these FLA records. [Adobe output-format migration table](https://helpx.adobe.com/animate/desktop/kb/unsupported-features-html5-canvas-webgl.html)

The original FLA XML is the primary evidence for the fields actually authored. The consulted Adobe API/help pages do not provide a complete XFL serialization/defaults specification for the missing attributes above.

## Current Panda Stage boundary

In `src/main/services/fla-static-snapshot-svg-builder.ts`, `parseShapeStyle` classifies a style containing `LinearGradient` as `linear`. `parseSolidStrokeStyle` currently rejects every non-`solid` style before it checks for a `SolidColor`, then requires a `SolidStroke` with `SolidColor` paint. Thus both selected styles fail closed with the existing unsupported linear stroke fill message. Linear gradients are already reconstructed for fills, but the stroke assembly path calls the solid-stroke parser.

The current C03 parser also does not inspect `solidStyle`. A positive numeric `weight` alone is therefore not evidence that `solidStyle="hairline"` has ordinary width-stroke semantics. Do not use this gap to treat the Magic record as an ordinary stroke. Existing C03 unit coverage explicitly rejects gradient strokes and non-normal scale modes in `tests/unit/fla-static-snapshot-c03-stroke.test.ts`.

## Bounded follow-up contract and fail-closed boundary

If a future Issue authorizes implementation after the unresolved semantics are settled, a defensible first subset is:

- a `SolidStroke` whose fill is one supported `LinearGradient`;
- `scaleMode="normal"`;
- an established ordinary-solid style mapping, with authored or externally proven values for width, caps, joins, miter behavior, hinting, gradient matrix components, stop alpha, spread, and interpolation;
- exact authored edge references and geometry retained unchanged.

Keep hairline, radial/bitmap stroke paint, non-normal scale modes, unknown style values, unresolved omitted-property defaults, and unsupported gradient data fail-closed. Do not infer values from either filename. Do not add endpoint snapping, fill closure, epsilon joins, synthetic connector segments, or other geometry changes; #693's open-fill boundary remains in force.

Under this contract, the Blue Lady record is only a candidate after its omitted `solidStyle` and stroke/gradient defaults are proven. The Magic record remains excluded until Adobe's hairline behavior and its interaction with the authored nonzero weight are established. Therefore, this contract does not currently cover both Issue #735 targets.

## Validation plan for a separately authorized implementation

No tests or verifiers were run for this research-only issue. A later implementation should use the existing C03 tests as the focused seam and add target-specific evidence without broadening geometry semantics:

1. Extend `tests/unit/fla-static-snapshot-c03-stroke.test.ts` with the proven gradient-stroke subset and negative controls for Hairline, unresolved omitted fields, non-normal scale, radial/bitmap paint, and malformed stops. Assert stroke paint, width, cap/join, matrix, stop data, and explicit rejection text.
2. Exercise the real two source targets through the production static-snapshot path. Record source hashes before/after, exact source addresses, edge counts, geometry identity, deterministic output hashes, and `git diff --check`.
3. Capture paired Windows Adobe Animate and Panda Stage images at the same framing for both targets. The Magic comparison must show the gold eight-stop Hairline result without changing either source edge. The Blue Lady comparison must show the three-stop gradient on its single referenced edge with the authored transform placement. Include focused crops and full-shape context; report any pixel/visual difference instead of tuning geometry to hide it.
4. Run the repository Main-service matrix after implementation: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm build`, plus a target-specific Windows Electron acceptance verifier if required by the follow-up. The current `verify:fla-v1-5-c3` and `verify:fla-v1-5-c4` scripts cover unrelated importer/recovery work and should not be presented as evidence for these stroke semantics.

The implementation must preserve #693: stroke work cannot close open fills or add guessed connectors, and no geometry may be changed to make either screenshot look closer.

## Research checks

- Frozen original source hashes matched before/after the read-only archive inspection.
- Both source archives were opened for inspection only; no source archive bytes were written.
- Current branch was `issue-676-p0-c01-display-list-resolver`; the only pre-existing untracked path was the user's `docs/handoff/10.7/` directory, which was left untouched.
- No tests, repository-wide verifier, or acceptance run was performed.
