# Issue #260 — FLA parser adoption and update policy

This is a maintainer-facing policy for the bounded FLA V1 parser closure. It
does not promise general `fla-viewer` compatibility and does not reopen the
bounded license search recorded in #250.

## Current pin

- Upstream: `lifeart/fla-viewer`
- Commit: `048000ccab67469980b8dedd1fc2b65a02d2b164`
- Closure: the 12 files listed in `resources/licenses/FLA-PARSER-NOTICE.txt`
- Direct runtime dependencies: `jszip@3.10.1`, `pako@1.0.11`
- License status: `LICENSE_INTENT_ONLY`, under the explicit maintainer risk
  decision recorded in [Issue #250](https://github.com/Cognitive-Architect/panda-stage/issues/250)

## Update rules

Parser and parser-runtime updates are explicit and reviewable. No floating
upstream URL, floating package range, automatic update, or unreviewed lockfile
refresh is allowed for this closure.

Every proposed update must, in one bounded change set:

1. pin a concrete upstream commit and exact runtime package versions;
2. review the complete parser-core diff against the previous pin;
3. run the real-sample compatibility verifier, including the expected 158
   bitmap identities and representative PNG/JPEG/alpha evidence;
4. refresh the parser-only dependency inventory and vulnerability audit;
5. refresh the notice/license evidence if any package identity, license fact,
   or authoritative upstream artifact changes; and
6. document any local modification to the closure, including its reason and
   exact reviewable diff.

The preferred packaging shape remains the bounded extracted parser core plus
the exact direct dependencies. Do not switch to a floating npm/upstream
dependency or pull in the upstream viewer/player/exporter application merely
to simplify updates.

## Security and compatibility boundary

The parser worker remains sandboxed and isolated by the existing Main/Preload
boundary. Updates must not introduce ActionScript execution, arbitrary source
filesystem access, network access, or viewer/player/exporter ownership into the
closure. The V1 product promise remains raster-only modern XFL/FLA inspection
and import; timeline semantics, Symbols/MovieClips, tweens, vectors, text,
masks, filters, and legacy binary FLA support remain outside the promise.
