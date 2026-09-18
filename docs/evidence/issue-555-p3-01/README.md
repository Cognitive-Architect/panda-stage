# Issue #555 / P3-01 receipt

## Scope

This receipt covers the bounded Selected Asset Surface Contract Pilot. The
production change is limited to the ImageAssetPicker family base and the
landscape Character Settings compound host. No TSX, store, service, IPC,
global token value, legacy CSS, or Phase 4 cleanup was introduced.

## Causal proof

```text
selected asset surface property
  -> .image-asset-picker in S14-14
  -> C05 .image-asset-picker-selected-row in S16-04
  -> C09 .image-asset-picker-inline .image-asset-picker-selected
     (inline geometry remains in S16-07; surface remains owned by S14-14)
```

The C05 inner Picker trigger remains borderless/transparent inside the outer
compound surface. `character-mouth-clear` remains a separate button. C09 keeps
its 52px inline selected row, 44px thumbnail, candidate sizing, and existing
single-card editing structure.

## Validation boundary

Automated validation is complete. The receipt intentionally keeps Windows
Electron visual acceptance pending for the maintainer; launch smoke is not a
substitute for checking C05/C09 computed styles, hover/focus, constrained
windows, DPI, and representative content.
