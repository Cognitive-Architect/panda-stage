# Core, subsystem regression, and Full CI

Daily PRs and pushes to `main` use [.github/workflows/ci.yml](../.github/workflows/ci.yml).
The workflow has one Windows **Core CI** job and a thin **Final CI result** job.
Draft and Ready PRs use the same checks; no Ready proof or merge-provenance
status is produced or required by the workflow.

Core runs diff whitespace checks, typecheck, lint, unit tests, integration
tests, and build. Approved Markdown-only changes instead check whitespace
and relative links without installing dependencies. Unknown paths always run
Core and receive a `No mapped subsystem regression` summary; they do not fail
just because the optional mapping has no entry.

## Optional subsystem regression

[scripts/verification-manifest.json](../scripts/verification-manifest.json)
remains the single gate inventory and path-to-suite mapping. Its routing
section contains only documentation patterns, subsystem routes, and the
manual Full suite list. There are no risk tiers or proof metadata.

[scripts/ci-routing.cjs](../scripts/ci-routing.cjs) compares the PR base to
its current HEAD, including both sides of renames and deleted paths. Main
pushes compare the previous commit from the event. Manual Core runs use the
current commit's parent when no comparison is supplied. Empty comparisons
still run Core; they do not silently become documentation-only changes.

Every matched route can contribute suites; each suite runs once after Core
in the same job, using the same checkout, dependency installation and build.
The summary identifies the comparison, selected suites, and unmapped paths.
For example, Canvas changes map to `verify:canvas` and `verify:history`.
There is no requirement to register every new file before Core can pass.

The existing `verify:*` wrappers are unchanged. Some wrappers internally
repeat build or integration tests, so this first trial removes workflow-level
duplication but does not claim that all nested command duplication is gone.
PR #1039 spans multiple subsystems; comparing its whole PR diff can select
more suites than the old Draft-only last-push comparison.

PR pushes use concurrency group `ci-${{ github.ref }}` and cancel superseded
runs. Running `main` checks are not cancelled by newer pushes. `Final CI
result` succeeds only when Core, including its selected regressions, succeeds.
Keep that stable check in branch protection; retire the old `Ready Full proof`
requirement when adopting this workflow. Other branch protection settings and
OWNER's final acceptance remain unchanged.

## Manual Full CI

[.github/workflows/full-ci.yml](../.github/workflows/full-ci.yml) exposes a
separate **Full CI** `workflow_dispatch` entry for OWNER-requested heavy checks
and release preparation. It preserves typecheck, lint, unit, integration,
build, and all eight existing Full suites. It is not called by the daily PR
workflow or by a Ready event. GitHub must register the new workflow on the
default branch before its Actions UI can offer the manual entry.

No Full run or `verify:project` invocation is implied by routine requests for
quality checks. A nightly schedule and release packaging are outside this
trial.

## Maintaining and checking this configuration

Add source/test/verifier patterns to an existing subsystem route when useful.
Use existing executable `verify:*` suite IDs; do not add a second risk database.
The gate inventory still describes every package verifier, including manual
and historical entries. Business tests are not removed by this CI change.

Focused configuration validation:

```powershell
node --check scripts/ci-routing.cjs
pnpm exec vitest run tests/contract/ci-routing.test.ts tests/contract/verification-manifest.test.ts
git diff --check
```

The small CI contract checks parse both workflows, preserve Core coverage and
manual Full wiring, check representative mappings and non-blocking unknown
paths, and ensure selected suite commands exist. The actual GitHub Actions
run on PR #1039 supplies the final trial evidence, including durations and
cancellation of a superseded run.

## Known failures and human acceptance

A failure introduced or triggered by the PR, or whose independence is
uncertain, must be fixed. A known unrelated failure may be accepted only when
its exact check is identified, evidence proves it already fails on base/main
or an existing issue tracks it, the PR receipt records the cause and tracking
issue, and OWNER explicitly agrees to proceed. CI does not automatically
waive a red check, and this policy does not authorize automated merges.

OWNER makes the final decision from Core, relevant subsystem evidence, and
Windows Electron UAT. Full and artifact/proof identity chains are not normal
merge prerequisites.
