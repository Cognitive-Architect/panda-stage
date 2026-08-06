# Issue #102 Task 4 evidence

This directory contains the automated real-Electron evidence for Task 4.

Run the gate from the repository root with:

```powershell
pnpm verify:issue102-task4
```

The gate builds the renderer, launches the packaged Electron renderer with a
mocked main-process boundary, and checks both `1280x720` and `1024x720`:

- no page-level horizontal overflow;
- 44px minimum hit targets for the tagged core actions;
- stable recent-project cards;
- visible editor canvas, right inspector, and bottom workspace;
- the compact-bar more menu remains inside the viewport.

`results.json` contains the measured rectangles and pass/fail assertions.
The PNG files are the corresponding window captures. The existing Task 1,
Task 2, Task 3, and Issue 76 Electron gates provide the complementary create,
open, recent, recovery, preview, save, close, and regression coverage.

Human Windows Electron acceptance for the Task 4 primary path remains the
final acceptance step; this evidence does not claim that human PASS.
