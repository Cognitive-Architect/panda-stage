import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { buildProductPreviewImagePlan } from '../../src/renderer/shell/productPreviewModel';
import {
  buildStageImageSourceKey,
  isStageFrameReady,
  StageImageResourceSession,
  type StageImageLayerSource,
} from '../../src/renderer/stage/stageImageResourceSession';
import { buildProjectWithAnimation, IDS } from '../unit/domain/testProject';

const LAYER_A = '70000000-0000-4000-8000-000000000021';
const LAYER_B = '70000000-0000-4000-8000-000000000022';

interface FakeImage {
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  succeed(): void;
}

function createImage(): FakeImage {
  return {
    onload: null,
    onerror: null,
    src: '',
    naturalWidth: 640,
    naturalHeight: 640,
    succeed() {
      this.onload?.({} as Event);
    },
  };
}

function animationLayer(
  id: string,
  options: {
    startTimeMs: number;
    mode: 'once' | 'loop';
    endBehavior: 'hold' | 'hide';
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotationDeg: number;
    opacity: number;
    zIndex: number;
    flipX: boolean;
  },
) {
  const {
    startTimeMs,
    mode,
    endBehavior,
    x,
    y,
    scaleX,
    scaleY,
    rotationDeg,
    opacity,
    zIndex,
    flipX,
  } = options;
  return {
    id,
    name: id === LAYER_A ? 'A' : 'B',
    source: { kind: 'animation' as const, animationId: IDS.animation },
    anchor: 'center' as const,
    startTimeMs,
    animationPlayback: { mode, endBehavior },
    x,
    y,
    scaleX,
    scaleY,
    rotationDeg,
    opacity,
    zIndex,
    flipX,
    visible: true,
    locked: false,
  };
}

function build21FrameProject(
  options: { includeSecond?: boolean; secondEndBehavior?: 'hold' | 'hide' } = {},
): Project {
  const base = buildProjectWithAnimation();
  const sourceAnimation = base.animations[0]!;
  const frameAssets = sourceAnimation.frames.map((frame, ordinal) => {
    const id = `81000000-0000-4000-8000-${String(ordinal + 1).padStart(12, '0')}`;
    const sha256 = ordinal.toString(16).padStart(64, '0');
    return {
      id,
      kind: 'image' as const,
      name: `synthetic-walk-${ordinal}`,
      relativePath: `assets/synthetic-walk-${ordinal}.png`,
      mimeType: 'image/png',
      width: 640,
      height: 640,
      sha256,
      usage: 'uncategorized' as const,
      keywords: ['synthetic', 'issue947'],
      frame: {
        ...frame,
        assetId: id,
        sha256,
        sourceViewport: {
          x: 100 + ordinal * 3,
          y: 100 + ordinal,
          width: 640,
          height: 640,
        },
        offset: { x: ordinal * 3, y: ordinal },
      },
    };
  });
  const animation = {
    ...sourceAnimation,
    frames: frameAssets.map((asset) => asset.frame),
  };
  const layerA = animationLayer(LAYER_A, {
    startTimeMs: 0,
    mode: 'loop',
    endBehavior: 'hold',
    x: 300,
    y: 400,
    scaleX: 1,
    scaleY: 0.9,
    rotationDeg: 7,
    opacity: 0.8,
    zIndex: 3,
    flipX: false,
  });
  const layers = [layerA];
  if (options.includeSecond ?? true) {
    layers.push(animationLayer(LAYER_B, {
      startTimeMs: 1_000,
      mode: 'once',
      endBehavior: options.secondEndBehavior ?? 'hold',
      x: 900,
      y: 600,
      scaleX: 1.5,
      scaleY: 1.25,
      rotationDeg: -11,
      opacity: 0.6,
      zIndex: 4,
      flipX: true,
    }));
  }

  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...frameAssets.map(({ frame, ...asset }) => {
      void frame;
      return asset;
    })],
    animations: [animation],
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: 3_000,
      backgroundLayerId: null,
      layers,
      timelineEvents: [],
    })),
  });
}

function buildAssetUrls(project: Project): Record<string, string> {
  return Object.fromEntries(
    project.animations[0]!.frames.map((frame) => [
      frame.assetId,
      `blob:issue947-${frame.assetId}-${frame.sha256}`,
    ]),
  );
}

function makeHarness(): { session: StageImageResourceSession; images: FakeImage[] } {
  const images: FakeImage[] = [];
  const session = new StageImageResourceSession({
    createImage: () => {
      const image = createImage();
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
  });
  return { session, images };
}

function buildSources(
  project: Project,
  evaluatedShot: ReturnType<typeof evaluateShotAtTime>,
  assetUrls: Readonly<Record<string, string>>,
): { current: StageImageLayerSource[]; upcoming: StageImageLayerSource[]; model: ReturnType<typeof buildStageRenderModel> } {
  const model = buildStageRenderModel(project, evaluatedShot, assetUrls);
  const current = model.layers.flatMap((layer) =>
    layer.parts.map((part) => ({
      id: part.id,
      assetId: part.asset.id,
      projectId: project.id,
      sha256: part.asset.sha256,
      sourceUrl: part.sourceUrl,
    })),
  );
  const plan = buildProductPreviewImagePlan(
    project,
    project.shots.find((shot) => shot.id === evaluatedShot.shotId)!,
    evaluatedShot,
  );
  const upcoming = plan.recentAnimationAssetIds.flatMap((assetId) => {
    const frame = project.animations[0]!.frames.find(
      (candidate) => candidate.assetId === assetId,
    );
    const sourceUrl = assetUrls[assetId];
    if (!frame || !sourceUrl) return [];
    return [{
      id: `prewarm:${assetId}`,
      assetId,
      projectId: project.id,
      sha256: frame.sha256,
      sourceUrl,
    }];
  });
  return { current, upcoming, model };
}

function settleImageLoads(images: readonly FakeImage[]): void {
  for (let turn = 0; turn < 100; turn += 1) {
    const loading = images.filter((image) => image.onload !== null);
    if (loading.length === 0) return;
    loading.forEach((image) => image.succeed());
  }
  throw new Error('Synthetic Stage image queue did not settle.');
}

function evaluateLayer(
  project: Project,
  timeMs: number,
  layerId: string,
) {
  const shot = project.shots[0]!;
  return evaluateShotAtTime(shot, timeMs, project).layers.find(
    (layer) => layer.id === layerId,
  )!;
}

describe('Issue #947 AP-03 decoded image prewarm integration', () => {
  it('keeps two 21-frame instances independent and reuses the same cold/hot source images', () => {
    const singleProject = build21FrameProject({ includeSecond: false });
    const dualProject = build21FrameProject({ secondEndBehavior: 'hold' });
    const run = (project: Project, times: readonly number[]) => {
      const harness = makeHarness();
      const urls = buildAssetUrls(project);
      const visit = (timeMs: number) => {
        const evaluated = evaluateShotAtTime(project.shots[0]!, timeMs, project);
        const { current, upcoming, model } = buildSources(project, evaluated, urls);
        harness.session.reconcile(current, () => {});
        harness.session.prewarm(upcoming);
        settleImageLoads(harness.images);
        const state = harness.session.getSnapshot();
        expect(state.ready).toBe(true);
        expect(
          isStageFrameReady({
            error: state.error,
            hasModel: true,
            imageState: state,
            layerCount: model.layers.length,
            sourceKey: buildStageImageSourceKey(current),
          }),
        ).toBe(true);
        expect(new Set(state.images.values()).size).toBe(
          new Set(current.map((source) => `${source.assetId}:${source.sha256}`)).size,
        );
        return { evaluated, model };
      };

      for (const timeMs of times) visit(timeMs);
      const coldImageCreations = harness.session.getDiagnostics().imageCreations;
      const coldCacheHits = harness.session.getDiagnostics().cacheHits;
      const beforeHot = coldImageCreations;
      for (const timeMs of times) visit(timeMs);
      const hotImageCreations = harness.session.getDiagnostics().imageCreations - beforeHot;
      const diagnostics = harness.session.getDiagnostics();
      harness.session.dispose();
      return { coldImageCreations, hotImageCreations, coldCacheHits, diagnostics };
    };

    const singleTimes = Array.from({ length: 21 }, (_, index) => index * 40);
    const dualTimes = Array.from({ length: 47 }, (_, index) => index * 40);
    const single = run(singleProject, singleTimes);
    const dual = run(dualProject, dualTimes);

    expect(single.coldImageCreations).toBe(21);
    expect(dual.coldImageCreations).toBe(21);
    expect(single.hotImageCreations).toBe(0);
    expect(dual.hotImageCreations).toBe(0);
    expect(single.diagnostics.prewarmInFlightPeak).toBeLessThanOrEqual(2);
    expect(dual.diagnostics.prewarmInFlightPeak).toBeLessThanOrEqual(2);
    expect(single.diagnostics.retainedEntries).toBeLessThanOrEqual(64);
    expect(dual.diagnostics.retainedEntries).toBeLessThanOrEqual(64);
    expect(single.coldCacheHits).toBeGreaterThan(0);
    expect(dual.coldCacheHits).toBeGreaterThan(0);

    console.info('[issue947-ap03-cold-hot]', JSON.stringify({
      single: {
        coldImageCreations: single.coldImageCreations,
        hotImageCreations: single.hotImageCreations,
        cacheHits: single.diagnostics.cacheHits,
        optionalDecodePeak: single.diagnostics.prewarmInFlightPeak,
      },
      dual: {
        coldImageCreations: dual.coldImageCreations,
        hotImageCreations: dual.hotImageCreations,
        cacheHits: dual.diagnostics.cacheHits,
        optionalDecodePeak: dual.diagnostics.prewarmInFlightPeak,
      },
    }));
  });

  it('keeps A=0 Loop and B=1000 Once/Hold or Hide frame, crop, and transforms independent', () => {
    const holdProject = build21FrameProject({ secondEndBehavior: 'hold' });
    const atZero = evaluateShotAtTime(holdProject.shots[0]!, 0, holdProject);
    const atStart = evaluateShotAtTime(holdProject.shots[0]!, 1_000, holdProject);
    const atNextFrame = evaluateShotAtTime(holdProject.shots[0]!, 1_040, holdProject);
    const atEnd = evaluateShotAtTime(holdProject.shots[0]!, 1_840, holdProject);
    const layer = (state: typeof atStart, id: string) =>
      state.layers.find((candidate) => candidate.id === id)!;

    expect(layer(atZero, LAYER_A).animationFrame?.offset.x).toBe(0);
    expect(layer(atZero, LAYER_B).visible).toBe(false);
    expect(layer(atStart, LAYER_A).animationFrame?.offset.x).toBe(12);
    expect(layer(atStart, LAYER_B).animationFrame?.offset.x).toBe(0);
    expect(layer(atNextFrame, LAYER_A).animationFrame?.offset.x).toBe(15);
    expect(layer(atNextFrame, LAYER_B).animationFrame?.offset.x).toBe(3);
    expect(layer(atEnd, LAYER_A).animationFrame?.offset.x).toBe(12);
    expect(layer(atEnd, LAYER_B).animationFrame?.offset.x).toBe(60);
    expect(layer(atEnd, LAYER_B).visible).toBe(true);

    const urls = buildAssetUrls(holdProject);
    const rendered = buildStageRenderModel(holdProject, atNextFrame, urls);
    const renderedA = rendered.layers.find((candidate) => candidate.id === LAYER_A)!;
    const renderedB = rendered.layers.find((candidate) => candidate.id === LAYER_B)!;
    expect(renderedA.render).toMatchObject({
      x: 300,
      y: 400,
      scaleX: 1,
      scaleY: 0.9,
      rotationDeg: 7,
      opacity: 0.8,
    });
    expect(renderedB.render).toMatchObject({
      x: 900,
      y: 600,
      scaleX: -1.5,
      scaleY: 1.25,
      rotationDeg: -11,
      opacity: 0.6,
    });
    expect(renderedA.visual?.parts[0]?.localRect.x).not.toBe(
      renderedB.visual?.parts[0]?.localRect.x,
    );
    expect(layer(atNextFrame, LAYER_A).flipX).toBe(false);
    expect(layer(atNextFrame, LAYER_B).flipX).toBe(true);

    const hideProject = build21FrameProject({ secondEndBehavior: 'hide' });
    expect(evaluateLayer(hideProject, 1_840, LAYER_B)).toMatchObject({
      visible: false,
      animationFrame: { offset: { x: 60 } },
    });
    expect(evaluateLayer(hideProject, 1_040, LAYER_B).animationFrame?.offset.x).toBe(3);
  });
});
