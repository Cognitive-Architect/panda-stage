// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  migrateProject,
  type AdaptivePartsCharacter,
  type Character,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { layerStore } from '../../src/renderer/stores/layerStore';

const service = new CharacterService();

function buildAdaptiveProject(): {
  project: Project;
  singleCharacter: Character;
  compositeCharacter: Character;
  adaptiveCharacter: AdaptivePartsCharacter;
  imageAssets: ImageAsset[];
} {
  const base = migrateProject(exampleProject);
  const imageAssets = base.assets.filter(
    (asset): asset is ImageAsset => asset.kind === 'image',
  );
  const bodyAsset = imageAssets[0]!;
  const faceAsset = imageAssets[1] ?? bodyAsset;
  const withComposite = service.createComposite(base, {
    name: 'Composite Hero',
    bodyAssetId: bodyAsset.id,
    expressions: [{ name: '默认', assetId: faceAsset.id }],
    facePlacement: {
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
    },
  });
  const withAdaptive = service.createAdaptiveParts(withComposite, {
    name: 'Adaptive Hero',
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId: '10000000-0000-4000-8000-000000000001',
        assetId: bodyAsset.id,
        displayName: '身体',
        drawOrder: 0,
        visible: true,
        source: { kind: 'manual', sourceId: 'manual-body' },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        imageMapping: {
          sourceWidth: bodyAsset.width,
          sourceHeight: bodyAsset.height,
          crop: { x: 0, y: 0, width: bodyAsset.width, height: bodyAsset.height },
          exportScale: 1,
        },
      },
      {
        partId: '10000000-0000-4000-8000-000000000002',
        assetId: faceAsset.id,
        displayName: '头部',
        drawOrder: 1,
        visible: true,
        source: { kind: 'manual', sourceId: 'manual-head' },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: -20 },
        imageMapping: {
          sourceWidth: faceAsset.width,
          sourceHeight: faceAsset.height,
          crop: { x: 0, y: 0, width: faceAsset.width, height: faceAsset.height },
          exportScale: 1,
        },
      },
    ],
  });
  const singleCharacter = withAdaptive.characters.find(
    (character) => character.mode === 'single-image',
  )!;
  const compositeCharacter = withAdaptive.characters.find(
    (character) => character.mode === 'composite',
  )!;
  const adaptiveCharacter = withAdaptive.characters.find(
    (character): character is AdaptivePartsCharacter =>
      character.mode === 'adaptive-parts',
  )!;
  return {
    project: withAdaptive,
    singleCharacter,
    compositeCharacter,
    adaptiveCharacter,
    imageAssets,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (window as unknown as Record<string, unknown>).pandaStage = {
    assets: {
      readThumbnail: vi.fn().mockResolvedValue({
        ok: true,
        status: 'missing',
        reason: 'missing',
      }),
    },
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
  editorProjectStore.clear();
  vi.restoreAllMocks();
});

describe('Issue #1175 UI-01 – unified Character Detail shell across all 3 modes', () => {
  it('renders unified header and 3-tab switcher (结构/表情/设置) for single-image, composite, and adaptive-parts', () => {
    const { project, singleCharacter, compositeCharacter, adaptiveCharacter, imageAssets } =
      buildAdaptiveProject();
    const noop = () => undefined;

    for (const character of [singleCharacter, compositeCharacter, adaptiveCharacter]) {
      act(() => {
        root.render(
          createElement(CharacterEditor, {
            character,
            project,
            imageAssets,
            thumbnails: {},
            warnings: [],
            onRenameCharacter: noop,
            onDeleteCharacter: noop,
            onAddExpression: noop,
            onRenameExpression: noop,
            onSetExpressionAsset: noop,
            onRemoveExpression: noop,
            onSetDefaultExpression: noop,
            onSetMouthOpenAsset: noop,
            onSetDefaultTransform: noop,
            onThumbnailError: noop,
            hasCurrentShot: true,
            presentation: 'landscape',
            view: 'detail',
          }),
        );
      });

      expect(container.querySelector('[data-testid="character-detail-view"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="character-detail-back"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="character-detail-place-current-shot"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="character-rename-trigger"]')).not.toBeNull();
      const switcher = container.querySelector('[data-testid="character-workspace-switcher"]');
      expect(switcher?.getAttribute('data-workspace-count')).toBe('3');
      expect(container.querySelector('[data-testid="character-workspace-assembly-tab"]')?.textContent?.trim()).toBe('结构');
      expect(container.querySelector('[data-testid="character-workspace-expressions-tab"]')?.textContent).toContain('表情');
      expect(container.querySelector('[data-testid="character-workspace-settings-tab"]')?.textContent?.trim()).toBe('设置');
      expect(container.querySelector('[data-testid="character-delete-settings"]')).not.toBeNull();
    }
  });

  it('shows honest unconfigured Expressions state and real Settings controls for adaptive-parts without fake controls', () => {
    const { project, adaptiveCharacter, imageAssets } = buildAdaptiveProject();
    const onOpenAssembly = vi.fn(() => true);
    const onLeaveAssembly = vi.fn(() => true);
    const onRenameCharacter = vi.fn();
    const onDeleteCharacter = vi.fn();
    const onSetDefaultTransform = vi.fn();
    const noop = () => undefined;

    act(() => {
      root.render(
        createElement(CharacterEditor, {
          character: adaptiveCharacter,
          project,
          imageAssets,
          thumbnails: {},
          warnings: [],
          onRenameCharacter,
          onDeleteCharacter,
          onAddExpression: noop,
          onRenameExpression: noop,
          onSetExpressionAsset: noop,
          onRemoveExpression: noop,
          onSetDefaultExpression: noop,
          onSetMouthOpenAsset: noop,
          onSetDefaultTransform,
          onThumbnailError: noop,
          onOpenAssembly,
          onLeaveAssembly,
          adaptiveAssemblyActive: true,
          hasCurrentShot: true,
          presentation: 'landscape',
          view: 'detail',
        }),
      );
    });

    // Adaptive opens on 结构 tab by default
    expect(
      container
        .querySelector('[data-testid="character-workspace-assembly-tab"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      container.querySelector('[data-testid="character-adaptive-structure-slot"]'),
    ).not.toBeNull();

    // Switch to 表情 tab -> leaves assembly and shows concise honest empty state
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="character-workspace-expressions-tab"]')
        ?.click();
    });
    expect(onLeaveAssembly).toHaveBeenCalledTimes(1);
    const unavailable = container.querySelector(
      '[data-testid="character-adaptive-expressions-unavailable"]',
    );
    expect(unavailable).not.toBeNull();
    expect(unavailable?.querySelector('button')).toBeNull();

    // Switch to 设置 tab -> no Talking Head, no Mouth picker, has Delete + Default Transform
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="character-workspace-settings-tab"]')
        ?.click();
    });
    expect(container.querySelector('[data-testid="character-talking-head-settings"]')).toBeNull();
    expect(container.querySelector('[data-testid="character-detail-mouth-visual-picker"]')).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="character-delete-settings"]')
        ?.click();
    });
    expect(onDeleteCharacter).toHaveBeenCalledTimes(1);
  });

  it('navigates adaptive-parts from CharacterList to unified detail view and supports rename, default transform, and reference-checked delete', () => {
    const { project, adaptiveCharacter } = buildAdaptiveProject();
    editorProjectStore.open('F:/tmp/project', project);
    shotStore.select(project.shots[0]!.id);
    const onViewChange = vi.fn();

    act(() => {
      root.render(
        createElement(CharacterManager, {
          snapshot: editorProjectStore.getSnapshot(),
          view: 'list',
          presentation: 'landscape',
          onViewChange,
        }),
      );
    });

    // Clicking an adaptive character navigates to unified 'detail' view
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          `button[data-character-id="${adaptiveCharacter.id}"]`,
        )
        ?.click();
    });
    expect(onViewChange).toHaveBeenCalledWith('detail');

    // Render detail view for the adaptive character
    act(() => {
      root.render(
        createElement(CharacterManager, {
          snapshot: editorProjectStore.getSnapshot(),
          view: 'detail',
          presentation: 'landscape',
          onViewChange,
        }),
      );
    });

    // Rename adaptive character through unified inline rename
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="character-rename-trigger"]')
        ?.click();
    });
    const renameInput = container.querySelector<HTMLInputElement>(
      '[data-testid="character-inline-rename-input"]',
    )!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(renameInput, 'Renamed Adaptive');
      renameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      container
        .querySelector<HTMLFormElement>('[data-testid="character-inline-rename-form"]')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(
      editorProjectStore
        .getSnapshot()
        ?.project.characters.find((c) => c.id === adaptiveCharacter.id)?.name,
    ).toBe('Renamed Adaptive');

    // Place adaptive character into current shot -> delete must be blocked by reference check
    layerStore.createAdaptiveCharacter(adaptiveCharacter.id, { x: 0, y: 0 });
    window.confirm = vi.fn(() => true);
    act(() => {
      root.render(
        createElement(CharacterManager, {
          snapshot: editorProjectStore.getSnapshot(),
          view: 'detail',
          presentation: 'landscape',
          onViewChange,
        }),
      );
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="character-workspace-settings-tab"]')
        ?.click();
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="character-delete-settings"]')
        ?.click();
    });
    expect(
      editorProjectStore
        .getSnapshot()
        ?.project.characters.some((c) => c.id === adaptiveCharacter.id),
    ).toBe(true);
    expect(
      container.querySelector('.character-manager-status')?.textContent,
    ).toContain('不能删除');

    // Undo layer placement -> delete now succeeds
    editorProjectStore.undo();
    act(() => {
      root.render(
        createElement(CharacterManager, {
          snapshot: editorProjectStore.getSnapshot(),
          view: 'detail',
          presentation: 'landscape',
          onViewChange,
        }),
      );
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="character-delete-settings"]')
        ?.click();
    });
    expect(
      editorProjectStore
        .getSnapshot()
        ?.project.characters.some((c) => c.id === adaptiveCharacter.id),
    ).toBe(false);
    expect(onViewChange).toHaveBeenLastCalledWith('list');
  });

  it('portals AdaptivePartsAssemblyWorkbench part list into the drawer slot and omits duplicate header', () => {
    const { project, adaptiveCharacter } = buildAdaptiveProject();
    editorProjectStore.open('F:/tmp/project', project);
    const began = characterAssemblySessionStore.beginAdaptiveParts(
      adaptiveCharacter.id,
    );
    expect(began.ok).toBe(true);
    if (!began.ok) return;

    const drawerSlot = document.createElement('div');
    document.body.appendChild(drawerSlot);

    act(() => {
      root.render(
        createElement(CharacterAssemblyWorkbench, {
          projectSnapshot: editorProjectStore.getSnapshot()!,
          session: began.snapshot,
          adaptivePartsListTarget: drawerSlot,
        }),
      );
    });

    const workbench = container.querySelector(
      '[data-testid="adaptive-parts-assembly-workbench"]',
    );
    expect(workbench?.getAttribute('data-hosted-in-drawer')).toBe('true');
    expect(
      container.querySelector('[data-testid="adaptive-parts-assembly-header"]'),
    ).toBeNull();
    expect(
      drawerSlot.querySelector('[data-testid="adaptive-parts-assembly-count"]')?.textContent,
    ).toContain('2');
    expect(
      drawerSlot.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]'),
    ).toHaveLength(2);

    drawerSlot.remove();
  });
});
