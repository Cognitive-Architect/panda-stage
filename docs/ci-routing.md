# CI routing and incremental Draft rechecks

Panda Stage CI has three stable outcomes: `docs`, `targeted`, and `full`.
The durable business-routing source is the `routing` section of
[`scripts/verification-manifest.json`](../scripts/verification-manifest.json).
The workflow reads that model through `scripts/ci-routing.cjs`; it does not
carry a second path-to-area, area-to-suite, or verifier-script case table.
Full-risk routes are evaluated before targeted routes, then targeted routes in
manifest order, so a narrow ownership rule can precede a broader shell rule.

## Conservative policy

- Main Process, Preload, domain/shared/history/store ownership, CI/build and
  release infrastructure, unknown paths, and rename/copy/delete changes run
  the Full route.
- A non-draft PR always gets a final Full sweep over the complete PR state.
- A push to `main` and `workflow_dispatch` always run Full.
- Unowned test or verifier paths are unknown and therefore Full; they are not
  silently ignored.
- `Final CI result` remains the stable required-check name for every route.

The manifest can represent renderer-only capability families such as
preview/playback, export UI, welcome/first-run, and recovery UI with targeted
routes. Cross-process export/FFmpeg work and installer/release work remain
conservative Full routes. A capability family does not require a dedicated
verifier when existing suites already cover its contract.

## Incremental Draft rechecks

On a Draft PR, `scripts/find-full-green-baseline.cjs` searches only the same
`ci.yml` workflow and accepts a baseline only when all of these are true:

1. the workflow run belongs to the same PR;
2. its HEAD differs from and is an ancestor of the current HEAD;
3. the run succeeded;
4. `Classify change risk`, `Full quality and regression`, and
   `Final CI result` all succeeded.

The classifier may then inspect `FULL_GREEN_HEAD..CURRENT_HEAD`. The delta is
targeted only when every matched route is targeted and incrementally eligible.
Any proof/API/ancestry failure leaves the baseline empty and falls back to the
complete PR base-to-HEAD classification. Full-risk or unknown delta paths still
run Full.

## Add a renderer/business subsystem

The normal maintenance change is:

1. add product code and its tests/verifier when needed;
2. add one route in `scripts/verification-manifest.json` with a stable
   capability identity, `sourcePatterns`, `testPatterns`, `verifierPatterns`,
   `suites`, `riskPolicy`, `incrementalEligible`, `owner`, and `notes`;
3. use only active executable suite IDs already represented by `verify:*`
   gates in the same manifest, or add the package script and gate entry in the
   same change;
4. run the contract and quality checks below.

Do not edit `.github/workflows/ci.yml` merely to register the subsystem name.
Workflow edits are reserved for CI mechanics such as events, permissions,
runners, or release/build policy.

```powershell
pnpm exec vitest run tests/contract/ci-routing.test.ts tests/contract/verification-manifest.test.ts
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

The contracts enumerate `src/renderer/features/*`, validate suite
executability, associate active verifier files with routes, and prove that a
hypothetical subsystem can be registered by manifest data alone. A new feature
directory without a route fails the contract; runtime classification also
fails unknown paths safe to Full.

## Acceptance receipt

PR #227 HEAD `f802e6b9a10265db4aa227c9c1a8a6c2a9093c66` had no proven
same-PR Full-green predecessor, so CI run `31998785944` correctly fell back to
complete base-to-HEAD classification. It selected all eight manifest suites;
the Full job, manifest-selected regression, and stable `Final CI result` all
passed. This HEAD is therefore eligible to be considered as a baseline for a
later Draft delta, subject to the same-PR, ancestry, and job-proof checks above.
