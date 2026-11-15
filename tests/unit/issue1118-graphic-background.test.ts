import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  LayerService,
  LayerServiceError,
  ProjectSchema,
  resolveBackgroundVisualDimensions,
  type AnimationDefinition,
  type Layer,
} from '../../src/domain';
import { evaluateExportPreparationSupport } from '../../src/domain/export-preparation';
import {
  getLandscapeBackgroundGuidance,
  getLayerBackgroundControlModel,
  shouldShowLayerBackgroundControls,
} from '../../src/renderer/features/properties/LayerBackgroundControl';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const layerService = new LayerService();

const STANDARD_ANIMATION_ID = '71000000-0000-4000-8000-000000000001';
const STANDARD_ANIM_FRAME_ID = '72000000-0000-4000-8000-000000000001';

function withGraphicLayer(structured = true) {
  const base = graphicFaceProject(structured);
  const added = layerService.createFromAnimation(base, IDS.shot, {
    animationId: FACE_GRAPHIC_ID,
    position: { x: 200, y: 200 },
    startTimeMs: 0,
  });
  return {
    project: added.project,
    graphicLayerId: added.layer.id,
  };
}

function withStandardAnimationLayer() {
  const { project: base, graphicLayerId } = withGraphicLayer(true);
  const standardAnim: AnimationDefinition = {
    id: STANDARD_ANIMATION_ID,
    name: 'Standard Loop',
    source: {
      basename: 'std.fla',
      sha256: 'e'.repeat(64),
      renderTargetId: 'std-loop',
      targetKind: 'scene',
      targetName: 'Scene 1',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 320, height: 240 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    durationMs: 1000 / 24,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: STANDARD_ANIM_FRAME_ID,
        sha256: 'd'.repeat(64),
        sourceViewport: { x: 0, y: 0, width: 320, height: 240 },
        startMs: 0,
        durationMs: 1000 / 24,
        offset: { x: 0, y: 0 },
        createdBySequenceImport: false,
      },
    ],
  };
  const withDef = ProjectSchema.parse({
    ...base,
    animations: [...base.animations, standardAnim],
    assets: [
      ...base.assets,
      {
        id: STANDARD_ANIM_FRAME_ID,
        kind: 'image',
        name: 'Frame 0',
        relativePath: 'assets/std-frame-0.png',
        mimeType: 'image/png',
        sha256: 'd'.repeat(64),
        width: 320,
        height: 240,
        usage: 'uncategorized',
        keywords: [],
      },
    ],
  });
  const added = layerService.createFromAnimation(withDef, IDS.shot, {
    animationId: STANDARD_ANIMATION_ID,
    position: { x: 200, y: 200 },
    startTimeMs: 0,
  });
  return {
    project: added.project,
    graphicLayerId,
    stdAnimLayerId: added.layer.id,
  };
}

function asSnapshot(project: ReturnType<typeof graphicFaceProject>): EditorProjectSnapshot {
  return {
    projectRoot: 'D:/PandaStage-Acceptance/issue1118',
    project,
    dirty: false,
    revision: 1,
  };
}

describe('Issue #1118 Workstream B: Graphic Layer official background contract', () => {
  it('resolves stable background visual dimensions for ImageAsset and FlaGraphicDefinition, rejecting Character and standard AnimationDefinition', () => {
    const { project, stdAnimLayerId } = withStandardAnimationLayer();
    const shot = project.shots[0]!;
    const assetLayer = shot.layers.find((l) => l.id === IDS.layerAsset)!;
    const charLayer = shot.layers.find((l) => l.id === IDS.layerChar)!;
    const stdAnimLayer = shot.layers.find((l) => l.id === stdAnimLayerId)!;

    expect(resolveBackgroundVisualDimensions(project, assetLayer)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(resolveBackgroundVisualDimensions(project, charLayer)).toBeNull();
    expect(resolveBackgroundVisualDimensions(project, stdAnimLayer)).toBeNull();

    const structured = withGraphicLayer(true);
    const structuredGraphicLayer = structured.project.shots[0]!.layers.find(
      (l) => l.id === structured.graphicLayerId,
    )!;
    // Must come from definition.source.canvas (200x180), not frame 0 sourceViewport (80x70)
    expect(
      resolveBackgroundVisualDimensions(structured.project, structuredGraphicLayer),
    ).toEqual({
      width: 200,
      height: 180,
    });

    const nonStructured = withGraphicLayer(false);
    const nonStructuredGraphicLayer = nonStructured.project.shots[0]!.layers.find(
      (l) => l.id === nonStructured.graphicLayerId,
    )!;
    expect(
      resolveBackgroundVisualDimensions(
        nonStructured.project,
        nonStructuredGraphicLayer,
      ),
    ).toEqual({
      width: 200,
      height: 180,
    });
  });

  it('sets, fills, and clears a Graphic Layer background while preserving animation metadata and stable canvas Cover geometry', () => {
    const created = withGraphicLayer(true);
    const graphicLayerId = created.graphicLayerId;
    let project = layerService.updateAnimationPlayback(created.project, IDS.shot, graphicLayerId, {
      startTimeMs: 320,
      mode: 'once',
      endBehavior: 'hold',
    });
    project = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === IDS.shot
          ? {
              ...shot,
              layers: shot.layers.map((layer) =>
                layer.id === graphicLayerId
                  ? {
                      ...layer,
                      animationFirstFrame: 2,
                      flaGraphicInstanceTransformOverrides: {
                        '0': {
                          '["face-0"]': { a: 1, b: 0, c: 0, d: 1, tx: 15, ty: -8 },
                        },
                      },
                    }
                  : layer,
              ),
            }
          : shot,
      ),
    });

    const asBg = layerService.setBackground(project, IDS.shot, graphicLayerId);
    const shotAfterSet = asBg.shots[0]!;
    const bgLayer = shotAfterSet.layers.find((l) => l.id === graphicLayerId)!;

    expect(shotAfterSet.backgroundLayerId).toBe(graphicLayerId);
    expect(bgLayer.zIndex).toBe(0);
    expect(bgLayer.locked).toBe(true);
    // Cover of 200x180 into 1920x1080 => scale max(1920/200, 1080/180) = 9.6
    expect(bgLayer.x).toBe(960);
    expect(bgLayer.y).toBe(540);
    expect(bgLayer.scaleX).toBeCloseTo(9.6, 5);
    expect(bgLayer.scaleY).toBeCloseTo(9.6, 5);
    expect(bgLayer.source).toEqual({ kind: 'animation', animationId: FACE_GRAPHIC_ID });
    expect(bgLayer.startTimeMs).toBe(320);
    expect(bgLayer.animationFirstFrame).toBe(2);
    expect(bgLayer.animationPlayback).toEqual({
      mode: 'once',
      endBehavior: 'hold',
    });
    expect(bgLayer.flaGraphicInstanceTransformOverrides).toEqual({
      '0': {
        '["face-0"]': { a: 1, b: 0, c: 0, d: 1, tx: 15, ty: -8 },
      },
    });

    // Idempotent setBackground when already locked background
    expect(layerService.setBackground(asBg, IDS.shot, graphicLayerId)).toBe(asBg);

    // Unlock, move, and fillBackground restores Cover using stable canvas
    const unlocked = layerService.setLocked(asBg, IDS.shot, graphicLayerId, false);
    const moved = layerService.updateTransform(unlocked, IDS.shot, graphicLayerId, {
      x: 100,
      y: 120,
      scale: 2,
      rotationDeg: 0,
      opacity: 1,
      flipX: false,
    });
    const refilled = layerService.fillBackground(moved, IDS.shot);
    const refilledBg = refilled.shots[0]!.layers.find((l) => l.id === graphicLayerId)!;
    expect(refilledBg.x).toBe(960);
    expect(refilledBg.y).toBe(540);
    expect(refilledBg.scaleX).toBeCloseTo(9.6, 5);
    expect(refilledBg.scaleY).toBeCloseTo(9.6, 5);
    expect(refilledBg.locked).toBe(false);
    expect(refilledBg.source).toEqual({ kind: 'animation', animationId: FACE_GRAPHIC_ID });

    // Save -> Close -> Reopen round-trip validation
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(refilled)));
    expect(reopened.shots[0]!.backgroundLayerId).toBe(graphicLayerId);

    // clearBackground clears backgroundLayerId & unlocks
    const cleared = layerService.clearBackground(asBg, IDS.shot);
    expect(cleared.shots[0]!.backgroundLayerId).toBeNull();
    expect(cleared.shots[0]!.layers.find((l) => l.id === graphicLayerId)?.locked).toBe(false);
  });

  it('rejects setting a standard AnimationDefinition layer as background and preserves PNG ImageAsset regression', () => {
    const { project: projectWithStd, stdAnimLayerId } = withStandardAnimationLayer();
    expect(() =>
      layerService.setBackground(
        projectWithStd,
        IDS.shot,
        stdAnimLayerId,
      ),
    ).toThrow(LayerServiceError);

    expect(() =>
      ProjectSchema.parse({
        ...projectWithStd,
        shots: [
          {
            ...projectWithStd.shots[0]!,
            backgroundLayerId: stdAnimLayerId,
          },
        ],
      }),
    ).toThrow();

    // PNG ImageAsset still sets and fills cleanly
    const pngBg = layerService.setBackground(projectWithStd, IDS.shot, IDS.layerAsset);
    expect(pngBg.shots[0]!.backgroundLayerId).toBe(IDS.layerAsset);
    const pngLayer = pngBg.shots[0]!.layers.find((l) => l.id === IDS.layerAsset)!;
    // assetBg is 1920x1080 -> 1920x1080 cover scale is 1
    expect(pngLayer.scaleX).toBe(1);
    expect(pngLayer.scaleY).toBe(1);
  });

  it('passes export preparation for visible Graphic background and reports hidden-background issue when invisible', () => {
    const created = withGraphicLayer(true);
    const project = layerService.setBackground(
      created.project,
      IDS.shot,
      created.graphicLayerId,
    );
    const issues = evaluateExportPreparationSupport(project, 'static');
    const backgroundIssues = issues.filter((i) =>
      i.problem.includes('背景'),
    );
    expect(backgroundIssues).toEqual([]);

    const hiddenBgProject = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === IDS.shot
          ? {
              ...shot,
              layers: shot.layers.map((layer) =>
                layer.id === created.graphicLayerId
                  ? { ...layer, visible: false }
                  : layer,
              ),
            }
          : shot,
      ),
    });
    const hiddenIssues = evaluateExportPreparationSupport(hiddenBgProject, 'static');
    expect(
      hiddenIssues.some((i) => i.problem.includes('需要可见的图像背景')),
    ).toBe(true);
  });

  it('builds StageRenderModel using stable flaGraphic canvas dimensions and keeps part renders local for Graphic backgrounds', () => {
    const assetUrlsFor = (proj: ReturnType<typeof graphicFaceProject>) =>
      Object.fromEntries(
        proj.assets.map((asset) => [asset.id, `https://asset.invalid/${asset.relativePath}`]),
      );

    const created = withGraphicLayer(true);
    const project = layerService.setBackground(
      created.project,
      IDS.shot,
      created.graphicLayerId,
    );
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, project);
    const model = buildStageRenderModel(project, evaluated, assetUrlsFor(project));
    const bgStageLayer = model.layers.find((l) => l.id === created.graphicLayerId)!;

    expect(bgStageLayer.render.isBackground).toBe(true);
    expect(bgStageLayer.render.width).toBe(200);
    expect(bgStageLayer.render.height).toBe(180);
    expect(bgStageLayer.render.scaleX).toBeCloseTo(9.6, 5);
    expect(bgStageLayer.render.scaleY).toBeCloseTo(9.6, 5);
    expect(bgStageLayer.visual?.kind).toBe('fla-graphic');
    expect(bgStageLayer.visual?.flaGraphic?.canvas).toEqual({ width: 200, height: 180 });
    expect(bgStageLayer.parts.every((part) => !part.render.isBackground)).toBe(true);

    // Non-structured fla-graphic background also keeps parts[0].render local so StagePartImages doesn't double-apply Cover
    const nonStructuredCreated = withGraphicLayer(false);
    const nonStructured = layerService.setBackground(
      nonStructuredCreated.project,
      IDS.shot,
      nonStructuredCreated.graphicLayerId,
    );
    const nonStructuredModel = buildStageRenderModel(
      nonStructured,
      evaluateShotAtTime(nonStructured.shots[0]!, 0, nonStructured),
      assetUrlsFor(nonStructured),
    );
    const nonStructuredBg = nonStructuredModel.layers.find(
      (l) => l.id === nonStructuredCreated.graphicLayerId,
    )!;
    expect(nonStructuredBg.render.isBackground).toBe(true);
    expect(nonStructuredBg.parts[0]?.render.isBackground).toBe(false);
    expect(nonStructuredBg.parts[0]?.render.scaleX).not.toBeCloseTo(9.6, 1);

    // Ordinary ImageAsset background keeps parts[0].render === layer.render
    const imageBgProject = layerService.setBackground(project, IDS.shot, IDS.layerAsset);
    const imageBgModel = buildStageRenderModel(
      imageBgProject,
      evaluateShotAtTime(imageBgProject.shots[0]!, 0, imageBgProject),
      assetUrlsFor(imageBgProject),
    );
    const imageBgStageLayer = imageBgModel.layers.find((l) => l.id === IDS.layerAsset)!;
    expect(imageBgStageLayer.render.isBackground).toBe(true);
    expect(imageBgStageLayer.parts[0]?.render.isBackground).toBe(true);
  });

  it('exposes background controls for FlaGraphic layers and hides them for standard animations and characters', () => {
    const { project, graphicLayerId, stdAnimLayerId } = withStandardAnimationLayer();
    const snapshot = asSnapshot(project);

    expect(shouldShowLayerBackgroundControls(snapshot, IDS.shot, graphicLayerId)).toBe(true);
    expect(shouldShowLayerBackgroundControls(snapshot, IDS.shot, IDS.layerAsset)).toBe(true);
    expect(shouldShowLayerBackgroundControls(snapshot, IDS.shot, stdAnimLayerId)).toBe(false);
    expect(shouldShowLayerBackgroundControls(snapshot, IDS.shot, IDS.layerChar)).toBe(false);

    const availableModel = getLayerBackgroundControlModel(snapshot, IDS.shot, graphicLayerId);
    expect(availableModel.state).toBe('available');
    expect(availableModel.canSet).toBe(true);

    const unsupportedModel = getLayerBackgroundControlModel(snapshot, IDS.shot, stdAnimLayerId);
    expect(unsupportedModel.state).toBe('unsupported');
    expect(unsupportedModel.canSet).toBe(false);
    expect(getLandscapeBackgroundGuidance(unsupportedModel)).not.toContain('图片对象');

    const bgProject = layerService.setBackground(project, IDS.shot, graphicLayerId);
    const bgModel = getLayerBackgroundControlModel(
      asSnapshot(bgProject),
      IDS.shot,
      graphicLayerId,
    );
    expect(bgModel.state).toBe('background');
    expect(bgModel.backgroundLayer?.id).toBe(graphicLayerId);
    expect(bgModel.canFill).toBe(true);
    expect(bgModel.canClear).toBe(true);

    // Explicitly verify Layer type shape stays unchanged for animation fields
    const bgLayer: Layer = bgProject.shots[0]!.layers.find((l) => l.id === graphicLayerId)!;
    expect(bgLayer.source.kind).toBe('animation');
  });
});
