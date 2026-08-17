# CI routing: FAST -> FULL -> VERIFY

Panda Stage separates development feedback from delivery proof. The routing
truth remains `scripts/verification-manifest.json`; the workflow consumes it
through `scripts/ci-routing.cjs` and verifies merge identity through
`scripts/ci-provenance.cjs`.

The governing rule is: **one Full per final candidate, not one Full per
commit**.

## FAST: Draft development

Draft `pull_request` events never select Full automatically. `opened`,
`reopened`, and `converted_to_draft` compare the PR base with the current HEAD.
A Draft `synchronize` compares the event's previous HEAD with its new HEAD so
each development push receives the fastest relevant feedback.

| Draft delta | Tier | Checks |
| --- | --- | --- |
| Approved Markdown only | `docs` | whitespace, docs scope, relative links |
| Renderer/business route | `targeted` | core quality plus manifest-selected subsystem verifier suites |
| Main/Preload/domain/shared/history/store/release core | `focused` | CI contracts, typecheck, lint, unit, integration, build, plus any manifest-selected subsystem suites; never the full regression ledger |
| Workflow/router/manifest/build mechanics | `ci-selftest` | YAML parse, routing/manifest/provenance contracts, typecheck, lint, diff-check |
| Unknown production path | `unknown` | immediate actionable failure naming the unowned path |
| Rename/copy/delete | `focused` | focused safety checks; never a silent pass |

The manifest's Full-risk routes declare their Draft policy. CI mechanics use
`ci-selftest`; cross-process/core and release ownership use `focused`. Normal
renderer routes remain `targeted`. Adding a subsystem name to
`.github/workflows/ci.yml` is not part of normal maintenance.

A mixed CI/core/renderer delta is promoted to `focused`: it runs CI contracts
and core quality together, then executes any renderer suites selected by the
manifest. This avoids both an accidental Full and a partial fast pass.

Unknown Draft paths fail with this shape before expensive regression starts:

```text
Unknown production route: <path>.
Register ownership and risk policy in the verification manifest.
```

## FULL: exact delivery candidate

`ready_for_review` and every synchronize while a PR remains non-Draft compare
the complete PR base with the current HEAD and run all eight active manifest
suites. `workflow_dispatch` remains an explicit Full-on-demand path.

After the Full job succeeds, `Ready candidate proof` writes the commit status
`Ready Full proof` to that exact HEAD. The stable `Final CI result` succeeds
only after both Full and that proof job succeed. Repository protection on
`main` requires both contexts with strict up-to-date checking:

```text
Final CI result
Ready Full proof
```

A later commit has a different SHA and therefore has neither proof for the new
candidate. The changed candidate must pass Full again. Re-running Full for the
same unchanged final code is duplicate waste; running Full for changed final
code is required proof.

## VERIFY: merge to main

On a push to `main`, the provenance helper accepts the fast path only when all
of these are true:

1. the pushed HEAD is a two-parent merge commit;
2. the push `before` SHA is its first parent;
3. the second parent is the exact tested Ready candidate;
4. the candidate tree and merged-main tree are identical;
5. that candidate SHA has successful `Ready Full proof` status;
6. one successful `pull_request` CI run at that exact SHA contains successful
   `Classify change risk`, `Full quality and regression`,
   `Ready candidate proof`, and `Final CI result` jobs.

`Post-merge provenance` repeats the proof and normally completes in seconds.
Missing API evidence, a tree mismatch, unexpected parents, direct pushes,
squash/rebase merge shapes, or any other ambiguity select Full on `main`.
Branch names, PR numbers, commit messages, and labels are never proof.

The repository currently supports merge, squash, and rebase methods. Only a
normal merge commit can use the fast proof above; other methods deliberately
fall back to Full.

## Add or change a route

The normal subsystem maintenance change is:

1. add product code and its tests/verifier when needed;
2. add one route in `scripts/verification-manifest.json` with stable identity,
   source/test/verifier patterns, suites, risk policy, owner, and notes;
3. for a Full-risk route, select `focused` or `ci-selftest` as its Draft
   policy;
4. use only active executable suites represented by `verify:*` gates;
5. run the contracts and quality checks below.

```powershell
node --check scripts/ci-routing.cjs
node --check scripts/ci-provenance.cjs
node -e "require('js-yaml').load(require('node:fs').readFileSync('.github/workflows/ci.yml', 'utf8'))"
pnpm exec vitest run tests/contract/ci-routing.test.ts tests/contract/verification-manifest.test.ts tests/contract/ci-provenance.test.ts
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

The contracts cover Draft routing, Ready Full policy, exact-candidate proof
invalidation, merge tree identity, API/proof fallback, manifest drift, active
verifier ownership, and every current first-party renderer feature directory.

## Acceptance receipts

- Draft CI-mechanics HEAD `b3908cb432aa5ddc2fd14344fa54dd58ea4bf4b3`
  used `CI policy self-test` in run `32005965628`: classifier 5 seconds,
  self-test 39 seconds, Full skipped, stable Final passed.
- Draft CI follow-up HEAD `5224d7e63197732e7e2493466b3e11a3d4db79eb`
  used `CI policy self-test` in run `32006267433`: classifier 10 seconds,
  self-test 26 seconds, Full skipped, stable Final passed.
- `main` branch protection is strict and requires both `Final CI result` and
  `Ready Full proof`. Draft PR #231 remains merge-blocked even with a green
  fast-path Final because the exact-candidate Ready proof is absent.
