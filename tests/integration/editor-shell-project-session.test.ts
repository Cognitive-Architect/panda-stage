import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import {
  RecoveryPanelControls,
} from '../../src/renderer/features/recovery/ProjectRecoveryPanel';
import {
  ProjectSessionController,
  type ProjectSessionApi,
} from '../../src/renderer/features/recovery/ProjectSessionController';
import {
  EditorShellSession,
} from '../../src/renderer/shell/EditorShell';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import type {
  RecoveryCandidate,
} from '../../src/shared/recovery-api';
import exampleProject from '../../demo-project/project-v1.example.json';

const PROJECT_ROOT = 'D:\\projects\\shell.pandastage';
const PROJECT = ProjectSchema.parse(exampleProject);

function candidate(project: Project): RecoveryCandidate {
  return {
    projectRoot: PROJECT_ROOT,
    recoveryFilePath: `${PROJECT_ROOT}\\recovery\\candidate.json`,
    projectId: project.id,
    savedAtMs: 4_102_444_800_000,
    project,
  };
}

function createSession(recoveryCandidate: RecoveryCandidate | null) {
  const order: string[] = [];
  const store = new EditorProjectStore();
  store.subscribe(() => order.push('store.open'));
  let activeSubscriptions = 0;
  let maximumActiveSubscriptions = 0;
  const onError = vi.fn(() => {
    activeSubscriptions += 1;
    maximumActiveSubscriptions = Math.max(
      maximumActiveSubscriptions,
      activeSubscriptions,
    );
    let active = true;
    return vi.fn(() => {
      if (!active) return;
      active = false;
      activeSubscriptions -= 1;
    });
  });
  const stop = vi.fn(async () => ({ ok: true as const }));
  const sessionApi: ProjectSessionApi = {
    open: vi.fn(async () => {
      order.push('open');
      return {
        ok: true as const,
        value: {
          projectRoot: PROJECT_ROOT,
          projectFilePath: `${PROJECT_ROOT}\\project.json`,
          project: PROJECT,
          migrated: false,
          sourceVersion: 1 as const,
        },
      };
    }),
    openRecent: vi.fn(),
    track: vi.fn(async () => {
      order.push('track');
      return { ok: true as const };
    }),
    stop,
    detect: vi.fn(async () => {
      order.push('detect');
      return { ok: true as const, candidate: recoveryCandidate };
    }),
  };
  const createController = vi.fn(
    (api: ProjectSessionApi, projectStore: EditorProjectStore) =>
      new ProjectSessionController(api, projectStore),
  );
  const session = new EditorShellSession({
    store,
    sessionApi,
    autosaveApi: {
      update: vi.fn(async () => ({ ok: true as const })),
      onError,
    },
    recoveryApi: {
      restore: vi.fn(async () => ({
        ok: true as const,
        candidate: recoveryCandidate!,
      })),
      ignore: vi.fn(async () => ({
        ok: true as const,
        retained: true as const,
      })),
    },
    projectSaveApi: {
      save: vi.fn(async (request) => ({
        ok: true as const,
        value: {
          projectRoot: request.projectRoot,
          projectFilePath: `${request.projectRoot}\\project.json`,
          project: request.project,
          migrated: false,
          sourceVersion: 1 as const,
        },
      })),
    },
    createController,
  });
  return {
    session,
    store,
    order,
    stop,
    onError,
    createController,
    getActiveSubscriptions: () => activeSubscriptions,
    getMaximumActiveSubscriptions: () => maximumActiveSubscriptions,
  };
}

describe('EditorShell project session integration', () => {
  it('preserves open -> track -> detect -> store.open and returns session state to the shell', async () => {
    const harness = createSession(null);

    const snapshot = await harness.session.switchProject(PROJECT_ROOT);

    expect(harness.order).toEqual([
      'open',
      'track',
      'detect',
      'store.open',
    ]);
    expect(snapshot).toEqual({
      trackedProjectRoot: PROJECT_ROOT,
      recoveryCandidate: null,
    });
    expect(harness.store.getSnapshot()).toMatchObject({
      projectRoot: PROJECT_ROOT,
      dirty: false,
    });
  });

  it('keeps restore, save, and ignore semantics behind shell-owned actions', async () => {
    const recoveredProject = ProjectSchema.parse({
      ...structuredClone(exampleProject),
      name: 'Recovered project',
    });
    const restoreHarness = createSession(candidate(recoveredProject));
    await restoreHarness.session.switchProject(PROJECT_ROOT);

    expect((await restoreHarness.session.restoreRecovery()).ok).toBe(true);
    expect(restoreHarness.store.getSnapshot()).toMatchObject({
      project: { name: 'Recovered project' },
      dirty: true,
    });
    expect(await restoreHarness.session.saveCurrentProject()).toMatchObject({
      ok: true,
      acknowledgement: 'current',
    });

    const ignoreHarness = createSession(candidate(PROJECT));
    await ignoreHarness.session.switchProject(PROJECT_ROOT);
    expect(await ignoreHarness.session.ignoreRecovery()).toEqual({
      ok: true,
      retained: true,
    });
    expect(ignoreHarness.session.getSnapshot().recoveryCandidate).toBeNull();
  });

  it('renders the existing recovery selectors through presenter props', () => {
    const markup = renderToStaticMarkup(
      RecoveryPanelControls({
        projectSnapshot: null,
        sessionSnapshot: {
          trackedProjectRoot: null,
          recoveryCandidate: null,
        },
        projectRootInput: '',
        status: 'Ready',
        busy: false,
        onProjectRootInputChange: vi.fn(),
        onOpenProject: vi.fn(),
        onRestoreRecovery: vi.fn(),
        onIgnoreRecovery: vi.fn(),
        onSaveRecoveredProject: vi.fn(),
      }),
    );

    expect(markup).toContain('class="recovery-panel"');
    expect(markup).toContain('class="recovery-open-row"');
    expect(markup).toContain('class="recovery-status-row"');
    expect(markup).toContain('class="editor-save-button"');
  });

  it('stops the tracked project after the final StrictMode cleanup', async () => {
    const harness = createSession(null);
    await harness.session.switchProject(PROJECT_ROOT);

    harness.session.activateAutosaveErrors(vi.fn());
    harness.session.deactivateAutosaveErrors();
    const simulatedCleanup =
      harness.session.scheduleControllerDisposal();
    harness.session.activateAutosaveErrors(vi.fn());
    await simulatedCleanup;

    expect(harness.stop).not.toHaveBeenCalled();
    expect(harness.getActiveSubscriptions()).toBe(1);
    expect(harness.getMaximumActiveSubscriptions()).toBe(1);

    harness.session.deactivateAutosaveErrors();
    await harness.session.scheduleControllerDisposal();

    expect(harness.onError).toHaveBeenCalledTimes(2);
    expect(harness.getActiveSubscriptions()).toBe(0);
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(harness.stop).toHaveBeenCalledWith(PROJECT_ROOT);
    expect(harness.createController).toHaveBeenCalledTimes(1);
  });
});
