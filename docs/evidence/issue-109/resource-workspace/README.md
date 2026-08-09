# Issue #109 — Adaptive resource workspace

This evidence package covers the automated Electron acceptance gate for the
adaptive left resource workspace.

The gate runs the built application at 1280×720 and 1024×720 and checks:

- the wide 320–360px dock and narrow 48–56px handle/drawer behavior;
- viewport containment and horizontal-overflow invariants;
- compact BottomWorkspace bounds, hidden overflow, and unclipped HistoryControls;
- shot list/create, asset browser/details, and character list/create/detail/
  expression subviews;
- sticky-header actions, drawer close affordances, and the no-dirty-state
  navigation contract.

`results.json` contains the measured snapshots and pass/fail result. The PNG
files are the corresponding real-Electron screenshots.

Automated verification does not replace the issue's required human Windows or
cloud-PC acceptance. Issue #109 should remain open until that acceptance is
recorded.
