# Issue #749 — bounded Male linear-stroke contract gate

## Verdict

**STOP / NO-GO — STOP: CONTRACT_UNVERIFIED.** The original Male Shape and StrokeStyle 4 are frozen and identified, but the effective Animate values for several omitted XFL fields are not proven. Issue #749 explicitly requires stopping when a material default cannot be responsibly fixed. No production change or target render was made.

| Gate | Status | Evidence |
| --- | --- | --- |
| Style 4 contract | **STOP — CONTRACT_UNVERIFIED** | Authored values and omissions are recorded in [receipt.json](./receipt.json). |
| Male full scene root, frame 0 | **NOT RENDERED** | The last production capture on the same production-code state stops at Style 4 with `TARGET_UNSUPPORTED`; see [#748 raster receipt](../issue-748/raster-run.json). |
| Preservation controls | **SOURCE PRESERVED; NOT RERUN FOR #749** | Current source hash matches the frozen #748 hash. There was no renderer change to validate against the Hanfu, Qingling, radial-stroke, or Open-Fill controls. |

## Frozen source and first blocker

The unchanged original `D:\表情合集\新人物\修仙男.fla` still hashes to `565C5609A7610EF64ED9F98B09D98DD82D5A45255ADB4D3D410A5A365E0EF4A5`. The exact target is Shape `fla-shape-ce9f3623690b031bcc05dea3`, `StrokeStyle 4`, in Scene 1 frame 0. Its one referencing Edge is `!16452 12313[16410 12376 16376 12429`. The previous `TARGET_UNSUPPORTED` result and in-memory-only recovery normalization are documented in the [#748 source receipt](../issue-748/receipt.json); that receipt reports a strict preflight pass and unchanged original bytes.

The source explicitly writes `SolidStroke scaleMode="normal"`, `LinearGradient spreadMethod="reflect"`, the four stop colors and ratios, and matrix values `a`, `d`, `tx`, and `ty`. It omits `SolidStroke` weight, caps, joins, miter limit, pixel hinting, and `solidStyle`; matrix `b`/`c`; every stop's alpha; and `interpolationMethod`. The current Panda parser has fallback choices for several of these fields, but those implementation choices do not establish Adobe Animate's effective values. The same Shape's radial Style 3 is an engineering comparator, not an Adobe oracle. The earlier [#735 research report](../../research/issue-735-bounded-linear-stroke-research.md) reaches the same caution for omitted XFL fields and says not to infer these values.

The exact source records are shown separately below. The Edge attribute's leading CRLF is preserved from the source XML:

```xml
<StrokeStyle index="4">
                              <SolidStroke scaleMode="normal">
                                <fill>
                                  <LinearGradient spreadMethod="reflect">
                                    <matrix>
                                      <Matrix a="0.009490966796875" d="0.01239013671875" tx="814.65" ty="625.65"/>
                                    </matrix>
                                    <GradientEntry color="#594F45" ratio="0.152941176470588"/>
                                    <GradientEntry color="#D7DFD5" ratio="0.447058823529412"/>
                                    <GradientEntry color="#A4A79E" ratio="0.72156862745098"/>
                                    <GradientEntry color="#FCFDFA" ratio="1"/>
                                  </LinearGradient>
                                </fill>
                              </SolidStroke>
                            </StrokeStyle>

<Edge fillStyle0="1" fillStyle1="1" strokeStyle="4" edges="
!16452 12313[16410 12376 16376 12429"/>
```

Adobe's DOM API documents getters for stroke thickness, fill, cap, join, scale type, and hinting, and gradient matrix and spread. Those references establish that Animate exposes the properties; they do not state the omitted-field defaults for this FLA record: [ISolidStrokeStyle](https://helpx.adobe.com/animate/CPSDevKit/APIDocs/class_d_o_m_1_1_stroke_style_1_1_i_solid_stroke_style.html), [IGradientFillStyle](https://helpx.adobe.com/animate/CPSDevKit/APIDocs/class_d_o_m_1_1_fill_style_1_1_i_gradient_fill_style.html).

## Animate oracle availability

Adobe Animate 2023 is installed at `D:\AN2023\Adobe Animate 2023\Animate.exe`, version `23.0.0.407`. Its current process is displaying `黑衣修仙男.fla*`; the asterisk indicates unsaved state. That document was not touched. Adobe's documented JSFL workflow runs a script through **Commands → Run Command**; it does not document an isolated command-line invocation. With this unsaved document occupying the current Animate session and no verified isolated JSFL runner available, a focused oracle could not be run safely. See Adobe's [Commands menu automation instructions](https://helpx.adobe.com/animate/desktop/multimedia-and-video/automating-tasks-commands-menu.html).

## Scope and validation

- No original FLA or other source archive is included in this evidence directory.
- No production source file changed, no stroke was skipped or approximated, and no full Male PNG is claimed.
- `pnpm test:integration` passed on the unchanged production-code state before the evidence-only changes: 38 files and 189 tests. It also ran typecheck and the renderer/Electron build. This was the user-requested integration run, not a validation of a Style 4 implementation.
- After adding the evidence route, `pnpm typecheck`, `pnpm lint`, and `pnpm test:unit` passed; the unit run had 344 files and 2,489 tests. `pnpm exec vitest run tests/contract/ci-routing.test.ts` passed with 87 tests.
- The evidence-only CI route is registered narrowly for `docs/evidence/issue-749/**`; the routing contract keeps Issue #750 evidence unregistered and fail-closed.
- No matching Adobe reference was available: `NO_MATCHING_ADOBE_REFERENCE / HUMAN_REVIEW_PENDING`.

## Next blocker

The only next blocker is the C01 contract gate: determine the effective Animate values for the omitted fields listed above through a safe focused Animate oracle or source-level evidence that proves those values. Until then, do not add renderer code or a test that would encode guessed defaults.
