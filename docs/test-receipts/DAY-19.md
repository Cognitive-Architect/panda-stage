# Day 19 Test Receipt — Character Definitions

## Coordinates

- Work order: `B-19/45`
- Branch: `feat/day-19-character-definitions`
- Baseline SHA: `e4567132136ef658c20da925ca3e3e00de6598b9`
- Result SHA: `5dc27e36e1bfd7f89aa69ca1e00b0400f767ff51`
- Locally tested core SHA: `89610e9607601f72cf92c02bae676912cffdad63`
- Core tree SHA: `c90de6ee386b7ccdc15273f10c193a9c92f7b13c`
- Result: PASS

## Actual result

- A project user can create, select, rename, and delete an unreferenced
  character. Creation always produces explicit `normal` and `angry`
  expressions and one minimal `VoiceProfile`; no speech-generation UI or
  service is introduced.
- Expressions can be added, renamed, selected as default, and removed. The
  default expression cannot be removed until another expression is selected.
  Expressions used by a character layer or expression timeline event are also
  protected.
- `mouthOpenAssetId` is optional and references one project image asset. It is
  deliberately character-wide so the later fixed-frequency open/closed-mouth
  feature can use one minimal open-mouth image without a phoneme model.
- `defaultScale` is bounded to `0.1..10`; `defaultFlipX` is boolean. These are
  definition defaults only—Day 19 does not create canvas layers.
- The selected default expression is explicit through
  `defaultExpressionId`. `baseAssetId` remains for existing consumers and is
  kept equal to the selected default expression asset.
- Every expression and mouth reference resolves to an in-project image Asset
  ID. Character JSON contains no absolute path, data URL, or copied image.
- Expression names and character names are unique after trimming and
  case-folding.
- A dimension warning appears when either width or height differs from the
  default expression by more than 30%. It uses stored Asset metadata and never
  silently rescales the source.
- Expression appearance resolution preserves the supplied logical center for
  different image dimensions. The Renderer continues to use center offsets.
- Character deletion uses the shared reference scanner and is blocked by shot
  layers or dialogues. Asset deletion also recognizes character base,
  expression, and mouth references.
- Character edits enter the existing revision/recovery flow. The UI can save
  them with the existing revision-safe project API; a full page reload and
  reopen reproduced all character fields.

## Project schema and migration

The formal project schema is now version 2.

```json
{
  "id": "<character UUID>",
  "name": "Panda",
  "baseAssetId": "<normal image asset UUID>",
  "defaultVoiceProfileId": "<voice profile UUID>",
  "expressions": [
    { "id": "<UUID>", "name": "normal", "assetId": "<image UUID>" },
    { "id": "<UUID>", "name": "angry", "assetId": "<image UUID>" }
  ],
  "defaultExpressionId": "<normal expression UUID>",
  "mouthOpenAssetId": "<mouth image UUID>",
  "defaultScale": 0.75,
  "defaultFlipX": true
}
```

Formal v1 projects migrate in memory as follows:

1. Choose the expression whose `assetId` matches `baseAssetId`; otherwise use
   the first expression.
2. Write its ID to `defaultExpressionId` and align `baseAssetId`.
3. Set `defaultScale=1` and `defaultFlipX=false`.
4. Leave `mouthOpenAssetId` absent.
5. Do not modify `project.json` until the user explicitly saves.

The pre-existing legacy probe collision at schema version 1 remains
distinguished by its strict shape and still migrates deterministically.

## Real UI and fixture evidence

`pnpm verify:day19` performs this real Electron flow:

1. Inspect three generated PNG files with `MediaInspectionService`.
2. Open a v1 project and migrate it to the current model.
3. Import all three files through the existing import entry.
4. Create `Panda` with `normal`, `angry`, and a mouth-open image.
5. Switch the default to angry and back to normal.
6. Set `defaultScale=0.75` and `defaultFlipX=true`.
7. Confirm the default delete control is disabled with replacement guidance.
8. Confirm real 160×120 versus 240×120 and 160×52 metadata produces warnings.
9. Save at revision 5, reload the Renderer, reopen the project, and compare
   every field.

Recorded fixtures:

| Fixture | Real metadata | SHA-256 |
|---|---:|---|
| `熊猫 normal.png` | 160×120 | `a4a9fbf3f0bb6ff421c253667cf0722690f1c22ec870a20af6aa4ab78a620d13` |
| `熊猫 angry.png` | 240×120 | `76abdb1114c9f390bfff8839ef5acbdf9c93ed6bd76af141f7669071143f65a9` |
| `熊猫 mouth-open.png` | 160×52 | `cc8c370be4c782f5fe09dec4d4dc31b25003806d2da3e422bb55c2224ee779e1` |

Evidence:

- `docs/evidence/day-19/character-configured.png`
- `docs/evidence/day-19/character-reopened.png`
- `docs/evidence/day-19/results.json`

The configured screenshot shows distinct expression thumbnails, default
marker, transform controls, mouth selection, and both >30% warnings. The
reopened screenshot shows the same definition at revision 0 with a clean
project.

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| TYPE | PASS | `pnpm typecheck` |
| LINT | PASS | `pnpm lint` |
| FMT | N/A | no Prettier dependency or configuration; ESLint enforces repository TypeScript style |
| UNIT / COMPONENT | PASS | 50 files / 270 tests |
| INTEGRATION | PASS | 9 files / 68 tests |
| BUILD | PASS | `pnpm build` |
| DAY 19 REAL/UI | PASS | `pnpm verify:day19` |
| M1 | PASS | `pnpm verify:m1` on core result SHA |
| DAY 16 | PASS | `pnpm verify:day16` on core result SHA |
| DAY 17 | PASS | `pnpm verify:day17` on core result SHA |
| DAY 18 | PASS | `pnpm verify:day18` on core result SHA |
| CI | PASS | GitHub Actions run `30149260016`, attempt 2 |

## B-19/45 completion audit

| Blade | Result | Evidence |
|---|---|---|
| FUNC-001 create normal/angry | PASS | CharacterService, component test, real Electron flow |
| FUNC-002 valid explicit default | PASS | schema, service, migration and UI default switching |
| FUNC-003 optional mouth asset | PASS | schema/service/component/persistence evidence |
| FUNC-004 save and reopen | PASS | real ProjectService integration plus Electron reload |
| CONST-001 asset IDs only | PASS | serialized JSON assertions and machine evidence |
| CONST-002 unique expression names | PASS | case-folded schema and service tests |
| CONST-003 stable center anchor | PASS | `resolveAppearance` same-center test and center-offset Renderer |
| CONST-004 no TTS UI/call | PASS | static scope audit and real DOM audit |
| NEG-001 protect default deletion | PASS | service error, disabled UI control and tooltip |
| NEG-002 reject missing/wrong media | PASS | schema and CharacterService tests |
| NEG-003 >30% warning | PASS | real fixture metadata, unit and screenshot |
| NEG-004 protect used character | PASS | shared scanner and CharacterService test |
| UX-001 thumbnails/default marker | PASS | component test and configured screenshot |
| UX-002 understandable risk text | PASS | component test and configured screenshot |
| E2E-001 import→create→save→reopen | PASS | Day 19 Electron machine evidence |
| HIGH-001 expression switch center | PASS | different-size appearance resolution test |

## Decisions and debt

- `DECISION-001`: keep expressions as an explicit ordered array with stable
  UUIDs. Names are user labels; references use IDs.
- `DECISION-002`: use one optional character-wide `mouthOpenAssetId`. This is
  the smallest structure required for later fixed-frequency opening and does
  not prebuild phoneme or per-expression mouth systems.
- `DECISION-003`: compare each candidate image against the explicit default
  expression using width and height metadata independently; warn when either
  absolute relative difference is strictly greater than 30%.
- `DECISION-004`: extend the existing reference scanner with character and
  expression scans so asset, character, and expression deletion share one
  source of truth.
- `DEBT-MODEL-B19-001`: `baseAssetId` is retained as a compatibility alias for
  the default expression asset. It may be removed only in a future explicit
  migration after all consumers use `defaultExpressionId`.
- `DEBT-TEST-B19-001`: automated Electron screenshots replace a manual video;
  they cover configured and reopened states with machine assertions.
- No Character canvas placement, timeline editor, TTS, voice cloning, phoneme
  mouth model, automatic cutout, or skeletal animation was introduced.

## Rollback

- Revert the Day 19 implementation commit and its evidence/receipt commits.
- A v1 project is never rewritten until explicit save, so reverting before
  save leaves its original data untouched.
