// @vitest-environment happy-dom
import { act, createElement, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  migrateProject,
  type AdaptivePartsCharacter,
  type Character,
  type FlaGraphicDefinition,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { CharacterFloatHost } from '../../src/renderer/features/characters/characterFloatHost';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { CharacterResourceSwapDialog } from '../../src/renderer/features/characters/CharacterResourceSwapDialog';
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
    head: { assetId: faceAsset.id, placement: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0, flipX: false }, pivot: { x: 0, y: 0 } },
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

function mountFloatingCharacter() {
  const target = document.createElement('div');
  container.appendChild(target);
  const setMode = vi.fn();
  function Editor() {
    const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot);
    const [view, onViewChange] = useState<'list' | 'create' | 'detail' | 'expression' | 'legacy'>('list');
    return createElement(CharacterFloatHost.Provider, { value: { target, setMode } },
      createElement(CharacterManager, { snapshot, view, onViewChange, presentation: 'landscape', floatEnabled: true }),
    );
  }
  act(() => root.render(createElement(Editor)));
  const button = (id: string, scope: ParentNode = target) =>
    scope.querySelector<HTMLButtonElement>('[data-testid="' + id + '"]')!;
  const click = (element: HTMLElement) => act(() => element.click());
  const open = (id: string) => click(container.querySelector<HTMLButtonElement>('button[data-character-id="' + id + '"]')!);
  return { target, button, click, open };
}

describe('Floating single-image and composite detail (#1181)', () => {
  it('preserves single-image expression and mouth actions while separating definitions from the selected Shot layer', async () => {
    const { project, singleCharacter, imageAssets } = buildAdaptiveProject();
    editorProjectStore.open('F:/tmp/project', project);
    shotStore.select(project.shots[0]!.id);
    const { target, button, click, open } = mountFloatingCharacter();
    await act(async () => open(singleCharacter.id));
    expect(target.querySelector('[data-mode="single-image"]')).not.toBeNull();
    expect(button('character-float-left-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(button('character-float-right-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(button('character-single-structure-image-picker')).not.toBeNull();
    expect(target.querySelector('.expression-card')).not.toBeNull();
    const mouthId = imageAssets[0]!.id;
    click(button('character-detail-mouth-visual-picker-selected'));
    expect(target.querySelector('[data-testid="character-detail-mouth-visual-picker-candidates"]')).toBeNull();
    const dialog = document.body.querySelector('[data-testid="character-resource-swap-dialog"]')!;
    expect(dialog).not.toBeNull();
    click(dialog.querySelector<HTMLButtonElement>(`[data-testid="character-swap-candidate-image-${mouthId}"]`)!);
    // Selecting a candidate inside the dialog does NOT mutate the character before confirmation
    expect(
      editorProjectStore.getSnapshot()!.project.characters.find((c) => c.id === singleCharacter.id),
    ).not.toMatchObject({ mouthOpenAssetId: mouthId });
    click(dialog.querySelector<HTMLButtonElement>('[data-testid="character-swap-confirm"]')!);
    const current = editorProjectStore.getSnapshot()!.project;
    expect(current.characters.find(c => c.id === singleCharacter.id)).toMatchObject({ mouthOpenAssetId: mouthId });
    click(button('character-float-role-edit'));
    expect(button('character-float-right-toggle').getAttribute('aria-expanded')).toBe('true');
    click(button('character-float-left-toggle'));
    expect(button('character-float-right-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(editorProjectStore.getSnapshot()?.project.shots).toEqual(project.shots);
    expect(characterAssemblySessionStore.getSnapshot()).toBeNull();
  });

  it('moves composite precision to the right and protects the same draft when leaving Parts', async () => {
    const { project, compositeCharacter } = buildAdaptiveProject();
    editorProjectStore.open('F:/tmp/project', project);
    shotStore.select(project.shots[0]!.id);
    const { target, button, click, open } = mountFloatingCharacter();
    await act(async () => open(compositeCharacter.id));
    const precision = () => target.querySelector('.character-float-precision')!;
    expect(button('character-assembly-preview')).not.toBeNull();
    click(button('character-assembly-body-picker-selected'));
    click(button('character-assembly-fine-tune-toggle'));
    click(button('character-assembly-body-right-step', precision()));
    click(button('character-assembly-head-asset-selected'));
    click(button('character-assembly-head-right-step', precision()));
    click(button('character-assembly-default-face-select'));
    click(button('character-assembly-right-step', precision()));
    const draft = characterAssemblySessionStore.getActiveAssemblySessionHandle()!.getSnapshot()!.draft;
    expect(draft.bodyPlacement?.offsetX).toBe(1);
    expect(draft.head?.placement.offsetX).toBe(1);
    expect(draft.facePlacement.offsetX).toBe(1);
    expect(editorProjectStore.getSnapshot()?.project).toEqual(project);
    click(button('character-assembly-pivot-mode-toggle'));
    expect(button('character-assembly-head-pivot')).not.toBeNull();
    click(button('character-assembly-pivot-mode-toggle'));
    click(button('character-float-right-toggle'));
    click(button('character-assembly-body-picker-selected'));
    expect(button('character-float-right-toggle').getAttribute('aria-expanded')).toBe('false');

    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const expressions = [...target.querySelectorAll<HTMLButtonElement>('.character-float-left-nav button')][1]!;
    click(expressions);
    expect(expressions.getAttribute('aria-pressed')).toBe('false');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(characterAssemblySessionStore.getActiveAssemblySessionHandle()!.getSnapshot()!.draft).toEqual(draft);
    confirm.mockReturnValue(true);
    click(expressions);
    expect(expressions.getAttribute('aria-pressed')).toBe('true');
    expect(characterAssemblySessionStore.getActiveAssemblySessionHandle()!.getSnapshot()!.draft.facePlacement.offsetX).toBe(0);
    expect(editorProjectStore.getSnapshot()!.project.shots).toEqual(project.shots);
  });

  it('aligns float picker surfaces, mouth preview toggle, and composite precision controls (#1182)', async () => {
    const { project, singleCharacter, compositeCharacter, imageAssets } = buildAdaptiveProject();
    editorProjectStore.open('F:/tmp/project', project);
    shotStore.select(project.shots[0]!.id);
    const { target, button, click, open } = mountFloatingCharacter();

    await act(async () => open(singleCharacter.id));
    expect(
      button('character-single-structure-image-picker-selected').getAttribute('data-asset-state'),
    ).toBe('configured');
    expect(
      button('character-single-structure-image-picker-selected').getAttribute('title'),
    ).toContain('×');
    expect(
      button('character-detail-mouth-visual-picker').querySelector('.image-asset-picker-selected-row--surface'),
    ).not.toBeNull();
    click(button('character-detail-mouth-visual-picker-selected'));
    const mouthDialog = document.body.querySelector('[data-testid="character-resource-swap-dialog"]')!;
    click(mouthDialog.querySelector<HTMLButtonElement>(`[data-testid="character-swap-candidate-image-${imageAssets[0]!.id}"]`)!);
    click(mouthDialog.querySelector<HTMLButtonElement>('[data-testid="character-swap-confirm"]')!);
    const mouthPreview = target.querySelector<HTMLButtonElement>('.character-float-mouth-preview-button')!;
    expect(mouthPreview).not.toBeNull();
    expect(mouthPreview.getAttribute('aria-pressed')).toBe('false');
    click(mouthPreview);
    expect(mouthPreview.getAttribute('aria-pressed')).toBe('true');
    click(button('character-float-role-edit'));
    expect(
      target.querySelector('.character-float-danger-footer [data-testid="character-delete-settings"]'),
    ).not.toBeNull();

    click(button('character-detail-back'));
    await act(async () => open(compositeCharacter.id));
    expect(
      target.querySelectorAll('.character-float-operations .image-asset-picker-selected-row--surface').length,
    ).toBe(4);
    const defaultFaceBtn = button('character-assembly-default-face-select');
    expect(defaultFaceBtn.getAttribute('title')).toContain('×');
    expect(defaultFaceBtn.querySelector('small')?.textContent).not.toContain('×');
    click(defaultFaceBtn);
    click(button('character-assembly-fine-tune-toggle'));
    const precision = target.querySelector('.character-float-precision')!;
    expect(precision.querySelector('.character-float-angle-input-wrap .character-float-angle-unit')?.textContent).toBe('°');
    expect(precision.querySelector('.character-float-precision-actions')).not.toBeNull();
    click(button('character-assembly-face-rotation-up', precision));
    expect(
      characterAssemblySessionStore.getActiveAssemblySessionHandle()!.getSnapshot()!.draft.facePlacement.rotationDeg,
    ).toBe(1);
    click(button('character-assembly-reset', precision));
    expect(
      characterAssemblySessionStore.getActiveAssemblySessionHandle()!.getSnapshot()!.draft.facePlacement.rotationDeg,
    ).toBe(0);
  });

  it('opens the shared floating resource swap dialog across single-image, composite, and expression slots without mutating on cancel (#1183)', async () => {
    const { project, singleCharacter, compositeCharacter, imageAssets } = buildAdaptiveProject();
    if (singleCharacter.mode !== 'single-image' || compositeCharacter.mode !== 'composite') {
      throw new Error('Expected single-image and composite fixtures');
    }
    editorProjectStore.open('F:/tmp/project', project);
    shotStore.select(project.shots[0]!.id);
    const { target, button, click, open } = mountFloatingCharacter();

    // 1. Single-image: Esc / Cancel does not mutate, search empty state works, Confirm applies
    await act(async () => open(singleCharacter.id));
    const singleBefore = editorProjectStore.getSnapshot()!.project;
    const altAssetId = imageAssets.find(
      (asset) => asset.id !== singleCharacter.expressions[0]!.assetId,
    )!.id;
    click(button('character-single-structure-image-picker-selected'));
    let dialog = document.body.querySelector('[data-testid="character-resource-swap-dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(target.querySelector('[data-testid="character-single-structure-image-picker-candidates"]')).toBeNull();
    const searchInput = dialog.querySelector<HTMLInputElement>('[data-testid="character-swap-search"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(searchInput, '___non_existent___');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(dialog.querySelector('[data-testid="character-swap-empty-state"]')?.textContent).toContain('没有匹配素材');
    click(dialog.querySelector<HTMLButtonElement>('.character-swap-empty-clear')!);
    click(dialog.querySelector<HTMLButtonElement>(`[data-testid="character-swap-candidate-image-${altAssetId}"]`)!);
    expect(editorProjectStore.getSnapshot()!.project).toEqual(singleBefore);
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.querySelector('[data-testid="character-resource-swap-dialog"]')).toBeNull();
    expect(editorProjectStore.getSnapshot()!.project).toEqual(singleBefore);

    click(button('character-single-structure-image-picker-selected'));
    dialog = document.body.querySelector('[data-testid="character-resource-swap-dialog"]')!;
    click(dialog.querySelector<HTMLButtonElement>(`[data-testid="character-swap-candidate-image-${altAssetId}"]`)!);
    click(dialog.querySelector<HTMLButtonElement>('[data-testid="character-swap-confirm"]')!);
    const updatedSingle = editorProjectStore.getSnapshot()!.project.characters.find((c) => c.id === singleCharacter.id);
    expect(updatedSingle?.mode === 'single-image' ? updatedSingle.expressions[0]?.assetId : null).toBe(altAssetId);

    // 2. Expression edit uses the same swap dialog rather than an inline grid
    const firstExprId = singleCharacter.expressions[0]!.id;
    click(button(`expression-edit-${firstExprId}`));
    expect(target.querySelector(`[data-testid="expression-asset-picker-${firstExprId}-candidates"]`)).toBeNull();
    click(button(`expression-asset-picker-${firstExprId}-selected`));
    dialog = document.body.querySelector('[data-testid="character-resource-swap-dialog"]')!;
    expect(dialog).not.toBeNull();
    click(dialog.querySelector<HTMLButtonElement>('[data-testid="character-swap-cancel"]')!);
    expect(document.body.querySelector('[data-testid="character-resource-swap-dialog"]')).toBeNull();

    // 3. Composite Body/Head does not display unsupported FLA tab and writes to assembly draft only on confirm
    click(button('character-detail-back'));
    await act(async () => open(compositeCharacter.id));
    click(button('character-assembly-body-picker-change-action'));
    dialog = document.body.querySelector('[data-testid="character-resource-swap-dialog"]')!;
    expect(dialog.querySelector('[data-testid="character-swap-tab-graphic"]')).toBeNull();
    const altBodyId = imageAssets.find((a) => a.id !== compositeCharacter.bodyAssetId)!.id;
    click(dialog.querySelector<HTMLButtonElement>(`[data-testid="character-swap-candidate-image-${altBodyId}"]`)!);
    expect(
      characterAssemblySessionStore.getActiveAssemblySessionHandle()!.getSnapshot()!.draft.bodyAssetId,
    ).toBe(compositeCharacter.bodyAssetId);
    click(dialog.querySelector<HTMLButtonElement>('[data-testid="character-swap-confirm"]')!);
    expect(
      characterAssemblySessionStore.getActiveAssemblySessionHandle()!.getSnapshot()!.draft.bodyAssetId,
    ).toBe(altBodyId);
  });

  it('guards Enter on search/candidate, paginates 12 items per page, renders Lucide Check, and labels pending selection (#1184)', async () => {
    const { project, singleCharacter, imageAssets } = buildAdaptiveProject();
    if (singleCharacter.mode !== 'single-image') throw new Error('Expected single-image');
    editorProjectStore.open('F:/tmp/project', project);
    shotStore.select(project.shots[0]!.id);
    const { button, click, open } = mountFloatingCharacter();

    // 1. P1 Enter regression + footer summary + Lucide Check in live CharacterEditor flow
    await act(async () => open(singleCharacter.id));
    const singleBefore = editorProjectStore.getSnapshot()!.project;
    const altAsset = imageAssets.find((asset) => asset.id !== singleCharacter.expressions[0]!.assetId)!;
    click(button('character-single-structure-image-picker-selected'));
    const dialog = document.body.querySelector('[data-testid="character-resource-swap-dialog"]')!;
    const summary = dialog.querySelector('.character-swap-summary')!;
    expect(summary.textContent).toContain('已选择：');
    expect(summary.textContent).not.toContain('当前：');

    const checkEl = dialog.querySelector('.character-swap-card-check')!;
    expect(checkEl.textContent).toBe('');
    expect(checkEl.querySelector('svg')).not.toBeNull();

    // Enter in search input must not confirm or close
    const searchInput = dialog.querySelector<HTMLInputElement>('[data-testid="character-swap-search"]')!;
    act(() => {
      searchInput.focus();
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(document.body.querySelector('[data-testid="character-resource-swap-dialog"]')).not.toBeNull();
    expect(editorProjectStore.getSnapshot()!.project).toEqual(singleBefore);

    // Focus alt candidate -> Enter + button click selects pending without committing
    const altCard = dialog.querySelector<HTMLButtonElement>(
      `[data-testid="character-swap-candidate-image-${altAsset.id}"]`,
    )!;
    act(() => {
      altCard.focus();
      altCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      altCard.click();
    });
    expect(document.body.querySelector('[data-testid="character-resource-swap-dialog"]')).not.toBeNull();
    expect(summary.textContent).toContain(`已选择：${altAsset.name}`);
    expect(editorProjectStore.getSnapshot()!.project).toEqual(singleBefore);

    // Explicit confirm applies the change
    click(dialog.querySelector<HTMLButtonElement>('[data-testid="character-swap-confirm"]')!);
    expect(document.body.querySelector('[data-testid="character-resource-swap-dialog"]')).toBeNull();
    const updated = editorProjectStore.getSnapshot()!.project.characters.find((c) => c.id === singleCharacter.id);
    expect(updated?.mode === 'single-image' ? updated.expressions[0]?.assetId : null).toBe(altAsset.id);

    // 2. P2 Pagination (12 per page) for both Image and FLA Graphic candidates + page localization
    const baseImage = imageAssets[0]!;
    const manyImages: ImageAsset[] = Array.from({ length: 15 }, (_, index) => ({
      ...baseImage,
      id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Image ${String(index + 1).padStart(2, '0')}`,
      sha256: 'b'.repeat(64),
    }));
    const graphicFrameAssets: ImageAsset[] = Array.from({ length: 14 }, (_, index) => ({
      id: `92000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      kind: 'image',
      name: `Graphic Frame ${index + 1}`,
      relativePath: `assets/graphic-frame-${index + 1}.svg`,
      mimeType: 'image/svg+xml',
      sha256: 'a'.repeat(64),
      width: 100,
      height: 100,
      usage: 'character',
      keywords: [],
      flaGraphicFrame: {
        definitionId: `91000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        ordinal: 0,
      },
    }));
    const manyGraphics: FlaGraphicDefinition[] = Array.from({ length: 14 }, (_, index) => ({
      id: `91000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      kind: 'fla-graphic',
      name: `Graphic ${String(index + 1).padStart(2, '0')}`,
      source: {
        basename: 'sample.fla',
        sha256: 'c'.repeat(64),
        renderTargetId: `sym-${index + 1}`,
        targetKind: 'graphic-symbol',
        targetName: `Symbol${index + 1}`,
        startFrameIndex: 0,
        endFrameIndex: 0,
        sourceFps: 24,
        canvas: { width: 100, height: 100 },
        anchor: { x: 0, y: 0 },
        documentCanvas: { width: 1920, height: 1080 },
      },
      durationMs: 1000 / 24,
      frames: [
        {
          ordinal: 0,
          sourceFrameIndex: 0,
          assetId: graphicFrameAssets[index]!.id,
          sha256: 'a'.repeat(64),
          sourceViewport: { x: 0, y: 0, width: 100, height: 100 },
          offset: { x: 0, y: 0 },
          startMs: 0,
          durationMs: 1000 / 24,
          createdBySequenceImport: false,
        },
      ],
    }));

    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    editorProjectStore.open('F:/tmp/project', {
      ...project,
      assets: [...project.assets, ...manyImages, ...graphicFrameAssets],
      animations: manyGraphics,
    });
    act(() => {
      root.render(
        createElement(CharacterResourceSwapDialog, {
          open: true,
          title: '更换素材',
          imageAssets: manyImages,
          graphicDefinitions: manyGraphics,
          thumbnails: {},
          currentValue: { kind: 'image', assetId: manyImages[13]!.id },
          onCancel,
          onConfirm,
        }),
      );
    });

    const pagedDialog = document.body.querySelector('[data-testid="character-resource-swap-dialog"]')!;
    // Opens on page 2 where manyImages[13] lives (3 items on page 2, not all 15)
    expect(pagedDialog.querySelector('[data-testid="character-swap-image-page"]')?.textContent).toBe('2 / 2');
    expect(pagedDialog.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(pagedDialog.querySelector('[data-testid="character-swap-image-prev"]')).not.toBeNull();
    click(pagedDialog.querySelector<HTMLButtonElement>('[data-testid="character-swap-image-prev"]')!);
    expect(pagedDialog.querySelector('[data-testid="character-swap-image-page"]')?.textContent).toBe('1 / 2');
    expect(pagedDialog.querySelectorAll('[role="option"]')).toHaveLength(12);

    // Switch to FLA Graphic tab -> renders 12 items on page 1, page 2 has 2 items
    click(pagedDialog.querySelector<HTMLButtonElement>('[data-testid="character-swap-tab-graphic"]')!);
    expect(pagedDialog.querySelector('[data-testid="character-swap-graphic-page"]')?.textContent).toBe('1 / 2');
    expect(pagedDialog.querySelectorAll('[role="option"]')).toHaveLength(12);
    click(pagedDialog.querySelector<HTMLButtonElement>('[data-testid="character-swap-graphic-next"]')!);
    expect(pagedDialog.querySelector('[data-testid="character-swap-graphic-page"]')?.textContent).toBe('2 / 2');
    expect(pagedDialog.querySelectorAll('[role="option"]')).toHaveLength(2);
  });
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
