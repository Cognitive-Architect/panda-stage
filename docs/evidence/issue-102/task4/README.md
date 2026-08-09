# Issue #102 Task 4 evidence

This directory contains the automated real-Electron evidence for Task 4.

Run the gate from the repository root with:

```powershell
pnpm verify:issue102-task4
```

The gate builds the renderer, launches the packaged Electron renderer with a
mocked main-process boundary, and checks `1280x720`, `1024x720`, the
minimum supported width (`800x720`), and the minimum supported window size
(`800x560`):

- no page-level horizontal overflow;
- 44px minimum hit targets for the tagged core actions;
- stable recent-project cards;
- visible editor canvas, right inspector, and bottom workspace;
- compact BottomWorkspace bounds, hidden overflow, and unclipped HistoryControls;
- the compact bottom history remains contained at the minimum supported height;
- the compact-bar more menu remains inside the viewport.

`results.json` contains the measured rectangles, bottom-surface metrics, and
pass/fail assertions. The PNG files are the corresponding window captures.
The existing Task 1, Task 2, Task 3, and Issue 76 Electron gates provide the
complementary create, open, recent, recovery, preview, save, close, and
regression coverage.

Human Windows Electron acceptance for the Task 4 primary path remains the
final acceptance step; this evidence does not claim that human PASS.
