// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterService,
  FlaGraphicDefinitionSchema,
  buildAdaptivePartsFromFlaGraphicSubtrees,
  collectFlaGraphicSubtreeSelections,
  doFlaGraphicSubtreeSelectionsOverlap,
  type AdaptivePartsCharacter,
  type FlaGraphicDefinition,
  type FlaGraphicStructureNode,
  type Project,
} from '../../src/domain';
import {
  createAdaptiveCharacterFromFlaGraphic,
  formatFlaGraphicSkippedSummary,
} from '../../src/renderer/features/fla-import/createAdaptiveCharacterFromGraphic';
import {
  FlaCharacterImportFlow,
  type FlaCharacterImportAttempt,
} from '../../src/renderer/features/fla-import/FlaCharacterImportFlow';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';
import { FlaGraphicInstanceWorkbench } from '../../src/renderer/fla-import/FlaGraphicInstanceWorkbench';
import type { FlaRenderTarget } from '../../src/shared/fla-static-snapshot-api';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { CharacterStore } from '../../src/renderer/stores/characterStore';
import { characterStore } from '../../src/renderer/stores/characterStore';
import type { FlaGraphicInstanceCommitRequest, FlaGraphicInstanceCommitResponse } from '../../src/shared/fla-graphic-instance-api';
import {
  FLA_PARSER_COMMIT,
  FLA_PARSER_ENTRYPOINT,
  FLA_PARSER_PACKAGE,
  type FlaInspectionResponse,
} from '../../src/shared/fla-import-api';
import type { FlaPartPreviewResponse } from '../../src/shared/fla-part-preview-api';
import type { FlaRenderableTargetCatalogResponse } from '../../src/shared/fla-static-snapshot-api';
import { buildProject, IDS } from './domain/testProject';

const GRAPHIC_ID = 'c3000000-0000-4000-8000-000000000001';
const FRAME0_ASSET_ID = 'c5000000-0000-4000-8000-000000000001';
const BITMAP_ASSET_ID = 'c5000000-0000-4000-8000-000000000002';
const SHAPE_ASSET_ID = 'c5000000-0000-4000-8000-000000000003';
const FRAME_CROP_ASSET_ID = 'c5000000-0000-4000-8000-000000000004';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function matrix(tx = 0, ty = 0, scale = 1) {
  return { a: scale, b: 0, c: 0, d: scale, tx, ty };
}

function makeRichGraphicProject(nodes: FlaGraphicStructureNode[], includeFrameCrop = false): {
  project: Project;
  definition: FlaGraphicDefinition;
} {
  const base = buildProject();
  const assets = [
    ...base.assets,
    {
      id: FRAME0_ASSET_ID,
      kind: 'image' as const,
      name: 'frame0.svg',
      relativePath: 'assets/frame0.svg',
      mimeType: 'image/svg+xml',
      sha256: SHA_A,
      width: 400,
      height: 400,
      usage: 'uncategorized' as const,
      keywords: [],
      flaGraphicFrame: { definitionId: GRAPHIC_ID, ordinal: 0 },
    },
    {
      id: BITMAP_ASSET_ID,
      kind: 'image' as const,
      name: 'part-bitmap.png',
      relativePath: 'assets/part-bitmap.png',
      mimeType: 'image/png',
      sha256: SHA_B,
      width: 64,
      height: 64,
      usage: 'uncategorized' as const,
      keywords: [],
    },
    {
      id: SHAPE_ASSET_ID,
      kind: 'image' as const,
      name: 'part-shape.svg',
      relativePath: 'assets/part-shape.svg',
      mimeType: 'image/svg+xml',
      sha256: SHA_C,
      width: 80,
      height: 90,
      usage: 'uncategorized' as const,
      keywords: [],
    },
    ...(includeFrameCrop
      ? [
          {
            id: FRAME_CROP_ASSET_ID,
            kind: 'image' as const,
            name: 'frame-crop.svg',
            relativePath: 'assets/frame-crop.svg',
            mimeType: 'image/svg+xml',
            sha256: SHA_D,
            width: 400,
            height: 400,
            usage: 'uncategorized' as const,
            keywords: [],
          },
        ]
      : []),
  ];

  const definition = FlaGraphicDefinitionSchema.parse({
    id: GRAPHIC_ID,
    name: 'HeroRig',
    kind: 'fla-graphic',
    source: {
      basename: 'hero.fla',
      sha256: SHA_A,
      renderTargetId: 'fla-render-target-12345678',
      targetKind: 'graphic-symbol',
      targetName: 'HeroRig',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 400, height: 400 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 400, height: 400 },
    },
    durationMs: 1000 / 24,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: FRAME0_ASSET_ID,
        sha256: SHA_A,
        sourceViewport: { x: 0, y: 0, width: 400, height: 400 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: 1000 / 24,
        createdBySequenceImport: false,
      },
    ],
    structure: {
      version: 1,
      symbolDefinitions: {
        'Sym/Head': {
          symbolRef: 'Sym/Head',
          children: [
            {
              id: 'head-shape',
              type: 'opaque',
              opaqueKind: 'shape',
              drawOrder: 0,
              localTransform: matrix(0, 0),
              fallbackScope: 'subtree',
              fallbackAssetId: SHAPE_ASSET_ID,
              fallbackViewBox: { x: 0, y: 0, width: 80, height: 90 },
            },
          ],
        },
      },
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'main',
              nodes,
            },
          ],
        },
      ],
    },
  });

  const project: Project = {
    ...base,
    assets,
    animations: [definition],
  };
  return { project, definition };
}

function makeSubtreeGroupNode(id: string, groupId: string, drawOrder: number, tx: number, ty: number): FlaGraphicStructureNode {
  return {
    id,
    type: 'group',
    groupId,
    drawOrder,
    localTransform: matrix(tx, ty),
    children: [
      {
        id: `${id}-leaf`,
        type: 'opaque',
        opaqueKind: 'shape',
        drawOrder: 0,
        localTransform: matrix(0, 0),
        fallbackScope: 'subtree',
        fallbackAssetId: SHAPE_ASSET_ID,
        fallbackViewBox: { x: 0, y: 0, width: 80, height: 90 },
      },
    ],
  };
}

describe('collectFlaGraphicSubtreeSelections (#1203 V1-A)', () => {
  it('collects non-overlapping mixed Group/Symbol/Shape parts while degrading unsafe nodes locally', () => {
    const nodes: FlaGraphicStructureNode[] = [
      makeSubtreeGroupNode('g-back', '披风', 0, 10, 20),
      {
        id: 'sym-head',
        type: 'symbol',
        symbolRef: '角色部位/头部',
        nestedDefinitionId: 'Sym/Head',
        drawOrder: 1,
        localTransform: matrix(50, 30),
      },
      {
        id: 'shape-torso',
        type: 'opaque',
        opaqueKind: 'shape',
        drawOrder: 2,
        localTransform: matrix(100, 120),
        fallbackScope: 'subtree',
        fallbackAssetId: SHAPE_ASSET_ID,
        fallbackViewBox: { x: 0, y: 0, width: 80, height: 90 },
      },
      {
        id: 'g-unsafe-filter',
        type: 'opaque',
        opaqueKind: 'filter',
        drawOrder: 3,
        localTransform: matrix(0, 0),
        reason: '滤镜节点暂不支持独立拆分',
      },
      {
        id: 'g-mixed-rescue',
        type: 'group',
        groupId: 'fla-group-mixed',
        drawOrder: 4,
        localTransform: matrix(200, 100),
        children: [
          {
            id: 'arm-bitmap',
            type: 'bitmap',
            bitmapRef: '左臂.png',
            assetId: BITMAP_ASSET_ID,
            drawOrder: 0,
            localTransform: matrix(0, 0),
          },
          {
            id: 'overlapping-crop',
            type: 'opaque',
            opaqueKind: 'shape',
            drawOrder: 1,
            localTransform: matrix(0, 0),
            fallbackScope: 'frame-crop',
            fallbackAssetId: FRAME_CROP_ASSET_ID,
            fallbackViewBox: { x: 90, y: 110, width: 100, height: 100 },
          },
        ],
      },
    ];

    const { project, definition } = makeRichGraphicProject(nodes, true);
    const result = collectFlaGraphicSubtreeSelections({
      definition,
      frameOrdinal: 0,
      assets: project.assets,
    });

    expect(result.selections.map((s) => s.label)).toEqual([
      '披风',
      '头部',
      '零件 3',
      '左臂',
    ]);
    expect(result.selections.some((s) => (s.label ?? '').includes('未命名'))).toBe(false);
    expect(result.selections.some((s) => (s.label ?? '').includes('小师妹'))).toBe(false);
    expect(result.skipped.length).toBe(2);
    for (let i = 0; i < result.selections.length; i += 1) {
      for (let j = i + 1; j < result.selections.length; j += 1) {
        expect(
          doFlaGraphicSubtreeSelectionsOverlap(result.selections[i]!, result.selections[j]!),
        ).toBe(false);
      }
    }

    const built = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: result.selections,
      characterName: '测试混排角色',
    });
    expect(built.parts).toHaveLength(4);
    expect(built.parts.map((p) => p.drawOrder)).toEqual([0, 1, 2, 3]);
    expect(built.parts.every((p) => p.visualSource?.kind === 'fla-graphic')).toBe(true);
  });

  it('unwraps a single whole-artwork container one level and bypasses the 24-part PNG cap (28 subtrees)', () => {
    const innerParts: FlaGraphicStructureNode[] = Array.from({ length: 28 }, (_, index) =>
      makeSubtreeGroupNode(
        `part-${index}`,
        index % 2 === 0 ? `部件-${index + 1}` : `fla-group-${index}`,
        index,
        (index % 7) * 40,
        Math.floor(index / 7) * 40,
      ),
    );
    const singleRootWrapper: FlaGraphicStructureNode = {
      id: 'whole-wrapper',
      type: 'group',
      groupId: 'fla-group-root',
      drawOrder: 0,
      localTransform: matrix(0, 0),
      children: innerParts,
    };

    const { project, definition } = makeRichGraphicProject([singleRootWrapper]);
    const result = collectFlaGraphicSubtreeSelections({
      definition,
      frameOrdinal: 0,
      assets: project.assets,
    });

    expect(result.selections).toHaveLength(28);
    expect(result.selections[0]?.label).toBe('部件-1');
    expect(result.selections[1]?.label).toBe('零件 2');

    const built = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: result.selections,
    });
    expect(built.parts).toHaveLength(28);
    const charService = new CharacterService();
    const withChar = charService.createAdaptiveParts(project, built);
    const created = withChar.characters.at(-1) as AdaptivePartsCharacter;
    expect(created.mode).toBe('adaptive-parts');
    expect(created.parts).toHaveLength(28);
  });

  it('does not auto-split a single Shape into multiple parts', () => {
    const singleShape: FlaGraphicStructureNode = {
      id: 'only-shape',
      type: 'opaque',
      opaqueKind: 'shape',
      drawOrder: 0,
      localTransform: matrix(0, 0),
      fallbackScope: 'subtree',
      fallbackAssetId: SHAPE_ASSET_ID,
      fallbackViewBox: { x: 0, y: 0, width: 80, height: 90 },
    };
    const { project, definition } = makeRichGraphicProject([singleShape]);
    const result = collectFlaGraphicSubtreeSelections({
      definition,
      frameOrdinal: 0,
      assets: project.assets,
    });

    expect(result.selections).toHaveLength(1);
  });
});

describe('createAdaptiveCharacterFromFlaGraphic & FlaCharacterImportFlow (#1203 V1-A)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let priorPandaStageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    priorPandaStageDescriptor = Object.getOwnPropertyDescriptor(window, 'pandaStage');
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    editorProjectStore.clear();
    if (priorPandaStageDescriptor) {
      Object.defineProperty(window, 'pandaStage', priorPandaStageDescriptor);
    } else {
      Reflect.deleteProperty(window, 'pandaStage');
    }
  });

  function makeGraphicPreview(sessionId: string): Extract<
    FlaPartPreviewResponse,
    { ok: true; status: 'PREVIEW_READY'; capability: 'GRAPHIC_INSTANCES_READY' }
  > & { sessionId: string; generation: number } {
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    return {
      ok: true,
      status: 'PREVIEW_READY',
      capability: 'GRAPHIC_INSTANCES_READY',
      requestId: '00000000-0000-4000-8000-000000000101',
      sessionId,
      generation: 1,
      planId: '00000000-0000-4000-8000-000000000102',
      poseIdentity: SHA_A,
      target: {
        renderTargetId: 'fla-render-target-scene000001',
        userLabel: '主场景',
        frameCount: 1,
        selectedFrameIndex: 0,
      },
      stage: { width: 400, height: 400, pixelCount: 160000 },
      nativePreview: {
        width: 400,
        height: 400,
        pixelCount: 160000,
        sha256: SHA_A,
        byteLength: pngBytes.byteLength,
        bytes: pngBytes,
      },
      partPreviews: [
        {
          unitId: 'part-001-graphic0001',
          occurrenceId: 'occ-11111111111111111111111111111111',
          sourceKind: 'graphic-symbol-occurrence',
          sourceSymbolId: 'Lib/HeroRig',
          sourceAddress: 'scene/layer-0/0',
          adapterIdentity: 'Lib/HeroRig',
          sourceDefinitionFrameCount: 1,
          layerName: 'Layer 1',
          drawOrder: 0,
          graphicInstanceImportable: true,
          image: {
            width: 400,
            height: 400,
            pixelCount: 160000,
            sha256: SHA_B,
            byteLength: pngBytes.byteLength,
            bytes: pngBytes,
          },
        },
      ],
      reassembledPreview: null,
      metrics: {
        preparedSourceCacheHit: false,
        sourcePreparationCountForRequest: 1,
        displayListResolveCount: 1,
        rasterCount: 2,
        unitCount: 1,
        totalPngBytes: 8,
        elapsedMs: 1,
      },
    };
  }

  it('commits Definition without shotId, survives character creation failure, and reuses Definition on retry', async () => {
    const store = new EditorProjectStore();
    const baseProject = buildProject();
    store.open('D:\\Temp\\TestProject', baseProject);
    const characters = new CharacterStore(store, new CharacterService());
    const nodes = Array.from({ length: 12 }, (_, index) =>
      makeSubtreeGroupNode(`part-${index}`, `部件-${index + 1}`, index, index * 10, 0),
    );
    const { project: withGraphicProject } = makeRichGraphicProject(nodes);
    const committedProject: Project = {
      ...baseProject,
      assets: withGraphicProject.assets,
      animations: withGraphicProject.animations,
    };

    const commitGraphicInstance = vi.fn<
      (request: FlaGraphicInstanceCommitRequest) => Promise<FlaGraphicInstanceCommitResponse>
    >(async () => {
      const current = store.getSnapshot()!;
      const alreadyExists = current.project.animations.some((a) => a.id === GRAPHIC_ID);
      return {
        ok: true,
        status: 'completed',
        requestId: '00000000-0000-4000-8000-000000000201',
        projectRoot: current.projectRoot,
        projectId: current.project.id,
        openInstanceId: store.getProjectInstanceId()!,
        baseRevision: current.revision,
        savedRevision: alreadyExists ? current.revision : current.revision + 1,
        projectChanged: !alreadyExists,
        project: committedProject,
        animationId: GRAPHIC_ID,
        layerId: null,
      };
    });

    const spyCreateAdaptive = vi.spyOn(characters, 'createAdaptiveParts')
      .mockImplementationOnce(() => {
        throw new Error('模拟角色写入失败');
      });

    const sessionId = '00000000-0000-4000-8000-000000000301';
    const preview = makeGraphicPreview(sessionId);

    const firstAttempt = await createAdaptiveCharacterFromFlaGraphic({
      preview,
      unitId: 'part-001-graphic0001',
      characterName: '英雄角色',
      api: { commitGraphicInstance },
      store,
      characters,
    });

    expect(firstAttempt.ok).toBe(false);
    if (firstAttempt.ok) throw new Error('expected failure on first attempt');
    expect(firstAttempt.kind).toBe('character-create-failed');
    expect(firstAttempt.animationId).toBe(GRAPHIC_ID);
    expect(commitGraphicInstance).toHaveBeenCalledTimes(1);
    expect(commitGraphicInstance.mock.calls[0]?.[0]).not.toHaveProperty('shotId');
    // Definition persisted cleanly; no duplicate character created and no shot layers added.
    expect(store.getSnapshot()!.project.animations.filter((a) => a.id === GRAPHIC_ID)).toHaveLength(1);
    expect(store.getSnapshot()!.project.characters).toHaveLength(baseProject.characters.length);
    expect(store.getSnapshot()!.project.shots[0]!.layers).toHaveLength(baseProject.shots[0]!.layers.length);

    spyCreateAdaptive.mockRestore();

    const retryAttempt = await createAdaptiveCharacterFromFlaGraphic({
      preview,
      unitId: 'part-001-graphic0001',
      characterName: '英雄角色',
      reusedAnimationId: firstAttempt.animationId,
      api: { commitGraphicInstance },
      store,
      characters,
    });

    expect(retryAttempt.ok).toBe(true);
    if (!retryAttempt.ok) throw new Error('expected retry to succeed');
    expect(retryAttempt.partCount).toBe(12);
    // Definition was reused directly without re-committing source files!
    expect(commitGraphicInstance).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()!.project.animations.filter((a) => a.id === GRAPHIC_ID)).toHaveLength(1);
    const createdChar = store.getSnapshot()!.project.characters.find(
      (c) => c.id === retryAttempt.characterId,
    ) as AdaptivePartsCharacter;
    expect(createdChar.mode).toBe('adaptive-parts');
    expect(createdChar.parts).toHaveLength(12);
    expect(createdChar.parts.every((p) => p.visualSource?.kind === 'fla-graphic')).toBe(true);
  });

  it('completes end-to-end FlaCharacterImportFlow for a 10+ part Graphic and opens assembly', async () => {
    const baseProject = buildProject();
    editorProjectStore.open('D:\\Temp\\FlowProject', baseProject);
    const sessionId = '00000000-0000-4000-8000-000000000401';
    const preview = makeGraphicPreview(sessionId);
    const nodes = Array.from({ length: 11 }, (_, index) =>
      makeSubtreeGroupNode(`part-${index}`, `部件-${index + 1}`, index, index * 20, 0),
    );
    const { project: withGraphicProject } = makeRichGraphicProject(nodes);

    const catalogResponse: FlaRenderableTargetCatalogResponse = {
      ok: true,
      sessionId,
      omittedCandidateCount: 0,
      summary: 'ok',
      entries: [
        {
          target: {
            renderTargetId: 'fla-render-target-scene000001',
            kind: 'scene',
            userLabel: '主场景 · 第 1 帧',
            sourceTimelineIndex: 0,
            frameCount: 1,
            selectedFrameIndex: 0,
            compatibility: ['degraded'],
          },
          catalogRole: 'scene',
          previewSupported: true,
          isBlank: false,
        },
      ],
    };

    const inspectionResponse: FlaInspectionResponse = {
      ok: true,
      sessionId,
      ir: {
        source: {
          format: 'fla',
          basename: 'hero.fla',
          byteLength: 100,
          sha256: SHA_A,
          parser: {
            package: FLA_PARSER_PACKAGE,
            entrypoint: FLA_PARSER_ENTRYPOINT,
            commit: FLA_PARSER_COMMIT,
          },
        },
        document: {
          width: 400,
          height: 400,
          frameRate: 24,
          backgroundColor: '#FFFFFF',
        },
        media: [],
        timelines: [],
        compatibility: [],
        summary: {
          placedInstanceCount: 1,
          libraryOnlyMediaCount: 0,
        },
      },
      diagnostics: [],
    };

    const commitGraphicInstance = vi.fn(async (): Promise<FlaGraphicInstanceCommitResponse> => {
      const snap = editorProjectStore.getSnapshot()!;
      return {
        ok: true,
        status: 'completed',
        requestId: '00000000-0000-4000-8000-000000000403',
        projectRoot: snap.projectRoot,
        projectId: snap.project.id,
        openInstanceId: editorProjectStore.getProjectInstanceId()!,
        baseRevision: snap.revision,
        savedRevision: snap.revision + 1,
        projectChanged: true,
        project: {
          ...snap.project,
          assets: withGraphicProject.assets,
          animations: withGraphicProject.animations,
        },
        animationId: GRAPHIC_ID,
        layerId: null,
      };
    });

    Object.defineProperty(window, 'pandaStage', {
      configurable: true,
      value: {
        fla: {
          chooseAndInspect: vi.fn(),
          onInspectionStarted: vi.fn(() => () => undefined),
          cancel: vi.fn(async () => undefined),
          staticSnapshotCatalog: vi.fn(async () => catalogResponse),
          staticSnapshotCancel: vi.fn(async () => ({ accepted: true })),
          partPreview: vi.fn(async () => preview),
          partPreviewCancel: vi.fn(async () => ({ accepted: true })),
          commitGraphicInstance,
        },
      },
    });

    const attempt: FlaCharacterImportAttempt = {
      lifecycle: { cancel: vi.fn(async () => undefined) } as unknown as FlaCharacterImportAttempt['lifecycle'],
      operation: {
        requestId: '00000000-0000-4000-8000-000000000404',
        inspectionStarted: Promise.resolve(),
        response: Promise.resolve(inspectionResponse),
      },
    };

    const openedCharacters: string[] = [];
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        createElement(FlaCharacterImportFlow, {
          snapshot: editorProjectStore.getSnapshot(),
          attempt,
          onCreateCharacter: vi.fn(),
          onCreateCharacterFromGraphic: (input) =>
            createAdaptiveCharacterFromFlaGraphic({
              ...input,
              api: { commitGraphicInstance },
              store: editorProjectStore,
              characters: characterStore,
            }),
          onQueryCharacterCreateStatus: vi.fn(),
          onCreatedCharacter: (characterId) => {
            openedCharacters.push(characterId);
            return true;
          },
          onClose,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const createButton = document.querySelector<HTMLButtonElement>('[data-testid="fla-character-import-create"]');
    expect(createButton).not.toBeNull();
    expect(createButton!.disabled).toBe(false);
    expect(document.querySelector('[data-testid="fla-character-import-graphic-badge"]')?.textContent)
      .toContain('Graphic 元件');

    await act(async () => {
      createButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(openedCharacters).toHaveLength(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const createdChar = editorProjectStore.getSnapshot()!.project.characters.find(
      (c) => c.id === openedCharacters[0],
    ) as AdaptivePartsCharacter;
    expect(createdChar.name).toBe('HeroRig');
    expect(createdChar.parts).toHaveLength(11);
    expect(createdChar.parts.every((p) => p.visualSource?.kind === 'fla-graphic')).toBe(true);
    expect(IDS.shot).toBeDefined();
  });

  it('keeps legacy PNG character import path working when no Graphic instances exist (#1203 V1-A non-regression)', async () => {
    const baseProject = buildProject();
    editorProjectStore.open('D:\\Temp\\LegacyPngProject', baseProject);
    const sessionId = '00000000-0000-4000-8000-000000000501';
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const wholeImageFallback: FlaPartPreviewResponse = {
      ok: true,
      status: 'PREVIEW_READY',
      capability: 'WHOLE_IMAGE_ONLY',
      reason: 'No importable source-addressed Graphic instance was found.',
      requestId: '00000000-0000-4000-8000-000000000502',
      sessionId,
      generation: 1,
      planId: '00000000-0000-4000-8000-000000000503',
      poseIdentity: SHA_A,
      target: {
        renderTargetId: 'fla-render-target-scene000001',
        userLabel: '主场景 · 第 1 帧',
        frameCount: 1,
        selectedFrameIndex: 0,
      },
      stage: { width: 400, height: 400, pixelCount: 160000 },
      nativePreview: {
        width: 400,
        height: 400,
        pixelCount: 160000,
        sha256: SHA_A,
        byteLength: pngBytes.byteLength,
        bytes: pngBytes,
      },
      partPreviews: [],
      reassembledPreview: null,
      metrics: {
        preparedSourceCacheHit: false,
        sourcePreparationCountForRequest: 1,
        displayListResolveCount: 1,
        rasterCount: 1,
        unitCount: 0,
        totalPngBytes: 4,
        elapsedMs: 1,
      },
    };
    const editablePngPreview: FlaPartPreviewResponse = {
      ok: true,
      status: 'PREVIEW_READY',
      capability: 'EDITABLE_PARTS_READY',
      requestId: '00000000-0000-4000-8000-000000000504',
      sessionId,
      generation: 2,
      planId: '00000000-0000-4000-8000-000000000505',
      poseIdentity: SHA_B,
      target: {
        renderTargetId: 'fla-render-target-scene000001',
        userLabel: '主场景 · 第 1 帧',
        frameCount: 1,
        selectedFrameIndex: 0,
      },
      stage: { width: 400, height: 400, pixelCount: 160000 },
      nativePreview: {
        width: 400,
        height: 400,
        pixelCount: 160000,
        sha256: SHA_A,
        byteLength: pngBytes.byteLength,
        bytes: pngBytes,
      },
      partPreviews: [
        {
          unitId: 'part-001-shape01',
          occurrenceId: 'occ-11111111111111111111111111111111',
          sourceKind: 'shape-occurrence',
          sourceSymbolId: null,
          sourceAddress: 'scene/0/0',
          adapterIdentity: null,
          sourceDefinitionFrameCount: null,
          layerName: 'Layer 1',
          drawOrder: 0,
          image: {
            width: 400,
            height: 400,
            pixelCount: 160000,
            sha256: SHA_B,
            byteLength: pngBytes.byteLength,
            bytes: pngBytes,
          },
        },
        {
          unitId: 'part-002-shape02',
          occurrenceId: 'occ-22222222222222222222222222222222',
          sourceKind: 'shape-occurrence',
          sourceSymbolId: null,
          sourceAddress: 'scene/0/1',
          adapterIdentity: null,
          sourceDefinitionFrameCount: null,
          layerName: 'Layer 1',
          drawOrder: 1,
          image: {
            width: 400,
            height: 400,
            pixelCount: 160000,
            sha256: SHA_C,
            byteLength: pngBytes.byteLength,
            bytes: pngBytes,
          },
        },
      ],
      reassembledPreview: {
        width: 400,
        height: 400,
        pixelCount: 160000,
        sha256: SHA_A,
        byteLength: pngBytes.byteLength,
        bytes: pngBytes,
      },
      metrics: {
        preparedSourceCacheHit: false,
        sourcePreparationCountForRequest: 0,
        displayListResolveCount: 3,
        rasterCount: 4,
        unitCount: 2,
        totalPngBytes: 16,
        elapsedMs: 1,
      },
    };
    const catalogResponse: FlaRenderableTargetCatalogResponse = {
      ok: true,
      sessionId,
      omittedCandidateCount: 0,
      summary: 'ok',
      entries: [
        {
          target: {
            renderTargetId: 'fla-render-target-scene000001',
            kind: 'scene',
            userLabel: '主场景 · 第 1 帧',
            sourceTimelineIndex: 0,
            frameCount: 1,
            selectedFrameIndex: 0,
            compatibility: ['degraded'],
          },
          catalogRole: 'scene',
          previewSupported: true,
          isBlank: false,
        },
      ],
    };
    const inspectionResponse: FlaInspectionResponse = {
      ok: true,
      sessionId,
      ir: {
        source: {
          format: 'fla',
          basename: 'legacy-png.fla',
          byteLength: 100,
          sha256: SHA_A,
          parser: {
            package: FLA_PARSER_PACKAGE,
            entrypoint: FLA_PARSER_ENTRYPOINT,
            commit: FLA_PARSER_COMMIT,
          },
        },
        document: { width: 400, height: 400, frameRate: 24, backgroundColor: '#FFFFFF' },
        media: [],
        timelines: [],
        compatibility: [],
        summary: { placedInstanceCount: 2, libraryOnlyMediaCount: 0 },
      },
      diagnostics: [],
    };
    const partPreviewMock = vi.fn(async (req: { purpose?: string }) =>
      req.purpose === 'graphic-instance' ? wholeImageFallback : editablePngPreview,
    );
    Object.defineProperty(window, 'pandaStage', {
      configurable: true,
      value: {
        fla: {
          chooseAndInspect: vi.fn(),
          onInspectionStarted: vi.fn(() => () => undefined),
          cancel: vi.fn(async () => undefined),
          staticSnapshotCatalog: vi.fn(async () => catalogResponse),
          staticSnapshotCancel: vi.fn(async () => ({ accepted: true })),
          partPreview: partPreviewMock,
          partPreviewCancel: vi.fn(async () => ({ accepted: true })),
        },
      },
    });
    const attempt: FlaCharacterImportAttempt = {
      lifecycle: { cancel: vi.fn(async () => undefined) } as unknown as FlaCharacterImportAttempt['lifecycle'],
      operation: {
        requestId: '00000000-0000-4000-8000-000000000506',
        inspectionStarted: Promise.resolve(),
        response: Promise.resolve(inspectionResponse),
      },
    };
    const onCreateCharacter = vi.fn(async () => ({
      operationId: 'op-1',
      projectRoot: 'D:\\Temp\\LegacyPngProject',
      projectId: baseProject.id,
      openInstanceId: editorProjectStore.getProjectInstanceId()!,
      baseRevision: 0,
      savedRevision: 1,
      characterId: 'legacy-char-1',
      voiceProfileId: 'vp-1',
      identity: {
        planId: editablePngPreview.planId,
        sessionId,
        requestId: '00000000-0000-4000-8000-000000000504',
        generation: 2,
        rawSourceSha256: SHA_A,
        normalizedSourceSha256: SHA_A,
        poseIdentity: editablePngPreview.poseIdentity,
        target: {
          renderTargetId: 'fla-render-target-scene000001',
          kind: 'scene' as const,
          sceneIndex: 0,
          sourceLibraryItemName: null,
          selectedFrameIndex: 0,
        },
      },
      assets: [],
      createdAssetCount: 0,
      reusedAssetCount: 0,
    }));

    await act(async () => {
      root.render(
        createElement(FlaCharacterImportFlow, {
          snapshot: editorProjectStore.getSnapshot(),
          attempt,
          onCreateCharacter,
          onCreateCharacterFromGraphic: vi.fn(),
          onQueryCharacterCreateStatus: vi.fn(),
          onCreatedCharacter: () => true,
          onClose: vi.fn(),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(document.querySelector('[data-testid="fla-character-import-graphic-badge"]')).toBeNull();
    expect(document.querySelector('[data-testid="fla-character-import-parts-toggle"]')?.textContent)
      .toContain('零件 2');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-character-import-create"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onCreateCharacter).toHaveBeenCalledTimes(1);
  });

  it('formats skipped-only, warnings-only, merged+deduped, and clean summaries (#1206)', () => {
    expect(formatFlaGraphicSkippedSummary(4, [], [])).toBeUndefined();
    expect(
      formatFlaGraphicSkippedSummary(4, [
        { nodePath: ['bad'], label: '滤镜', reason: '滤镜节点暂不支持独立拆分' },
      ]),
    ).toBe('已创建 4 个可编辑零件，已跳过 1 个不支持独立提取的节点（滤镜节点暂不支持独立拆分）');

    expect(
      formatFlaGraphicSkippedSummary(
        2,
        [],
        ['包含不支持独立提取的子节点，创建零件时会跳过这些子节点。'],
      ),
    ).toBe(
      '角色已创建（2 个可编辑零件），部分内容存在限制或已跳过：包含不支持独立提取的子节点，创建零件时会跳过这些子节点。',
    );

    expect(
      formatFlaGraphicSkippedSummary(
        3,
        [{ nodePath: ['bad'], label: '滤镜', reason: '原因 A' }],
        ['原因 A', '原因 B', '原因 B'],
      ),
    ).toBe('角色已创建（3 个可编辑零件），已跳过 1 个不支持独立提取的节点（原因 A；原因 B）');
  });

  it('surfaces mixed-Group descendant warnings identically across both 主入口 and 快捷入口 (#1206)', async () => {
    const mixedNodes: FlaGraphicStructureNode[] = [
      {
        id: 'mixed-group',
        type: 'group',
        groupId: '混合部位',
        drawOrder: 0,
        localTransform: matrix(10, 10),
        children: [
          {
            id: 'mixed-valid-shape',
            type: 'opaque',
            opaqueKind: 'shape',
            drawOrder: 0,
            localTransform: matrix(0, 0),
            fallbackScope: 'subtree',
            fallbackAssetId: SHAPE_ASSET_ID,
            fallbackViewBox: { x: 0, y: 0, width: 80, height: 90 },
          },
          {
            id: 'mixed-unrenderable-child',
            type: 'opaque',
            opaqueKind: 'filter',
            drawOrder: 1,
            localTransform: matrix(0, 0),
            reason: '滤镜节点暂不支持独立拆分',
          },
        ],
      },
      makeSubtreeGroupNode('clean-group', '完整部位', 1, 100, 20),
    ];

    const { project: withMixedGraphic } = makeRichGraphicProject(mixedNodes);
    const mixedCollection = collectFlaGraphicSubtreeSelections({
      definition: withMixedGraphic.animations[0] as FlaGraphicDefinition,
      frameOrdinal: 0,
      assets: withMixedGraphic.assets,
    });
    expect(mixedCollection.selections).toHaveLength(2);
    expect(mixedCollection.skipped).toEqual([]);
    expect(mixedCollection.warnings).toEqual([
      '包含不支持独立提取的子节点，创建零件时会跳过这些子节点。',
    ]);

    // 1) 主入口「导入角色」: FlaCharacterImportFlow -> CharacterManager.character-manager-status
    const baseProject = buildProject();
    editorProjectStore.open('D:\\Temp\\MixedGroupEntry1', baseProject);
    const sessionId1 = '00000000-0000-4000-8000-000000000601';
    const preview1 = makeGraphicPreview(sessionId1);
    const catalogResponse1: FlaRenderableTargetCatalogResponse = {
      ok: true,
      sessionId: sessionId1,
      omittedCandidateCount: 0,
      summary: 'ok',
      entries: [
        {
          target: {
            renderTargetId: 'fla-render-target-scene000001',
            kind: 'scene',
            userLabel: '主场景 · 第 1 帧',
            sourceTimelineIndex: 0,
            frameCount: 1,
            selectedFrameIndex: 0,
            compatibility: ['degraded'],
          },
          catalogRole: 'scene',
          previewSupported: true,
          isBlank: false,
        },
      ],
    };
    const inspectionResponse1: FlaInspectionResponse = {
      ok: true,
      sessionId: sessionId1,
      ir: {
        source: {
          format: 'fla',
          basename: 'mixed-group.fla',
          byteLength: 100,
          sha256: SHA_A,
          parser: {
            package: FLA_PARSER_PACKAGE,
            entrypoint: FLA_PARSER_ENTRYPOINT,
            commit: FLA_PARSER_COMMIT,
          },
        },
        document: { width: 400, height: 400, frameRate: 24, backgroundColor: '#FFFFFF' },
        media: [],
        timelines: [],
        compatibility: [],
        summary: { placedInstanceCount: 1, libraryOnlyMediaCount: 0 },
      },
      diagnostics: [],
    };
    const commitGraphicInstance = vi.fn(async (): Promise<FlaGraphicInstanceCommitResponse> => {
      const snap = editorProjectStore.getSnapshot()!;
      return {
        ok: true,
        status: 'completed',
        requestId: '00000000-0000-4000-8000-000000000602',
        projectRoot: snap.projectRoot,
        projectId: snap.project.id,
        openInstanceId: editorProjectStore.getProjectInstanceId()!,
        baseRevision: snap.revision,
        savedRevision: snap.revision + 1,
        projectChanged: true,
        project: {
          ...snap.project,
          assets: withMixedGraphic.assets,
          animations: withMixedGraphic.animations,
        },
        animationId: GRAPHIC_ID,
        layerId: null,
      };
    });

    Object.defineProperty(window, 'pandaStage', {
      configurable: true,
      value: {
        assets: {
          readThumbnail: vi.fn(async () => ({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'not mocked' },
          })),
        },
        fla: {
          chooseAndInspect: vi.fn(),
          onInspectionStarted: vi.fn(() => () => undefined),
          cancel: vi.fn(async () => undefined),
          staticSnapshotCatalog: vi.fn(async () => catalogResponse1),
          staticSnapshotCancel: vi.fn(async () => ({ accepted: true })),
          partPreview: vi.fn(async () => preview1),
          partPreviewCancel: vi.fn(async () => ({ accepted: true })),
          commitGraphicInstance,
        },
      },
    });
    const attempt1: FlaCharacterImportAttempt = {
      lifecycle: { cancel: vi.fn(async () => undefined) } as unknown as FlaCharacterImportAttempt['lifecycle'],
      operation: {
        requestId: '00000000-0000-4000-8000-000000000603',
        inspectionStarted: Promise.resolve(),
        response: Promise.resolve(inspectionResponse1),
      },
    };

    function CharacterManagerHost() {
      const snap = useSyncExternalStore(
        editorProjectStore.subscribe,
        editorProjectStore.getSnapshot,
        editorProjectStore.getSnapshot,
      );
      return createElement(CharacterManager, {
        snapshot: snap,
        view: 'list',
        flaCharacterImportAttempt: attempt1,
        onCreateFlaCharacter: vi.fn(),
        onCreateCharacterFromGraphic: (input) =>
          createAdaptiveCharacterFromFlaGraphic({
            ...input,
            api: { commitGraphicInstance },
            store: editorProjectStore,
            characters: characterStore,
          }),
        onQueryFlaCharacterCreateStatus: vi.fn(),
      });
    }

    await act(async () => {
      root.render(createElement(CharacterManagerHost));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-character-import-create"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const expectedNotice =
      '角色已创建（2 个可编辑零件），部分内容存在限制或已跳过：包含不支持独立提取的子节点，创建零件时会跳过这些子节点。';
    const entry1Statuses = container.querySelectorAll('.character-manager-status');
    expect(entry1Statuses).toHaveLength(1);
    expect(entry1Statuses[0]?.textContent).toBe(expectedNotice);
    expect(characterAssemblySessionStore.getSnapshot()?.kind).toBe('adaptive-parts');

    // 2) 快捷入口「导入 FLA → 创建为角色」: FlaGraphicInstanceWorkbench -> CharacterManager
    characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
    await act(async () => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    editorProjectStore.open('D:\\Temp\\MixedGroupEntry2', baseProject);
    const sessionId2 = '00000000-0000-4000-8000-000000000701';
    const preview2 = makeGraphicPreview(sessionId2);
    Object.defineProperty(window, 'pandaStage', {
      configurable: true,
      value: {
        assets: {
          readThumbnail: vi.fn(async () => ({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'not mocked' },
          })),
        },
        fla: {
          partPreview: vi.fn(async () => preview2),
          partPreviewCancel: vi.fn(async () => ({ accepted: true })),
        },
      },
    });

    let createdFromWorkbench: {
      characterId: string;
      notice?: string;
      nonce: number;
    } | null = null;
    function Entry2Host() {
      const snap = useSyncExternalStore(
        editorProjectStore.subscribe,
        editorProjectStore.getSnapshot,
        editorProjectStore.getSnapshot,
      );
      if (!createdFromWorkbench) {
        return createElement(FlaGraphicInstanceWorkbench, {
          enabled: true,
          sessionId: sessionId2,
          source: { basename: 'mixed-group.fla', sha256: SHA_A },
          targetRenderTargetId: 'fla-render-target-scene000001' as FlaRenderTarget['renderTargetId'],
          targetLookupPending: false,
          importDisabledReason: null,
          onCreateCharacterFromGraphic: (input) =>
            createAdaptiveCharacterFromFlaGraphic({
              ...input,
              api: { commitGraphicInstance },
              store: editorProjectStore,
              characters: characterStore,
            }),
          onCharacterCreated: (result) => {
            expect(result.skipped).toEqual([]);
            expect(result.warnings).toEqual([
              '包含不支持独立提取的子节点，创建零件时会跳过这些子节点。',
            ]);
            createdFromWorkbench = {
              characterId: result.characterId,
              notice: formatFlaGraphicSkippedSummary(
                result.partCount,
                result.skipped,
                result.warnings,
              ),
              nonce: 1,
            };
          },
        });
      }
      return createElement(CharacterManager, {
        snapshot: snap,
        view: 'list',
        externalCreatedCharacter: createdFromWorkbench,
      });
    }

    await act(async () => {
      root.render(createElement(Entry2Host));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-candidate-part-001-graphic0001"]')!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-create-character"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // Re-render host once createdFromWorkbench is captured so CharacterManager mounts with it.
    await act(async () => {
      root.render(createElement(Entry2Host));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const entry2Statuses = container.querySelectorAll('.character-manager-status');
    expect(entry2Statuses).toHaveLength(1);
    expect(entry2Statuses[0]?.textContent).toBe(expectedNotice);
    const assemblySnap = characterAssemblySessionStore.getSnapshot();
    expect(assemblySnap?.kind).toBe('adaptive-parts');
    if (assemblySnap?.kind === 'adaptive-parts') {
      expect(assemblySnap.characterId).toBe(createdFromWorkbench!.characterId);
    }
  });
});
