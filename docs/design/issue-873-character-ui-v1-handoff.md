# Issue #873 — Character UI v1 handoff

> Implementation source: https://github.com/Cognitive-Architect/panda-stage/issues/873
>
> Created from main `18d7181147e172ed75de55cc7f8e47563bc2c7ea` on 2026-10-27.

## Scope

- UI-01: compact consistent Character detail navigation: back, add to current Shot, close.
- UI-02: compact talking-head intensity and stable in-place real-character preview; preserve apply/revert and 0/100/200%.
- UI-03: remove redundant danger heading/helper copy; preserve deletion confirmation and reference protections.

## Delivery routing

1. Work only on `issue-873-character-ui-v1`. Review through its Draft PR into `main` (review-only target, **do not merge**).
2. OWNER reviews actual Windows Electron visuals and states explicitly that UI PASS.
3. **Only after OWNER GO**, inspect updated PR #870 (`issue-868-am03`) and transfer approved UI-only commits to that branch, re-run focused regressions and record receipts.
4. Do not modify PR #870, #869 or #872 during this initial UI work. No Project Schema, renderer behavior, export or animation semantic changes.

This is a handoff marker to open a Draft PR; all implementation criteria live in Issue #873. No functional code changes are included in this initial commit.
