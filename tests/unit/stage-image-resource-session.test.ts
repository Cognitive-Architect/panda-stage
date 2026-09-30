import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateSpeakerFocusCamera,
  prepareSpeakerFocusCamera,
  type Project,
  type Shot,
} from '../../src/domain';
import {
  buildStageImageSourceKey,
  isStageFrameReady,
  MAX_RETAINED_STAGE_SOURCES,
  StageImageResourceSession,
  type StageImageResourceState,
} from '../../src/renderer/stage/stageImageResourceSession';
import {
  commitStageVisualFrame,
  selectStageVisualFrame,
} from '../../src/renderer/stage/stageVisualFrame';

interface FakeImage {
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  src: string;
  succeed(): void;
  fail(): void;
}

const LAYER_A = 'layer-a';
const LAYER_B = 'layer-b';
const CHARACTER_BODY = 'character-layer:body';
const CHARACTER_FACE = 'character-layer:face';

function createFakeImage(): FakeImage {
  return {
    onload: null,
    onerror: null,
    src: '',
    succeed() {
      this.onload?.({} as Event);
    },
    fail() {
      this.onerror?.({} as Event);
    },
  };
}

function createHarness(): {
  session: StageImageResourceSession;
  images: FakeImage[];
  states: StageImageResourceState[];
} {
  const images: FakeImage[] = [];
  const states: StageImageResourceState[] = [];
  const session = new StageImageResourceSession({
    createImage: () => {
      const image = createFakeImage();
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
  });
  return { session, images, states };
}

function reconcile(
  harness: ReturnType<typeof createHarness>,
  layers: Array<{ id: string; sourceUrl: string; assetId?: string }>,
): void {
  harness.session.reconcile(
    layers.map((layer) => ({ ...layer, assetId: layer.assetId ?? layer.id })),
    (state) => {
    harness.states.push(state);
    },
  );
}

describe('StageImageResourceSession', () => {
  it('wires the exact readiness gate through StageRenderer and hidden Export', () => {
    const stageRenderer = readFileSync(
      'src/renderer/stage/StageRenderer.tsx',
      'utf8',
    );
    const exportRenderer = readFileSync(
      'src/export-renderer/ExportRendererApp.tsx',
      'utf8',
    );

    expect(stageRenderer).toContain('StageImageResourceSession');
    expect(stageRenderer).toContain('isStageFrameReady');
    expect(stageRenderer).toContain('commitStageVisualFrame');
    expect(stageRenderer).toContain('data-stage-ready={String(ready)}');
    expect(stageRenderer).toContain('data-stage-render-token');
    expect(exportRenderer).toContain('onReady={handleStageReady}');
    expect(exportRenderer).toContain('isExactExportFrameReady');
    expect(exportRenderer).toContain('onError={handleStageError}');
  });

  it('keeps Export-style readiness false while an old committed frame is drawable', () => {
    const harness = createHarness();
    const initialLayers = [{ id: LAYER_A, sourceUrl: 'asset-a' }];
    const initialKey = buildStageImageSourceKey(initialLayers);

    reconcile(harness, initialLayers);
    harness.images[0]!.succeed();
    expect(
      isStageFrameReady({
        error: null,
        hasModel: true,
        imageState: harness.session.getSnapshot(),
        layerCount: 1,
        sourceKey: initialKey,
      }),
    ).toBe(true);

    const desiredLayers = [{ id: LAYER_A, sourceUrl: 'asset-b' }];
    reconcile(harness, desiredLayers);
    const pendingState = harness.session.getSnapshot();

    expect(pendingState.images.get(LAYER_A)).toBe(harness.images[0]);
    expect(pendingState.ready).toBe(false);
    expect(
      isStageFrameReady({
        error: null,
        hasModel: true,
        imageState: pendingState,
        layerCount: 1,
        sourceKey: buildStageImageSourceKey(desiredLayers),
      }),
    ).toBe(false);

    harness.images[1]!.succeed();
    const committedState = harness.session.getSnapshot();
    expect(
      isStageFrameReady({
        error: null,
        hasModel: true,
        imageState: committedState,
        layerCount: 1,
        sourceKey: buildStageImageSourceKey(desiredLayers),
      }),
    ).toBe(true);
  });

  it('does not announce the initial desired frame until every image is decoded', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: false,
      error: null,
    });
    expect(harness.session.getSnapshot().images.size).toBe(0);

    harness.images[0]!.succeed();

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: true,
      error: null,
    });
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
  });

  it('keeps a Body and Face runtime pair atomic across an expression replacement', () => {
    const harness = createHarness();
    const initial = [
      { id: CHARACTER_BODY, sourceUrl: 'body-v1' },
      { id: CHARACTER_FACE, sourceUrl: 'face-expression' },
    ];

    reconcile(harness, initial);
    harness.images[0]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.size).toBe(0);
    harness.images[1]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);

    reconcile(harness, [
      { id: CHARACTER_BODY, sourceUrl: 'body-v1' },
      { id: CHARACTER_FACE, sourceUrl: 'face-mouth' },
    ]);
    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.get(CHARACTER_BODY)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(CHARACTER_FACE)).toBe(
      harness.images[1],
    );
    harness.images[2]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(CHARACTER_BODY)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(CHARACTER_FACE)).toBe(
      harness.images[2],
    );
  });

  it('reuses unchanged decoded sources across time and transform reconciles', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);

    expect(harness.images).toHaveLength(1);
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
  });

  it('keeps source A committed while source B is pending, then replaces it atomically', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-b' }]);

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: false,
      error: null,
    });
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().sourceUrls.get(LAYER_A)).toBe(
      'asset-a',
    );
    expect(harness.session.getSnapshot().desiredSourceUrls.get(LAYER_A)).toBe(
      'asset-b',
    );

    harness.images[1]!.succeed();

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: true,
      error: null,
    });
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[1],
    );
    expect(harness.session.getSnapshot().sourceUrls.get(LAYER_A)).toBe(
      'asset-b',
    );
  });

  it('reuses an already decoded A source on A → B → A without another decode', () => {
    const harness = createHarness();
    const a = [{ id: CHARACTER_FACE, sourceUrl: 'face-expression-a' }];
    const b = [{ id: CHARACTER_FACE, sourceUrl: 'face-mouth-b' }];

    reconcile(harness, a);
    harness.images[0]!.succeed();
    reconcile(harness, b);
    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.get(CHARACTER_FACE)).toBe(harness.images[0]);
    harness.images[1]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);

    reconcile(harness, a);
    expect(harness.images).toHaveLength(2);
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(CHARACTER_FACE)).toBe(harness.images[0]);
    expect(isStageFrameReady({
      error: null,
      hasModel: true,
      imageState: harness.session.getSnapshot(),
      layerCount: 1,
      sourceKey: buildStageImageSourceKey(a),
    })).toBe(true);
  });

  it('lets the text-only return to A show its scheduled Camera without redundant decode wait', () => {
    const shot = {
      id: 'shot', durationMs: 1000, backgroundLayerId: null,
      dialogues: [
        { id: 'A1', characterId: 'A', startMs: 0, endMs: 300, text: 'A', audioClipId: 'audio-a' },
        { id: 'B1', characterId: 'B', startMs: 300, endMs: 600, text: 'B', audioClipId: 'audio-b' },
        { id: 'A2', characterId: 'A', startMs: 600, endMs: 900, text: 'A again' },
      ],
      timelineEvents: [{ id: 'shake-a', layerId: 'A-layer', type: 'shake', startMs: 600, endMs: 900, amplitudeX: 50, amplitudeY: 20, frequencyHz: 2 }],
      layers: [
        { id: 'A-layer', source: { kind: 'character', characterId: 'A' }, x: 400, y: 500, visible: true },
        { id: 'B-layer', source: { kind: 'character', characterId: 'B' }, x: 1500, y: 500, visible: true },
      ],
    } as unknown as Shot;
    const project = { width: 1920, height: 1080, characters: [], shots: [shot] } as unknown as Project;
    const plan = prepareSpeakerFocusCamera(project, shot);
    const harness = createHarness();
    const sourceA = [{ id: CHARACTER_FACE, sourceUrl: 'expression-a' }];
    const sourceB = [{ id: CHARACTER_FACE, sourceUrl: 'mouth-b' }];

    reconcile(harness, sourceA);
    harness.images[0]!.succeed();
    const frameA = { model: { timeMs: 250 }, caption: 'A', camera: evaluateSpeakerFocusCamera(plan, 250) };
    let committed = commitStageVisualFrame(null, frameA, harness.session.getSnapshot().ready);

    reconcile(harness, sourceB);
    const frameB = { model: { timeMs: 550 }, caption: 'B', camera: evaluateSpeakerFocusCamera(plan, 550) };
    expect(selectStageVisualFrame(committed, frameB, harness.session.getSnapshot().ready)).toEqual(frameA);
    harness.images[1]!.succeed();
    committed = commitStageVisualFrame(committed, frameB, harness.session.getSnapshot().ready);
    expect(committed?.camera?.centerX).toBe(1280);

    reconcile(harness, sourceA);
    const returnCamera = evaluateSpeakerFocusCamera(plan, 650);
    const returnFrame = { model: { timeMs: 650 }, caption: 'A again', camera: returnCamera };
    expect(harness.images).toHaveLength(2);
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(selectStageVisualFrame(committed, returnFrame, true)).toEqual(returnFrame);
    expect(returnCamera.centerX).toBeLessThan(frameB.camera.centerX);
    expect(returnCamera.centerX).toBeGreaterThan(frameA.camera.centerX);
    expect(returnCamera).toEqual(evaluateSpeakerFocusCamera(plan, 650));
  });

  it('keeps Body and both Face occurrences atomic when a decoded expression returns', () => {
    const harness = createHarness();
    const a = [
      { id: 'A:body', sourceUrl: 'body-a' },
      { id: 'A:face', sourceUrl: 'expression-a' },
      { id: 'B:body', sourceUrl: 'body-b' },
      { id: 'B:face', sourceUrl: 'expression-b' },
    ];
    const b = [
      a[0]!,
      { id: 'A:face', sourceUrl: 'mouth-a' },
      a[2]!,
      { id: 'B:face', sourceUrl: 'mouth-b' },
    ];
    reconcile(harness, a);
    harness.images.forEach((image) => image.succeed());
    reconcile(harness, b);
    expect(harness.session.getSnapshot().ready).toBe(false);
    harness.images[4]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(false);
    harness.images[5]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);

    reconcile(harness, a);
    const state = harness.session.getSnapshot();
    expect(harness.images).toHaveLength(6);
    expect(state.ready).toBe(true);
    expect(state.images.get('A:face')).toBe(harness.images[1]);
    expect(state.images.get('B:face')).toBe(harness.images[3]);
    expect(state.images.get('A:body')).toBe(harness.images[0]);
    expect(state.images.get('B:body')).toBe(harness.images[2]);
  });

  it('keeps only a finite number of superseded decoded sources', () => {
    const harness = createHarness();
    for (let index = 0; index <= MAX_RETAINED_STAGE_SOURCES + 1; index += 1) {
      reconcile(harness, [{ id: LAYER_A, sourceUrl: `source-${index}` }]);
      harness.images.at(-1)!.succeed();
      expect(harness.session.getSnapshot().ready).toBe(true);
    }
    const countBeforeReturn = harness.images.length;
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'source-0' }]);
    expect(harness.images).toHaveLength(countBeforeReturn + 1);
    expect(harness.session.getSnapshot().ready).toBe(false);
    harness.images.at(-1)!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);
    harness.session.dispose();
    expect(harness.session.getSnapshot().images.size).toBe(0);
  });

  it('does not re-decode or remove unchanged siblings during one-layer replacement', () => {
    const harness = createHarness();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a' },
      { id: LAYER_B, sourceUrl: 'asset-b' },
    ]);
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a-next' },
      { id: LAYER_B, sourceUrl: 'asset-b' },
    ]);

    expect(harness.images).toHaveLength(3);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[1],
    );

    harness.images[2]!.succeed();

    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[2],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[1],
    );
  });

  it('commits simultaneous replacements only when the desired frame is complete', () => {
    const harness = createHarness();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a' },
      { id: LAYER_B, sourceUrl: 'asset-b' },
    ]);
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a-next' },
      { id: LAYER_B, sourceUrl: 'asset-b-next' },
    ]);
    harness.images[2]!.succeed();

    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[1],
    );

    harness.images[3]!.succeed();

    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[2],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[3],
    );
  });

  it('ignores a late B completion after the desired frame returns to A', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-b' }]);
    const staleB = harness.images[1]!;

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    staleB.succeed();

    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(staleB.src).toBe('');
  });

  it('keeps the last committed frame as an explicit fallback when a replacement fails', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();
    reconcile(harness, [{ id: LAYER_A, assetId: 'mouth-asset', sourceUrl: 'asset-b' }]);
    harness.images[1]!.fail();

    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().error).toBeInstanceOf(Error);
    expect(harness.session.getSnapshot().failures).toMatchObject([
      {
        partId: LAYER_A,
        assetId: 'mouth-asset',
        sourceUrl: 'asset-b',
        reason: 'decode',
      },
    ]);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().sourceUrls.get(LAYER_A)).toBe(
      'asset-a',
    );
  });

  it('releases removed resources and makes late callbacks harmless after disposal', () => {
    const harness = createHarness();
    let callbackCount = 0;

    harness.session.reconcile(
      [
        { id: LAYER_A, sourceUrl: 'asset-a' },
        { id: LAYER_B, sourceUrl: 'asset-b' },
      ],
      () => {
        callbackCount += 1;
      },
    );
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    harness.session.reconcile(
      [{ id: LAYER_A, sourceUrl: 'asset-a' }],
      () => {
        callbackCount += 1;
      },
    );
    expect(harness.session.getSnapshot().images.has(LAYER_B)).toBe(false);
    expect(harness.images[1]!.onload).toBeNull();

    const callbacksBeforeDispose = callbackCount;
    harness.session.dispose();
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    expect(callbackCount).toBe(callbacksBeforeDispose);
    expect(harness.session.getSnapshot().images.size).toBe(0);
  });
});
