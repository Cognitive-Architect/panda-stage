# Core CI

Daily PRs and pushes to `main` use [ci.yml](../.github/workflows/ci.yml):
one Windows **Core CI** job followed by the thin **Final CI result** check.
Draft and Ready PRs use the same checks.

Core runs diff whitespace checks, typecheck, lint, unit, integration, and
build. Changes limited to root README/AGENTS/DESIGN Markdown and `docs/**/*.md`
instead check whitespace and relative links without installing dependencies.
Mixed, unknown and empty diffs run Core; there is no file registration rule.

[ci-routing.cjs](../scripts/ci-routing.cjs) only determines this docs-only
scope and checks documentation links. It compares the whole PR base to HEAD,
including deletions and both sides of renames. Main pushes use the previous
commit from the event; manual runs fall back to the current commit's parent.
There is no subsystem classifier or path-to-suite database.

PR runs use concurrency group `ci-${{ github.ref }}` and cancel superseded
runs. Running `main` checks are not cancelled by newer pushes. **Final CI
result** succeeds only when Core succeeds; it remains the stable required
branch-protection context. No Ready proof or provenance status is required.

The eight historical subsystem aggregators and their manual Full workflow
are retired. Their bounded classification and retained local diagnostics are
listed in the [CI-LEAN-02 inventory](testing/ci-lean-02-inventory.md).
[verification-manifest.json](../scripts/verification-manifest.json) remains a
command ledger for its existing inventory/evidence consumers; CI does not
read it to select jobs. No business test or concrete runtime assertion was
deleted by this change.

Configuration checks:

```powershell
node --check scripts/ci-routing.cjs
pnpm exec vitest run tests/contract/ci-routing.test.ts tests/contract/verification-manifest.test.ts
git diff --check
```

The small CI contract parses the workflow and checks Core commands,
docs-only behavior, concurrency and the stable final result. The ledger
contract checks command inventory drift. PR #1039 supplies the live trial
for Core/Final results, duration and cancellation.

OWNER decides whether to merge from Core PASS, the current feature's targeted
validation and Windows Electron UAT where needed. Historical suite reruns and
Full/proof chains are not merge prerequisites.

A failure introduced or triggered by the PR, or whose independence is
uncertain, must be fixed. A known unrelated failure may be accepted only when
its exact check is identified, evidence proves it already fails on base/main
or an existing issue tracks it, the receipt records the cause and tracking
issue, and OWNER explicitly agrees to proceed. CI does not waive red checks
or authorize automatic merges.
