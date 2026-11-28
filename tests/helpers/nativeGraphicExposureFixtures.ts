import {
  FlaGraphicDefinitionSchema,
  FlaGraphicStructureSchema,
  ProjectSchema,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { buildSourceGraphicFixture } from './nativeGraphicProject';

export const SECOND_FRAME_ASSET_ID = '10000000-0000-4000-8000-000000000007';
const SECOND_FRAME_SHA = 'f'.repeat(64);

/**
 * Source-backed (external FLA) Graphic Definition with two captured frames and
 * an authored internal timeline track. It deliberately carries no exposure /
 * hold markers, so every evaluation must stay byte-identical to the pre-#1453
 * source-import semantics.
 */
export function buildSourceGraphicMultiFrameFixture(): {
  readonly project: Project;
  readonly definition: FlaGraphicDefinition;
} {
  const base = buildSourceGraphicFixture();
  const single = base.project.animations.find(
    (candidate) => candidate.id === base.definitionId,
  ) as FlaGraphicDefinition;
  const structure = FlaGraphicStructureSchema.parse({
    ...JSON.parse(JSON.stringify(single.structure)),
    frames: [
      JSON.parse(JSON.stringify(single.structure!.frames[0])),
      {
        ordinal: 1,
        layers: [
          {
            name: '来源图层',
            nodes: [
              {
                type: 'opaque',
                id: 'frame-1-shape',
                sourceAddress: 'graphic:source/frame-1/0',
                drawOrder: 0,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 60 },
                opaqueKind: 'shape',
                sourceRef: 'fla-shape-frame-1',
                fallbackScope: 'subtree',
                fallbackAssetId: '10000000-0000-4000-8000-000000000005',
                fallbackViewBox: { x: 0, y: 0, width: 90, height: 70 },
              },
            ],
          },
        ],
      },
    ],
    timeline: {
      tracks: [
        {
          trackId: 'addr:graphic:source/frame-0/0',
          keyframes: [
            {
              timeMs: 0,
              transform: { tx: 10, ty: 20, rotationDeg: 0, scaleX: 1, scaleY: 1 },
              easing: 'linear',
            },
            {
              timeMs: 500,
              transform: { tx: 210, ty: 120, rotationDeg: 30, scaleX: 2, scaleY: 2 },
              easing: 'ease',
            },
          ],
        },
      ],
    },
  });
  const frameDurationMs = 1_000 / single.source.sourceFps;
  const definition = FlaGraphicDefinitionSchema.parse({
    ...JSON.parse(JSON.stringify(single)),
    source: {
      ...single.source,
      endFrameIndex: single.source.startFrameIndex + 1,
    },
    durationMs: frameDurationMs * 2,
    frames: [
      JSON.parse(JSON.stringify(single.frames[0])),
      {
        ordinal: 1,
        sourceFrameIndex: single.source.startFrameIndex + 1,
        assetId: SECOND_FRAME_ASSET_ID,
        sha256: SECOND_FRAME_SHA,
        sourceViewport: { ...single.frames[0]!.sourceViewport },
        offset: { ...single.frames[0]!.offset },
        startMs: frameDurationMs,
        durationMs: frameDurationMs,
        createdBySequenceImport: false,
      },
    ],
    structure,
  });
  const project = ProjectSchema.parse({
    ...base.project,
    assets: [
      ...base.project.assets,
      {
        id: SECOND_FRAME_ASSET_ID,
        kind: 'image',
        name: 'graphic-frame-1.svg',
        relativePath: 'assets/graphic-frame-1.svg',
        mimeType: 'image/svg+xml',
        sha256: SECOND_FRAME_SHA,
        width: 640,
        height: 640,
        usage: 'uncategorized',
        keywords: [],
      },
    ],
    animations: [definition],
  });
  const projectDefinition = project.animations.find(
    (candidate) => candidate.id === definition.id,
  ) as FlaGraphicDefinition;
  return { project, definition: projectDefinition };
}
