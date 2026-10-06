import { describe, expect, it } from 'vitest';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import {
  adaptFlaXflDisplaySource,
  type FlaXflGraphicSymbolDescriptor,
} from '../../src/main/services/fla-static-snapshot-display-list-adapter';

function matrix(tx = 0, ty = 0): string {
  return `<matrix><Matrix a="1" b="0" c="0" d="1" tx="${tx}" ty="${ty}"/></matrix>`;
}

function transformedMatrix(a: number, b: number, c: number, d: number, tx: number, ty: number): string {
  return `<matrix><Matrix a="${a}" b="${b}" c="${c}" d="${d}" tx="${tx}" ty="${ty}"/></matrix>`;
}

function bitmap(name: string, tx = 0, ty = 0): string {
  return `<DOMBitmapInstance libraryItemName="${name}">${matrix(tx, ty)}</DOMBitmapInstance>`;
}

function symbol(name: string, tx = 0, ty = 0): string {
  return `<DOMSymbolInstance libraryItemName="${name}" symbolType="graphic">${matrix(tx, ty)}</DOMSymbolInstance>`;
}

function shape(): string {
  return `<DOMShape><edges><Edge cubics="!0 0|20 0|20 20|0 20|0 0"/></edges></DOMShape>`;
}

function frame(index: number, elements: string): string {
  return `<DOMFrame index="${index}" duration="1" tweenType="none"><elements>${elements}</elements></DOMFrame>`;
}

function layer(name: string, frames: string): string {
  return `<DOMLayer name="${name}"><frames>${frames}</frames></DOMLayer>`;
}

function timeline(name: string, layers: string[]): string {
  return `<DOMTimeline name="${name}"><layers>${layers.join('')}</layers></DOMTimeline>`;
}

function graphic(name: string, layers: string[]): string {
  return `<DOMSymbolItem name="${name}" symbolType="graphic"><timeline>${timeline(`${name}-timeline`, layers)}</timeline></DOMSymbolItem>`;
}

function buildAdapterFixture() {
  const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
    layer('scene-front', [
      frame(0, `${symbol('outer', 9, 11)}${bitmap('scene-front-after', 21, 22)}`),
      frame(1, `${bitmap('scene-front-frame1-a', 31, 32)}${bitmap('scene-front-frame1-b', 41, 42)}`),
    ].join('')),
    layer('scene-back', [
      frame(0, `${bitmap('scene-back-a', 1, 2)}${bitmap('scene-back-b', 3, 4)}`),
      frame(1, `${bitmap('scene-back-frame1-a', 5, 6)}${bitmap('scene-back-frame1-b', 7, 8)}`),
    ].join('')),
  ])}</timelines></DOMDocument>`;
  const libraryXmlEntries = Object.freeze([
    Object.freeze({
      name: 'LIBRARY/outer.xml',
      xml: graphic('outer', [
        layer('outer-front', [
          frame(0, `${symbol('inner', 13, 17)}${bitmap('outer-front-after', 23, 29)}`),
          frame(1, `${bitmap('outer-front-frame1-a', 31, 37)}${bitmap('outer-front-frame1-b', 41, 47)}`),
        ].join('')),
        layer('outer-back', [frame(0, shape()), frame(1, shape())].join('')),
      ]),
    }),
    Object.freeze({
      name: 'LIBRARY/inner.xml',
      xml: graphic('inner', [
        layer('inner-front', [frame(0, `${bitmap('inner-front-a', 3, 5)}${bitmap('inner-front-b', 7, 11)}`)].join('')),
        layer('inner-back', [frame(0, shape())].join('')),
      ]),
    }),
  ]);
  const originalLibraryEntries = libraryXmlEntries.map((entry) => ({ ...entry }));
  const adapted = adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  if (!adapted.ok) throw new Error(`Adapter fixture failed: ${adapted.message}`);

  return { adapted: adapted.source, documentXml, libraryXmlEntries, originalLibraryEntries };
}

function buildMotionAdapterFixture(
  startMetadata = '',
  endMetadata = '',
  endLibraryItemName = 'moving-target',
  duration = 2,
) {
  const motionFrame = (index: number, duration: number, target: string, transform: string, metadata: string) =>
    `<DOMFrame index="${index}" duration="${duration}" tweenType="motion" motionTweenSnap="true" keyMode="22017">${metadata}` +
    `<elements><DOMSymbolInstance libraryItemName="${target}" symbolType="graphic" loop="single frame">` +
    `${transform}<transformationPoint><Point x="5" y="7"/></transformationPoint></DOMSymbolInstance></elements></DOMFrame>`;
  const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
    layer('scene', [frame(0, symbol('motion-root'))].join('')),
  ])}</timelines></DOMDocument>`;
  const libraryXmlEntries = [{
    name: 'LIBRARY/motion-root.xml',
    xml: graphic('motion-root', [layer('moving', [
      motionFrame(0, duration, 'moving-target', transformedMatrix(1, 0, 0, 1, 0, 0), startMetadata),
      motionFrame(duration, 1, endLibraryItemName, transformedMatrix(0, 1, -1, 0, 20, 30), endMetadata),
    ].join(''))]),
  }];
  const adapted = adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  if (!adapted.ok) throw new Error(`Motion adapter fixture failed: ${adapted.message}`);
  return adapted.source;
}

function descriptor(source: ReturnType<typeof buildAdapterFixture>['adapted'], name: string): FlaXflGraphicSymbolDescriptor {
  const result = source.graphicSymbols.find((candidate) => candidate.sourceLibraryItemName === name);
  if (!result) throw new Error(`Missing Graphic fixture: ${name}`);
  return result;
}

function elementNames(elements: readonly { readonly kind: string; readonly libraryItemName?: string }[]): string[] {
  return elements.map((element) => element.libraryItemName ?? element.kind);
}

describe('XFL display-list adapter painter-order normalization (#700)', () => {
  it('normalizes Scene, Graphic, and nested Graphic layers once while preserving within-layer order and transforms', () => {
    const { adapted: source, documentXml, libraryXmlEntries, originalLibraryEntries } = buildAdapterFixture();
    const scene = source.sceneTimelines[0];
    expect(scene).toBeDefined();
    if (!scene) return;

    const sceneContext = scene.frameContext;
    expect(sceneContext.layers.map((candidate) => candidate.name)).toEqual(['scene-back', 'scene-front']);
    expect(elementNames(sceneContext.layers[0]!.elements)).toEqual(['scene-back-a', 'scene-back-b']);
    expect(elementNames(sceneContext.layers[1]!.elements)).toEqual(['outer', 'scene-front-after']);
    expect(sceneContext.layers[1]!.elements[0]).toMatchObject({
      kind: 'symbol',
      localTransform: { tx: 9, ty: 11 },
    });

    const outer = descriptor(source, 'outer');
    const inner = descriptor(source, 'inner');
    expect(outer.frameContext.layers.map((candidate) => candidate.name)).toEqual(['outer-back', 'outer-front']);
    expect(outer.frameContext.layers[1]!.elements.map((element) => element.kind === 'symbol'
      ? element.libraryItemName
      : element.kind === 'bitmap' ? element.libraryItemName : element.kind)).toEqual([
      'inner',
      'outer-front-after',
    ]);
    expect(inner.frameContext.layers.map((candidate) => candidate.name)).toEqual(['inner-back', 'inner-front']);
    expect(elementNames(inner.frameContext.layers[1]!.elements)).toEqual(['inner-front-a', 'inner-front-b']);

    const resolved = resolveFlaDisplayList({
      root: { kind: 'scene', name: scene.name, frameContext: sceneContext },
      symbols: source.symbols,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.displayList.layers.map((candidate) => candidate.name)).toEqual(['scene-back', 'scene-front']);
    const outerNode = resolved.displayList.layers[1]!.children[0];
    expect(outerNode).toMatchObject({ kind: 'group', symbolLibraryItemName: 'outer', worldTransform: { tx: 9, ty: 11 } });
    if (outerNode?.kind !== 'group') return;
    expect(outerNode.children[0]?.kind).toBe('shape');
    const innerNode = outerNode.children[1];
    expect(innerNode).toMatchObject({ kind: 'group', symbolLibraryItemName: 'inner', worldTransform: { tx: 22, ty: 28 } });
    if (innerNode?.kind !== 'group') return;
    expect(innerNode.children.map((candidate) => candidate.kind === 'bitmap'
      ? candidate.libraryItemName
      : candidate.kind)).toEqual(['shape', 'inner-front-a', 'inner-front-b']);
    expect(outerNode.children[2]).toMatchObject({ kind: 'bitmap', libraryItemName: 'outer-front-after' });
    expect(resolved.displayList.layers[1]!.children[1]).toMatchObject({
      kind: 'bitmap',
      libraryItemName: 'scene-front-after',
      worldTransform: { tx: 21, ty: 22 },
    });

    // Resolving nested symbols must not reorder the original archive entry
    // list or mutate the selected Scene frame context.
    expect(source.sceneTimelines[0]!.frameContext).toEqual(sceneContext);
    expect(libraryXmlEntries).toEqual(originalLibraryEntries);
    expect(documentXml).toContain('<DOMLayer name="scene-front">');
  });

  it('normalizes explicitly selected Scene and Graphic frames without changing element order', () => {
    const { adapted: source } = buildAdapterFixture();
    const scene = source.sceneTimelines[0];
    expect(scene).toBeDefined();
    if (!scene) return;

    const selectedScene = source.buildSceneFrameContext(scene.xml, 1, 'selected-scene-frame');
    expect(selectedScene.ok).toBe(true);
    if (!selectedScene.ok) return;
    expect(selectedScene.value.frameIndex).toBe(1);
    expect(selectedScene.value.layers.map((candidate) => candidate.name)).toEqual(['scene-back', 'scene-front']);
    expect(elementNames(selectedScene.value.layers[0]!.elements)).toEqual([
      'scene-back-frame1-a',
      'scene-back-frame1-b',
    ]);
    expect(elementNames(selectedScene.value.layers[1]!.elements)).toEqual([
      'scene-front-frame1-a',
      'scene-front-frame1-b',
    ]);

    const outer = descriptor(source, 'outer');
    const selectedGraphic = source.buildGraphicFrameContext(
      outer.timelineXml,
      outer.frameSpanIndex,
      1,
      'selected-outer-frame',
    );
    expect(selectedGraphic.ok).toBe(true);
    if (!selectedGraphic.ok) return;
    expect(selectedGraphic.value.frameIndex).toBe(1);
    expect(selectedGraphic.value.layers.map((candidate) => candidate.name)).toEqual(['outer-back', 'outer-front']);
    expect(elementNames(selectedGraphic.value.layers[1]!.elements)).toEqual([
      'outer-front-frame1-a',
      'outer-front-frame1-b',
    ]);
  });

  it('resolves the bounded two-frame motion span through the production Graphic frame adapter', () => {
    const source = buildMotionAdapterFixture();
    const target = descriptor(source, 'motion-root');

    const selected = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      1,
      'bounded-motion-interior',
    );

    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value.frameIndex).toBe(1);
    expect(selected.value.layers).toHaveLength(1);
    expect(selected.value.layers[0]?.elements).toHaveLength(1);
    const interpolated = selected.value.layers[0]?.elements[0];
    expect(interpolated).toMatchObject({
      kind: 'symbol',
      libraryItemName: 'moving-target',
      symbolType: 'graphic',
      localTransform: {
        tx: 10,
        ty: 15,
      },
    });
    if (interpolated?.kind !== 'symbol' || !interpolated.localTransform) return;
    expect(interpolated.localTransform.a).toBeCloseTo(Math.SQRT1_2, 12);
    expect(interpolated.localTransform.b).toBeCloseTo(Math.SQRT1_2, 12);
    expect(interpolated.localTransform.c).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(interpolated.localTransform.d).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('resolves source-proven three-frame spans at their exact 1/3 and 2/3 progress', () => {
    const source = buildMotionAdapterFixture('', '', 'moving-target', 3);
    const target = descriptor(source, 'motion-root');

    for (const [frameIndex, progress] of [[1, 1 / 3], [2, 2 / 3]] as const) {
      const selected = source.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        frameIndex,
        `bounded-three-frame-motion-${frameIndex}`,
      );

      expect(selected.ok).toBe(true);
      if (!selected.ok) continue;
      const interpolated = selected.value.layers[0]?.elements[0];
      expect(interpolated?.kind).toBe('symbol');
      if (interpolated?.kind !== 'symbol' || !interpolated.localTransform) continue;
      expect(interpolated.localTransform.tx).toBeCloseTo(20 * progress, 12);
      expect(interpolated.localTransform.ty).toBeCloseTo(30 * progress, 12);
      expect(interpolated.localTransform.a).toBeCloseTo(Math.cos(Math.PI / 2 * progress), 12);
      expect(interpolated.localTransform.b).toBeCloseTo(Math.sin(Math.PI / 2 * progress), 12);
    }

    const unsupportedLongerSpan = buildMotionAdapterFixture('', '', 'moving-target', 4);
    const unsupportedTarget = descriptor(unsupportedLongerSpan, 'motion-root');
    const unsupported = unsupportedLongerSpan.buildGraphicFrameContext(
      unsupportedTarget.timelineXml,
      unsupportedTarget.frameSpanIndex,
      2,
      'unsupported-four-frame-motion',
    );
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.message).toContain('bounded transform-only subset');
  });

  it('keeps motion tween interiors fail-closed when source easing or target identity changes', () => {
    const eased = buildMotionAdapterFixture('<Ease><Property name="x" value="1"/></Ease>');
    const easedTarget = descriptor(eased, 'motion-root');
    const easedResult = eased.buildGraphicFrameContext(
      easedTarget.timelineXml,
      easedTarget.frameSpanIndex,
      1,
      'eased-motion-interior',
    );
    expect(easedResult.ok).toBe(false);
    if (!easedResult.ok) expect(easedResult.message).toContain('bounded transform-only subset');

    const mismatched = buildMotionAdapterFixture('', '', 'different-target');
    const mismatchedTarget = descriptor(mismatched, 'motion-root');
    const mismatchedResult = mismatched.buildGraphicFrameContext(
      mismatchedTarget.timelineXml,
      mismatchedTarget.frameSpanIndex,
      1,
      'mismatched-motion-interior',
    );
    expect(mismatchedResult.ok).toBe(false);
    if (!mismatchedResult.ok) expect(mismatchedResult.message).toContain('bounded transform-only subset');
  });
});
