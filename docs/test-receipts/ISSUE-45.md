# Issue #45 Test Receipt — Schema v4 and Identity-Safe Character Drops

## Scope

- Issue: `#45 fix(day22): version locked layers and make character drops identity-safe`
- Branch / PR: `feat/day-22-layer-placement` / `#44`
- Result: PASS

## Schema v4 contract

- `PROJECT_SCHEMA_VERSION` is `4`; new projects are created directly as v4.
- v4 uses the strict current Layer shape and requires `locked: boolean`.
- v3 has its own strict historical Layer shape without `locked`.
- The explicit v3 → v4 migration adds `locked=false` to every layer.
- v0, v1, and v2 continue through the existing migration chain and finish as
  v4 without changing IDs, references, center coordinates, or inferred
  background identity.
- A migrated project is not written during open. After save, `project.json`
  contains `schemaVersion: 4`; reopen reports `migrated=false`,
  `sourceVersion=4`, and preserves `locked=true`.
- Missing `locked` in v4, `locked` smuggled into strict v3, and future schema
  versions are rejected instead of being silently normalized.

Evidence:

- `tests/unit/migrations/project-migration.test.ts`
- `tests/integration/schema-v4-layer-lock.test.ts`
- `tests/integration/project-lifecycle.test.ts`
- `tests/integration/background-identity-lifecycle.test.ts`

## Drag payload v2

The single shared protocol is:

```ts
type AssetDropPayload =
  | {
      version: 2;
      type: 'character-expression';
      assetId: string;
      characterId: string;
      expressionId: string;
    }
  | {
      version: 2;
      type: 'asset-image';
      assetId: string;
    }
  | {
      version: 2;
      type: 'audio';
      assetId: string;
    };
```

`LayerService` verifies that the character exists, the expression belongs to
that character, the expression points to the supplied asset, and the asset is
an image. It never searches for a first asset match.

The asset library emits one distinct entry per character expression. Shared
assets therefore retain the selected character and expression identity.
Protocol v1 is rejected; there is no long-lived dual-protocol path.

### Mouth-open-only decision

Option A is adopted. An image used only as `mouthOpenAssetId` has no expression
identity, so its card emits `asset-image` and creates a direct asset layer.
The card labels this behavior before drag.

Evidence:

- `src/domain/assetDropPayload.ts`
- `tests/unit/asset-drop-payload.test.ts`
- `tests/unit/asset-library-selectors.test.ts`
- `tests/unit/layer-service.test.ts`
- `tests/unit/layer-stores.test.ts`

## Negative-state proof

- Unknown character ID: rejected.
- Expression not owned by character: rejected.
- Expression/asset mismatch: rejected.
- Character asset disguised as `asset-image`: rejected.
- Rejections leave project data, layer count, revision, dirty state,
  notifications, and autosave boundary unchanged.
- Payload schemas reject paths, extra asset objects, unknown types, and v1
  character payloads.

## Gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| Unit / component | PASS — 62 files / 351 tests |
| Integration | PASS — 14 files / 76 tests |
| `pnpm build` | PASS |
| `pnpm verify:day19` | PASS |
| `pnpm verify:day20` | PASS |
| `pnpm verify:day21` | PASS |
| `pnpm verify:day22` | PASS |

## Scope audit

No Transformer, scale/rotation/flip editing, layer ordering controls,
undo/redo, timeline work, action presets, or new character-management UI was
added.
