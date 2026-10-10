import { describe, expect, it } from 'vitest';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { prepareFlaNestedGraphicFrameSelections } from '../../src/main/services/fla-nested-graphic-frame-selector';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';

function matrix(tx = 0, ty = 0): string {
  return `<matrix><Matrix a="1" b="0" c="0" d="1" tx="${tx}" ty="${ty}"/></matrix>`;
}

function shape(tx = 0, color = '#336699'): string {
  return `<DOMShape>${matrix(tx)}<fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills><edges><Edge fillStyle1="1" cubics="!0 0|20 0|20 20|0 20|0 0"/></edges></DOMShape>`;
}

function frame(index: number, elements: string, duration = 1, tweenType = 'none'): string {
  return `<DOMFrame index="${index}" duration="${duration}" tweenType="${tweenType}"><elements>${elements}</elements></DOMFrame>`;
}

function timeline(name: string, frames: string): string {
  return `<DOMTimeline name="${name}"><layers><DOMLayer name="Layer 1"><frames>${frames}</frames></DOMLayer></layers></DOMTimeline>`;
}

function graphic(name: string, frames: string): string {
  return `<DOMSymbolItem name="${name}" symbolType="graphic"><timeline>${timeline(`${name}-timeline`, frames)}</timeline></DOMSymbolItem>`;
}

/** Compact authored child timeline of `count` one-frame spans with no display elements. */
function emptyFrames(count: number): string {
  return Array.from({ length: count }, (_, i) => `<DOMFrame index="${i}" duration="1"/>`).join('');
}

/**
 * A parent whose owning span for the nested instance is a bounded MOTION tween
 * (a reconstructable transform-only pair), used to prove an animated/tweened
 * firstFrame stays fail-closed.
 */
function animatedParentFrames(): string {
  const instance = (tx: number, ty: number, selected: string) =>
    `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop" firstFrame="1"${selected}>` +
    `${matrix(tx, ty)}<transformationPoint><Point x="5" y="7"/></transformationPoint></DOMSymbolInstance>`;
  const start = `<DOMFrame index="0" duration="2" tweenType="motion" motionTweenSnap="true" keyMode="22017"><elements>${instance(0, 0, '')}</elements></DOMFrame>`;
  const end = `<DOMFrame index="2" duration="1" tweenType="none" keyMode="15872"><elements>${instance(4, 6, ' selected="true"')}</elements></DOMFrame>`;
  return start + end;
}

/**
 * A parent whose owning span for the nested instance is a bounded MOTION tween
 * with no authored firstFrame and a configurable span origin/duration (plus an
 * optional authored lastFrame). Used by the #724 tween-span controls: a missing
 * firstFrame on a tween-owned instance keeps only the legacy origin=0/no-wrap
 * bounded path.
 */
function motionOwnedMissingFirstFrame(options: {
  readonly origin?: number;
  readonly spanDuration?: number;
  readonly lastFrame?: string;
} = {}): string {
  const origin = options.origin ?? 0;
  const spanDuration = options.spanDuration ?? 2;
  const last = options.lastFrame === undefined ? '' : ` lastFrame="${options.lastFrame}"`;
  const instance = (tx: number, ty: number, selected: string) =>
    `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop"${last}${selected}>` +
    `${matrix(tx, ty)}<transformationPoint><Point x="5" y="7"/></transformationPoint></DOMSymbolInstance>`;
  const start = `<DOMFrame index="${origin}" duration="${spanDuration}" tweenType="motion" motionTweenSnap="true" keyMode="22017"><elements>${instance(0, 0, '')}</elements></DOMFrame>`;
  const end = `<DOMFrame index="${origin + spanDuration}" duration="1" tweenType="none" keyMode="15872"><elements>${instance(4, 6, ' selected="true"')}</elements></DOMFrame>`;
  return start + end;
}

function adapt(parentFrames: string, childFrames: string) {
  const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', '')}</timelines></DOMDocument>`;
  const result = adaptFlaXflDisplaySource(documentXml, [
    { name: 'LIBRARY/parent.xml', xml: graphic('parent', parentFrames) },
    { name: 'LIBRARY/child.xml', xml: graphic('child', childFrames) },
    { name: 'LIBRARY/pose.xml', xml: graphic('pose', childFrames) },
  ]);
  if (!result.ok) throw new Error(result.message);
  return result.source;
}

function graphicRoot(source: ReturnType<typeof adapt>, name: string, frameIndex: number) {
  const descriptor = source.graphicSymbols.find((candidate) => candidate.sourceLibraryItemName.endsWith(name));
  if (!descriptor) throw new Error(`Missing Graphic fixture ${name}`);
  const selected = source.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    frameIndex,
    `test-root:${name}@${frameIndex}`,
  );
  if (!selected.ok) throw new Error(selected.message);
  return { kind: 'graphic' as const, name: descriptor.sourceLibraryItemName, frameContext: selected.value };
}

/** A Scene whose owning layer frame carries the nested instance, plus its child Graphic. */
function adaptScene(sceneFrames: string, childFrames: string) {
  const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', sceneFrames)}</timelines></DOMDocument>`;
  const result = adaptFlaXflDisplaySource(documentXml, [
    { name: 'LIBRARY/child.xml', xml: graphic('child', childFrames) },
  ]);
  if (!result.ok) throw new Error(result.message);
  return result.source;
}

function sceneRoot(source: ReturnType<typeof adaptScene>, frameIndex: number) {
  const scene = source.sceneTimelines[0];
  if (!scene) throw new Error('Missing Scene timeline');
  const selected = source.buildSceneFrameContext(scene.xml, frameIndex, `test-scene@${frameIndex}`);
  if (!selected.ok) throw new Error(selected.message);
  return { kind: 'scene' as const, name: scene.name, frameContext: selected.value };
}

describe('nested Graphic authored-frame selection', () => {
  it('selects distinct Single Frame child states per instance and preserves source transforms', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="pose" symbolType="graphic" loop="single frame" firstFrame="1">${matrix(3)}</DOMSymbolInstance>` +
      `<DOMSymbolInstance libraryItemName="pose" symbolType="graphic" loop="single frame" firstFrame="2">${matrix(7)}</DOMSymbolInstance>`);
    const poses = frame(0, shape(0, '#111111')) +
      frame(1, shape(0, '#222222')) +
      frame(2, shape(0, '#333333'));
    const source = adapt(parent, poses);
    const root = graphicRoot(source, 'parent', 0);
    const prepared = prepareFlaNestedGraphicFrameSelections(source, root);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.selections.map((selection) => selection.selectedChildFrameIndex)).toEqual([1, 2]);
    expect(prepared.selections.map((selection) => selection.sourceTransform.tx)).toEqual([3, 7]);
    expect(prepared.selections[0]?.sourceAddress).not.toBe(prepared.selections[1]?.sourceAddress);

    const resolved = resolveFlaDisplayList(prepared.resolverInput);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const children = resolved.displayList.layers[0]?.children ?? [];
    expect(children).toHaveLength(2);
    expect(children.map((node) => node.kind === 'group' ? node.symbolLibraryItemName : null)).toEqual([
      source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName.endsWith('pose'))?.sourceLibraryItemName,
      source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName.endsWith('pose'))?.sourceLibraryItemName,
    ]);
    expect(children.map((node) => node.kind === 'group' ? node.children[0]?.kind : null)).toEqual(['shape', 'shape']);
    expect(children.map((node) => node.kind === 'group' && node.children[0]?.kind === 'shape'
      ? node.children[0].worldTransform.tx
      : null)).toEqual([3, 7]);

    const repeated = prepareFlaNestedGraphicFrameSelections(source, root);
    expect(repeated.ok).toBe(true);
    if (repeated.ok) expect(repeated.selections).toEqual(prepared.selections);
  });

  it('advances default Loop inside a zero-origin containing span', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop">${matrix(12)}</DOMSymbolInstance>`,
      3);
    const child = frame(0, shape()) + frame(1, shape()) + frame(2, shape());
    const source = adapt(parent, child);
    const root = graphicRoot(source, 'parent', 2);
    const prepared = prepareFlaNestedGraphicFrameSelections(source, root);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.selections).toMatchObject([{
      sourceParentFrameIndex: 2,
      sourceParentFrameSpanStart: 0,
      selectedChildFrameIndex: 2,
    }]);
  });

  it('advances a default Loop from a nonzero containing-span origin (#723)', () => {
    // Pre-#723 this combination was fail-closed ("span starts at 206"). #720 A4
    // proves a missing firstFrame defaults to 0, so the parent span origin only
    // shifts `elapsed` and must never be reused as the child first frame.
    const parent = frame(206,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop">${matrix()}</DOMSymbolInstance>`,
      3);
    const source = adapt(parent, emptyFrames(3));
    const checkpoints: Array<[number, number]> = [[206, 0], [207, 1], [208, 2]];
    for (const [parentFrame, childFrame] of checkpoints) {
      const prepared = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', parentFrame));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.selections).toMatchObject([{
        sourceParentFrameSpanStart: 206,
        firstFrameWasExplicit: false,
        effectiveFirstFrame: 0,
        childFrameCount: 3,
        selectedChildFrameIndex: childFrame,
        selectionRule: 'loop-missing-first-frame-modulo',
      }]);
      expect(prepared.selections[0]?.firstFrame).toBeUndefined();
      expect(prepared.selections[0]?.selectedChildFrameIndex).not.toBe(206);
    }
  });

  it('selects Play Once relative to its containing authored span', () => {
    const parent = frame(5,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="play once">${matrix(12)}</DOMSymbolInstance>`,
      5);
    const source = adapt(parent, frame(0, shape()) + frame(1, shape()) + frame(2, shape()));
    const root = graphicRoot(source, 'parent', 7);
    const prepared = prepareFlaNestedGraphicFrameSelections(source, root);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.selections).toMatchObject([{
      sourceParentFrameIndex: 7,
      sourceParentFrameSpanStart: 5,
      selectedChildFrameIndex: 2,
      selectionRule: 'play-once-relative-containing-span',
      sourceTransform: { tx: 12, ty: 0 },
    }]);
  });

  it('uses frame zero for omitted Single Frame firstFrame and constant one-frame Loop', () => {
    const singleFrameParent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="single frame">${matrix()}</DOMSymbolInstance>`);
    const singleFrameSource = adapt(singleFrameParent, frame(0, shape()) + frame(1, shape()));
    const singleFrame = prepareFlaNestedGraphicFrameSelections(
      singleFrameSource,
      graphicRoot(singleFrameSource, 'parent', 0),
    );
    expect(singleFrame.ok).toBe(true);
    if (singleFrame.ok) {
      expect(singleFrame.selections).toMatchObject([{
        selectedChildFrameIndex: 0,
        selectionRule: 'single-frame-default-first-frame-zero',
      }]);
    }

    const constantLoopParent = frame(5,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop">${matrix()}</DOMSymbolInstance>`,
      3);
    const constantLoopSource = adapt(constantLoopParent, frame(0, shape()));
    const constantLoop = prepareFlaNestedGraphicFrameSelections(
      constantLoopSource,
      graphicRoot(constantLoopSource, 'parent', 7),
    );
    expect(constantLoop.ok).toBe(true);
    if (constantLoop.ok) {
      expect(constantLoop.selections).toMatchObject([{
        sourceParentFrameSpanStart: 5,
        selectedChildFrameIndex: 0,
        selectionRule: 'loop-single-frame-constant',
      }]);
    }
  });

  it('holds Play Once at the last child frame after its timeline ends', () => {
    const parent = frame(5,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="play once">${matrix()}</DOMSymbolInstance>`,
      5);
    const source = adapt(parent, frame(0, shape()) + frame(1, shape()) + frame(2, shape()));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 8));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.selections).toMatchObject([{
        selectedChildFrameIndex: 2,
        selectionRule: 'play-once-hold-last-frame',
      }]);
    }
  });

  it('wraps a default Loop modulo the child frame count (#723)', () => {
    // M2 case A: missing firstFrame, childFrameCount 5, owning span static.
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop">${matrix()}</DOMSymbolInstance>`,
      6);
    const source = adapt(parent, emptyFrames(5));
    const checkpoints: Array<[number, number]> = [[0, 0], [1, 1], [4, 4], [5, 0]];
    for (const [elapsed, childFrame] of checkpoints) {
      const prepared = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', elapsed));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.selections).toMatchObject([{
        childFrameCount: 5,
        selectedChildFrameIndex: childFrame,
        selectionRule: 'loop-missing-first-frame-modulo',
      }]);
    }
  });

  it.each([
    { mode: 'play once', firstFrame: 'not-an-index' },
    { mode: 'loop', firstFrame: 'not-an-index' },
    { mode: 'single frame', firstFrame: 'not-an-index' },
  ])('fails closed for unsupported timing attributes ($mode, firstFrame=$firstFrame)', ({ mode, firstFrame }) => {
    const first = firstFrame ? ` firstFrame="${firstFrame}"` : '';
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="${mode}"${first}>${matrix()}</DOMSymbolInstance>`);
    const source = adapt(parent, frame(0, shape()) + frame(1, shape()));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 0));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
  });

  it('fails closed when the selected child state is inside a tween span', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop">${matrix()}</DOMSymbolInstance>`,
      2);
    const child = frame(0, shape(), 2, 'motion') + frame(2, shape());
    const source = adapt(parent, child);
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 1));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TWEEN' });
  });

  // --- Issue #721: bounded explicit Loop + static firstFrame (#720 A1) ---

  it('wraps an explicit-Loop static firstFrame range modulo N, targeting firstFrame', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop" firstFrame="206">${matrix()}</DOMSymbolInstance>`,
      403);
    const source = adapt(parent, emptyFrames(407));
    const checkpoints: Array<[number, number]> = [
      [0, 206], [1, 207], [29, 235], [200, 406], [201, 206], [202, 207], [402, 206],
    ];
    for (const [elapsed, expected] of checkpoints) {
      const prepared = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', elapsed));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.selections).toMatchObject([{
        playbackMode: 'loop',
        firstFrame: '206',
        childFrameCount: 407,
        selectedChildFrameIndex: expected,
        selectionRule: 'loop-static-first-frame-modulo',
      }]);
    }
  });

  it('honours an explicit lastFrame as the bounded Loop upper bound', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop" firstFrame="3" lastFrame="5">${matrix()}</DOMSymbolInstance>`,
      6);
    const source = adapt(parent, emptyFrames(8));
    const checkpoints: Array<[number, number]> = [[0, 3], [1, 4], [2, 5], [3, 3]];
    for (const [elapsed, expected] of checkpoints) {
      const prepared = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', elapsed));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.selections[0]?.selectedChildFrameIndex).toBe(expected);
      expect(prepared.selections[0]?.selectionRule).toBe('loop-static-first-frame-modulo');
    }
  });

  it.each([
    { name: 'invalid lastFrame', attrs: 'loop="loop" firstFrame="1" lastFrame="xyz"', child: 4 },
    { name: 'bounds outside the child range', attrs: 'loop="loop" firstFrame="3" lastFrame="9"', child: 4 },
    { name: 'inverted bounds', attrs: 'loop="loop" firstFrame="3" lastFrame="2"', child: 4 },
  ])('fails closed for a malformed explicit-Loop range ($name)', ({ attrs, child }) => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" ${attrs}>${matrix()}</DOMSymbolInstance>`,
      4);
    const source = adapt(parent, emptyFrames(child));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 0));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
  });

  it('keeps an animated firstFrame fail-closed when the owning span is a tween', () => {
    const source = adapt(animatedParentFrames(), emptyFrames(4));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 1));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
    if (!result.ok) expect(result.message).toContain('animated firstFrame');
  });

  it('selects the mode-invariant only frame for a missing playback mode and preserves its absence', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic">${matrix()}</DOMSymbolInstance>`,
      4);
    const source = adapt(parent, emptyFrames(1));
    const prepared = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 0));

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.selections).toMatchObject([{
      firstFrameWasExplicit: false,
      effectiveFirstFrame: 0,
      childFrameCount: 1,
      selectedChildFrameIndex: 0,
      selectionRule: 'mode-invariant-single-frame',
      selectionBasis: 'mode-invariant-single-frame',
    }]);
    expect(prepared.selections[0]).not.toHaveProperty('playbackMode');
    expect(prepared.selections[0]?.firstFrame).toBeUndefined();

    const selectedInstance = prepared.resolverInput.root.frameContext.layers
      .flatMap((layer) => layer.elements)
      .find((element) => element.kind === 'symbol');
    expect(selectedInstance?.playbackMode).toBeUndefined();
  });

  it('fails closed for missing playback mode with a multi-frame Graphic', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic">${matrix()}</DOMSymbolInstance>`,
      4);
    const source = adapt(parent, emptyFrames(4));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 0));
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_PLAYBACK_DEFAULT' });
    if (!result.ok) expect(result.message).toContain('childFrameCount=4');
  });

  it('fails closed when the child Graphic has no valid frame range', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic">${matrix()}</DOMSymbolInstance>`,
      4);
    const source = adapt(parent, emptyFrames(1));
    const zeroFrameSource = {
      ...source,
      graphicSymbols: source.graphicSymbols.map((descriptor) =>
        descriptor.sourceLibraryItemName.endsWith('child')
          ? { ...descriptor, frameCount: 0 }
          : descriptor),
    };
    const result = prepareFlaNestedGraphicFrameSelections(zeroFrameSource, graphicRoot(source, 'parent', 0));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
    if (!result.ok) expect(result.message).toContain('no valid frame range');
  });

  it.each([
    { mode: 'loop', rule: 'loop-single-frame-constant' },
    { mode: 'play once', rule: 'play-once-relative-containing-span' },
    { mode: 'single frame', rule: 'single-frame-default-first-frame-zero' },
  ])('preserves explicit $mode behavior for a one-frame Graphic', ({ mode, rule }) => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="${mode}">${matrix()}</DOMSymbolInstance>`,
      4);
    const source = adapt(parent, emptyFrames(1));
    const prepared = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 0));

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.selections).toMatchObject([{
      playbackMode: mode,
      childFrameCount: 1,
      selectedChildFrameIndex: 0,
      selectionRule: rule,
    }]);
    expect(prepared.selections[0]).not.toHaveProperty('selectionBasis');
  });

  it('fails closed for an unknown playback mode', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="bogus mode" firstFrame="1">${matrix()}</DOMSymbolInstance>`,
      4);
    const source = adapt(parent, emptyFrames(4));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 0));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
    if (!result.ok) expect(result.message).toContain('outside the proven boundary');
  });

  it('keeps Play Once advancing min(F + elapsed, L) across the containing span (#713 regression)', () => {
    const parent = frame(4,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="play once" firstFrame="1">${matrix()}</DOMSymbolInstance>`,
      6);
    const source = adapt(parent, emptyFrames(4));
    const expected: Array<[number, number, string]> = [
      [4, 1, 'play-once-relative-containing-span'],
      [5, 2, 'play-once-relative-containing-span'],
      [6, 3, 'play-once-relative-containing-span'],
      [7, 3, 'play-once-hold-last-frame'],
      [8, 3, 'play-once-hold-last-frame'],
      [9, 3, 'play-once-hold-last-frame'],
    ];
    for (const [frameIndex, childFrame, rule] of expected) {
      const prepared = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', frameIndex));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.selections[0]?.selectedChildFrameIndex).toBe(childFrame);
      expect(prepared.selections[0]?.selectionRule).toBe(rule);
    }
  });

  // --- Issue #722: Scene-owned span metadata reaches the #721 bounded Loop rule ---

  it('applies the bounded explicit-Loop rule to a static Scene-owned span (#722)', () => {
    // A Scene-owned static authored span (no tweenType) whose child Graphic is a
    // bounded explicit Loop. The Scene path now carries the owning-span tween type,
    // so the #721 modulo rule is reachable from a Scene root instead of fail-closed.
    const sceneFrames = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop" firstFrame="3">${matrix()}</DOMSymbolInstance>`,
      8);
    const source = adaptScene(sceneFrames, emptyFrames(8));
    const prepared = prepareFlaNestedGraphicFrameSelections(source, sceneRoot(source, 0));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.selections).toMatchObject([{
      playbackMode: 'loop',
      firstFrame: '3',
      childFrameCount: 8,
      selectedChildFrameIndex: 3,
      selectionRule: 'loop-static-first-frame-modulo',
    }]);
  });

  it('keeps an explicit-Loop firstFrame fail-closed on a tweened Scene-owned span (#722)', () => {
    const sceneFrames = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop" firstFrame="1">${matrix()}</DOMSymbolInstance>`,
      8, 'motion');
    const source = adaptScene(sceneFrames, emptyFrames(8));
    const result = prepareFlaNestedGraphicFrameSelections(source, sceneRoot(source, 0));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
    if (!result.ok) expect(result.message).toContain('animated firstFrame');
  });

  // --- Issue #723: bounded missing-firstFrame -> effective 0 (#720 A4) ---

  it('treats an absent Loop firstFrame as effective 0 while preserving authored absence (#723 M1-A)', () => {
    const missing = adapt(
      frame(0,
        `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop">${matrix()}</DOMSymbolInstance>`,
        3),
      emptyFrames(3),
    );
    const missingPrepared = prepareFlaNestedGraphicFrameSelections(missing, graphicRoot(missing, 'parent', 0));
    expect(missingPrepared.ok).toBe(true);
    if (!missingPrepared.ok) return;
    expect(missingPrepared.selections).toMatchObject([{
      firstFrameWasExplicit: false,
      effectiveFirstFrame: 0,
      selectedChildFrameIndex: 0,
      selectionRule: 'loop-missing-first-frame-modulo',
    }]);
    // Raw provenance: absence is never rewritten into an authored firstFrame.
    expect(missingPrepared.selections[0]?.firstFrame).toBeUndefined();

    const explicitZero = adapt(
      frame(0,
        `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop" firstFrame="0">${matrix()}</DOMSymbolInstance>`,
        3),
      emptyFrames(3),
    );
    const explicitPrepared = prepareFlaNestedGraphicFrameSelections(explicitZero, graphicRoot(explicitZero, 'parent', 0));
    expect(explicitPrepared.ok).toBe(true);
    if (!explicitPrepared.ok) return;
    // Bounded semantics are equivalent, but the authored provenance stays distinct.
    expect(explicitPrepared.selections).toMatchObject([{
      firstFrame: '0',
      firstFrameWasExplicit: true,
      effectiveFirstFrame: 0,
      selectedChildFrameIndex: 0,
      selectionRule: 'loop-static-first-frame-modulo',
    }]);
  });

  it('accepts an authored lastFrame as the missing-firstFrame Loop upper bound (#723)', () => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="loop" lastFrame="2">${matrix()}</DOMSymbolInstance>`,
      6);
    const source = adapt(parent, emptyFrames(8));
    const checkpoints: Array<[number, number]> = [[0, 0], [2, 2], [3, 0]];
    for (const [elapsed, childFrame] of checkpoints) {
      const prepared = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', elapsed));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.selections[0]?.selectedChildFrameIndex).toBe(childFrame);
      expect(prepared.selections[0]?.selectionRule).toBe('loop-missing-first-frame-modulo');
    }
  });

  // --- Issue #724: tween-span scope re-tightening (missing-firstFrame Loop) ---

  it('preserves the legacy origin=0 no-wrap Loop path inside a tweened owning span (#724)', () => {
    // #724 positive legacy control: a missing-firstFrame Loop whose owning span is
    // a motion tween keeps only the pre-existing bounded path (origin 0, no
    // authored lastFrame, no wrap). This is the com22 compatibility case that must
    // survive the re-tightening.
    const source = adapt(motionOwnedMissingFirstFrame(), emptyFrames(4));
    const checkpoints: Array<[number, number]> = [[0, 0], [1, 1]];
    for (const [parentFrame, childFrame] of checkpoints) {
      const prepared = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', parentFrame));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.selections).toMatchObject([{
        firstFrameWasExplicit: false,
        effectiveFirstFrame: 0,
        childFrameCount: 4,
        selectedChildFrameIndex: childFrame,
        selectionRule: 'loop-zero-origin-no-wrap',
      }]);
      expect(prepared.selections[0]?.firstFrame).toBeUndefined();
    }
  });

  it('fails closed when a tween-owned missing-firstFrame Loop would need to wrap (#724 negative A)', () => {
    const source = adapt(motionOwnedMissingFirstFrame({ spanDuration: 5 }), emptyFrames(4));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 4));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
    if (!result.ok) expect(result.message).toContain('wrap is outside the proven boundary');
  });

  it('fails closed for a tween-owned missing-firstFrame Loop with a non-zero origin (#724 negative B)', () => {
    const source = adapt(motionOwnedMissingFirstFrame({ origin: 206 }), emptyFrames(4));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 206));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
    if (!result.ok) expect(result.message).toContain('span starts at 206');
  });

  it('fails closed for a tween-owned missing-firstFrame Loop with an authored lastFrame (#724 negative C)', () => {
    const source = adapt(motionOwnedMissingFirstFrame({ lastFrame: '2' }), emptyFrames(4));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 0));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
    if (!result.ok) expect(result.message).toContain('not proven inside a tween-owned span');
  });

  it.each([
    { name: 'invalid lastFrame', attrs: 'loop="loop" lastFrame="xyz"', child: 4 },
    { name: 'lastFrame outside the child range', attrs: 'loop="loop" lastFrame="9"', child: 4 },
  ])('fails closed for a malformed missing-firstFrame Loop range ($name)', ({ attrs, child }) => {
    const parent = frame(0,
      `<DOMSymbolInstance libraryItemName="child" symbolType="graphic" ${attrs}>${matrix()}</DOMSymbolInstance>`,
      4);
    const source = adapt(parent, emptyFrames(child));
    const result = prepareFlaNestedGraphicFrameSelections(source, graphicRoot(source, 'parent', 0));
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_TIMING' });
  });
});
