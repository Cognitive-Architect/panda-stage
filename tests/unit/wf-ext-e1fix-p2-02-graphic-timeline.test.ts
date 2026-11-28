import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  analyzeProjectResourceReuse,
  buildImportedProjectCandidate,
  collectProjectResourceClosure,
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  ProjectSchema,
  isFlaGraphicDefinition,
  type FlaGraphicDefinition,
  type ImageAsset,
  type Project,
} from '../../src/domain';

const SHA_A = 'a'.repeat(64);
const SHA_SVG = 'e'.repeat(64);

function makeImageAsset(
  overrides: Partial<ImageAsset> & { id: string; name: string },
): ImageAsset {
  return {
    kind: 'image',
    relativePath: `assets/${overrides.name}.png`,
    mimeType: 'image/png',
    width: 128,
    height: 128,
    usage: 'character',
    keywords: [],
    sha256: SHA_A,
    ...overrides,
  };
}

function makeBaseProject(overrides: Partial<Project> = {}): Project {
  const now = '2026-11-28T00:00:00.000Z';
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: randomUUID(),
    name: 'Target',
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    fps: PROJECT_FPS,
    assets: [],
    animations: [],
    characters: [],
    voiceProfiles: [],
    subtitleStyles: [
      {
        id: randomUUID(),
        name: 'Default',
        fontFamily: 'Microsoft YaHei',
        fontSize: 44,
        textColor: '#fffdf6',
        backgroundColor: '#0a141100',
        position: 'bottom',
        align: 'center',
        maxWidth: 1600,
      },
    ],
    shots: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function buildGraphicProject(): {
  project: Project;
  graphicId: string;
  frameSvgAssetId: string;
} {
  const graphicId = randomUUID();
  const frameSvgAssetId = randomUUID();
  const bitmapAssetId = randomUUID();

  const bitmapAsset = makeImageAsset({
    id: bitmapAssetId,
    name: 'BodyBitmap',
    relativePath: 'assets/body.png',
    sha256: SHA_A,
  });
  const frameSvgAsset = makeImageAsset({
    id: frameSvgAssetId,
    name: 'GraphicFrame0',
    relativePath: 'assets/frame-0.svg',
    mimeType: 'image/svg+xml',
    sha256: SHA_SVG,
    flaGraphicFrame: { definitionId: graphicId, ordinal: 0 },
  });

  const graphic: FlaGraphicDefinition = {
    id: graphicId,
    name: 'TimelineGraphic',
    kind: 'fla-graphic',
    durationMs: 1000 / 24,
    source: {
      basename: 'timeline.fla',
      sha256: SHA_A,
      renderTargetId: 'symbol:TimelineSym',
      targetKind: 'graphic-symbol',
      targetName: 'TimelineSym',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 400, height: 400 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: frameSvgAssetId,
        sha256: SHA_SVG,
        sourceViewport: { x: 0, y: 0, width: 400, height: 400 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: 1000 / 24,
        createdBySequenceImport: false,
      },
    ],
    structure: {
      version: 1,
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'Main',
              nodes: [
                {
                  type: 'bitmap',
                  id: 'node-body',
                  sourceAddress: 'L0/F0/Body',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                  bitmapRef: 'bitmaps/body.png',
                  assetId: bitmapAssetId,
                },
              ],
            },
          ],
        },
      ],
      timeline: {
        tracks: [
          {
            trackId: 'track-1',
            keyframes: [
              {
                timeMs: 0,
                transform: { tx: 0, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
                easing: 'linear' as const,
              },
            ],
          },
        ],
      },
      symbolDefinitions: {
        'sym:inner': {
          symbolRef: 'symbol:inner',
          sourceFrameCount: 10,
          frameSelectionKey: 'sel-abc',
          children: [],
          timeline: {
            tracks: [
              {
                trackId: 'inner-track',
                keyframes: [
                  {
                    timeMs: 0,
                    transform: { tx: 0, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
                    easing: 'linear' as const,
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };

  const project = makeBaseProject({
    assets: [bitmapAsset, frameSvgAsset],
    animations: [graphic],
  });
  return { project, graphicId, frameSvgAssetId };
}

function planFreshAssets(
  assets: readonly { id: string; name: string; relativePath: string }[],
): never[] {
  return assets.map((a) => ({
    sourceAsset: a,
    targetId: randomUUID(),
    reused: false,
    targetRelativePath: `assets/copy-${a.name}.png`,
  })) as never[];
}

function importAndAnalyze(
  srcProject: Project,
  graphicId: string,
  mutateTarget?: (project: Project) => Project,
) {
  const selections = [{ kind: 'animation' as const, id: graphicId }];
  const closure = collectProjectResourceClosure(srcProject, selections);
  const built = buildImportedProjectCandidate({
    targetProject: makeBaseProject(),
    sourceProject: srcProject,
    closure,
    plannedAssets: planFreshAssets(closure.assets),
    createId: randomUUID,
    updatedAtIso: '2026-11-28T01:00:00.000Z',
    selections,
  });
  const target = mutateTarget ? mutateTarget(built.project) : built.project;
  const analysis = analyzeProjectResourceReuse({
    sourceProject: srcProject,
    targetProject: target,
    closure,
  });
  return analysis;
}

describe('P2-02: Graphic internal timeline compatibility', () => {
  it('rejects reuse when root timeline keyframes differ', () => {
    const { project, graphicId } = buildGraphicProject();
    const analysis = importAndAnalyze(project, graphicId, (target) =>
      ProjectSchema.parse({
        ...target,
        animations: target.animations.map((a) => {
          if (!isFlaGraphicDefinition(a)) return a;
          const g = a as FlaGraphicDefinition;
          return {
            ...g,
            structure: {
              ...g.structure!,
              timeline: {
                tracks: [
                  {
                    trackId: 'track-1',
                    keyframes: [
                      {
                        timeMs: 0,
                        transform: { tx: 100, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
                        easing: 'linear' as const,
                      },
                    ],
                  },
                ],
              },
            },
          };
        }),
      }),
    );
    expect(analysis.reusableAnimationBySourceId.size).toBe(0);
  });

  it('rejects reuse when nested Symbol timeline differs', () => {
    const { project, graphicId } = buildGraphicProject();
    const analysis = importAndAnalyze(project, graphicId, (target) =>
      ProjectSchema.parse({
        ...target,
        animations: target.animations.map((a) => {
          if (!isFlaGraphicDefinition(a)) return a;
          const g = a as FlaGraphicDefinition;
          return {
            ...g,
            structure: {
              ...g.structure!,
              symbolDefinitions: {
                'sym:inner': {
                  ...g.structure!.symbolDefinitions!['sym:inner']!,
                  timeline: {
                    tracks: [
                      {
                        trackId: 'inner-track',
                        keyframes: [
                          {
                            timeMs: 500,
                            transform: { tx: 0, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
                            easing: 'linear' as const,
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          };
        }),
      }),
    );
    expect(analysis.reusableAnimationBySourceId.size).toBe(0);
  });

  it('rejects reuse when nested Symbol sourceFrameCount differs', () => {
    const { project, graphicId } = buildGraphicProject();
    const analysis = importAndAnalyze(project, graphicId, (target) =>
      ProjectSchema.parse({
        ...target,
        animations: target.animations.map((a) => {
          if (!isFlaGraphicDefinition(a)) return a;
          const g = a as FlaGraphicDefinition;
          return {
            ...g,
            structure: {
              ...g.structure!,
              symbolDefinitions: {
                'sym:inner': {
                  ...g.structure!.symbolDefinitions!['sym:inner']!,
                  sourceFrameCount: 99,
                },
              },
            },
          };
        }),
      }),
    );
    expect(analysis.reusableAnimationBySourceId.size).toBe(0);
  });

  it('rejects reuse when nested Symbol frameSelectionKey differs', () => {
    const { project, graphicId } = buildGraphicProject();
    const analysis = importAndAnalyze(project, graphicId, (target) =>
      ProjectSchema.parse({
        ...target,
        animations: target.animations.map((a) => {
          if (!isFlaGraphicDefinition(a)) return a;
          const g = a as FlaGraphicDefinition;
          return {
            ...g,
            structure: {
              ...g.structure!,
              symbolDefinitions: {
                'sym:inner': {
                  ...g.structure!.symbolDefinitions!['sym:inner']!,
                  frameSelectionKey: 'sel-changed',
                },
              },
            },
          };
        }),
      }),
    );
    expect(analysis.reusableAnimationBySourceId.size).toBe(0);
  });

  it('still allows reuse when Graphic structure is identical', () => {
    const { project, graphicId } = buildGraphicProject();
    const analysis = importAndAnalyze(project, graphicId);
    expect(analysis.reusableAnimationBySourceId.size).toBe(1);
  });
});
