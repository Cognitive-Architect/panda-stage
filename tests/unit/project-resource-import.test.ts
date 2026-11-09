// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { ProjectResourceImportPanel } from '../../src/renderer/features/assets/ProjectResourceImportPanel';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ProjectResourceImportApplyRequestSchema } from '../../src/shared/project-resource-import-api';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/project-resource-import-ui.pandastage';
const IMPORTED_ASSET_ID = '81000000-0000-4000-8000-000000000001';
const UNSUPPORTED_CHARACTER_ID = '81000000-0000-4000-8000-000000000002';

let container: HTMLDivElement;
let root: Root;
let project = buildProject();
let chooseProjectResources: ReturnType<typeof vi.fn>;
let importProjectResources: ReturnType<typeof vi.fn>;
let imported: ReturnType<typeof vi.fn<() => void>>;
let status: ReturnType<typeof vi.fn<(message: string) => void>>;
let priorPandaStageDescriptor: PropertyDescriptor | undefined;

function completedProject() {
  const asset = {
    ...project.assets[0]!,
    id: IMPORTED_ASSET_ID,
    name: 'Forest background',
    relativePath: 'assets/forest.png',
    usage: 'background' as const,
  };
  return {
    asset,
    project: ProjectSchema.parse({
      ...project,
      assets: [...project.assets, asset],
      updatedAt: '2026-11-09T10:00:00.000Z',
    }),
  };
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('cross-project resource import UI and contracts', () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    project = buildProject();
    editorProjectStore.open(PROJECT_ROOT, project);
    const { asset, project: savedProject } = completedProject();
    chooseProjectResources = vi.fn(async () => ({
      ok: true,
      status: 'selected',
      sourceToken: '82000000-0000-4000-8000-000000000001',
      sourceProjectName: 'Production A',
      items: [
        {
          kind: 'image',
          id: IMPORTED_ASSET_ID,
          name: 'Forest background',
          usage: 'background',
          dependencyCount: 1,
          supported: true,
        },
        {
          kind: 'character',
          id: UNSUPPORTED_CHARACTER_ID,
          name: 'Broken character',
          mode: 'composite',
          dependencyCount: 2,
          supported: false,
          reason: '缺少角色默认配音档案',
        },
      ],
    }));
    importProjectResources = vi.fn(async () => ({
      ok: true,
      status: 'completed',
      project: savedProject,
      baseRevision: 0,
      savedRevision: 1,
      sourceProjectName: 'Production A',
      importedAssets: [asset],
      importedCharacters: [],
      importedVoiceProfiles: [],
    }));
    imported = vi.fn<() => void>();
    status = vi.fn<(message: string) => void>();
    priorPandaStageDescriptor = Object.getOwnPropertyDescriptor(window, 'pandaStage');
    Object.defineProperty(window, 'pandaStage', {
      configurable: true,
      value: {
        assets: {
          chooseProjectResources,
          importProjectResources,
        },
      },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(ProjectResourceImportPanel, {
          snapshot: {
            projectRoot: PROJECT_ROOT,
            project,
            dirty: false,
            revision: 0,
          },
          onImported: () => imported(),
          onStatus: (message: string) => status(message),
        }),
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    editorProjectStore.clear();
    if (priorPandaStageDescriptor) {
      Object.defineProperty(window, 'pandaStage', priorPandaStageDescriptor);
    } else {
      Reflect.deleteProperty(window, 'pandaStage');
    }
  });

  it('lets an author browse, select supported resources, and commit one import', async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="project-resource-import-trigger"]',
    );
    expect(trigger?.disabled).toBe(false);
    await act(async () => trigger?.click());
    await tick();

    expect(chooseProjectResources).toHaveBeenCalledWith({
      projectRoot: PROJECT_ROOT,
      project,
      baseRevision: 0,
    });
    expect(container.textContent).toContain('Production A');
    const options = container.querySelectorAll<HTMLInputElement>(
      '.project-resource-import-option input',
    );
    expect(options).toHaveLength(2);
    expect(options[0]?.disabled).toBe(false);
    expect(options[1]?.disabled).toBe(true);
    expect(container.textContent).toContain('缺少角色默认配音档案');

    const importButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.project-resource-import-actions button'),
    ).find((button) => button.textContent?.includes('导入'));
    expect(importButton?.disabled).toBe(true);
    await act(async () => options[0]?.click());
    expect(importButton?.disabled).toBe(false);
    await act(async () => importButton?.click());
    await tick();

    expect(importProjectResources).toHaveBeenCalledWith({
      projectRoot: PROJECT_ROOT,
      project,
      baseRevision: 0,
      sourceToken: '82000000-0000-4000-8000-000000000001',
      resources: [{ kind: 'image', id: IMPORTED_ASSET_ID }],
    });
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 1,
      project: { assets: expect.arrayContaining([expect.objectContaining({ id: IMPORTED_ASSET_ID })]) },
    });
    expect(imported).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledWith(
      '已从“Production A”导入 0 个角色和 1 张图片。',
    );
    expect(container.querySelector('[data-testid="project-resource-import-overlay"]')).toBeNull();
  });

  it('rejects duplicate resource selections at the IPC contract boundary', () => {
    const parsed = ProjectResourceImportApplyRequestSchema.safeParse({
      projectRoot: PROJECT_ROOT,
      project,
      baseRevision: 0,
      sourceToken: '82000000-0000-4000-8000-000000000001',
      resources: [
        { kind: 'image', id: IMPORTED_ASSET_ID },
        { kind: 'image', id: IMPORTED_ASSET_ID },
      ],
    });
    expect(parsed.success).toBe(false);
    expect(IDS.project).toBe(project.id);
  });
});
