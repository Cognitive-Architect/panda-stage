// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterService,
  LayerService,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  ProjectSchema,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { ExpressionEditor } from '../../src/renderer/features/characters/ExpressionEditor';
import { GraphicFacePicker } from '../../src/renderer/features/characters/GraphicFacePicker';
import { ExpressionAtTimeControl } from '../../src/renderer/features/properties/ExpressionAtTimeControl';
import { getRightInspectorLayerSummary } from '../../src/renderer/shell/RightInspector';
import {
  characterAssemblySessionStore,
  type CharacterAssemblySnapshot,
} from '../../src/renderer/stores/characterAssemblySessionStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const service = new CharacterService();
const PROJECT_ROOT = 'D:/acceptance/graphic-ui.pandastage';

function compositeGraphicProject({
  structured = true,
  rotationDeg = 0,
  flipX = false,
}: {
  structured?: boolean;
  rotationDeg?: number;
  flipX?: boolean;
} = {}): Project {
  let project = graphicFaceProject(structured);
  project = service.setExpressionVisualSource(
    project,
    IDS.character,
    IDS.expressionNormal,
    faceSource(0),
  );
  project = service.setExpressionVisualSource(
    project,
    IDS.character,
    IDS.expressionAngry,
    faceSource(1),
  );
  project = service.setMouthOpenVisualSource(
    project,
    IDS.character,
    faceSource(3),
  );
  return ProjectSchema.parse({
    ...project,
    characters: [
      {
        ...project.characters[0]!,
        mode: 'composite',
        bodyAssetId: IDS.assetChar,
        bodyPlacement: { offsetX: 0, offsetY: 0, scale: 1 },
        facePlacement: {
          offsetX: 12,
          offsetY: -20,
          scale: 0.5,
          rotationDeg,
          flipX,
        },
      },
    ],
  });
}

function activeAssemblySession(): CharacterAssemblySnapshot {
  const session = characterAssemblySessionStore.getSnapshot();
  if (
    !session ||
    session.status !== 'active' ||
    !('characterId' in session) ||
    !('editTarget' in session) ||
    !('facePlacement' in session.draft)
  ) {
    throw new Error('Expected active composite assembly session');
  }
  return session;
}

function LiveAssemblyWorkbench() {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
    editorProjectStore.getSnapshot,
  );
  const rawSession = useSyncExternalStore(
    characterAssemblySessionStore.subscribe,
    characterAssemblySessionStore.getSnapshot,
    characterAssemblySessionStore.getSnapshot,
  );
  if (
    !snapshot ||
    !rawSession ||
    rawSession.status !== 'active' ||
    !('characterId' in rawSession) ||
    !('editTarget' in rawSession) ||
    !('facePlacement' in rawSession.draft)
  ) {
    return null;
  }
  return createElement(CharacterAssemblyWorkbench, {
    projectSnapshot: snapshot,
    session: rawSession,
  });
}

function parseInlinePx(markup: string, testId: string, prop: 'left' | 'top' | 'width' | 'height'): number {
  const escaped = testId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const tagMatch = markup.match(
    new RegExp(`<(?:div|button)[^>]*data-testid="${escaped}"[^>]*>`, 'u'),
  );
  expect(tagMatch).not.toBeNull();
  const styleMatch = tagMatch![0].match(/style="([^"]*)"/u);
  expect(styleMatch).not.toBeNull();
  const valueMatch = styleMatch![1]!.match(
    new RegExp(`${prop}:(-?\\d+(?:\\.\\d+)?)px`, 'u'),
  );
  expect(valueMatch).not.toBeNull();
  return Number(valueMatch![1]);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof globalThis.IntersectionObserver !== 'function') {
    globalThis.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof IntersectionObserver;
  }
  if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (typeof HTMLElement.prototype.releasePointerCapture !== 'function') {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (typeof HTMLElement.prototype.hasPointerCapture !== 'function') {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  characterAssemblySessionStore.getActiveAssemblySessionHandle()?.cancel();
  editorProjectStore.clear();
  Reflect.deleteProperty(window, 'pandaStage');
  vi.restoreAllMocks();
});

describe('Graphic face composite assembly & UI regression (#1112 / PR #1113 review)', () => {
  it('mounts character-assembly-face-drag-target & scale handle without double-transform for structured and fallback Graphic faces', () => {
    const leftOrigin = PROJECT_WIDTH / 2;
    const topOrigin = PROJECT_HEIGHT / 2;

    for (const structured of [true, false]) {
      const project = compositeGraphicProject({ structured });
      editorProjectStore.open(PROJECT_ROOT, project);
      const began = characterAssemblySessionStore.begin(IDS.character);
      expect(began.ok).toBe(true);
      const session = activeAssemblySession();
      const snapshot = editorProjectStore.getSnapshot()!;

      const markup = renderToStaticMarkup(
        createElement(CharacterAssemblyWorkbench, {
          projectSnapshot: snapshot,
          session,
        }),
      );
      expect(markup).toContain('data-testid="character-assembly-face-drag-target"');
      expect(markup).toContain('data-testid="character-assembly-face-scale-handle"');

      const dragLeft = parseInlinePx(markup, 'character-assembly-face-drag-target', 'left');
      const dragTop = parseInlinePx(markup, 'character-assembly-face-drag-target', 'top');
      const dragWidth = parseInlinePx(markup, 'character-assembly-face-drag-target', 'width');
      const dragHeight = parseInlinePx(markup, 'character-assembly-face-drag-target', 'height');
      const handleLeft = parseInlinePx(markup, 'character-assembly-face-scale-handle', 'left');
      const handleTop = parseInlinePx(markup, 'character-assembly-face-scale-handle', 'top');

      if (structured) {
        // 200x180 canvas * 0.5 around (offsetX=12, offsetY=-20) -> [-38, -65, 100, 90]
        expect(dragLeft).toBeCloseTo(leftOrigin - 38, 4);
        expect(dragTop).toBeCloseTo(topOrigin - 65, 4);
        expect(dragWidth).toBeCloseTo(100, 4);
        expect(dragHeight).toBeCloseTo(90, 4);
      } else {
        // Fallback cropped 80x70 at offset (0, 8) inside 200x180 canvas * 0.5 around (12, -20)
        expect(dragLeft).toBeCloseTo(leftOrigin + 12 + (0 - 100) * 0.5, 4);
        expect(dragTop).toBeCloseTo(topOrigin - 20 + (8 - 90) * 0.5, 4);
        expect(dragWidth).toBeCloseTo(40, 4);
        expect(dragHeight).toBeCloseTo(35, 4);
      }
      // Handle sits at the exact bottom-right corner of the mapped rect (not double-transformed).
      expect(handleLeft).toBeCloseTo(dragLeft + dragWidth, 4);
      expect(handleTop).toBeCloseTo(dragTop + dragHeight, 4);
      characterAssemblySessionStore.getActiveAssemblySessionHandle()?.cancel();
      editorProjectStore.clear();
    }

    // With rotation + flipX applied, faceHandlePoint must stay at faceContentRect bottom-right without double transform.
    const rotated = compositeGraphicProject({
      structured: true,
      rotationDeg: 25,
      flipX: true,
    });
    editorProjectStore.open(PROJECT_ROOT, rotated);
    characterAssemblySessionStore.begin(IDS.character);
    const rotatedSession = activeAssemblySession();
    const rotatedMarkup = renderToStaticMarkup(
      createElement(CharacterAssemblyWorkbench, {
        projectSnapshot: editorProjectStore.getSnapshot()!,
        session: rotatedSession,
      }),
    );
    const rLeft = parseInlinePx(rotatedMarkup, 'character-assembly-face-drag-target', 'left');
    const rTop = parseInlinePx(rotatedMarkup, 'character-assembly-face-drag-target', 'top');
    const rWidth = parseInlinePx(rotatedMarkup, 'character-assembly-face-drag-target', 'width');
    const rHeight = parseInlinePx(rotatedMarkup, 'character-assembly-face-drag-target', 'height');
    expect(rWidth).toBeGreaterThan(100);
    expect(parseInlinePx(rotatedMarkup, 'character-assembly-face-scale-handle', 'left')).toBeCloseTo(rLeft + rWidth, 4);
    expect(parseInlinePx(rotatedMarkup, 'character-assembly-face-scale-handle', 'top')).toBeCloseTo(rTop + rHeight, 4);
    expect(rotatedMarkup).toContain('transform:rotate(0deg) scaleX(1)');
  });

  it('supports pointer drag, Arrow key nudging, scale handle control, and loads fallback Graphic frame asset in CharacterAssemblyWorkbench', async () => {
    const requestedAssetIds: string[] = [];
    Object.assign(window, {
      pandaStage: {
        assets: {
          readCanvasImage: vi.fn(async ({ assetId }: { assetId: string }) => {
            requestedAssetIds.push(assetId);
            return {
              ok: false as const,
              error: {
                code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND' as const,
                message: 'stub',
                assetId,
              },
            };
          }),
        },
      } as unknown as Window['pandaStage'],
    });

    const project = compositeGraphicProject({ structured: false });
    editorProjectStore.open(PROJECT_ROOT, project);
    characterAssemblySessionStore.begin(IDS.character);

    await act(async () => {
      root.render(createElement(LiveAssemblyWorkbench));
      await Promise.resolve();
    });

    // Fallback Graphic face assetId is queued for loading alongside bodyAssetId.
    const fallbackFaceAssetId = project.animations[0]!.frames[0]!.assetId;
    expect(requestedAssetIds).toContain(fallbackFaceAssetId);

    const dragTarget = container.querySelector(
      '[data-testid="character-assembly-face-drag-target"]',
    ) as HTMLElement | null;
    expect(dragTarget).not.toBeNull();

    // Pointer drag updates facePlacement offset in the live assembly session store.
    act(() => {
      dragTarget!.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        }),
      );
      dragTarget!.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: 110,
          clientY: 105,
        }),
      );
      dragTarget!.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          clientX: 110,
          clientY: 105,
        }),
      );
    });
    const afterDrag = activeAssemblySession();
    expect(afterDrag.draft.facePlacement.offsetX).toBeGreaterThan(12);
    expect(afterDrag.draft.facePlacement.offsetY).toBeGreaterThan(-20);

    // Keyboard Arrow & Shift+Arrow nudging moves facePlacement precisely from the post-drag position.
    const prevX = afterDrag.draft.facePlacement.offsetX;
    const prevY = afterDrag.draft.facePlacement.offsetY;
    act(() => {
      dragTarget!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    act(() => {
      dragTarget!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    const afterNudge = activeAssemblySession();
    expect(afterNudge.draft.facePlacement.offsetX).toBeCloseTo(prevX + 1, 4);
    expect(afterNudge.draft.facePlacement.offsetY).toBeCloseTo(prevY - 10, 4);

    // Scale handle keyboard ArrowUp increases facePlacement.scale smoothly.
    const scaleHandle = container.querySelector(
      '[data-testid="character-assembly-face-scale-handle"]',
    ) as HTMLButtonElement | null;
    expect(scaleHandle).not.toBeNull();
    const prevScale = afterNudge.draft.facePlacement.scale;
    act(() => {
      scaleHandle!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
      );
    });
    const afterScale = activeAssemblySession();
    expect(afterScale.draft.facePlacement.scale).toBeCloseTo(prevScale + 0.05, 4);
  });

  it('marks Graphic mouth as configured in CharacterEditor, renders Graphic labels/previews in Inspector & ExpressionAtTimeControl, and resets add-form & GraphicFacePicker local UI state', () => {
    let project = graphicFaceProject();
    project = service.setExpressionVisualSource(
      project,
      IDS.character,
      IDS.expressionNormal,
      faceSource(0),
    );
    project = service.setExpressionVisualSource(
      project,
      IDS.character,
      IDS.expressionAngry,
      faceSource(2),
    );
    project = service.setMouthOpenVisualSource(
      project,
      IDS.character,
      faceSource(3),
    );
    project = new LayerService().createFromAsset(project, IDS.shot, {
      version: 2,
      type: 'character-expression',
      characterId: IDS.character,
      expressionId: IDS.expressionAngry,
      position: { x: 400, y: 500 },
    }).project;

    editorProjectStore.open(PROJECT_ROOT, project);
    const character = project.characters[0]!;
    const imageAssets = project.assets.filter(
      (asset): asset is ImageAsset => asset.kind === 'image',
    );
    const thumbnails = Object.fromEntries(
      imageAssets.map((asset) => [asset.id, { status: 'loading' as const }]),
    );
    const noop = () => undefined;

    const baseEditorProps = {
      character,
      imageAssets,
      thumbnails,
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
      onOpenAssembly: () => true,
      onLeaveAssembly: () => true,
      onSetAssemblyHeadAsset: noop,
      onSetAssemblyBodyAsset: noop,
      onSetAssemblyMouthAsset: noop,
      view: 'detail' as const,
    };

    // 1. CharacterEditor summary labels Graphic frames & landscape settings marks mouthOpenVisualSource configured.
    const defaultMarkup = renderToStaticMarkup(
      createElement(CharacterEditor, { ...baseEditorProps, presentation: 'default' }),
    );
    expect(defaultMarkup).toContain('<span>第 1 帧</span>');
    expect(defaultMarkup).toContain('<span>第 3 帧</span>');

    const landscapeMarkup = renderToStaticMarkup(
      createElement(CharacterEditor, { ...baseEditorProps, presentation: 'landscape' }),
    );
    expect(landscapeMarkup).toContain('character-mouth-state is-configured');
    expect(landscapeMarkup).toContain('data-mouth-configured="true"');

    // 2. ExpressionAtTimeControl & RightInspector getRightInspectorLayerSummary handle Graphic layers.
    const shot = project.shots[0]!;
    const graphicLayer = shot.layers.find((layer) => layer.id !== IDS.layerChar && layer.source.kind === 'character')!;
    timelineUiStore.seek(0, shot.durationMs);
    const summary = getRightInspectorLayerSummary(
      editorProjectStore.getSnapshot(),
      graphicLayer,
    );
    expect(summary.typeLabel).toBe('角色图层');
    expect(summary.graphicSource).toEqual(faceSource(2));
    act(() => {
      root.render(
        createElement(ExpressionAtTimeControl, {
          project,
          projectRoot: PROJECT_ROOT,
          shot,
          layer: graphicLayer,
        }),
      );
    });
    expect(container.querySelector('[role="img"][aria-label="正常"]')).not.toBeNull();
    expect(container.querySelector('[role="img"][aria-label="生气"]')).not.toBeNull();

    // 3. ExpressionEditor cancelAdd resets newGraphic alongside newAssetId.
    const onAddOpenChange = vi.fn();
    const onAddGraphic = vi.fn();
    act(() => {
      root.render(
        createElement(ExpressionEditor, {
          character,
          imageAssets,
          thumbnails,
          warnings: [],
          presentation: 'landscape',
          isAddOpen: true,
          onAddOpenChange,
          onAdd: noop,
          onRename: noop,
          onSetAsset: noop,
          onSetSource: noop,
          onAddGraphic,
          onRemove: noop,
          onSetDefault: noop,
          onThumbnailError: noop,
        }),
      );
    });
    const toggle = container.querySelector(
      '[data-testid="expression-add-asset-picker-graphic-toggle"]',
    ) as HTMLButtonElement;
    act(() => toggle.click());
    const defBtn = container.querySelector(
      '.expression-add-form-landscape .graphic-face-definitions button',
    ) as HTMLButtonElement;
    act(() => defBtn.click());
    const frameBtn = container.querySelector(
      '[data-testid="expression-add-asset-picker-frame-2"]',
    ) as HTMLButtonElement;
    act(() => frameBtn.click());
    const cancelBtn = container.querySelector(
      '[data-testid="expression-add-cancel"]',
    ) as HTMLButtonElement;
    act(() => cancelBtn.click());
    act(() => {
      root.render(
        createElement(ExpressionEditor, {
          character,
          imageAssets,
          thumbnails,
          warnings: [],
          presentation: 'landscape',
          isAddOpen: true,
          onAddOpenChange,
          onAdd: noop,
          onRename: noop,
          onSetAsset: noop,
          onSetSource: noop,
          onAddGraphic,
          onRemove: noop,
          onSetDefault: noop,
          onThumbnailError: noop,
        }),
      );
    });
    expect(
      container.querySelector('.expression-add-form-landscape .graphic-face-selected'),
    ).toBeNull();

    // 4. GraphicFacePicker hides stale "更换图片" child panel when source updates or clears,
    // and resets expanded drawer state when switching testId across expressions.
    const renderPicker = (
      source: ReturnType<typeof faceSource> | undefined,
      testId = 'picker-reset-check',
    ) => {
      act(() => {
        root.render(
          createElement(GraphicFacePicker, {
            source,
            onChange: noop,
            onClear: noop,
            testId,
            children: createElement('div', { 'data-testid': 'legacy-image-child' }, 'img-child'),
          }),
        );
      });
    };
    renderPicker(faceSource(0), 'expr-a');
    expect(container.querySelector('[data-testid="legacy-image-child"]')).toBeNull();
    const switchImgBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent === '更换图片',
    )!;
    act(() => switchImgBtn.click());
    expect(container.querySelector('[data-testid="legacy-image-child"]')).not.toBeNull();
    renderPicker(faceSource(1), 'expr-a');
    expect(container.querySelector('[data-testid="legacy-image-child"]')).toBeNull();

    // Opening expr-a then switching to expr-b resets open=false so expr-b toggle opens on first click.
    act(() => {
      (container.querySelector('[data-testid="expr-a-graphic-toggle"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('.graphic-face-options')).not.toBeNull();
    renderPicker(undefined, 'expr-b');
    expect(container.querySelector('.graphic-face-options')).toBeNull();
    act(() => {
      (container.querySelector('[data-testid="expr-b-graphic-toggle"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('.graphic-face-options')).not.toBeNull();
  });
});
