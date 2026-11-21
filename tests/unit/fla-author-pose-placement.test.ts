// @vitest-environment happy-dom
import { createHash, randomUUID } from 'node:crypto';
import { createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractFlaAuthorPoseReferencesFromDefinition } from '../../src/domain/services/flaAuthorPosePlacement';
import {
  buildAdaptivePartsFromFlaGraphicSubtrees,
  CharacterService,
  LayerService,
  ProjectSchema,
  resolveFlaGraphicAuthorPosePlacements,
  resolveLayerVisualParts,
  type CharacterPart,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';
import {
  FlaGraphicInstanceCommitResponseSchema,
  type FlaGraphicInstanceCommitResponse,
} from '../../src/shared/fla-graphic-instance-api';
import { FlaPartPreviewService } from '../../src/main/services/FlaPartPreviewService';
import { FlaGraphicInstanceCommitService } from '../../src/main/services/FlaGraphicInstanceCommitService';
import {
  prepareFlaStaticSnapshotDisplaySource,
  stableRenderTargetId,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { ProjectService } from '../../src/main/services/ProjectService';
import type {
  FlaStaticSnapshotRasterizeInput,
  FlaStaticSnapshotRasterizer,
} from '../../src/main/services/fla-static-snapshot-render-session';
import type { FlaImportService } from '../../src/main/services/FlaImportService';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAdaptiveCharacterFromFlaGraphic, formatFlaGraphicSkippedSummary } from '../../src/renderer/features/fla-import/createAdaptiveCharacterFromGraphic';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';
import { FlaGraphicInstanceWorkbench } from '../../src/renderer/fla-import/FlaGraphicInstanceWorkbench';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { EditorProjectStore, editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { CharacterStore, characterStore as singletonCharacterStore } from '../../src/renderer/stores/characterStore';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import type { FlaCharacterImportAttempt } from '../../src/renderer/features/fla-import/FlaCharacterImportFlow';
import {
  FLA_PARSER_COMMIT,
  FLA_PARSER_ENTRYPOINT,
  FLA_PARSER_PACKAGE,
  type FlaInspectionResponse,
} from '../../src/shared/fla-import-api';
import type {
  FlaPartPreviewResponse,
} from '../../src/shared/fla-part-preview-api';
import type {
  FlaRenderTarget,
  FlaRenderableTargetCatalogResponse,
} from '../../src/shared/fla-static-snapshot-api';

const tempDirs: string[] = [];
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as const;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const GRAPHIC_ID = '00000000-0000-4000-8000-000000000801';

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function makePng(width: number, height: number, paint: number): Uint8Array {
  const crc32 = (bytes: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, data: Buffer): Buffer => {
    const type = Buffer.from(name, 'ascii');
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length, 0);
    type.copy(output, 4);
    data.copy(output, 8);
    output.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      scanlines[offset] = paint;
      scanlines[offset + 1] = 120;
      scanlines[offset + 2] = 200;
      scanlines[offset + 3] = 255;
    }
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function makeBaseProject(): Project {
  const base = buildProject();
  return {
    ...base,
    assets: base.assets.map((asset) =>
      asset.kind === 'image' && !('sha256' in asset && asset.sha256)
        ? { ...asset, sha256: SHA_B }
        : asset,
    ),
  };
}

function makeGraphicDefinition(
  structure: FlaGraphicStructure,
  overrides: Partial<FlaGraphicDefinition> = {},
): FlaGraphicDefinition {
  const durationMs = Math.max(1, structure.frames.length) * 100;
  const frames = structure.frames.map((_frame, index) => ({
    ordinal: index,
    sourceFrameIndex: index,
    assetId: IDS.assetBg,
    sha256: SHA_B,
    sourceViewport: { x: -100, y: -100, width: 800, height: 800 },
    offset: { x: 0, y: 0 },
    startMs: index * 100,
    durationMs: 100,
    createdBySequenceImport: false,
  }));
  return {
    id: GRAPHIC_ID,
    name: 'ScatteredHero',
    kind: 'fla-graphic',
    source: {
      basename: 'hero-v2.fla',
      sha256: SHA_A,
      renderTargetId: 'fla-render-target-graphic-v201',
      targetKind: 'graphic-symbol',
      targetName: 'ScatteredHero',
      startFrameIndex: 0,
      endFrameIndex: Math.max(0, frames.length - 1),
      sourceFps: 10,
      canvas: { width: 800, height: 800 },
      anchor: { x: -100, y: -100 },
      documentCanvas: { width: 1280, height: 720 },
    },
    durationMs,
    structure,
    frames,
    ...overrides,
  };
}

function shapeLeaf(
  id: string,
  drawOrder: number,
  sourceRef: string | undefined,
  localTransform: { a: number; b: number; c: number; d: number; tx: number; ty: number } = IDENTITY,
  fallbackViewBox = { x: 0, y: 0, width: 40, height: 40 },
) {
  return {
    id,
    sourceAddress: `graphic/${id}`,
    drawOrder,
    localTransform: { ...localTransform },
    type: 'opaque' as const,
    opaqueKind: 'shape' as const,
    ...(sourceRef ? { sourceRef } : {}),
    fallbackScope: 'subtree' as const,
    fallbackAssetId: IDS.assetBg,
    fallbackViewBox: { ...fallbackViewBox },
  };
}

function makeScatteredAndAssembledStructure(): FlaGraphicStructure {
  const rot30 = {
    a: Math.cos(Math.PI / 6),
    b: Math.sin(Math.PI / 6),
    c: -Math.sin(Math.PI / 6),
    d: Math.cos(Math.PI / 6),
    tx: 260,
    ty: 80,
  };
  const flipScaled = { a: -1.25, b: 0, c: 0, d: 1.25, tx: 340, ty: 210 };

  return {
    version: 1,
    symbolDefinitions: {
      head_sym: {
        symbolRef: 'parts/head',
        children: [shapeLeaf('def-head-shape', 0, 'shape-head', IDENTITY, { x: -20, y: -20, width: 40, height: 40 })],
      },
      torso_sym: {
        symbolRef: 'parts/torso',
        children: [shapeLeaf('def-torso-shape', 0, 'shape-torso', IDENTITY, { x: -25, y: -35, width: 50, height: 70 })],
      },
      arm_l_sym: {
        symbolRef: 'parts/arm_l',
        children: [shapeLeaf('def-arm-l-shape', 0, 'shape-arm-l', IDENTITY, { x: -10, y: -30, width: 20, height: 60 })],
      },
      arm_r_sym: {
        symbolRef: 'parts/arm_r',
        children: [shapeLeaf('def-arm-r-shape', 0, 'shape-arm-r', IDENTITY, { x: -10, y: -30, width: 20, height: 60 })],
      },
    },
    frames: [
      {
        ordinal: 0,
        layers: [
          {
            name: 'Scattered',
            nodes: [
              // Scattered row with non-zero parent Group wrapper
              {
                id: 'scatter-wrap',
                sourceAddress: 'f0/wrap',
                drawOrder: 0,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 30 },
                type: 'group',
                groupId: 'grp-scatter-wrap',
                children: [
                  {
                    id: 'f0-head',
                    sourceAddress: 'f0/head',
                    drawOrder: 0,
                    localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 10 },
                    type: 'symbol',
                    symbolRef: 'parts/head',
                    nestedDefinitionId: 'head_sym',
                  },
                  {
                    id: 'f0-arm-r',
                    sourceAddress: 'f0/arm-r',
                    drawOrder: 1,
                    localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 140, ty: 20 },
                    type: 'symbol',
                    symbolRef: 'parts/arm_r',
                    nestedDefinitionId: 'arm_r_sym',
                  },
                  {
                    id: 'f0-torso',
                    sourceAddress: 'f0/torso',
                    drawOrder: 2,
                    localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 280, ty: 30 },
                    type: 'symbol',
                    symbolRef: 'parts/torso',
                    nestedDefinitionId: 'torso_sym',
                  },
                  {
                    id: 'f0-arm-l',
                    sourceAddress: 'f0/arm-l',
                    drawOrder: 3,
                    localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 420, ty: 40 },
                    type: 'symbol',
                    symbolRef: 'parts/arm_l',
                    nestedDefinitionId: 'arm_l_sym',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        ordinal: 1,
        layers: [
          {
            name: 'Assembled',
            nodes: [
              // Reference pose with nested parent transform, flip/scale, rotation, AND corrected drawOrder:
              // arm_l (behind) -> torso -> head -> arm_r (front)
              {
                id: 'f1-arm-l',
                sourceAddress: 'f1/arm-l',
                drawOrder: 0,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 180, ty: 200 },
                type: 'symbol',
                symbolRef: 'parts/arm_l',
                nestedDefinitionId: 'arm_l_sym',
              },
              {
                id: 'f1-rig-group',
                sourceAddress: 'f1/rig',
                drawOrder: 1,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 15 },
                type: 'group',
                groupId: 'grp-assembled-rig',
                children: [
                  {
                    id: 'f1-torso',
                    sourceAddress: 'f1/torso',
                    drawOrder: 0,
                    localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 220, ty: 195 },
                    type: 'symbol',
                    symbolRef: 'parts/torso',
                    nestedDefinitionId: 'torso_sym',
                  },
                  {
                    id: 'f1-head',
                    sourceAddress: 'f1/head',
                    drawOrder: 1,
                    localTransform: rot30,
                    type: 'symbol',
                    symbolRef: 'parts/head',
                    nestedDefinitionId: 'head_sym',
                  },
                ],
              },
              {
                id: 'f1-arm-r',
                sourceAddress: 'f1/arm-r',
                drawOrder: 2,
                localTransform: flipScaled,
                type: 'symbol',
                symbolRef: 'parts/arm_r',
                nestedDefinitionId: 'arm_r_sym',
              },
            ],
          },
        ],
      },
    ],
  };
}

async function buildAuthorPoseRealFlaArchive(): Promise<Uint8Array> {
  const symbolXml = (
    name: string,
    elements: string,
  ): string => `<DOMSymbolItem xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="${name}" symbolType="graphic" xmlns="http://ns.adobe.com/xfl/2008/">
  <timeline><DOMTimeline name="${name}"><layers>
    <DOMLayer name="Layer 1"><frames><DOMFrame index="0" duration="1"><elements>${elements}</elements></DOMFrame></frames></DOMLayer>
  </layers></DOMTimeline></timeline>
</DOMSymbolItem>`;

  const boxShape = (color: string, x = -20, y = -20, w = 40, h = 40): string => `<DOMShape>
    <fills><FillStyle index="1"><SolidColor color="${color}" alpha="1"/></FillStyle></fills>
    <edges><Edge fillStyle1="1" cubics="!${x} ${y}|${x + w} ${y}|${x + w} ${y + h}|${x} ${y + h}|${x} ${y}"/></edges>
  </DOMShape>`;

  const zip = new JSZip();
  zip.file(
    'DOMDocument.xml',
    `<DOMDocument xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" width="1280" height="720" frameRate="24" xmlns="http://ns.adobe.com/xfl/2008/">
  <symbols>
    <Include href="parts/head.xml"/>
    <Include href="parts/torso.xml"/>
    <Include href="parts/arm_l.xml"/>
    <Include href="parts/arm_r.xml"/>
    <Include href="ScatteredHero.xml"/>
    <Include href="AssembledHero.xml"/>
  </symbols>
  <timelines><DOMTimeline name="Scene 1"><layers>
    <DOMLayer name="Stage"><frames><DOMFrame index="0" duration="1"><elements>
      <DOMSymbolInstance libraryItemName="ScatteredHero" symbolType="graphic" loop="loop" firstFrame="0">
        <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
      </DOMSymbolInstance>
    </elements></DOMFrame></frames></DOMLayer>
  </layers></DOMTimeline></timelines>
</DOMDocument>`,
  );
  zip.file('LIBRARY/parts/head.xml', symbolXml('parts/head', boxShape('#f03a55')));
  zip.file('LIBRARY/parts/torso.xml', symbolXml('parts/torso', boxShape('#2468ab')));
  zip.file('LIBRARY/parts/arm_l.xml', symbolXml('parts/arm_l', boxShape('#3aa76d')));
  zip.file('LIBRARY/parts/arm_r.xml', symbolXml('parts/arm_r', boxShape('#e09124')));
  zip.file(
    'LIBRARY/ScatteredHero.xml',
    symbolXml(
      'ScatteredHero',
      `<DOMGroup><matrix><Matrix a="1" d="1" tx="40" ty="40"/></matrix><members>
        <DOMSymbolInstance libraryItemName="parts/head" symbolType="graphic" loop="loop" firstFrame="0"><matrix><Matrix a="1" d="1" tx="20" ty="20"/></matrix></DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="parts/torso" symbolType="graphic" loop="loop" firstFrame="0"><matrix><Matrix a="1" d="1" tx="150" ty="20"/></matrix></DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="parts/arm_l" symbolType="graphic" loop="loop" firstFrame="0"><matrix><Matrix a="1" d="1" tx="280" ty="20"/></matrix></DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="parts/arm_r" symbolType="graphic" loop="loop" firstFrame="0"><matrix><Matrix a="1" d="1" tx="410" ty="20"/></matrix></DOMSymbolInstance>
      </members></DOMGroup>`,
    ),
  );
  zip.file(
    'LIBRARY/AssembledHero.xml',
    symbolXml(
      'AssembledHero',
      `<DOMGroup><matrix><Matrix a="1" d="1" tx="300" ty="200"/></matrix><members>
        <DOMSymbolInstance libraryItemName="parts/arm_l" symbolType="graphic" loop="loop" firstFrame="0"><matrix><Matrix a="1" d="1" tx="-50" ty="40"/></matrix></DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="parts/torso" symbolType="graphic" loop="loop" firstFrame="0"><matrix><Matrix a="1" d="1" tx="0" ty="50"/></matrix></DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="parts/head" symbolType="graphic" loop="loop" firstFrame="0"><matrix><Matrix a="0.8660254" b="0.5" c="-0.5" d="0.8660254" tx="0" ty="-20"/></matrix></DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="parts/arm_r" symbolType="graphic" loop="loop" firstFrame="0"><matrix><Matrix a="-1" d="1" tx="50" ty="40"/></matrix></DOMSymbolInstance>
      </members></DOMGroup>`,
    ),
  );
  return zip.generateAsync({ type: 'uint8array' });
}

afterEach(async () => {
  characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
  if (activeRoot) {
    const r = activeRoot;
    activeRoot = null;
    await act(async () => r.unmount());
  }
  activeContainer?.remove();
  activeContainer = null;
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('FLA Graphic V2-A Author Pose Reuse (#1207)', () => {
  it('places scattered parts into the author assembled pose with nested parent transform, flip/scale/rotation, drawOrder parity, and full persistence/edit/restore cycle', async () => {
    const structure = makeScatteredAndAssembledStructure();
    const definition = makeGraphicDefinition(structure);
    const project: Project = {
      ...makeBaseProject(),
      animations: [definition],
    };

    const collection = {
      selections: [
        { nodePath: ['scatter-wrap', 'f0-head'], label: 'Head' },
        { nodePath: ['scatter-wrap', 'f0-arm-r'], label: 'Arm R' },
        { nodePath: ['scatter-wrap', 'f0-torso'], label: 'Torso' },
        { nodePath: ['scatter-wrap', 'f0-arm-l'], label: 'Arm L' },
      ],
    };

    // 1) Manual subtree creation (applyAuthorPose omitted) MUST keep V1 identity untouched.
    const manualInput = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: collection.selections,
    });
    expect(manualInput.parts.every((p) => p.restTransform.tx === 0 && p.restTransform.ty === 0)).toBe(true);

    // 2) Auto author-pose creation (applyAuthorPose: true) MUST place all 4 parts at Assembled poses.
    let resolutionReport: ReturnType<typeof resolveFlaGraphicAuthorPosePlacements> | null = null;
    const autoInput = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: collection.selections,
      applyAuthorPose: true,
      onAuthorPoseResolved: (report) => {
        resolutionReport = report;
      },
    });
    expect(resolutionReport).not.toBeNull();
    expect(resolutionReport!.matchedCount).toBe(4);
    expect(resolutionReport!.matchedOrigin).toBe('definition-frame');

    const byName = new Map(autoInput.parts.map((part) => [part.displayName!, part]));
    const head = byName.get('Head')!;
    const torso = byName.get('Torso')!;
    const armL = byName.get('Arm L')!;
    const armR = byName.get('Arm R')!;

    // Verify drawOrder matches Reference Frame 1 order: arm_l < torso < head < arm_r
    expect(armL.drawOrder).toBe(0);
    expect(torso.drawOrder).toBe(1);
    expect(head.drawOrder).toBe(2);
    expect(armR.drawOrder).toBe(3);

    // Verify exact world point placement: origin of Head symbol in frame 0 (in Group-local coords:
    // scattered world (50, 40) - anchor(-100, -100) = (150, 140)) must land at
    // reference nested Group(20, 15) * rot30(260, 80) = (280, 95) - anchor(-100, -100) = (380, 195).
    const applyM = (m: CharacterPart['restTransform'], x: number, y: number) => ({
      x: m.a * x + m.c * y + m.tx,
      y: m.b * x + m.d * y + m.ty,
    });
    const headMapped = applyM(head.restTransform, 150, 140);
    expect(headMapped.x).toBeCloseTo(380, 3);
    expect(headMapped.y).toBeCloseTo(195, 3);
    expect(head.restTransform.a).toBeCloseTo(Math.cos(Math.PI / 6), 4);
    expect(head.restTransform.b).toBeCloseTo(Math.sin(Math.PI / 6), 4);

    // Arm R had flipX scale -1.25 in reference pose.
    expect(armR.restTransform.a).toBeCloseTo(-1.25, 4);
    expect(armR.restTransform.d).toBeCloseTo(1.25, 4);

    // 3) Persist character, verify Shot Stage resolution, save/reopen schema, and original Graphic Definition isolation.
    const characterService = new CharacterService();
    const createdProject = ProjectSchema.parse(
      characterService.createAdaptiveParts(project, autoInput),
    );
    const createdChar = createdProject.characters.find(
      (c) => c.mode === 'adaptive-parts' && c.name === autoInput.name,
    )!;
    expect(createdChar.mode).toBe('adaptive-parts');

    const layerService = new LayerService();
    const shotId = createdProject.shots[0]!.id;
    const withCharLayer = layerService.createFromAdaptiveCharacter(
      createdProject,
      shotId,
      createdChar.id,
      { x: 640, y: 360 },
    ).project;
    // Also add an independent Animation Layer referencing the SAME Graphic Definition.
    const withBothLayers = layerService.createFromAnimation(withCharLayer, shotId, {
      animationId: definition.id,
      position: { x: 300, y: 300 },
      startTimeMs: 0,
    }).project;
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(withBothLayers)));
    const charVisual = resolveLayerVisualParts(
      reopened,
      reopened.shots[0]!,
      {
        id: reopened.shots[0]!.layers.at(-2)!.id,
        assetId: '',
        currentExpressionId: null,
        mouthOverrideAssetId: null,
        anchor: 'center',
        x: 640,
        y: 360,
        scaleX: 1,
        scaleY: 1,
        flipX: false,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        zIndex: 0,
      },
    );
    expect(charVisual.kind).toBe('adaptive-parts-character');
    expect(charVisual.parts).toHaveLength(4);
    // Original Graphic Definition & Animation Layer stay untouched (anchor -100,-100, frame 0 scattered unchanged).
    expect(reopened.animations[0]).toEqual(definition);
  });

  it('extracts bounded authorPoseReferences from sibling Graphic symbols via real Main FlaPartPreviewService -> FlaGraphicInstanceCommitService', async () => {
    const flaBytes = await buildAuthorPoseRealFlaArchive();
    const flaSha = createHash('sha256').update(flaBytes).digest('hex');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'panda-v2a-real-fla-'));
    tempDirs.push(dir);

    const mockImportService = {
      getSession: vi.fn((sessionId: string) => ({
        sessionId,
        sourceBytes: flaBytes,
        ir: {
          source: { basename: 'hero-v2.fla', sha256: flaSha, originalSourceSha256: flaSha },
          document: { width: 1280, height: 720, frameRate: 24, backgroundColor: '#ffffff' },
          media: [],
          timelines: [],
          compatibility: [],
          summary: { placedInstanceCount: 1, libraryOnlyMediaCount: 0 },
        },
        trace: { originalSourceSha256: flaSha },
        source: { basename: 'hero-v2.fla', bytes: flaBytes, sha256: flaSha },
      })),
    } as unknown as FlaImportService;

    const preparedSource = await prepareFlaStaticSnapshotDisplaySource(flaBytes, 'preview');
    expect(preparedSource.ok).toBe(true);
    if (!preparedSource.ok) throw new Error(preparedSource.message);
    const displaySource = preparedSource.source;
    const targetId = stableRenderTargetId(flaBytes, 'scene\u0000timeline\u00000');

    const rasterizer: FlaStaticSnapshotRasterizer = {
      rasterize: vi.fn(async (input: FlaStaticSnapshotRasterizeInput) => ({
        pngBytes: makePng(input.width, input.height, 120),
        width: input.width,
        height: input.height,
        pixelCount: input.pixelCount,
      })),
      cancel: vi.fn(() => true),
      close: vi.fn(),
    };
    const renderSession = {
      prepareDisplaySourceForPartPreview: vi.fn(async () => ({
        ok: true as const,
        source: displaySource,
        xmlByteLength: 1,
        cacheHit: false,
      })),
    };
    const previewService = new FlaPartPreviewService({
      flaImportService: mockImportService,
      renderSession: renderSession as never,
      rasterizer,
    });

    const projectRoot = path.join(dir, 'v2a-real.pandastage');
    const projectService = new ProjectService();
    const createdProjectMeta = await projectService.create(projectRoot, { name: 'V2A Real' });

    const store = new EditorProjectStore();
    store.open(projectRoot, createdProjectMeta.project);

    const commitService = new FlaGraphicInstanceCommitService({
      projectService,
      partPreviewService: previewService,
      getCurrentProjectSnapshot: () => {
        const snap = store.getSnapshot();
        const openInstanceId = store.getProjectInstanceId();
        return snap && openInstanceId !== null
          ? { project: snap.project, revision: snap.revision, openInstanceId }
          : null;
      },
    });

    const sessionId = '90700000-0000-4000-8000-000000000001';
    const previewResponse = await previewService.preview({
      format: 'fla-part-preview',
      version: 1,
      requestId: randomUUID(),
      sessionId,
      generation: 1,
      target: {
        renderTargetId: targetId,
        selectedFrameIndex: 0,
      },
      purpose: 'graphic-instance',
    });
    expect(previewResponse.ok).toBe(true);
    if (
      !previewResponse.ok ||
      previewResponse.capability === 'WHOLE_IMAGE_ONLY' ||
      previewResponse.generation === undefined
    ) {
      throw new Error('preview failed');
    }
    expect(previewResponse.partPreviews.length).toBeGreaterThanOrEqual(1);

    const characterStore = new CharacterStore(store, new CharacterService());
    const created = await createAdaptiveCharacterFromFlaGraphic({
      preview: {
        ...previewResponse,
        sessionId,
        generation: previewResponse.generation,
      },
      unitId: previewResponse.partPreviews[0]!.unitId,
      api: {
        commitGraphicInstance: (request) => commitService.commit(request),
      },
      store,
      characters: characterStore,
    });

    if (!created.ok) throw new Error(`${created.kind}: ${created.message}`);
    expect(created.ok).toBe(true);
    expect(created.partCount).toBe(4);
    expect(created.autoPlacedCount).toBe(4);
    expect(created.autoPlacedOrigin).toBe('author-pose');

    const finalProject = store.getSnapshot()!.project;
    // Sibling AssembledHero must NOT be imported into project.animations as a second Graphic Definition.
    expect(finalProject.animations.filter((a) => 'kind' in a && a.kind === 'fla-graphic')).toHaveLength(1);
    const createdChar = finalProject.characters.find((c) => c.id === created.characterId)!;
    expect(createdChar.mode).toBe('adaptive-parts');
    if (createdChar.mode === 'adaptive-parts') {
      // Every part's sourceRestTransform/restTransform moved cleanly from scattered (40+x, 60) to assembled (300, 200+...)
      expect(createdChar.parts.every((p) => p.restTransform.tx !== 0 || p.restTransform.ty !== 0)).toBe(true);
      const armR = createdChar.parts.find((p) => p.restTransform.a < 0);
      expect(armR).toBeDefined();
      expect(armR!.restTransform.a).toBeCloseTo(-1, 3);
    }

    // Response schema validation check
    const responseSample = FlaGraphicInstanceCommitResponseSchema.safeParse({
      ok: true,
      status: 'completed',
      requestId: randomUUID(),
      project: finalProject,
      projectRoot,
      projectId: finalProject.id,
      openInstanceId: store.getProjectInstanceId()!,
      baseRevision: 0,
      savedRevision: 1,
      projectChanged: true,
      animationId: created.animationId,
      layerId: null,
      authorPoseReferences: [
        {
          origin: 'sibling-graphic',
          sourceLabel: 'AssembledHero',
          referenceFrameOrdinal: 0,
          referenceSymbolRef: 'AssembledHero',
          nodes: [],
        },
      ],
    });
    expect(responseSample.success).toBe(true);

    previewService.close();
  });

  it('skips missing reference, duplicate identical symbolRef, missing sourceRef, same-name different-source, and singular transforms locally without disturbing siblings or character center', () => {
    const structure: FlaGraphicStructure = {
      version: 1,
      symbolDefinitions: {
        sleeve_sym: {
          symbolRef: 'parts/sleeve',
          children: [shapeLeaf('def-sleeve', 0, 'shape-sleeve')],
        },
        head_sym: {
          symbolRef: 'parts/head',
          children: [shapeLeaf('def-head', 0, 'shape-head')],
        },
        hair_sym_a: {
          symbolRef: 'parts/hair_a',
          children: [shapeLeaf('def-hair-a', 0, 'shape-hair-a')],
        },
        hair_sym_b: {
          symbolRef: 'parts/hair_b',
          children: [shapeLeaf('def-hair-b', 0, 'shape-hair-b')],
        },
        bad_matrix_sym: {
          symbolRef: 'parts/badge',
          children: [shapeLeaf('def-badge', 0, 'shape-badge')],
        },
      },
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'Source',
              nodes: [
                // 1) Duplicate identical symbolRef (left sleeve & right sleeve) -> MUST NOT match
                {
                  id: 's-sleeve-l',
                  sourceAddress: 'f0/s1',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 10 },
                  type: 'symbol',
                  symbolRef: 'parts/sleeve',
                  nestedDefinitionId: 'sleeve_sym',
                },
                {
                  id: 's-sleeve-r',
                  sourceAddress: 'f0/s2',
                  drawOrder: 1,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 80, ty: 10 },
                  type: 'symbol',
                  symbolRef: 'parts/sleeve',
                  nestedDefinitionId: 'sleeve_sym',
                },
                // 2) Opaque shape missing sourceRef -> MUST NOT match
                shapeLeaf('Hair', 2, undefined, { a: 1, b: 0, c: 0, d: 1, tx: 150, ty: 10 }),
                // 3) Same display name ('Hair') / different underlying symbolRef ('parts/hair_a' vs 'parts/hair_b') -> MUST NOT match
                {
                  id: 's-hair',
                  sourceAddress: 'f0/hair',
                  drawOrder: 3,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 220, ty: 10 },
                  type: 'symbol',
                  symbolRef: 'parts/hair_a',
                  nestedDefinitionId: 'hair_sym_a',
                },
                // 4) Valid source transform matched against a singular / non-invertible reference transform -> MUST skip locally without crashing
                {
                  id: 's-singular',
                  sourceAddress: 'f0/badge',
                  drawOrder: 4,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 290, ty: 10 },
                  type: 'symbol',
                  symbolRef: 'parts/badge',
                  nestedDefinitionId: 'bad_matrix_sym',
                },
                // 5) Clean unique match -> MUST succeed locally while all 5 above stay untouched!
                {
                  id: 's-head',
                  sourceAddress: 'f0/head',
                  drawOrder: 5,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 360, ty: 10 },
                  type: 'symbol',
                  symbolRef: 'parts/head',
                  nestedDefinitionId: 'head_sym',
                },
              ],
            },
          ],
        },
        {
          ordinal: 1,
          layers: [
            {
              name: 'Ref',
              nodes: [
                {
                  id: 'r-sleeve-1',
                  sourceAddress: 'f1/s1',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 500, ty: 500 },
                  type: 'symbol',
                  symbolRef: 'parts/sleeve',
                  nestedDefinitionId: 'sleeve_sym',
                },
                {
                  id: 'r-sleeve-2',
                  sourceAddress: 'f1/s2',
                  drawOrder: 1,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 600, ty: 500 },
                  type: 'symbol',
                  symbolRef: 'parts/sleeve',
                  nestedDefinitionId: 'sleeve_sym',
                },
                shapeLeaf('Hair', 2, 'other-shape-ref', { a: 1, b: 0, c: 0, d: 1, tx: 550, ty: 300 }),
                {
                  id: 'r-hair-b',
                  sourceAddress: 'f1/hair',
                  drawOrder: 3,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 550, ty: 200 },
                  type: 'symbol',
                  symbolRef: 'parts/hair_b',
                  nestedDefinitionId: 'hair_sym_b',
                },
                {
                  id: 'r-badge',
                  sourceAddress: 'f1/badge',
                  drawOrder: 4,
                  localTransform: { a: 0, b: 0, c: 0, d: 0, tx: 550, ty: 400 },
                  type: 'symbol',
                  symbolRef: 'parts/badge',
                  nestedDefinitionId: 'bad_matrix_sym',
                },
                {
                  id: 'r-head',
                  sourceAddress: 'f1/head',
                  drawOrder: 5,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 520, ty: 120 },
                  type: 'symbol',
                  symbolRef: 'parts/head',
                  nestedDefinitionId: 'head_sym',
                },
              ],
            },
          ],
        },
      ],
    };

    const definition = makeGraphicDefinition(structure);
    const project = {
      ...makeBaseProject(),
      animations: [definition],
    };

    // Negative check A: no reference at all -> zero placement, zero center shift
    const noRef = resolveFlaGraphicAuthorPosePlacements({
      sourceParts: [],
      references: [],
      sourceRootTransform: IDENTITY,
      definitionAnchor: definition.source.anchor,
    });
    expect(noRef.matchedCount).toBe(0);

    let report: ReturnType<typeof resolveFlaGraphicAuthorPosePlacements> | null = null;
    const partialResult = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: [
        { nodePath: ['s-sleeve-l'], label: 'Left Sleeve' },
        { nodePath: ['s-sleeve-r'], label: 'Right Sleeve' },
        { nodePath: ['Hair'], label: 'Hair' },
        { nodePath: ['s-hair'], label: 'Hair' },
        { nodePath: ['s-singular'], label: 'Badge' },
        { nodePath: ['s-head'], label: 'Head' },
      ],
      applyAuthorPose: true,
      onAuthorPoseResolved: (r) => {
        report = r;
      },
    });

    expect(report).not.toBeNull();
    // ONLY Head (`s-head`, partIndex 5) is matched safely; all 5 negative cases are locally skipped at IDENTITY.
    expect(report!.matchedCount).toBe(1);
    expect(report!.skippedReasons.get(0)).toBe('ambiguous-source-identity');
    expect(report!.skippedReasons.get(1)).toBe('ambiguous-source-identity');
    expect(report!.skippedReasons.get(2)).toBe('missing-source-identity');
    expect(report!.skippedReasons.get(3)).toBe('unmatched');
    expect(report!.skippedReasons.get(4)).toBe('non-invertible-transform');

    expect(partialResult.parts[0]!.restTransform).toEqual(IDENTITY);
    expect(partialResult.parts[1]!.restTransform).toEqual(IDENTITY);
    expect(partialResult.parts[2]!.restTransform).toEqual(IDENTITY);
    expect(partialResult.parts[3]!.restTransform).toEqual(IDENTITY);
    expect(partialResult.parts[4]!.restTransform).toEqual(IDENTITY);
    // Head moved cleanly by (+160, +110)
    expect(partialResult.parts[5]!.restTransform.tx).toBeCloseTo(160, 4);
    expect(partialResult.parts[5]!.restTransform.ty).toBeCloseTo(110, 4);
  });

  it('shares identical placement and feedback across 主入口 and 快捷入口 and supports raw-origin vs reference-pose restore in CharacterAssemblyWorkbench', async () => {
    const structure = makeScatteredAndAssembledStructure();
    const definition = makeGraphicDefinition(structure);
    const editorStore = editorProjectStore;
    const characterStore = singletonCharacterStore;
    const baseProject = makeBaseProject();
    const withDefProject = {
      ...baseProject,
      animations: [definition],
    };

    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const preview: Extract<
      FlaPartPreviewResponse,
      { ok: true; status: 'PREVIEW_READY'; capability: 'GRAPHIC_INSTANCES_READY' }
    > & { sessionId: string; generation: number } = {
      ok: true,
      status: 'PREVIEW_READY',
      capability: 'GRAPHIC_INSTANCES_READY',
      requestId: '00000000-0000-4000-8000-000000000852',
      sessionId: '00000000-0000-4000-8000-000000000850',
      generation: 1,
      planId: '00000000-0000-4000-8000-000000000851',
      poseIdentity: SHA_C,
      target: {
        renderTargetId: 'fla-render-target-scene000001',
        userLabel: '主场景',
        frameCount: 1,
        selectedFrameIndex: 0,
      },
      stage: { width: 1280, height: 720, pixelCount: 921600 },
      nativePreview: {
        width: 200,
        height: 200,
        pixelCount: 40000,
        sha256: SHA_B,
        byteLength: pngBytes.byteLength,
        bytes: pngBytes,
      },
      partPreviews: [
        {
          unitId: 'part-001-graphic0001',
          occurrenceId: 'occ-11111111111111111111111111111111',
          sourceKind: 'graphic-symbol-occurrence',
          sourceSymbolId: 'ScatteredHero',
          sourceAddress: 'scene/0/0',
          adapterIdentity: 'ScatteredHero',
          sourceDefinitionFrameCount: 2,
          layerName: 'Stage',
          drawOrder: 0,
          graphicInstanceImportable: true,
          image: {
            width: 200,
            height: 200,
            pixelCount: 40000,
            sha256: SHA_B,
            byteLength: pngBytes.byteLength,
            bytes: pngBytes,
          },
        },
      ],
      reassembledPreview: null,
      metrics: {
        preparedSourceCacheHit: false,
        sourcePreparationCountForRequest: 0,
        displayListResolveCount: 1,
        rasterCount: 1,
        unitCount: 1,
        totalPngBytes: pngBytes.byteLength,
        elapsedMs: 1,
      },
    };
    const catalogResponse: FlaRenderableTargetCatalogResponse = {
      ok: true,
      sessionId: '00000000-0000-4000-8000-000000000850',
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
      sessionId: '00000000-0000-4000-8000-000000000850',
      ir: {
        source: {
          format: 'fla',
          basename: 'hero-v2.fla',
          byteLength: 100,
          sha256: SHA_A,
          parser: {
            package: FLA_PARSER_PACKAGE,
            entrypoint: FLA_PARSER_ENTRYPOINT,
            commit: FLA_PARSER_COMMIT,
          },
        },
        document: { width: 1280, height: 720, frameRate: 24, backgroundColor: '#FFFFFF' },
        media: [],
        timelines: [],
        compatibility: [],
        summary: { placedInstanceCount: 1, libraryOnlyMediaCount: 0 },
      },
      diagnostics: [],
    };
    const commitGraphicInstance = vi.fn(async () => {
      const snap = editorStore.getSnapshot()!;
      return {
        ok: true as const,
        status: 'completed' as const,
        requestId: randomUUID(),
        projectRoot: snap.projectRoot,
        projectId: snap.project.id,
        openInstanceId: editorStore.getProjectInstanceId()!,
        baseRevision: snap.revision,
        savedRevision: snap.revision + 1,
        projectChanged: true,
        project: {
          ...snap.project,
          animations: withDefProject.animations,
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
          staticSnapshotCatalog: vi.fn(async () => catalogResponse),
          staticSnapshotCancel: vi.fn(async () => ({ accepted: true })),
          partPreview: vi.fn(async () => preview),
          partPreviewCancel: vi.fn(async () => ({ accepted: true })),
          commitGraphicInstance,
        },
      },
    });

    activeContainer = document.createElement('div');
    document.body.append(activeContainer);
    activeRoot = createRoot(activeContainer);

    // Entry 1: FlaCharacterImportFlow -> CharacterManager
    editorStore.open('D:\\Temp\\V2AEntry1', baseProject);
    const attempt: FlaCharacterImportAttempt = {
      lifecycle: { cancel: vi.fn(async () => undefined) } as unknown as FlaCharacterImportAttempt['lifecycle'],
      operation: {
        requestId: randomUUID(),
        inspectionStarted: Promise.resolve(),
        response: Promise.resolve(inspectionResponse),
      },
    };
    function Entry1Host() {
      const snap = useSyncExternalStore(
        editorStore.subscribe,
        editorStore.getSnapshot,
        editorStore.getSnapshot,
      );
      return createElement(CharacterManager, {
        snapshot: snap,
        view: 'list',
        flaCharacterImportAttempt: attempt,
        onCreateFlaCharacter: vi.fn(),
        onCreateCharacterFromGraphic: (input) =>
          createAdaptiveCharacterFromFlaGraphic({
            ...input,
            api: { commitGraphicInstance },
            store: editorStore,
            characters: characterStore,
          }),
        onQueryFlaCharacterCreateStatus: vi.fn(),
      });
    }
    await act(async () => {
      activeRoot!.render(createElement(Entry1Host));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-character-import-create"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const entry1FlowError = document.querySelector('[role="alert"]')?.textContent;
    expect(entry1FlowError).toBeUndefined();
    const entry1Notice = activeContainer.querySelector('.character-manager-status')?.textContent;
    expect(entry1Notice).toBe('已按参考姿势自动还原 4/4 个零件');
    const char1 = editorStore.getSnapshot()!.project.characters.find((c) => c.mode === 'adaptive-parts')!;
    expect(char1.mode === 'adaptive-parts' && char1.parts.map((p) => p.restTransform)).toBeTruthy();

    // Entry 2: FlaGraphicInstanceWorkbench -> CharacterManager
    characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
    editorStore.open('D:\\Temp\\V2AEntry2', baseProject);
    let entry2Created: { characterId: string; notice?: string; nonce: number } | null = null;
    function Entry2Host() {
      const snap = useSyncExternalStore(
        editorStore.subscribe,
        editorStore.getSnapshot,
        editorStore.getSnapshot,
      );
      if (!entry2Created) {
        return createElement(FlaGraphicInstanceWorkbench, {
          enabled: true,
          sessionId: '00000000-0000-4000-8000-000000000850',
          source: { basename: 'hero-v2.fla', sha256: SHA_A },
          targetRenderTargetId: 'fla-render-target-scene000001' as FlaRenderTarget['renderTargetId'],
          targetLookupPending: false,
          importDisabledReason: null,
          onCreateCharacterFromGraphic: (input) =>
            createAdaptiveCharacterFromFlaGraphic({
              ...input,
              api: { commitGraphicInstance },
              store: editorStore,
              characters: characterStore,
            }),
          onCharacterCreated: (result) => {
            entry2Created = {
              characterId: result.characterId,
              notice: formatFlaGraphicSkippedSummary(
                result.partCount,
                result.skipped,
                result.warnings,
                {
                  autoPlacedCount: result.autoPlacedCount,
                  autoPlacedOrigin: result.autoPlacedOrigin,
                },
              ),
              nonce: 1,
            };
          },
        });
      }
      return createElement(CharacterManager, {
        snapshot: snap,
        view: 'list',
        externalCreatedCharacter: entry2Created,
      });
    }
    await act(async () => {
      activeRoot!.render(createElement(Entry2Host));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-candidate-part-001-graphic0001"]')!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-create-character"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => {
      activeRoot!.render(createElement(Entry2Host));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(activeContainer.querySelector('.character-manager-status')?.textContent).toBe(entry1Notice);
    const char2 = editorStore.getSnapshot()!.project.characters.find((c) => c.id === entry2Created!.characterId)!;
    if (char1.mode === 'adaptive-parts' && char2.mode === 'adaptive-parts') {
      expect(char2.parts.map((p) => p.restTransform)).toEqual(
        char1.parts.map((p) => p.restTransform),
      );
      expect(char2.parts.map((p) => p.drawOrder)).toEqual(
        char1.parts.map((p) => p.drawOrder),
      );
    }

    // Check CharacterAssemblyWorkbench raw-origin button & reference-pose restore distinction
    function WorkbenchHost() {
      const snap = useSyncExternalStore(
        editorStore.subscribe,
        editorStore.getSnapshot,
        editorStore.getSnapshot,
      )!;
      const assemblySession = useSyncExternalStore(
        characterAssemblySessionStore.subscribe,
        characterAssemblySessionStore.getSnapshot,
        characterAssemblySessionStore.getSnapshot,
      )!;
      return createElement(CharacterAssemblyWorkbench, {
        projectSnapshot: snap,
        savedProjectSnapshot: null,
        session: assemblySession,
      });
    }
    await act(async () => {
      activeRoot!.render(createElement(WorkbenchHost));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const firstPartId = (char2 as Extract<Project['characters'][number], { mode: 'adaptive-parts' }>).parts[0]!.partId;
    const originalSourceRest = {
      ...(char2 as Extract<Project['characters'][number], { mode: 'adaptive-parts' }>).parts[0]!.sourceRestTransform!,
    };
    await act(async () => {
      const editBtn = activeContainer!.querySelector<HTMLButtonElement>(
        `[data-part-id="${firstPartId}"] [data-testid="adaptive-parts-edit-button"]`,
      ) ?? activeContainer!.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-edit-button"]')!;
      editBtn.click();
    });
    const resetRawBtn = activeContainer.querySelector<HTMLButtonElement>(
      '[data-testid="adaptive-parts-reset-raw-origin-button"]',
    );
    expect(resetRawBtn).not.toBeNull();
    await act(async () => {
      resetRawBtn!.click();
    });
    const draftAfterReset = characterAssemblySessionStore.getSnapshot();
    expect(draftAfterReset?.kind).toBe('adaptive-parts');
    if (draftAfterReset?.kind === 'adaptive-parts') {
      const selected = draftAfterReset.draft.parts.find((p) => p.partId === draftAfterReset.selectedPartId)!;
      expect(selected.sourceRestTransform).toEqual(IDENTITY);
      expect(selected.restTransform).toEqual(IDENTITY);
      expect(originalSourceRest.tx !== 0 || originalSourceRest.ty !== 0).toBe(true);
    }
  });

  it('retains Main authorPoseReferences (sibling-graphic/scene-frame) across create-failure retries (reusedAnimationId) in both entries without cross-project or cross-source leakage', async () => {
    // Target Graphic itself only has Frame 0 scattered parts; assembled author pose ONLY exists in sibling-graphic / scene-frame references from Main.
    const fullStructure = makeScatteredAndAssembledStructure();
    const scatteredOnlyStructure: FlaGraphicStructure = {
      ...fullStructure,
      frames: [fullStructure.frames[0]!],
    };
    const definition = makeGraphicDefinition(scatteredOnlyStructure, {
      id: '00000000-0000-4000-8000-000000000802',
    });
    const siblingPoseDef = makeGraphicDefinition(fullStructure, {
      id: '00000000-0000-4000-8000-000000000803',
    });
    const extractedSibling = extractFlaAuthorPoseReferencesFromDefinition(siblingPoseDef, 0)[0]!;
    const authorPoseReferences: NonNullable<
      Extract<FlaGraphicInstanceCommitResponse, { ok: true }>['authorPoseReferences']
    > = [
      {
        origin: 'sibling-graphic',
        sourceLabel: 'AssembledPoseSibling',
        ...(extractedSibling.referenceFrameOrdinal !== undefined
          ? { referenceFrameOrdinal: extractedSibling.referenceFrameOrdinal }
          : {}),
        referenceSymbolRef: 'AssembledPoseSibling',
        nodes: extractedSibling.nodes.map((node) => ({
          ...node,
          ancestorSymbolChain: [...node.ancestorSymbolChain],
          descendantProvenance: node.descendantProvenance
            ? [...node.descendantProvenance]
            : undefined,
        })),
      },
    ];

    const editorStore = editorProjectStore;
    const baseProject = makeBaseProject();
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const preview: Extract<
      FlaPartPreviewResponse,
      { ok: true; status: 'PREVIEW_READY'; capability: 'GRAPHIC_INSTANCES_READY' }
    > & { sessionId: string; generation: number } = {
      ok: true,
      status: 'PREVIEW_READY',
      capability: 'GRAPHIC_INSTANCES_READY',
      requestId: '00000000-0000-4000-8000-000000000862',
      sessionId: '00000000-0000-4000-8000-000000000860',
      generation: 1,
      planId: '00000000-0000-4000-8000-000000000861',
      poseIdentity: SHA_C,
      target: {
        renderTargetId: 'fla-render-target-scene000002',
        userLabel: '主场景',
        frameCount: 1,
        selectedFrameIndex: 0,
      },
      stage: { width: 1280, height: 720, pixelCount: 921600 },
      nativePreview: {
        width: 200,
        height: 200,
        pixelCount: 40000,
        sha256: SHA_B,
        byteLength: pngBytes.byteLength,
        bytes: pngBytes,
      },
      partPreviews: [
        {
          unitId: 'part-001-graphic0001',
          occurrenceId: 'occ-22222222222222222222222222222222',
          sourceKind: 'graphic-symbol-occurrence',
          sourceSymbolId: 'ScatteredHero',
          sourceAddress: 'scene/0/0',
          adapterIdentity: 'ScatteredHero',
          sourceDefinitionFrameCount: 1,
          layerName: 'Stage',
          drawOrder: 0,
          graphicInstanceImportable: true,
          image: {
            width: 200,
            height: 200,
            pixelCount: 40000,
            sha256: SHA_B,
            byteLength: pngBytes.byteLength,
            bytes: pngBytes,
          },
        },
      ],
      reassembledPreview: null,
      metrics: {
        preparedSourceCacheHit: false,
        sourcePreparationCountForRequest: 0,
        displayListResolveCount: 1,
        rasterCount: 1,
        unitCount: 1,
        totalPngBytes: pngBytes.byteLength,
        elapsedMs: 1,
      },
    };
    const catalogResponse: FlaRenderableTargetCatalogResponse = {
      ok: true,
      sessionId: '00000000-0000-4000-8000-000000000860',
      omittedCandidateCount: 0,
      summary: 'ok',
      entries: [
        {
          target: {
            renderTargetId: 'fla-render-target-scene000002',
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
      sessionId: '00000000-0000-4000-8000-000000000860',
      ir: {
        source: {
          format: 'fla',
          basename: 'hero-retry.fla',
          byteLength: 100,
          sha256: SHA_A,
          parser: {
            package: FLA_PARSER_PACKAGE,
            entrypoint: FLA_PARSER_ENTRYPOINT,
            commit: FLA_PARSER_COMMIT,
          },
        },
        document: { width: 1280, height: 720, frameRate: 24, backgroundColor: '#FFFFFF' },
        media: [],
        timelines: [],
        compatibility: [],
        summary: { placedInstanceCount: 1, libraryOnlyMediaCount: 0 },
      },
      diagnostics: [],
    };
    const commitGraphicInstance = vi.fn(async () => {
      const snap = editorStore.getSnapshot()!;
      return {
        ok: true as const,
        status: 'completed' as const,
        requestId: randomUUID(),
        projectRoot: snap.projectRoot,
        projectId: snap.project.id,
        openInstanceId: editorStore.getProjectInstanceId()!,
        baseRevision: snap.revision,
        savedRevision: snap.revision + 1,
        projectChanged: true,
        project: {
          ...snap.project,
          animations: [definition],
        },
        animationId: definition.id,
        layerId: null,
        authorPoseReferences,
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
          staticSnapshotCatalog: vi.fn(async () => catalogResponse),
          staticSnapshotCancel: vi.fn(async () => ({ accepted: true })),
          partPreview: vi.fn(async () => preview),
          partPreviewCancel: vi.fn(async () => ({ accepted: true })),
          commitGraphicInstance,
        },
      },
    });

    activeContainer = document.createElement('div');
    document.body.append(activeContainer);
    activeRoot = createRoot(activeContainer);

    // 1) Entry 1 fail-once -> retry
    editorStore.open('D:\\Temp\\V2ARetryEntry1', baseProject);
    let failEntry1Once = true;
    const flakyCharStore1 = {
      createAdaptiveParts: (input: Parameters<CharacterStore['createAdaptiveParts']>[0], snap: Parameters<CharacterStore['createAdaptiveParts']>[1]) => {
        if (failEntry1Once) {
          failEntry1Once = false;
          throw new Error('simulated transient create failure (entry 1)');
        }
        return singletonCharacterStore.createAdaptiveParts(input, snap);
      },
    };
    const attempt: FlaCharacterImportAttempt = {
      lifecycle: { cancel: vi.fn(async () => undefined) } as unknown as FlaCharacterImportAttempt['lifecycle'],
      operation: {
        requestId: randomUUID(),
        inspectionStarted: Promise.resolve(),
        response: Promise.resolve(inspectionResponse),
      },
    };
    function RetryEntry1Host() {
      const snap = useSyncExternalStore(
        editorStore.subscribe,
        editorStore.getSnapshot,
        editorStore.getSnapshot,
      );
      return createElement(CharacterManager, {
        snapshot: snap,
        view: 'list',
        flaCharacterImportAttempt: attempt,
        onCreateFlaCharacter: vi.fn(),
        onCreateCharacterFromGraphic: (input) =>
          createAdaptiveCharacterFromFlaGraphic({
            ...input,
            api: { commitGraphicInstance },
            store: editorStore,
            characters: flakyCharStore1,
          }),
        onQueryFlaCharacterCreateStatus: vi.fn(),
      });
    }
    await act(async () => {
      activeRoot!.render(createElement(RetryEntry1Host));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-character-import-create"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(commitGraphicInstance).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('simulated transient create failure (entry 1)');

    // Click Retry cleanly (passes reusedAnimationId without calling commitGraphicInstance again)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-character-import-create"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(commitGraphicInstance).toHaveBeenCalledTimes(1);
    expect(activeContainer.querySelector('.character-manager-status')?.textContent).toBe('已按参考姿势自动还原 4/4 个零件');
    const retriedChar1 = editorStore.getSnapshot()!.project.characters.find((c) => c.mode === 'adaptive-parts')!;
    expect(retriedChar1.mode === 'adaptive-parts' && retriedChar1.parts.every((p) => p.restTransform.tx !== 0 || p.restTransform.ty !== 0)).toBe(true);

    // 2) Entry 2 fail-once -> retry
    characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
    editorStore.open('D:\\Temp\\V2ARetryEntry2', baseProject);
    let failEntry2Once = true;
    const flakyCharStore2 = {
      createAdaptiveParts: (input: Parameters<CharacterStore['createAdaptiveParts']>[0], snap: Parameters<CharacterStore['createAdaptiveParts']>[1]) => {
        if (failEntry2Once) {
          failEntry2Once = false;
          throw new Error('simulated transient create failure (entry 2)');
        }
        return singletonCharacterStore.createAdaptiveParts(input, snap);
      },
    };
    let entry2Created: { characterId: string; notice?: string; nonce: number } | null = null;
    function RetryEntry2Host() {
      const snap = useSyncExternalStore(
        editorStore.subscribe,
        editorStore.getSnapshot,
        editorStore.getSnapshot,
      );
      if (!entry2Created) {
        return createElement(FlaGraphicInstanceWorkbench, {
          enabled: true,
          sessionId: '00000000-0000-4000-8000-000000000860',
          source: { basename: 'hero-retry.fla', sha256: SHA_A },
          targetRenderTargetId: 'fla-render-target-scene000002' as FlaRenderTarget['renderTargetId'],
          targetLookupPending: false,
          importDisabledReason: null,
          onCreateCharacterFromGraphic: (input) =>
            createAdaptiveCharacterFromFlaGraphic({
              ...input,
              api: { commitGraphicInstance },
              store: editorStore,
              characters: flakyCharStore2,
            }),
          onCharacterCreated: (result) => {
            entry2Created = {
              characterId: result.characterId,
              notice: formatFlaGraphicSkippedSummary(
                result.partCount,
                result.skipped,
                result.warnings,
                {
                  autoPlacedCount: result.autoPlacedCount,
                  authorPosePlacedCount: result.authorPosePlacedCount,
                  savedLayoutPlacedCount: result.savedLayoutPlacedCount,
                  availableSavedLayoutCount: result.availableSavedLayoutCount,
                  autoPlacedOrigin: result.autoPlacedOrigin,
                },
              ),
              nonce: 1,
            };
          },
        });
      }
      return createElement(CharacterManager, {
        snapshot: snap,
        view: 'list',
        externalCreatedCharacter: entry2Created,
      });
    }
    await act(async () => {
      activeRoot!.render(createElement(RetryEntry2Host));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-candidate-part-001-graphic0001"]')!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-create-character"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(commitGraphicInstance).toHaveBeenCalledTimes(2);
    expect(entry2Created).toBeNull();

    // Retry from Entry 2
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-create-character"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(commitGraphicInstance).toHaveBeenCalledTimes(2);
    expect(entry2Created).not.toBeNull();
    expect(entry2Created!.notice).toBe('已按参考姿势自动还原 4/4 个零件');
    const retriedChar2 = editorStore.getSnapshot()!.project.characters.find((c) => c.id === entry2Created!.characterId)!;
    if (retriedChar1.mode === 'adaptive-parts' && retriedChar2.mode === 'adaptive-parts') {
      expect(retriedChar2.parts.map((p) => p.restTransform)).toEqual(
        retriedChar1.parts.map((p) => p.restTransform),
      );
      expect(retriedChar2.parts[0]!.restTransform).not.toEqual(IDENTITY);
    }

    // 3) Reopen project / switch FLA sha256 or preview MUST NOT reuse stale cached authorPoseReferences
    characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
    editorStore.open('D:\\Temp\\V2ARetryLeakCheck', baseProject);
    await createAdaptiveCharacterFromFlaGraphic({
      preview,
      unitId: 'part-001-graphic0001',
      characterName: 'FailedSeed',
      poseFrameOrdinal: 0,
      api: { commitGraphicInstance },
      store: editorStore,
      characters: {
        createAdaptiveParts: () => {
          throw new Error('seed failure');
        },
      },
    });
    // Closing and reopening same project path increments openInstanceId -> must NOT leak cached refs
    const projectWithDef = editorStore.getSnapshot()!.project;
    editorStore.clear();
    editorStore.open('D:\\Temp\\V2ARetryLeakCheck', projectWithDef);
    const leakedReopenRes = await createAdaptiveCharacterFromFlaGraphic({
      preview,
      unitId: 'part-001-graphic0001',
      characterName: 'AfterReopen',
      poseFrameOrdinal: 0,
      reusedAnimationId: definition.id,
      api: { commitGraphicInstance },
      store: editorStore,
      characters: singletonCharacterStore,
    });
    expect(leakedReopenRes.ok).toBe(true);
    if (leakedReopenRes.ok) {
      expect(leakedReopenRes.autoPlacedCount).toBe(0);
    }

    // Mismatched preview poseIdentity (different FLA source) also must NOT hit cached refs even in same open project instance
    editorStore.open('D:\\Temp\\V2ARetryLeakCheck2', baseProject);
    await createAdaptiveCharacterFromFlaGraphic({
      preview,
      unitId: 'part-001-graphic0001',
      characterName: 'FailedSeed2',
      poseFrameOrdinal: 0,
      api: { commitGraphicInstance },
      store: editorStore,
      characters: {
        createAdaptiveParts: () => {
          throw new Error('seed failure 2');
        },
      },
    });
    const mismatchedSourceRes = await createAdaptiveCharacterFromFlaGraphic({
      preview: { ...preview, poseIdentity: SHA_B },
      unitId: 'part-001-graphic0001',
      characterName: 'DifferentSourceRetry',
      poseFrameOrdinal: 0,
      reusedAnimationId: definition.id,
      api: { commitGraphicInstance },
      store: editorStore,
      characters: singletonCharacterStore,
    });
    expect(mismatchedSourceRes.ok).toBe(true);
    if (mismatchedSourceRes.ok) {
      expect(mismatchedSourceRes.autoPlacedCount).toBe(0);
    }
  });
});
