# F1-02 Minimum Contract

Status: research contract frozen from Issue #905 F1-01; this is a proposed
F1-02 boundary, not an existing production API.

## PartPlan

F1-02 consumes a read-only Main inspection session and an explicit scene/frame
selection. Its plan records:

- schema version, raw source SHA-256, Main-normalized source SHA-256, stage
  dimensions, and selected scene/frame;
- one distinct occurrence record for each planned unit, even when several
  occurrences reference the same library symbol;
- source address and parent occurrence chain, source definition and selected
  child-frame basis, layer visibility, draw order, and mask/composite
  dependencies;
- local and accumulated world matrices, stage coordinate space, crop, and the
  transform application rule.

Occurrence identity is derived from source identity plus the occurrence path
and frame selection. Symbol names are descriptive metadata, not identity. A
non-finite or non-invertible matrix, unknown occurrence path, or unsupported
composite dependency fails closed or remains an explicitly atomic composite.

## Rendering and lifecycle

- Resolve source transforms once into the full-stage unit image. Reassembly
  places that image at stage identity and must not apply the source matrix a
  second time. Cropped outputs require a separately versioned coordinate
  contract.
- Bind every plan and render request to the inspection session, source hash,
  request ID, and generation. Cancellation invalidates outstanding work;
  results from an older generation are discarded.
- Keep source paths, source bytes, and decoded media in Main. Renderer-facing
  requests use opaque session/plan/occurrence IDs and validated payloads.
- Plan inspection and rendering are read-only. They do not construct or mutate
  a Project, increment its revision, add History entries, register project
  assets, or call a commit API.
- Keep current Main and snapshot size, pixel, time, and concurrency limits.
  F1-02 must not raise a limit to make a source pass; report a limit failure as
  blocked or partial with the measured phase.

## F1-02 minimum evidence

For each source, retain the plan and a sanitized receipt with raw and
normalized hashes, per-occurrence addresses and matrices, visibility/order and
mask/composite facts, selected-frame basis, cancellation/generation outcome,
unsupported-path result, and prepare/resolve/raster timings and counts. Compare
the native whole frame, independent unit renders, and planned reassembly; keep
private artwork outside the repository. Report per-source and overall status
as `NATIVE_SOURCE_GO`, `PARTIAL`, or `BLOCKED`.

This contract adds no Project schema, persistence, History, export, or UI
surface. Those require separate authorization and design.
