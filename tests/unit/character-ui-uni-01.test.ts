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
import { CharacterManager, type AdaptiveCharacterManagementAction, type AdaptivePartsAssemblyActionResult, type AdaptivePartsAssemblyActionsRef } from '../../src/renderer/features/characters/CharacterManager';
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Character Detail and original Adaptive Parts workbench (#1179)', () => {
  it('keeps the detail workspaces for single-image and composite', () => {
    const { project, singleCharacter, compositeCharacter, imageAssets } =
      buildAdaptiveProject();
    const noop = () => undefined;

    for (const character of [singleCharacter, compositeCharacter]) {
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

  it('opens the standalone workbench and preserves role management, dirty drafts, and reference checks', () => {
    const { project, adaptiveCharacter } = buildAdaptiveProject();
    editorProjectStore.open('F:/tmp/project', project);
    shotStore.select(project.shots[0]!.id);
    const onViewChange = vi.fn();
    const actionsRef: AdaptivePartsAssemblyActionsRef = { current: null };

    act(() => {
      root.render(createElement(CharacterManager, {
        snapshot: editorProjectStore.getSnapshot(),
        view: 'list',
        presentation: 'landscape',
        onViewChange,
        adaptivePartsActionsRef: actionsRef,
      }));
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-character-id="' + adaptiveCharacter.id + '"]')!.click();
    });
    expect(onViewChange).not.toHaveBeenCalledWith('detail');
    expect(container.querySelector('[data-testid="character-workspace-switcher"]')).toBeNull();

    const session = characterAssemblySessionStore.getSnapshot();
    expect(session).toMatchObject({ characterId: adaptiveCharacter.id, kind: 'adaptive-parts' });
    const manage = (action: AdaptiveCharacterManagementAction) => {
      let result: AdaptivePartsAssemblyActionResult | undefined;
      act(() => { result = actionsRef.current!.manage(action); });
      return result;
    };
    const draft = characterAssemblySessionStore.getActiveAdaptivePartsAssemblySessionHandle()!;
    const original = draft.getSnapshot()!.draft;
    act(() => { draft.setDraft({ ...original, parts: original.parts.map(part => ({ ...part, visible: false })) }); });
    expect(manage({ kind: 'rename', name: 'Pending' })).toMatchObject({ ok: false });
    expect(draft.getSnapshot()!.draft.parts.every(part => !part.visible)).toBe(true);
    act(() => { draft.setDraft(original); });

    expect(manage({ kind: 'rename', name: 'Renamed Adaptive' })).toEqual({ ok: true });
    expect(manage({ kind: 'transform', scale: 1.25, flipX: true })).toEqual({ ok: true });
    expect(editorProjectStore.getSnapshot()?.project.characters.find(c => c.id === adaptiveCharacter.id))
      .toMatchObject({ name: 'Renamed Adaptive', defaultScale: 1.25, defaultFlipX: true });

    act(() => { layerStore.createAdaptiveCharacter(adaptiveCharacter.id, { x: 0, y: 0 }); });
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    expect(manage({ kind: 'delete' })).toMatchObject({
      ok: false, message: expect.stringContaining('不能删除'),
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    act(() => { editorProjectStore.undo(); });
    expect(manage({ kind: 'delete' })).toEqual({ ok: true });
    expect(editorProjectStore.getSnapshot()?.project.characters.some(c => c.id === adaptiveCharacter.id)).toBe(false);
    expect(onViewChange).toHaveBeenLastCalledWith('list');
  });

  it('keeps both floating panels independent while editing one part draft and switching context', () => {
    const { project, adaptiveCharacter } = buildAdaptiveProject();
    editorProjectStore.open('F:/tmp/project', project);
    const began = characterAssemblySessionStore.beginAdaptiveParts(adaptiveCharacter.id);
    if (!began.ok) throw began.error;
    const actions = { current: null };
    const renderWorkbench = () => act(() => {
      root.render(createElement(CharacterAssemblyWorkbench, {
        projectSnapshot: editorProjectStore.getSnapshot()!,
        session: began.session.getSnapshot()!,
        adaptivePartsActionsRef: actions,
      }));
    });
    renderWorkbench();
    const workbench = container.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')!;
    expect(workbench.querySelector('.adaptive-parts-assembly-title strong')?.textContent).toBe(adaptiveCharacter.name);
    expect(workbench.querySelector('[data-testid="adaptive-character-management"]')).not.toBeNull();
    expect(workbench.querySelector('[data-testid="adaptive-parts-back-to-list"]')).not.toBeNull();
    expect(workbench.querySelector('[data-testid="adaptive-parts-join-current-shot"]')).not.toBeNull();
    expect(workbench.querySelector('aside[aria-label="部件列表"]')).not.toBeNull();
    expect(workbench.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]')).toHaveLength(2);
    expect(workbench.querySelector('[data-testid="adaptive-parts-assembly-canvas"]')).not.toBeNull();
    expect(workbench.querySelector('[data-testid="character-workspace-switcher"]')).toBeNull();
    const button = (id: string, scope: ParentNode = workbench) =>
      scope.querySelector<HTMLButtonElement>('[data-testid="' + id + '"]')!;
    const click = (target: HTMLButtonElement) => {
      act(() => target.click());
      renderWorkbench();
    };
    const left = button('adaptive-parts-operations-toggle');
    const right = button('adaptive-parts-inspector-toggle');
    const rows = workbench.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]');
    expect(left.getAttribute('aria-expanded')).toBe('true');
    expect(right.getAttribute('aria-expanded')).toBe('false');

    click(button('adaptive-parts-edit-button', rows[0]));
    expect(right.getAttribute('aria-expanded')).toBe('true');
    expect(began.session.getSnapshot()?.selectedPartId).toBe(rows[0]?.getAttribute('data-part-id'));
    const originalDraft = began.session.getSnapshot()?.draft;
    click(button('adaptive-parts-offset-x-step-up'));
    const editedDraft = began.session.getSnapshot()?.draft;
    expect(editedDraft).not.toEqual(originalDraft);
    click(left);
    expect(right.getAttribute('aria-expanded')).toBe('true');
    expect(began.session.getSnapshot()?.draft).toEqual(editedDraft);
    click(left);
    click(button('adaptive-parts-assembly-row-select', rows[1]));
    expect(began.session.getSnapshot()?.selectedPartId).toBe(rows[1]?.getAttribute('data-part-id'));
    expect(right.getAttribute('aria-expanded')).toBe('true');

    click(button('adaptive-character-management'));
    expect(workbench.querySelector('[data-testid="adaptive-character-properties"]')?.closest('[hidden]')).toBeNull();
    expect(workbench.querySelector('[data-testid="adaptive-parts-inspector-fields"]')).toBeNull();
    expect(began.session.getSnapshot()?.draft).toEqual(editedDraft);
    act(() => right.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    click(button('adaptive-parts-assembly-row-select', rows[0]));
    expect(right.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(right);
    expect(began.session.getSnapshot()?.draft).toEqual(editedDraft);
  });
});
