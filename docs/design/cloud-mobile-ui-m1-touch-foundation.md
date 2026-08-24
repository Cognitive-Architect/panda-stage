# Cloud-mobile UI-M1 touch foundation

Issue #318 adds the small visual and input foundation needed by later
cloud-mobile UI work. It is intentionally additive: it does not implement
adaptive landscape/portrait layout, drawers, sheets, or a product-wide CSS
migration.

## Sources and overlap boundary

- Design source: PR #306, exact head `31718ada6e7a7e531b1ef86d8f7ee1b61902e42e`.
- Implementation-plan source: PR #307, exact head
  `a6dd9c5107af6aa7da9f3e7f061988979d638343`.
- Current production base for Issue #318: `main` at
  `24b412881f28df926f262975682924d5d1faec28`.
- PR #233 owns dialogue/audio/product-preview business work and also touches
  the legacy stylesheet. UI-M1 keeps that overlap narrow by adding token and
  primitive files and migrating only `CompactProjectBar`.

## Token contract

`src/renderer/styles/tokens.css` defines semantic variables for app/work/panel/
overlay surfaces, borders, primary/secondary/muted text, bamboo-green actions,
warning/danger/focus/disabled/selected states, a 4/8/12/16/24px spacing scale,
small/medium/large/pill radii, a compact readable type scale, and 44/48/56px
touch sizes.

`src/renderer/styles/primitives.css` is imported by the existing stylesheet as
a compatibility bridge. It styles new primitive data contracts instead of
requiring a bulk rewrite of legacy selectors.

## Primitive contract

`src/renderer/ui` provides:

- `Button`: primary, secondary, and danger variants with native disabled and
  focus behavior.
- `IconButton`: an explicit accessible name and a 44px hit target.
- `SegmentedTabs`: a single-choice tablist with selected and disabled state.
- `Field`: label, optional help text, and an error relationship for its
  control.
- `Stepper`: decrement, exact/display value, and increment controls.
- `PanelSurface` and `SectionHeader`: shared panel and heading structure.

The components preserve consumer-supplied legacy class names and add
`data-ui-*` attributes so existing selector-based behavior remains stable.

## First consumer and invariants

`CompactProjectBar` uses `PanelSurface` and the button primitive. Its project
center, save, menu, preview, and close callbacks, disabled conditions, save
state labels, menu lifecycle, accessible names, and existing test selectors
remain owned by the shell. The foundation creates no Project revision, dirty
state, History entry, IPC call, or persistent theme setting.

Human acceptance is still required on real Windows Electron with the
Wuying/Redmi path: distinguish primary/secondary/danger controls, confirm
selected/disabled/focus states, check comfortable hit targets and 125% scaling,
exercise the CompactProjectBar actions, and scan for unintended global
regressions.
