import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSchema, migrateProject, type Project } from '../../src/domain';
import {
  AutosaveService,
  type AutosaveClock,
} from '../../src/main/services/AutosaveService';
import type { RecoveryService } from '../../src/main/services/RecoveryService';
import {
  ProjectSessionController,
  type ProjectSessionApi,
} from '../../src/renderer/features/recovery/ProjectSessionController';
import {
  EditorShellSession,
  getEditorShellSessionRegion,
  getEditorShellState,
} from '../../src/renderer/shell/EditorShell';
import { CompactProjectBar } from '../../src/renderer/shell/CompactProjectBar';
import { NewProjectDialog } from '../../src/renderer/shell/NewProjectDialog';
import { ProjectCenterScreen } from '../../src/renderer/shell/ProjectCenterScreen';
import { RecoveryCandidateBanner } from '../../src/renderer/shell/RecoveryCandidateBanner';
import {
  StartScreen,
} from '../../src/renderer/shell/StartScreen';
import {
  EditorProjectStore,
  type EditorProjectSnapshot,
} from '../../src/renderer/stores/EditorProjectStore';
import type {
  RecoveryCandidate,
} from '../../src/shared/recovery-api';
import exampleProject from '../../demo-project/project-v1.example.json';

const PROJECT_ROOT = 'D:\\projects\\shell.pandastage';
const SECOND_PROJECT_ROOT = 'D:\\projects\\second.pandastage';
const PROJECT = migrateProject(exampleProject);
const inertClock: AutosaveClock = {
  setInterval: () =>
    1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => undefined,
};

function candidate(project: Project): RecoveryCandidate {
  return {
    projectRoot: PROJECT_ROOT,
    recoveryFilePath: `${PROJECT_ROOT}\\recovery\\candidate.json`,
    projectId: project.id,
    savedAtMs: 4_102_444_800_000,
    project,
  };
}

function renderCompactProjectBar(
  projectSnapshot: EditorProjectSnapshot,
  _recoveryCandidate: RecoveryCandidate | null,
  status = 'Ready',
  productPreviewOpen = false,
  closeConfirmOpen = false,
): string {
  return renderToStaticMarkup(
    createElement(CompactProjectBar, {
      projectSnapshot,
      saveState: projectSnapshot.dirty ? 'dirty' : 'saved',
      status,
      busy: false,
      productPreviewOpen,
      closeConfirmOpen,
      onOpenProjectCenter: vi.fn(),
      onOpenProjectFolder: vi.fn(async () => undefined),
      onSaveProject: vi.fn(),
      onOpenProductPreview: vi.fn(),
      onRequestCloseProject: vi.fn(),
      deviceMode: 'auto',
      onDeviceModeChange: vi.fn(),
    }),
  );
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
  const restore = vi.fn(async () => ({
    ok: true as const,
    candidate: recoveryCandidate!,
  }));
  const ignore = vi.fn(async () => ({
    ok: true as const,
    retained: true as const,
  }));
  const saveProject = vi.fn(async (request: {
    projectRoot: string;
    project: Project;
    revision: number;
  }) => ({
    ok: true as const,
    value: {
      projectRoot: request.projectRoot,
      projectFilePath: `${request.projectRoot}\\project.json`,
      project: request.project,
      migrated: false,
      sourceVersion: 1 as const,
    },
  }));
  const sessionApi: ProjectSessionApi = {
    open: vi.fn(async (projectRoot) => {
      order.push('open');
      return {
        ok: true as const,
        value: {
          projectRoot,
          projectFilePath: `${projectRoot}\\project.json`,
          project: PROJECT,
          migrated: false,
          sourceVersion: 1 as const,
        },
      };
    }),
    openRecent: vi.fn(async (projectRoot, expectedProjectId) => {
      order.push('openRecent');
      return {
        ok: true as const,
        document: {
          projectRoot,
          projectFilePath: `${projectRoot}\\project.json`,
          project: ProjectSchema.parse({
            ...PROJECT,
            id: expectedProjectId,
          }),
          migrated: false,
          sourceVersion: 1 as const,
        },
      };
    }),
    track: vi.fn(async () => {
      order.push('track');
      return { ok: true as const };
    }),
    stop,
    detect: vi.fn(async () => {
      order.push('detect');
      return { ok: true as const, candidate: recoveryCandidate };
    }),
    confirmSwitch: vi.fn(async () => ({ outcome: 'saved' as const })),
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
      restore,
      ignore,
    },
    projectSaveApi: {
      save: saveProject,
    },
    createController,
  });
  return {
    session,
    store,
    order,
    stop,
    restore,
    ignore,
    saveProject,
    onError,
    createController,
    getActiveSubscriptions: () => activeSubscriptions,
    getMaximumActiveSubscriptions: () => maximumActiveSubscriptions,
  };
}

describe('EditorShell project session integration', () => {
  it('renders the formal project center with an open project without reopening it', () => {
    const markup = renderToStaticMarkup(
      ProjectCenterScreen({
        busy: false,
        currentProject: {
          projectRoot: PROJECT_ROOT,
          project: PROJECT,
          dirty: true,
        },
        newProjectDialogOpen: false,
        onChooseProjectDirectory: vi.fn(),
        onOpenCandidatePathChange: vi.fn(),
        onOpenProject: vi.fn(),
        onOpenRecentProject: vi.fn(),
        onRequestNewProject: vi.fn(),
        onReturnToEditor: vi.fn(),
        openCandidatePath: '',
        recentRefreshToken: 0,
        status: '项目中心已打开',
      }),
    );

    expect(markup).toContain('data-testid="project-center-screen"');
    expect(markup).toContain('data-project-open="true"');
    expect(markup).toContain('data-testid="project-center-current-project"');
    expect(markup).toContain(PROJECT.name);
    expect(markup).toContain(PROJECT_ROOT);
    expect(markup).toContain('有未保存更改');
    expect(markup).toContain('data-testid="return-to-editor"');
    expect(markup).toContain('继续创作');
    expect(markup).not.toContain('返回编辑器');
    expect(markup).not.toContain('当前项目仍保持打开');
  });

  it('renders one no-project entry, recent projects, and an enabled create entry', () => {
    const markup = renderToStaticMarkup(
      StartScreen({
        openCandidatePath: '',
        status: 'Ready',
        busy: false,
        recentRefreshToken: 0,
        newProjectDialogOpen: false,
        onOpenCandidatePathChange: vi.fn(),
        onChooseProjectDirectory: vi.fn(),
        onOpenProject: vi.fn(),
        onOpenRecentProject: vi.fn(),
        onRequestNewProject: vi.fn(),
      }),
    );

    expect(markup.match(/class="recovery-open-row"/gu)).toHaveLength(1);
    expect(markup.match(/class="recent-projects-panel"/gu)).toHaveLength(1);
    expect(markup).toContain('打开项目');
    expect(markup).toContain('浏览…');
    expect(markup).toContain('data-testid="choose-project-directory"');
    expect(markup).toContain('新建项目');
    expect(markup).not.toContain('新建项目（后续阶段启用）');
    expect(markup).not.toMatch(
      /data-testid="new-project-button"[^>]*disabled/u,
    );
    expect(markup).not.toContain('class="recovery-prompt"');
    expect(markup).not.toContain('class="editor-save-button"');
    expect(markup).not.toContain('data-testid="editor-top-bar"');
    expect(markup).not.toContain('data-testid="new-project-dialog"');
  });

  it('disables the create entry while the dialog is already open', () => {
    const markup = renderToStaticMarkup(
      StartScreen({
        openCandidatePath: '',
        status: 'Ready',
        busy: false,
        recentRefreshToken: 0,
        newProjectDialogOpen: true,
        onOpenCandidatePathChange: vi.fn(),
        onChooseProjectDirectory: vi.fn(),
        onOpenProject: vi.fn(),
        onOpenRecentProject: vi.fn(),
        onRequestNewProject: vi.fn(),
      }),
    );

    expect(markup).toMatch(
      /data-testid="new-project-button"[^>]*disabled/u,
    );
  });

  it('gates the create button until both submitted parts are valid', () => {
    const empty = renderToStaticMarkup(
      NewProjectDialog({
        parentDirectory: '',
        projectName: '',
        status: '',
        busy: false,
        onParentDirectoryChange: vi.fn(),
        onProjectNameChange: vi.fn(),
        onChooseParentDirectory: vi.fn(),
        onCreateProject: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    const illegal = renderToStaticMarkup(
      NewProjectDialog({
        parentDirectory: 'D:\\作品',
        projectName: '子目录\\短片',
        status: '请修正项目名称。',
        busy: false,
        parentDirectoryTouched: true,
        projectNameTouched: true,
        onParentDirectoryChange: vi.fn(),
        onProjectNameChange: vi.fn(),
        onChooseParentDirectory: vi.fn(),
        onCreateProject: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    const ready = renderToStaticMarkup(
      NewProjectDialog({
        parentDirectory: 'D:\\作品',
        projectName: '短片',
        status: '已选择存放文件夹，请填写项目名称。',
        busy: false,
        onParentDirectoryChange: vi.fn(),
        onProjectNameChange: vi.fn(),
        onChooseParentDirectory: vi.fn(),
        onCreateProject: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(empty.match(/data-testid="new-project-dialog"/gu)).toHaveLength(1);
    expect(empty).not.toContain('请先选择新项目的存放文件夹');
    expect(empty).not.toContain('请输入项目名称。');
    expect(empty).toMatch(
      /data-testid="new-project-confirm"[^>]*disabled/u,
    );
    expect(illegal).toContain('不能包含斜杠或反斜杠');
    expect(illegal).toMatch(
      /data-testid="new-project-confirm"[^>]*disabled/u,
    );
    expect(ready).not.toMatch(
      /data-testid="new-project-confirm"[^>]*disabled/u,
    );
    expect(ready).not.toContain('将在所选文件夹中创建同名项目文件夹');
    // The dialog only ever renders the two submitted parts.
    expect(ready).not.toContain('.pandastage"');
    expect(ready).not.toContain('D:\\作品\\短片');
  });

  it('rejects an arbitrary non-path candidate before enabling open', () => {
    const markup = renderToStaticMarkup(
      StartScreen({
        openCandidatePath: '?',
        status: 'Ready',
        busy: false,
        recentRefreshToken: 0,
        newProjectDialogOpen: false,
        onOpenCandidatePathChange: vi.fn(),
        onChooseProjectDirectory: vi.fn(),
        onOpenProject: vi.fn(),
        onOpenRecentProject: vi.fn(),
        onRequestNewProject: vi.fn(),
      }),
    );

    expect(markup).toContain('项目文件夹路径包含 Windows 不允许的字符');
    expect(markup).toMatch(
      /class="recovery-open-row"[\s\S]*?<button disabled=""/u,
    );
  });

  it('preserves open -> track -> detect -> store.open and returns session state to the shell', async () => {
    const harness = createSession(null);
    expect(
      getEditorShellSessionRegion(
        getEditorShellState(harness.store.getSnapshot()),
      ),
    ).toBe('start-screen');

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
    expect(
      getEditorShellSessionRegion(
        getEditorShellState(harness.store.getSnapshot()),
      ),
    ).toBe('editor-layout');
    expect(harness.createController).toHaveBeenCalledTimes(1);
  });

  it('renders one compact project bar without owning the recovery banner', async () => {
    const recoveryCandidate = candidate(PROJECT);
    const harness = createSession(recoveryCandidate);
    const sessionSnapshot =
      await harness.session.switchProject(PROJECT_ROOT);
    const markup = renderCompactProjectBar(
      harness.store.getSnapshot()!,
      sessionSnapshot.recoveryCandidate,
      'Recovery available',
    );

    expect(harness.order).toEqual([
      'open',
      'track',
      'detect',
      'store.open',
    ]);
    const bannerMarkup = renderToStaticMarkup(
      RecoveryCandidateBanner({
        candidate: recoveryCandidate,
        busy: false,
        onRestore: vi.fn(),
        onIgnore: vi.fn(),
      }),
    );
    expect(markup.match(/data-testid="compact-project-bar"/gu)).toHaveLength(1);
    expect(markup).not.toContain('class="recovery-prompt"');
    expect(markup).not.toContain('class="recovery-open-row"');
    expect(markup.match(/class="editor-save-button"/gu)).toHaveLength(1);
    expect(bannerMarkup).toContain('role="alert"');
    expect(markup).toContain(PROJECT.name);
    expect(markup).toContain(`title="${PROJECT_ROOT}"`);
    expect(bannerMarkup).toContain(recoveryCandidate.recoveryFilePath);
    expect(bannerMarkup).toContain('恢复');
    expect(bannerMarkup).toContain('忽略');
    expect(harness.createController).toHaveBeenCalledTimes(1);
  });

  it('keeps one top bar while switching a second project through the same controller', async () => {
    const harness = createSession(null);
    await harness.session.switchProject(PROJECT_ROOT);
    const before = renderCompactProjectBar(
      harness.store.getSnapshot()!,
      harness.session.getSnapshot().recoveryCandidate,
    );

    const secondSnapshot =
      await harness.session.switchProject(SECOND_PROJECT_ROOT);
    const after = renderCompactProjectBar(
      harness.store.getSnapshot()!,
      secondSnapshot.recoveryCandidate,
    );

    expect(secondSnapshot.trackedProjectRoot).toBe(SECOND_PROJECT_ROOT);
    expect(harness.store.getSnapshot()?.projectRoot).toBe(
      SECOND_PROJECT_ROOT,
    );
    expect(before.match(/data-testid="compact-project-bar"/gu)).toHaveLength(1);
    expect(after.match(/data-testid="compact-project-bar"/gu)).toHaveLength(1);
    expect(before).not.toContain('class="recovery-open-row"');
    expect(after).not.toContain('class="recovery-open-row"');
    expect(harness.createController).toHaveBeenCalledTimes(1);
  });

  it('opens a recent project through the same shell session and controller', async () => {
    const harness = createSession(null);

    const snapshot = await harness.session.switchRecentProject(
      PROJECT_ROOT,
      PROJECT.id,
    );

    expect(harness.order).toEqual([
      'openRecent',
      'track',
      'detect',
      'store.open',
    ]);
    expect(snapshot.trackedProjectRoot).toBe(PROJECT_ROOT);
    expect(harness.store.getSnapshot()).toMatchObject({
      projectRoot: PROJECT_ROOT,
      project: { id: PROJECT.id },
    });
    expect(harness.createController).toHaveBeenCalledTimes(1);
  });

  it('does not update the stopped A autosave session during save-and-switch', async () => {
    const store = new EditorProjectStore();
    const projectB = migrateProject({
      ...structuredClone(exampleProject),
      id: 'c0000000-0000-4000-8000-000000000001',
      name: 'Project B',
    });
    const autosave = new AutosaveService({
      recoveryService: {
        writeRecovery: vi.fn().mockResolvedValue(undefined),
      } as unknown as RecoveryService,
      clock: inertClock,
    });
    const update = vi.fn(async (request) => {
      autosave.update(request);
      return { ok: true as const };
    });
    let session: EditorShellSession | null = null;
    const sessionApi: ProjectSessionApi = {
      open: vi.fn(async (projectRoot) => ({
        ok: true as const,
        value: {
          projectRoot,
          projectFilePath: `${projectRoot}\\project.json`,
          project: PROJECT,
          migrated: false,
          sourceVersion: 1 as const,
        },
      })),
      openRecent: vi.fn(async (projectRoot) => ({
        ok: true as const,
        document: {
          projectRoot,
          projectFilePath: `${projectRoot}\\project.json`,
          project: projectB,
          migrated: false,
          sourceVersion: 1 as const,
        },
      })),
      track: vi.fn(async (request) => {
        autosave.track(request);
        return { ok: true as const };
      }),
      stop: vi.fn(async (projectRoot) => {
        await autosave.stop(projectRoot);
        // This models the React effect that can observe the saved A snapshot
        // after Main has already stopped A during the controller transition.
        await session?.syncAutosave(store.getSnapshot());
        return { ok: true as const };
      }),
      detect: vi.fn(async () => ({
        ok: true as const,
        candidate: null,
      })),
      confirmSwitch: vi.fn(async (request) => {
        // The Main Process has completed the real formal save before the
        // controller marks A clean and stops its autosave session.
        autosave.markFormalSaved(
          request.projectRoot,
          request.project,
          request.revision,
        );
        return { outcome: 'saved' as const };
      }),
    };
    session = new EditorShellSession({
      store,
      sessionApi,
      autosaveApi: {
        update,
        onError: vi.fn(() => vi.fn()),
      },
      recoveryApi: {
        restore: vi.fn(),
        ignore: vi.fn(),
      },
      projectSaveApi: {
        save: vi.fn(),
      },
    });

    await session.switchProject(PROJECT_ROOT);
    await session.syncAutosave(store.getSnapshot());
    store.updateProject({ ...PROJECT, name: 'Project A edited' });
    await session.syncAutosave(store.getSnapshot());

    await expect(
      session.switchRecentProject(SECOND_PROJECT_ROOT, projectB.id),
    ).resolves.toMatchObject({
      trackedProjectRoot: SECOND_PROJECT_ROOT,
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectRoot: PROJECT_ROOT,
        dirty: false,
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectRoot: PROJECT_ROOT,
        dirty: true,
      }),
    );
    expect(autosave.trackedProjectCount()).toBe(1);
    expect(store.getSnapshot()).toMatchObject({
      projectRoot: SECOND_PROJECT_ROOT,
      project: { id: projectB.id },
      dirty: false,
    });
  });

  it('keeps A -> B -> A identity, visible active path, dirty state, and save target aligned', async () => {
    const harness = createSession(null);

    await harness.session.switchProject(PROJECT_ROOT);
    harness.store.updateProject({ ...PROJECT, name: 'Project A edited' });
    expect(harness.store.getSnapshot()).toMatchObject({
      projectRoot: PROJECT_ROOT,
      project: { name: 'Project A edited' },
      dirty: true,
    });
    await harness.session.saveCurrentProject();
    expect(harness.saveProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectRoot: PROJECT_ROOT }),
    );

    await harness.session.switchProject(SECOND_PROJECT_ROOT);
    harness.store.updateProject({ ...PROJECT, name: 'Project B edited' });
    await harness.session.saveCurrentProject();
    expect(harness.saveProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectRoot: SECOND_PROJECT_ROOT }),
    );

    await harness.session.switchRecentProject(PROJECT_ROOT, PROJECT.id);
    const current = harness.store.getSnapshot()!;
    expect(current).toMatchObject({
      projectRoot: PROJECT_ROOT,
      project: { id: PROJECT.id, name: PROJECT.name },
      dirty: false,
    });
    const markup = renderToStaticMarkup(
      createElement(CompactProjectBar, {
        projectSnapshot: current,
        saveState: 'saved',
        status: 'Ready',
        busy: false,
        productPreviewOpen: false,
        closeConfirmOpen: false,
        onOpenProjectCenter: vi.fn(),
        onOpenProjectFolder: vi.fn(async () => undefined),
        onSaveProject: vi.fn(),
        onOpenProductPreview: vi.fn(),
        onRequestCloseProject: vi.fn(),
        deviceMode: 'auto',
        onDeviceModeChange: vi.fn(),
      }),
    );
    expect(markup).toContain(`title="${PROJECT_ROOT}"`);
  });

  it('keeps restore, save, and ignore semantics behind shell-owned actions', async () => {
    const recoveredProject = migrateProject({
      ...structuredClone(exampleProject),
      name: 'Recovered project',
    });
    const restoreHarness = createSession(candidate(recoveredProject));
    await restoreHarness.session.switchProject(PROJECT_ROOT);

    expect((await restoreHarness.session.restoreRecovery()).ok).toBe(true);
    expect(restoreHarness.restore).toHaveBeenCalledTimes(1);
    expect(
      restoreHarness.session.getSnapshot().recoveryCandidate,
    ).toBeNull();
    expect(restoreHarness.store.getSnapshot()).toMatchObject({
      project: { name: 'Recovered project' },
      dirty: true,
    });
    const restoredMarkup = renderCompactProjectBar(
      restoreHarness.store.getSnapshot()!,
      restoreHarness.session.getSnapshot().recoveryCandidate,
      'Recovered',
    );
    expect(restoredMarkup).not.toContain('class="recovery-prompt"');
    expect(restoredMarkup).toContain('class="editor-save-button"');
    expect(restoredMarkup).toContain('dirty-state');
    expect(await restoreHarness.session.saveCurrentProject()).toMatchObject({
      ok: true,
      acknowledgement: 'current',
    });
    const savedMarkup = renderCompactProjectBar(
      restoreHarness.store.getSnapshot()!,
      restoreHarness.session.getSnapshot().recoveryCandidate,
      '项目已保存。',
    );
    expect(savedMarkup).not.toContain('data-testid="editor-action-status"');
    expect(savedMarkup).toMatch(
      /class="editor-save-button"[^>]*disabled/u,
    );

    const ignoreHarness = createSession(candidate(PROJECT));
    await ignoreHarness.session.switchProject(PROJECT_ROOT);
    expect(await ignoreHarness.session.ignoreRecovery()).toEqual({
      ok: true,
      retained: true,
    });
    expect(ignoreHarness.ignore).toHaveBeenCalledTimes(1);
    expect(ignoreHarness.session.getSnapshot().recoveryCandidate).toBeNull();
    const ignoredMarkup = renderCompactProjectBar(
      ignoreHarness.store.getSnapshot()!,
      ignoreHarness.session.getSnapshot().recoveryCandidate,
      'Ignored; evidence retained',
    );
    expect(ignoredMarkup).not.toContain('class="recovery-prompt"');
    expect(ignoredMarkup).toContain('data-save-state="saved"');
  });

  it('renders the editor controls and an enabled product preview entry', async () => {
    const harness = createSession(null);
    await harness.session.switchProject(PROJECT_ROOT);
    const markup = renderCompactProjectBar(
      harness.store.getSnapshot()!,
      null,
    );

    expect(markup).toContain('data-testid="compact-project-bar"');
    expect(markup).not.toContain('class="recovery-panel"');
    expect(markup).not.toContain('class="recovery-open-row"');
    expect(markup).toContain('recovery-status-row');
    expect(markup).toContain('class="editor-save-button"');
    expect(markup).toContain(PROJECT.name);
    expect(markup).toContain('data-testid="compact-project-more"');
    expect(markup).not.toContain('产品预览（后续阶段启用）');
    // The menu and overlay are both transient surfaces.
    expect(markup).not.toContain('data-testid="compact-project-menu"');
    expect(markup).not.toContain('data-testid="product-preview-overlay"');
    expect(markup).not.toContain('class="recovery-prompt"');
    expect(markup).not.toContain('Crash recovery');
    expect(markup).not.toContain('recovered');
    expect(markup).not.toContain('Recovered');
    expect(markup).toContain('data-testid="project-save-state"');
    expect(markup).toContain('已保存');
    expect(markup).toContain('aria-label="保存整个项目"');
  });

  it('disables the preview entry while the overlay is already open', async () => {
    const harness = createSession(null);
    await harness.session.switchProject(PROJECT_ROOT);
    const markup = renderCompactProjectBar(
      harness.store.getSnapshot()!,
      null,
      'Ready',
      true,
    );

    expect(markup).toContain('data-testid="compact-project-more"');
    // Opening the preview must not change the saved/dirty presentation.
    expect(markup).toContain('已保存');
    expect(markup).toMatch(/class="editor-save-button"[^>]*disabled/u);
  });

  it('renders exactly one in-app close entry next to the save control', async () => {
    const harness = createSession(null);
    await harness.session.switchProject(PROJECT_ROOT);
    const markup = renderCompactProjectBar(harness.store.getSnapshot()!, null);

    expect(markup).toContain('data-testid="compact-project-more"');
    // The menu only opens the dialog; it never renders it while closed.
    expect(markup).not.toContain('data-testid="close-confirm-dialog"');
    expect(markup).not.toContain('不保存关闭');
    expect(markup.match(/class="editor-save-button"/gu)).toHaveLength(1);
  });

  it('disables the close entry while the confirmation is already open', async () => {
    const harness = createSession(null);
    await harness.session.switchProject(PROJECT_ROOT);
    const markup = renderCompactProjectBar(
      harness.store.getSnapshot()!,
      null,
      'Ready',
      false,
      true,
    );

    expect(markup).not.toContain('data-testid="open-project-center"');
    // Confirming a close must not pre-emptively change project state.
    expect(markup).toContain('已保存');
    expect(markup).toContain(PROJECT_ROOT);
  });

  it('closes the tracked project through the owned session', async () => {
    const harness = createSession(null);
    await harness.session.switchProject(PROJECT_ROOT);
    expect(harness.store.getSnapshot()?.projectRoot).toBe(PROJECT_ROOT);

    const snapshot = await harness.session.closeProject();

    expect(harness.stop).toHaveBeenCalledWith(PROJECT_ROOT);
    expect(snapshot).toEqual({
      trackedProjectRoot: null,
      recoveryCandidate: null,
    });
    expect(harness.store.getSnapshot()).toBeNull();
    expect(
      getEditorShellSessionRegion(
        getEditorShellState(harness.store.getSnapshot()),
      ),
    ).toBe('start-screen');
    expect(harness.createController).toHaveBeenCalledTimes(1);
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
