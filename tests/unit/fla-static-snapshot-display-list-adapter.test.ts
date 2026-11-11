import { describe, expect, it } from 'vitest';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import {
  adaptFlaXflDisplaySource,
  adaptFlaXflDisplaySourceCooperatively,
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
        layer('outer-back', [frame(0, shape()), frame(1, shape()), frame(2, shape())].join('')),
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

describe('cooperative XFL display-source adaptation', () => {
  it('stops at a yield boundary when the inspection session is cancelled', async () => {
    const fixture = buildAdapterFixture();
    let cancelled = false;
    let yieldCount = 0;
    const adapted = await adaptFlaXflDisplaySourceCooperatively(
      fixture.documentXml,
      fixture.libraryXmlEntries,
      {
        shouldContinue: () => !cancelled,
        async yieldToEventLoop() {
          yieldCount += 1;
          cancelled = true;
        },
      },
    );

    expect(adapted.ok).toBe(false);
    expect(yieldCount).toBe(1);
    if (!adapted.ok) expect(adapted.message).toContain('cancelled');
  });
});

function buildMotionAdapterFixture(
  startMetadata = '',
  endMetadata = '',
  endLibraryItemName = 'moving-target',
  duration = 2,
  holdEndpoint = false,
  terminalFrameAttributes: Readonly<Partial<Record<'tweenType' | 'motionTweenSnap' | 'motionTweenSync' | 'keyMode', string | undefined>>> = {},
  startKeyMode: string | null = '22017',
  motionFrameAttributes: Readonly<Record<string, string>> = {},
  firstFrameTransition = false,
  playbackMode = 'single frame',
  sampleEndAlphaMultiplier?: string,
  sourceRotationAttributes: Readonly<Record<string, string | undefined>> = {},
  spanStartIndex = 0,
  sampleStartAlphaMultiplier?: string,
  endFirstFrameOverride?: string,
  sampleEndColorTransformXml?: string,
) {
  const spanEndIndex = spanStartIndex + duration;
  const motionFrameAttributeXml = Object.entries(motionFrameAttributes)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');
  const sourceRotationAttributeXml = Object.entries(sourceRotationAttributes)
    .flatMap(([name, value]) => value === undefined ? [] : [` ${name}="${value}"`])
    .join('');
  const motionFrame = (
    index: number,
    duration: number,
    target: string,
    transform: string,
    metadata: string,
    keyMode = startKeyMode,
  ) => {
    const isStartFrame = index === spanStartIndex;
    const authoredFirstFrame = !firstFrameTransition
      ? undefined
      : isStartFrame
        ? spanStartIndex > 0 ? String(spanStartIndex) : undefined
        : endFirstFrameOverride ?? String(spanEndIndex);
    const firstFrame = authoredFirstFrame === undefined ? '' : ` firstFrame="${authoredFirstFrame}"`;
    const alphaMultiplier = isStartFrame
      ? sampleStartAlphaMultiplier
      : sampleEndAlphaMultiplier;
    const alphaColorTransformXml = alphaMultiplier !== undefined
      ? `<color><Color alphaMultiplier="${alphaMultiplier}"/></color>`
      : '';
    const colorTransformXml = isStartFrame
      ? alphaColorTransformXml
      : sampleEndColorTransformXml ?? alphaColorTransformXml;
    const keyModeAttribute = keyMode === null ? '' : ` keyMode="${keyMode}"`;
    return `<DOMFrame index="${index}" duration="${duration}" tweenType="motion" motionTweenSnap="true"${keyModeAttribute}${motionFrameAttributeXml}${isStartFrame ? sourceRotationAttributeXml : ''}>${metadata}` +
      `<elements><DOMSymbolInstance libraryItemName="${target}" symbolType="graphic" loop="${playbackMode}"${isStartFrame ? '' : ' selected="true"'}${firstFrame}>` +
      `${transform}${colorTransformXml}</DOMSymbolInstance></elements></DOMFrame>`;
  };
  const terminalFrame = () => {
    const attributes = {
      index: String(spanStartIndex + duration),
      duration: '1',
      keyMode: '15872',
      ...terminalFrameAttributes,
    };
    const attributeXml = Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}="${value}"`)
      .join(' ');
    return `<DOMFrame ${attributeXml}>${endMetadata}<elements>` +
      `<DOMSymbolInstance libraryItemName="${endLibraryItemName}" symbolType="graphic" loop="single frame">` +
      `${transformedMatrix(0, 1, -1, 0, 20, 30)}` +
      `</DOMSymbolInstance></elements></DOMFrame>`;
  };
  const endpointFrame = holdEndpoint
    ? terminalFrame()
    : motionFrame(spanStartIndex + duration, 1, endLibraryItemName, transformedMatrix(0, 1, -1, 0, 20, 30), endMetadata);
  const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
    layer('scene', [frame(0, symbol('motion-root'))].join('')),
  ])}</timelines></DOMDocument>`;
  const libraryXmlEntries = [{
    name: 'LIBRARY/motion-root.xml',
    xml: graphic('motion-root', [layer('moving', [
      motionFrame(spanStartIndex, duration, 'moving-target', transformedMatrix(1, 0, 0, 1, 0, 0), startMetadata),
      endpointFrame,
    ].join(''))]),
  }];
  const adapted = adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  if (!adapted.ok) throw new Error(`Motion adapter fixture failed: ${adapted.message}`);
  return adapted.source;
}

function buildPivotMotionAdapterFixture(
  startPivot: { readonly x: number; readonly y: number },
  endPivot: { readonly x: number; readonly y: number },
) {
  const pivotXml = (point: { readonly x: number; readonly y: number }) =>
    `<transformationPoint><Point x="${point.x}" y="${point.y}"/></transformationPoint>`;
  const motionFrame = `<DOMFrame index="0" duration="2" tweenType="motion" keyMode="22017"><elements>` +
    `<DOMSymbolInstance libraryItemName="moving-target" symbolType="graphic">${matrix(0, 0)}` +
    `${pivotXml(startPivot)}</DOMSymbolInstance></elements></DOMFrame>`;
  const endpointFrame = `<DOMFrame index="2" keyMode="15872"><elements>` +
    `<DOMSymbolInstance libraryItemName="moving-target" symbolType="graphic">` +
    `${transformedMatrix(0, 1, -1, 0, 20, 30)}${pivotXml(endPivot)}` +
    `</DOMSymbolInstance></elements></DOMFrame>`;
  const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
    layer('scene', [frame(0, symbol('motion-root'))].join('')),
  ])}</timelines></DOMDocument>`;
  const adapted = adaptFlaXflDisplaySource(documentXml, [{
    name: 'LIBRARY/motion-root.xml',
    xml: graphic('motion-root', [layer('moving', `${motionFrame}${endpointFrame}`)]),
  }]);
  if (!adapted.ok) throw new Error(`Pivot motion adapter fixture failed: ${adapted.message}`);
  return adapted.source;
}

function buildSnapAdapterFixture(
  snapValue: string | null,
  keyMode = '17921',
  withMotionGuide = false,
) {
  const snapAttribute = snapValue === null ? '' : ` motionTweenSnap="${snapValue}"`;
  const guideLayer = withMotionGuide
    ? '<DOMLayer name="guide" layerType="guide"><frames>' + frame(0, shape()) + '</frames></DOMLayer>'
    : '';
  const movingLayerParent = withMotionGuide ? ' parentLayerIndex="0"' : '';
  const movingLayer = `<DOMLayer name="moving"${movingLayerParent}><frames>` +
    `<DOMFrame index="0" duration="2" tweenType="motion" keyMode="${keyMode}"${snapAttribute}>` +
    `<elements><DOMSymbolInstance libraryItemName="moving-target" symbolType="graphic">${matrix(0, 0)}</DOMSymbolInstance></elements>` +
    `</DOMFrame><DOMFrame index="2" keyMode="9728"><frameFilters><BlurFilter blurX="20" blurY="4"/></frameFilters>` +
    `<elements><DOMSymbolInstance libraryItemName="moving-target" symbolType="graphic">${transformedMatrix(0, 1, -1, 0, 20, 30)}</DOMSymbolInstance></elements>` +
    `</DOMFrame></frames></DOMLayer>`;
  const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
    layer('scene', [frame(0, symbol('motion-root'))].join('')),
  ])}</timelines></DOMDocument>`;
  const adapted = adaptFlaXflDisplaySource(documentXml, [{
    name: 'LIBRARY/motion-root.xml',
    xml: graphic('motion-root', [guideLayer, movingLayer].filter(Boolean)),
  }, {
    name: 'LIBRARY/moving-target.xml',
    xml: graphic('moving-target', [layer('art', frame(0, shape()))]),
  }]);
  if (!adapted.ok) throw new Error(`Snap adapter fixture failed: ${adapted.message}`);
  return adapted.source;
}

function buildRiggingAdapterFixtureResult(options: {
  readonly childTween?: boolean;
  readonly childRigParent?: string;
  readonly parentRigId?: string;
  readonly childRigId?: string;
  readonly parentTween?: boolean;
  readonly parentFrameParent?: string;
  readonly withGrandparent?: boolean;
  readonly parentObjectCount?: number;
  readonly childStartMatrix?: string;
  readonly parentStartMatrix?: string;
  readonly parentMatrix?: string;
  readonly parentStartPivot?: { readonly x: number; readonly y: number };
  readonly parentEndPivot?: { readonly x: number; readonly y: number };
  readonly grandparentMatrix?: string;
  readonly rigPropagationMatrix?: string;
} = {}) {
  const childTween = options.childTween ?? true;
  const childRigParent = options.childRigParent ?? '7';
  const parentRigId = options.parentRigId ?? '7';
  const childRigId = options.childRigId;
  const parentTween = options.parentTween ?? true;
  const parentFrameParent = options.parentFrameParent;
  const withGrandparent = options.withGrandparent ?? false;
  const parentObjectCount = options.parentObjectCount ?? 1;
  const childStartMatrix = options.childStartMatrix ?? matrix(10, 0);
  const parentStartMatrix = options.parentStartMatrix ?? matrix(0, 0);
  const parentMatrix = options.parentMatrix ?? transformedMatrix(0, 1, -1, 0, 0, 0);
  const pivotXml = (pivot: { readonly x: number; readonly y: number } | undefined) =>
    pivot ? `<transformationPoint><Point x="${pivot.x}" y="${pivot.y}"/></transformationPoint>` : '';
  const parentStartPivotXml = pivotXml(options.parentStartPivot);
  const parentEndPivotXml = pivotXml(options.parentEndPivot);
  const grandparentMatrix = options.grandparentMatrix ?? matrix(0, 0);
  const rigPropagationMatrix = options.rigPropagationMatrix ??
    '{&quot;a&quot;:64859,&quot;b&quot;:-9181,&quot;c&quot;:9181,&quot;d&quot;:64859,&quot;tx&quot;:0,&quot;ty&quot;:0}';
  const childStart = `<DOMFrame index="0" duration="${childTween ? 4 : 5}"${childTween ? ' tweenType="motion" keyMode="22017"' : ''} parentLayerIndex="${childRigParent}">` +
    `<elements><DOMSymbolInstance libraryItemName="child-art" symbolType="graphic">${childStartMatrix}</DOMSymbolInstance></elements></DOMFrame>`;
  const childEnd = childTween
    ? `<DOMFrame index="4" keyMode="9728" parentLayerIndex="${childRigParent}"><elements>` +
      `<DOMSymbolInstance libraryItemName="child-art" symbolType="graphic">${transformedMatrix(0, 1, -1, 0, 0, 10)}</DOMSymbolInstance>` +
      `</elements></DOMFrame>`
    : '';
  const parentEndAttributes = [
    'index="4"',
    'keyMode="9728"',
    ...(parentFrameParent !== undefined ? [`parentLayerIndex="${parentFrameParent}"`] : []),
    `rigPropagationMatrix="${rigPropagationMatrix}"`,
  ].join(' ');
  const parentElements = (matrixXml: string, pivotXml: string) => Array.from({ length: parentObjectCount }, (_, index) =>
    `<DOMSymbolInstance libraryItemName="parent-art-${index}" symbolType="graphic">${matrixXml}${pivotXml}</DOMSymbolInstance>`,
  ).join('');
  const parentStart = `<DOMFrame index="0" duration="${parentTween ? 4 : 5}"${parentTween ? ' tweenType="motion" keyMode="22017" motionTweenSnap="true"' : ''}${parentFrameParent !== undefined ? ` parentLayerIndex="${parentFrameParent}"` : ''}>` +
    `<elements>${parentElements(parentStartMatrix, parentStartPivotXml)}</elements></DOMFrame>`;
  const parentEnd = parentTween
    ? `<DOMFrame ${parentEndAttributes}><elements>${parentElements(parentMatrix, parentEndPivotXml)}</elements></DOMFrame>`
    : '';
  const childLayerRigId = childRigId !== undefined ? ` layerRiggingIndex="${childRigId}"` : '';
  const rootLayers = [
    `<DOMLayer name="child"${childLayerRigId}><frames>${childStart}${childEnd}</frames></DOMLayer>`,
    `<DOMLayer name="parent" layerRiggingIndex="${parentRigId}"><frames>${parentStart}${parentEnd}</frames></DOMLayer>`,
    ...(withGrandparent ? [
      `<DOMLayer name="grandparent" layerRiggingIndex="8"><frames><DOMFrame index="0" duration="5"><elements>` +
        `<DOMSymbolInstance libraryItemName="grandparent-art" symbolType="graphic">${grandparentMatrix}</DOMSymbolInstance>` +
        `</elements></DOMFrame></frames></DOMLayer>`,
    ] : []),
  ];
  const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
    layer('scene', [frame(0, symbol('rig-root'))].join('')),
  ])}</timelines></DOMDocument>`;
  const adapted = adaptFlaXflDisplaySource(documentXml, [{
    name: 'LIBRARY/rig-root.xml',
    xml: graphic('rig-root', rootLayers),
  }, {
    name: 'LIBRARY/child-art.xml',
    xml: graphic('child-art', [layer('art', frame(0, shape()))]),
  }, ...Array.from({ length: parentObjectCount }, (_, index) => ({
    name: `LIBRARY/parent-art-${index}.xml`,
    xml: graphic(`parent-art-${index}`, [layer('art', frame(0, shape()))]),
  })), ...(withGrandparent ? [{
    name: 'LIBRARY/grandparent-art.xml',
    xml: graphic('grandparent-art', [layer('art', frame(0, shape()))]),
  }] : [])]);
  return adapted;
}

function buildRiggingAdapterFixture(options: Parameters<typeof buildRiggingAdapterFixtureResult>[0] = {}) {
  const adapted = buildRiggingAdapterFixtureResult(options);
  if (!adapted.ok) throw new Error(`Rig adapter fixture failed: ${adapted.message}`);
  return adapted.source;
}

function buildRiggingDepthFixtureResult(parentDepth: number) {
  const childFrames = `<DOMFrame index="0" duration="4" tweenType="motion" keyMode="22017" parentLayerIndex="7">` +
    `<elements><DOMSymbolInstance libraryItemName="child-art" symbolType="graphic">${matrix(10, 0)}</DOMSymbolInstance></elements></DOMFrame>` +
    `<DOMFrame index="4" keyMode="9728" parentLayerIndex="7"><elements>` +
    `<DOMSymbolInstance libraryItemName="child-art" symbolType="graphic">${transformedMatrix(0, 1, -1, 0, 0, 10)}</DOMSymbolInstance>` +
    `</elements></DOMFrame>`;
  const parentLayers = Array.from({ length: parentDepth }, (_, index) => {
    const rigId = 7 + index;
    const parent = index + 1 < parentDepth ? ` parentLayerIndex="${rigId + 1}"` : '';
    const parentFrame = `<DOMFrame index="0" duration="5"${parent}><elements>` +
      `<DOMSymbolInstance libraryItemName="parent-art-${index}" symbolType="graphic">${matrix(0, 0)}</DOMSymbolInstance>` +
      `</elements></DOMFrame>`;
    return `<DOMLayer name="parent-${index}" layerRiggingIndex="${rigId}"><frames>${parentFrame}</frames></DOMLayer>`;
  });
  const adapted = adaptFlaXflDisplaySource(
    `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
      layer('scene', frame(0, symbol('rig-root'))),
    ])}</timelines></DOMDocument>`,
    [{ name: 'LIBRARY/rig-root.xml', xml: graphic('rig-root', [
      `<DOMLayer name="child"><frames>${childFrames}</frames></DOMLayer>`,
      ...parentLayers,
    ]) }, {
      name: 'LIBRARY/child-art.xml',
      xml: graphic('child-art', [layer('art', frame(0, shape()))]),
    }, ...Array.from({ length: parentDepth }, (_, index) => ({
      name: `LIBRARY/parent-art-${index}.xml`,
      xml: graphic(`parent-art-${index}`, [layer('art', frame(0, shape()))]),
    }))],
  );
  return adapted;
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

  it('keeps shape lookup and node accounting scoped when one prepared source resolves multiple authored frames', () => {
    const { adapted: source } = buildAdapterFixture();
    const outer = descriptor(source, 'outer');
    const baseShapeIds = new Set(source.shapeBlocks.keys());

    const selectedFrame1 = source.buildGraphicFrameContext(
      outer.timelineXml,
      outer.frameSpanIndex,
      1,
      'selected-outer-frame-1',
    );
    expect(selectedFrame1.ok).toBe(true);
    const frame1ShapeIds = [...source.shapeBlocks.keys()].filter((id) => !baseShapeIds.has(id));
    expect(frame1ShapeIds).toHaveLength(1);

    const selectedFrame2 = source.buildGraphicFrameContext(
      outer.timelineXml,
      outer.frameSpanIndex,
      2,
      'selected-outer-frame-2',
    );
    expect(selectedFrame2.ok).toBe(true);
    const frame2ShapeIds = [...source.shapeBlocks.keys()].filter((id) => !baseShapeIds.has(id));
    expect(frame2ShapeIds).toHaveLength(1);
    expect(frame2ShapeIds[0]).not.toBe(frame1ShapeIds[0]);
    expect(source.shapeBlocks.has(frame1ShapeIds[0]!)).toBe(false);
    expect(source.shapeBlocks.has(frame2ShapeIds[0]!)).toBe(true);

    source.resetFrameBuildState();
    expect(new Set(source.shapeBlocks.keys())).toEqual(baseShapeIds);
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

  it('keeps the XFL transformation point on its authored world path inside Classic Motion', () => {
    const source = buildPivotMotionAdapterFixture(
      { x: 5, y: 7 },
      { x: 8, y: 3 },
    );
    const target = descriptor(source, 'motion-root');
    const start = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      0,
      'pivot-motion-start',
    );
    const interior = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      1,
      'pivot-motion-interior',
    );
    const end = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      2,
      'pivot-motion-end',
    );

    expect(start.ok).toBe(true);
    expect(interior.ok).toBe(true);
    expect(end.ok).toBe(true);
    if (!start.ok || !interior.ok || !end.ok) return;
    const startElement = start.value.layers[0]?.elements[0];
    const interiorElement = interior.value.layers[0]?.elements[0];
    const endElement = end.value.layers[0]?.elements[0];
    expect(startElement?.localTransform).toEqual({
      a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0,
    });
    expect(endElement?.localTransform).toEqual({
      a: 0, b: 1, c: -1, d: 0, tx: 20, ty: 30,
    });
    expect(interiorElement?.localTransform?.tx).toBeCloseTo(9.939339828220179, 12);
    expect(interiorElement?.localTransform?.ty).toBeCloseTo(14.368272016354704, 12);
    if (interiorElement?.kind !== 'symbol' || !interiorElement.localTransform) return;
    expect(
      interiorElement.localTransform.a * 6.5 +
      interiorElement.localTransform.c * 5 +
      interiorElement.localTransform.tx,
    ).toBeCloseTo(11, 12);
    expect(
      interiorElement.localTransform.b * 6.5 +
      interiorElement.localTransform.d * 5 +
      interiorElement.localTransform.ty,
    ).toBeCloseTo(22.5, 12);
  });

  it('interpolates one source-supported directional frame BlurFilter within its motion span', () => {
    const emptyFrameFilters = buildMotionAdapterFixture(
      '',
      '<frameFilters/>',
      'moving-target',
      13,
      true,
      { keyMode: '9728' },
    );
    const emptyFiltersTarget = descriptor(emptyFrameFilters, 'motion-root');
    const selectedWithEmptyFilters = emptyFrameFilters.buildGraphicFrameContext(
      emptyFiltersTarget.timelineXml,
      emptyFiltersTarget.frameSpanIndex,
      1,
      'motion-frame-with-empty-frameFilters',
    );
    expect(selectedWithEmptyFilters.ok).toBe(true);

    const blurFrameFilters = buildMotionAdapterFixture(
      '',
      '<frameFilters><BlurFilter blurX="0" blurY="33"/></frameFilters>',
      'moving-target',
      13,
      true,
      { keyMode: '9728' },
    );
    const blurFiltersTarget = descriptor(blurFrameFilters, 'motion-root');
    const start = blurFrameFilters.buildGraphicFrameContext(
      blurFiltersTarget.timelineXml,
      blurFiltersTarget.frameSpanIndex,
      0,
      'motion-frame-with-blur-frameFilters-start',
    );
    expect(start.ok).toBe(true);
    if (start.ok) expect(start.value.layers[0]?.frameFilter).toBeUndefined();

    for (const [frameIndex, expectedProgress] of [[1, 1 / 13], [3, 3 / 13], [6, 6 / 13]] as const) {
      const selected = blurFrameFilters.buildGraphicFrameContext(
        blurFiltersTarget.timelineXml,
        blurFiltersTarget.frameSpanIndex,
        frameIndex,
        `motion-frame-with-blur-frameFilters-${frameIndex}`,
      );
      expect(selected.ok).toBe(true);
      if (!selected.ok) continue;
      expect(selected.value.layers[0]?.frameFilter).toMatchObject({
        kind: 'blur', blurX: 0, quality: 'low', enabled: true,
      });
      expect(selected.value.layers[0]?.frameFilter?.blurY).toBeCloseTo(33 * expectedProgress, 3);
    }

    const end = blurFrameFilters.buildGraphicFrameContext(
      blurFiltersTarget.timelineXml,
      blurFiltersTarget.frameSpanIndex,
      13,
      'motion-frame-with-blur-frameFilters-end',
    );
    expect(end.ok).toBe(true);
    if (end.ok) expect(end.value.layers[0]?.frameFilter?.blurY).toBe(33);
  });

  it('rejects unsupported BlurFilter combinations and interpolates an authored start filter', () => {
    const unsupportedEndFilters = [
      '<frameFilters><GlowFilter/></frameFilters>',
      '<frameFilters><BlurFilter blurX="0" blurY="33" quality="low"/></frameFilters>',
      '<frameFilters><BlurFilter blurX="0" blurY="256"/></frameFilters>',
      '<frameFilters><BlurFilter blurX="0" blurY="33"><Unsupported/></BlurFilter></frameFilters>',
      '<frameFilters><BlurFilter blurX="0" blurY="33"/><BlurFilter blurX="0" blurY="33"/></frameFilters>',
    ];
    for (const [index, metadata] of unsupportedEndFilters.entries()) {
      const source = buildMotionAdapterFixture('', metadata, 'moving-target', 13, true, { keyMode: '9728' });
      const target = descriptor(source, 'motion-root');
      const selected = source.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        1,
        `motion-frame-with-unsupported-filter-${index}`,
      );
      expect(selected.ok).toBe(false);
      if (!selected.ok) expect(selected.message).toContain('unsupported frame filter interpolation');
    }

    const startSource = buildMotionAdapterFixture(
      '<frameFilters><BlurFilter blurX="0" blurY="1"/></frameFilters>',
      '',
      'moving-target',
      13,
      true,
      { keyMode: '9728' },
    );
    const startTarget = descriptor(startSource, 'motion-root');
    const selectedWithStartFilter = startSource.buildGraphicFrameContext(
      startTarget.timelineXml,
      startTarget.frameSpanIndex,
      1,
      'motion-frame-with-unsupported-start-filter',
    );
    expect(selectedWithStartFilter.ok).toBe(true);
    if (selectedWithStartFilter.ok) {
      expect(selectedWithStartFilter.value.layers[0]?.frameFilter?.blurY).toBeCloseTo(1 - 1 / 13, 12);
    }
  });

  it('resolves linear transform motion spans at positive integer durations', () => {
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

    for (const duration of [4, 5, 6, 13, 14, 30, 72]) {
      const longerSpan = buildMotionAdapterFixture('', '', 'moving-target', duration);
      const longerTarget = descriptor(longerSpan, 'motion-root');
      const selectedLonger = longerSpan.buildGraphicFrameContext(
        longerTarget.timelineXml,
        longerTarget.frameSpanIndex,
        Math.floor(duration / 2),
        `bounded-source-motion-${duration}`,
      );
      expect(selectedLonger.ok).toBe(true);
    }

    const duration13 = buildMotionAdapterFixture('', '', 'moving-target', 13);
    const duration13Target = descriptor(duration13, 'motion-root');
    for (const [frameIndex, progress] of [[1, 1 / 13], [6, 6 / 13], [12, 12 / 13]] as const) {
      const selectedDuration13 = duration13.buildGraphicFrameContext(
        duration13Target.timelineXml,
        duration13Target.frameSpanIndex,
        frameIndex,
        `duration13-motion-frame-${frameIndex}`,
      );
      expect(selectedDuration13.ok).toBe(true);
      if (!selectedDuration13.ok) continue;
      const interpolated = selectedDuration13.value.layers[0]?.elements[0];
      expect(interpolated?.kind).toBe('symbol');
      if (interpolated?.kind !== 'symbol' || !interpolated.localTransform) continue;
      expect(interpolated.localTransform.tx).toBeCloseTo(20 * progress, 12);
      expect(interpolated.localTransform.ty).toBeCloseTo(30 * progress, 12);
      expect(interpolated.localTransform.a).toBeCloseTo(Math.cos(Math.PI / 2 * progress), 12);
      expect(interpolated.localTransform.b).toBeCloseTo(Math.sin(Math.PI / 2 * progress), 12);
    }

    const holdEndpoint = buildMotionAdapterFixture('', '', 'moving-target', 5, true);
    const holdTarget = descriptor(holdEndpoint, 'motion-root');
    const lastInterior = holdEndpoint.buildGraphicFrameContext(
      holdTarget.timelineXml,
      holdTarget.frameSpanIndex,
      4,
      'motion-ending-at-held-keyframe',
    );
    expect(lastInterior.ok).toBe(true);

  });

  it('preserves evidence-backed Sync and ordinary Classic Motion key-mode metadata', () => {
    const source = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      7,
      false,
      {},
      '24065',
      { motionTweenSync: 'true' },
    );
    const target = descriptor(source, 'motion-root');
    for (const frameIndex of [1, 3, 6]) {
      const selected = source.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        frameIndex,
        `sample-motion-metadata-frame-${frameIndex + 1}`,
      );

      expect(selected.ok).toBe(true);
      if (selected.ok) {
        const instance = selected.value.layers[0]?.elements[0];
        expect(instance).toMatchObject({ kind: 'symbol', sourceParentMotionTweenSync: true });
      }
    }

    const withoutSyncFlag = buildMotionAdapterFixture('', '', 'moving-target', 7, false, {}, '22017');
    const withoutSyncTarget = descriptor(withoutSyncFlag, 'motion-root');
    const afterSyncFlag = withoutSyncFlag.buildGraphicFrameContext(
      withoutSyncTarget.timelineXml,
      withoutSyncTarget.frameSpanIndex,
      3,
      'sample-motion-key-mode-after-sync-flag',
    );
    expect(afterSyncFlag.ok).toBe(true);
    if (afterSyncFlag.ok) {
      const instance = afterSyncFlag.value.layers[0]?.elements[0];
      expect(instance).not.toHaveProperty('sourceParentMotionTweenSync');
    }

    const explicitFalse = buildMotionAdapterFixture('', '', 'moving-target', 7, false, {}, '22017', {
      motionTweenSync: 'false',
    });
    const explicitFalseTarget = descriptor(explicitFalse, 'motion-root');
    const falseSyncFrame = explicitFalse.buildGraphicFrameContext(
      explicitFalseTarget.timelineXml,
      explicitFalseTarget.frameSpanIndex,
      3,
      'explicit-false-motion-sync',
    );
    expect(falseSyncFrame.ok).toBe(false);
    if (!falseSyncFrame.ok) expect(falseSyncFrame.message).toContain('keyMode=22017');

    const malformedSync = buildMotionAdapterFixture('', '', 'moving-target', 7, false, {}, '24065', {
      motionTweenSync: 'yes',
    });
    const malformedSyncTarget = descriptor(malformedSync, 'motion-root');
    const malformedSyncFrame = malformedSync.buildGraphicFrameContext(
      malformedSyncTarget.timelineXml,
      malformedSyncTarget.frameSpanIndex,
      3,
      'malformed-motion-sync',
    );
    expect(malformedSyncFrame.ok).toBe(false);
    if (!malformedSyncFrame.ok) expect(malformedSyncFrame.message).toContain('invalid authored value');
  });

  it('accepts the supported keyMode roles and rejects unknown or malformed authored values', () => {
    const accepted = [
      buildMotionAdapterFixture('', '', 'moving-target', 2, false, {}, '22017'),
      buildMotionAdapterFixture('', '', 'moving-target', 2, false, {}, '24065', { motionTweenSync: 'true' }),
      buildMotionAdapterFixture('', '', 'moving-target', 2, true, { keyMode: '15872' }, '22017'),
      buildMotionAdapterFixture('', '', 'moving-target', 2, true, { keyMode: '9728' }, '22017'),
    ];
    for (const [index, source] of accepted.entries()) {
      const target = descriptor(source, 'motion-root');
      const result = source.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        1,
        `supported-keyMode-role-${index}`,
      );
      expect(result.ok).toBe(true);
    }

    const rejected: readonly { readonly label: string; readonly keyMode: string | null; readonly sync?: string; readonly expected: string }[] = [
      { label: 'synthetic integer 3', keyMode: '3', expected: 'keyMode=3' },
      { label: 'negative integer', keyMode: '-1', expected: 'keyMode=-1' },
      { label: 'unknown bit pattern', keyMode: '12345', sync: 'true', expected: 'keyMode=12345' },
      { label: 'sync mode without sync flag', keyMode: '24065', expected: 'keyMode=24065' },
      { label: 'ordinary mode with sync flag', keyMode: '22017', sync: 'true', expected: 'keyMode=22017' },
      { label: 'missing keyMode', keyMode: null, expected: 'keyMode=(missing)' },
      { label: 'malformed keyMode', keyMode: 'not-an-integer', expected: 'keyMode=not-an-integer is not a valid safe integer' },
    ];
    for (const { label, keyMode, sync, expected } of rejected) {
      const source = buildMotionAdapterFixture(
        '',
        '',
        'moving-target',
        2,
        false,
        {},
        keyMode,
        sync === undefined ? {} : { motionTweenSync: sync },
      );
      const target = descriptor(source, 'motion-root');
      const result = source.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        1,
        `unsupported-keyMode-${label}`,
      );
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.message, label).toContain(expected);
    }

    const unsupportedTerminal = buildMotionAdapterFixture(
      '', '', 'moving-target', 2, true, { keyMode: '12345' }, '22017',
    );
    const terminalTarget = descriptor(unsupportedTerminal, 'motion-root');
    const terminalResult = unsupportedTerminal.buildGraphicFrameContext(
      terminalTarget.timelineXml,
      terminalTarget.frameSpanIndex,
      1,
      'unsupported-terminal-keyMode',
    );
    expect(terminalResult.ok).toBe(false);
    if (!terminalResult.ok) expect(terminalResult.message).toContain('keyMode=12345');

    const missingTerminal = buildMotionAdapterFixture(
      '', '', 'moving-target', 2, true, { keyMode: undefined }, '22017',
    );
    const missingTerminalTarget = descriptor(missingTerminal, 'motion-root');
    const missingTerminalResult = missingTerminal.buildGraphicFrameContext(
      missingTerminalTarget.timelineXml,
      missingTerminalTarget.frameSpanIndex,
      1,
      'missing-terminal-keyMode',
    );
    expect(missingTerminalResult.ok).toBe(false);
    if (!missingTerminalResult.ok) expect(missingTerminalResult.message).toContain('keyMode=(missing)');
  });

  it('accepts Classic Motion source metadata while preserving authored Graphic frame boundaries', () => {
    const source = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      7,
      false,
      {},
      '24065',
      { motionTweenSync: 'true' },
      true,
      'loop',
      '0.44921875',
    );
    const target = descriptor(source, 'motion-root');
    for (const frameIndex of [0, 1, 3, 6, 7]) {
      const selected = source.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        frameIndex,
        `classic-motion-frame-${frameIndex}`,
      );
      expect(selected.ok).toBe(true);
      if (!selected.ok) continue;
      const instance = selected.value.layers[0]?.elements[0];
      expect(instance).toMatchObject({
        kind: 'symbol',
        playbackMode: 'loop',
        sourceParentMotionTweenSync: true,
      });
      if (instance?.kind !== 'symbol') continue;
      expect(instance.firstFrame).toBe(frameIndex === 7 ? '7' : undefined);
      if (frameIndex === 0) {
        expect(instance.alphaMultiplier).toBeUndefined();
      } else {
        const progress = Math.min(frameIndex / 7, 1);
        expect(instance.alphaMultiplier).toBeCloseTo(1 + (0.44921875 - 1) * progress, 12);
      }
      if (frameIndex > 0 && frameIndex < 7) {
        expect(instance.localTransform?.tx).toBeCloseTo(20 * (frameIndex / 7), 12);
      }
    }
  });

  it('evaluates a generic Graphic child span from a non-zero parent origin', () => {
    const startIndex = 7;
    const duration = 7;
    const source = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      duration,
      false,
      {},
      '24065',
      { motionTweenSync: 'true' },
      true,
      'loop',
      '1',
      {},
      startIndex,
      '0.44921875',
    );
    const target = descriptor(source, 'motion-root');

    for (const [frameIndex, progress] of [[7, 0], [8, 1 / 7], [10, 3 / 7], [13, 6 / 7], [14, 1]] as const) {
      const selected = source.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        frameIndex,
        `generic-motion-frame-${frameIndex}`,
      );
      expect(selected.ok).toBe(true);
      if (!selected.ok) continue;
      const instance = selected.value.layers[0]?.elements[0];
      expect(instance).toMatchObject({
        kind: 'symbol',
        playbackMode: 'loop',
        sourceParentMotionTweenSync: true,
        sourceParentFrameIndex: frameIndex,
      });
      if (instance?.kind !== 'symbol' || !instance.localTransform) continue;
      expect(instance.firstFrame).toBe(frameIndex === 14 ? '14' : '7');
      expect(instance.alphaMultiplier ?? 1).toBeCloseTo(0.44921875 + (1 - 0.44921875) * progress, 12);
      expect(instance.localTransform.tx).toBeCloseTo(20 * progress, 12);
      expect(instance.localTransform.ty).toBeCloseTo(30 * progress, 12);
      expect(instance.localTransform.a).toBeCloseTo(Math.cos(Math.PI / 2 * progress), 12);
      expect(instance.localTransform.b).toBeCloseTo(Math.sin(Math.PI / 2 * progress), 12);
      expect(instance.sourceParentFrameSpanStart).toBe(frameIndex === 14 ? 14 : startIndex);
    }
  });

  it('interpolates alpha and RGB brightness channels independently across a tween span', () => {
    const source = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      7,
      false,
      {},
      '24065',
      { motionTweenSync: 'true' },
      true,
      'loop',
      undefined,
      {},
      7,
      '0.44921875',
      undefined,
      '<color><Color brightness="1"/></color>',
    );
    const target = descriptor(source, 'motion-root');

    for (const [frameIndex, progress] of [[7, 0], [8, 1 / 7], [10, 3 / 7], [13, 6 / 7], [14, 1]] as const) {
      const selected = source.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        frameIndex,
        `classic-motion-color-frame-${frameIndex}`,
      );
      expect(selected.ok).toBe(true);
      if (!selected.ok) continue;
      const instance = selected.value.layers[0]?.elements[0];
      expect(instance?.kind).toBe('symbol');
      if (instance?.kind !== 'symbol') continue;
      expect(instance.alphaMultiplier ?? 1).toBeCloseTo(0.44921875 + (1 - 0.44921875) * progress, 12);
      if (progress === 0) {
        expect(instance.rgbTransform).toBeUndefined();
      } else {
        expect(instance.rgbTransform?.multiplier).toBeCloseTo(1 - progress, 12);
        expect(instance.rgbTransform?.offset).toBeCloseTo(255 * progress, 12);
      }
    }
  });

  it('interpolates non-endpoint brightness values and applies Classic Motion easing', () => {
    const brightnessSource = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      2,
      false,
      {},
      '22017',
      {},
      false,
      'single frame',
      undefined,
      {},
      0,
      undefined,
      undefined,
      '<color><Color brightness="0.5"/></color>',
    );
    const brightnessTarget = descriptor(brightnessSource, 'motion-root');
    const brightnessFrame = brightnessSource.buildGraphicFrameContext(
      brightnessTarget.timelineXml,
      brightnessTarget.frameSpanIndex,
      1,
      'classic-motion-mid-brightness',
    );
    expect(brightnessFrame.ok).toBe(true);
    if (brightnessFrame.ok) {
      const instance = brightnessFrame.value.layers[0]?.elements[0];
      expect(instance?.kind).toBe('symbol');
      if (instance?.kind === 'symbol') {
        expect(instance.rgbTransform?.multiplier).toBeCloseTo(0.75, 12);
        expect(instance.rgbTransform?.offset).toBeCloseTo(63.75, 12);
      }
    }

    const easeSource = buildMotionAdapterFixture(
      '<tweens><Ease target="all" method="quadIn"/></tweens>',
      '',
      'moving-target',
      2,
    );
    const easeTarget = descriptor(easeSource, 'motion-root');
    const eased = easeSource.buildGraphicFrameContext(
      easeTarget.timelineXml,
      easeTarget.frameSpanIndex,
      1,
      'classic-motion-mid-ease',
    );
    expect(eased.ok).toBe(true);
    if (eased.ok) {
      const instance = eased.value.layers[0]?.elements[0];
      expect(instance?.kind).toBe('symbol');
      if (instance?.kind === 'symbol') expect(instance.localTransform?.tx).toBeCloseTo(5, 12);
    }

    const accelerationSource = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      2,
      false,
      {},
      '22017',
      { acceleration: '100' },
    );
    const accelerationTarget = descriptor(accelerationSource, 'motion-root');
    const accelerated = accelerationSource.buildGraphicFrameContext(
      accelerationTarget.timelineXml,
      accelerationTarget.frameSpanIndex,
      1,
      'classic-motion-mid-acceleration',
    );
    expect(accelerated.ok).toBe(true);
    if (accelerated.ok) {
      const instance = accelerated.value.layers[0]?.elements[0];
      expect(instance?.kind).toBe('symbol');
      if (instance?.kind === 'symbol') expect(instance.localTransform?.tx).toBeCloseTo(17.5, 12);
    }
  });

  it.each([
    {
      name: 'an unknown Color channel',
      color: '<color><Color redMultiplier="1"/></color>',
      reason: 'redMultiplier',
    },
    {
      name: 'multiple Color wrappers',
      color: '<color><Color brightness="1"/></color><color><Color brightness="1"/></color>',
      reason: 'multiple color wrappers',
    },
  ])('keeps Classic Motion fail-closed for $name with a Color-specific reason', ({ color, reason }) => {
    const source = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      7,
      false,
      {},
      '24065',
      { motionTweenSync: 'true' },
      true,
      'loop',
      undefined,
      {},
      7,
      '0.44921875',
      undefined,
      color,
    );
    const target = descriptor(source, 'motion-root');
    const selected = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      8,
      `invalid-sync-color-${reason}`,
    );

    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.message).toContain('unsupported Color');
      expect(selected.message).toContain(reason);
    }
  });

  it.each([
    { name: 'a six-frame span', duration: 6, endFirstFrame: undefined },
    { name: 'a differing authored child-frame endpoint', duration: 7, endFirstFrame: '13' },
  ])('accepts generic motion spans with $name', ({ duration, endFirstFrame }) => {
    const source = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      duration,
      false,
      {},
      '24065',
      { motionTweenSync: 'true' },
      true,
      'loop',
      undefined,
      {},
      7,
      undefined,
      endFirstFrame,
    );
    const target = descriptor(source, 'motion-root');
    const selected = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      8,
      `invalid-sync-pair-${duration}-${endFirstFrame ?? 'aligned'}`,
    );

    expect(selected.ok).toBe(true);
  });

  it.each([
    { direction: 'clockwise', expectedDelta: 5 * Math.PI / 2 },
    { direction: 'counter-clockwise', expectedDelta: -7 * Math.PI / 2 },
  ])('passes source $direction plus one extra turn to the existing matrix evaluator', ({ direction, expectedDelta }) => {
    const source = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      7,
      false,
      {},
      '24065',
      { motionTweenSync: 'true' },
      false,
      'loop',
      undefined,
      { motionTweenRotate: direction, motionTweenRotateTimes: '1' },
    );
    const target = descriptor(source, 'motion-root');

    for (const [frameIndex, progress] of [[1, 1 / 7], [3, 3 / 7], [6, 6 / 7]] as const) {
      const selected = source.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        frameIndex,
        `issue1047-${direction}-frame-${frameIndex}`,
      );
      expect(selected.ok).toBe(true);
      if (!selected.ok) continue;
      const instance = selected.value.layers[0]?.elements[0];
      expect(instance?.kind).toBe('symbol');
      if (instance?.kind !== 'symbol' || !instance.localTransform) continue;
      const expectedAngle = expectedDelta * progress;
      expect(instance.localTransform.a).toBeCloseTo(Math.cos(expectedAngle), 12);
      expect(instance.localTransform.b).toBeCloseTo(Math.sin(expectedAngle), 12);
      expect(instance.localTransform.tx).toBeCloseTo(20 * progress, 12);
      expect(instance.localTransform.ty).toBeCloseTo(30 * progress, 12);
    }
  });

  it.each([
    {
      name: 'unsupported direction',
      attrs: { motionTweenRotate: 'sideways' },
      reason: 'Unsupported motionTweenRotate value',
    },
    {
      name: 'fractional turn count',
      attrs: { motionTweenRotate: 'clockwise', motionTweenRotateTimes: '1.5' },
      reason: 'motionTweenRotateTimes must be a non-negative whole number',
    },
    {
      name: 'empty turn count',
      attrs: { motionTweenRotate: 'clockwise', motionTweenRotateTimes: '' },
      reason: 'motionTweenRotateTimes must be a non-negative whole number',
    },
  ])('rejects malformed Classic Motion rotation metadata with $name', ({ attrs, reason }) => {
    const source = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      7,
      false,
      {},
      '24065',
      { motionTweenSync: 'true' },
      false,
      'loop',
      undefined,
      attrs,
    );
    const target = descriptor(source, 'motion-root');
    const selected = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      3,
      `issue1047-invalid-${reason}`,
    );
    expect(selected.ok).toBe(false);
    if (!selected.ok) expect(selected.message).toContain(reason);
  });

  it('supports generic motion durations and validates source metadata at both endpoints', () => {
    const duration29 = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      29,
      true,
      { keyMode: '9728' },
    );
    const target = descriptor(duration29, 'motion-root');

    for (const [frameIndex, progress] of [[1, 1 / 29], [14, 14 / 29], [28, 28 / 29]] as const) {
      const selected = duration29.buildGraphicFrameContext(
        target.timelineXml,
        target.frameSpanIndex,
        frameIndex,
        `duration29-terminal9728-frame-${frameIndex}`,
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

    for (const terminalKeyMode of ['9728', '15872'] as const) {
      const synchronizedStart = buildMotionAdapterFixture(
        '',
        '',
        'moving-target',
        7,
        true,
        { keyMode: terminalKeyMode },
        '24065',
        { motionTweenSync: 'true' },
      );
      const synchronizedTarget = descriptor(synchronizedStart, 'motion-root');
      for (const [frameIndex, progress] of [[1, 1 / 7], [3, 3 / 7], [6, 6 / 7]] as const) {
        const selected = synchronizedStart.buildGraphicFrameContext(
          synchronizedTarget.timelineXml,
          synchronizedTarget.frameSpanIndex,
          frameIndex,
          `sync-start-terminal-${terminalKeyMode}-frame-${frameIndex}`,
        );
        expect(selected.ok, `terminal keyMode=${terminalKeyMode}, frame=${frameIndex}`).toBe(true);
        if (!selected.ok) continue;
        const interpolated = selected.value.layers[0]?.elements[0];
        expect(interpolated?.kind).toBe('symbol');
        if (interpolated?.kind !== 'symbol' || !interpolated.localTransform) continue;
        expect(interpolated.sourceParentMotionTweenSync).toBe(true);
        expect(interpolated.localTransform.tx).toBeCloseTo(20 * progress, 12);
        expect(interpolated.localTransform.ty).toBeCloseTo(30 * progress, 12);
      }
    }

    const explicitNoneTerminal = buildMotionAdapterFixture(
      '',
      '',
      'moving-target',
      29,
      true,
      { keyMode: '9728', tweenType: 'none' },
    );
    const explicitNoneTarget = descriptor(explicitNoneTerminal, 'motion-root');
    expect(explicitNoneTerminal.buildGraphicFrameContext(
      explicitNoneTarget.timelineXml,
      explicitNoneTarget.frameSpanIndex,
      1,
      'duration29-terminal9728-explicit-none',
    ).ok).toBe(true);

    const expectBlocked = (
      label: string,
      duration = 29,
      terminalAttributes: Readonly<Partial<Record<'tweenType' | 'motionTweenSnap' | 'motionTweenSync' | 'keyMode', string>>> = {
        keyMode: '9728',
      },
      endLibraryItemName = 'moving-target',
      startKeyMode = '22017',
      startMetadata = '',
    ) => {
      const source = buildMotionAdapterFixture(
        startMetadata,
        '',
        endLibraryItemName,
        duration,
        true,
        terminalAttributes,
        startKeyMode,
      );
      const fixtureTarget = descriptor(source, 'motion-root');
      const result = source.buildGraphicFrameContext(
        fixtureTarget.timelineXml,
        fixtureTarget.frameSpanIndex,
        1,
        `duration29-terminal9728-negative-${label}`,
      );
      expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.message).toContain('supported Classic Motion structure');
    };

    expectBlocked('invalid-terminal-keyMode', 29, { keyMode: 'not-an-integer' });
    expectBlocked('invalid-terminal-motionTweenSnap', 29, { keyMode: '9728', motionTweenSnap: 'invalid' });
    expectBlocked('terminal-with-Sync-metadata', 29, { keyMode: '9728', motionTweenSync: 'true' });
    expectBlocked('invalid-start-keyMode', 29, { keyMode: '9728' }, 'moving-target', 'not-an-integer');
    expectBlocked('untweened-start-keyMode-is-not-Classic-Motion', 29, { keyMode: '9728' }, 'moving-target', '9728');
    expectBlocked('easing-metadata', 29, { keyMode: '9728' }, 'moving-target', '22017',
      '<Ease><Property name="x" value="1"/></Ease>');
    expectBlocked('motion-path-metadata', 29, { keyMode: '9728' }, 'moving-target', '22017',
      '<MotionPath><Point x="1" y="2"/></MotionPath>');
    expectBlocked('different-endpoint-identity', 29, { keyMode: '9728' }, 'different-target');
  });

  it('pairs a Sync Classic start to the next valid Motion key without keyMode-family coupling', () => {
    const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
      layer('scene', [frame(0, symbol('motion-root'))].join('')),
    ])}</timelines></DOMDocument>`;
    const start = `<DOMFrame index="0" duration="2" tweenType="motion" motionTweenSnap="true" motionTweenSync="true" keyMode="24065"><elements>${symbol('moving-target')}</elements></DOMFrame>`;
    const nextMotionKey = `<DOMFrame index="2" duration="2" tweenType="motion" motionTweenSnap="true" keyMode="22017"><elements>${symbol('moving-target', 20, 30)}</elements></DOMFrame>`;
    const adapted = adaptFlaXflDisplaySource(documentXml, [{
      name: 'LIBRARY/motion-root.xml',
      xml: graphic('motion-root', [layer('moving', start + nextMotionKey)]),
    }]);
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;

    const target = descriptor(adapted.source, 'motion-root');
    const selected = adapted.source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      1,
      'sync-motion-to-ordinary-motion-key',
    );
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const interpolated = selected.value.layers[0]?.elements[0];
    expect(interpolated?.kind).toBe('symbol');
    if (interpolated?.kind !== 'symbol' || !interpolated.localTransform) return;
    expect(interpolated.sourceParentMotionTweenSync).toBe(true);
    expect(interpolated.localTransform.tx).toBeCloseTo(10, 12);
    expect(interpolated.localTransform.ty).toBeCloseTo(15, 12);
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
    if (!easedResult.ok) expect(easedResult.message).toContain('supported Classic Motion structure');

    const mismatched = buildMotionAdapterFixture('', '', 'different-target');
    const mismatchedTarget = descriptor(mismatched, 'motion-root');
    const mismatchedResult = mismatched.buildGraphicFrameContext(
      mismatchedTarget.timelineXml,
      mismatchedTarget.frameSpanIndex,
      1,
      'mismatched-motion-interior',
    );
    expect(mismatchedResult.ok).toBe(false);
    if (!mismatchedResult.ok) expect(mismatchedResult.message).toContain('supported Classic Motion structure');
  });
});

describe('Classic Motion Snap option and Motion Guide handling (#1061)', () => {
  it.each([
    { label: 'true with no guide layer', snap: 'true' },
    { label: 'false', snap: 'false' },
    { label: 'missing', snap: null },
  ])('interpolates ordinary Motion when Snap is $label and carries the BlurFilter', ({ label, snap }) => {
    const source = buildSnapAdapterFixture(snap);
    const target = descriptor(source, 'motion-root');
    const result = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      1,
      `snap-${label.replaceAll(' ', '-')}`,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const movingLayer = result.value.layers.find((candidate) => candidate.name === 'moving');
    const element = movingLayer?.elements[0];
    expect(element?.kind).toBe('symbol');
    if (element?.kind !== 'symbol' || !element.localTransform) return;
    expect(element.localTransform.tx).toBeCloseTo(10, 10);
    expect(element.localTransform.ty).toBeCloseTo(15, 10);
    expect(element.localTransform.a).toBeCloseTo(Math.SQRT1_2, 10);
    expect(element.localTransform.b).toBeCloseTo(Math.SQRT1_2, 10);
    expect(movingLayer?.frameFilter).toMatchObject({ blurX: 10, blurY: 2 });
  });

  it('keeps malformed Snap values diagnosed', () => {
    const source = buildSnapAdapterFixture('enabled');
    const target = descriptor(source, 'motion-root');
    const result = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      1,
      'malformed-snap-value',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('motionTweenSync or motionTweenSnap has an invalid authored value');
  });

  it('keeps an associated Motion Guide on the explicit unsupported path', () => {
    const source = buildSnapAdapterFixture(null, '17921', true);
    const target = descriptor(source, 'motion-root');
    const result = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      1,
      'motion-guide-path',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Motion Guide on layer 0 requires unsupported guide-path evaluation');
  });
});

describe('per-keyframe Rig parent matrix evaluation (#1061)', () => {
  function childAt(source: ReturnType<typeof buildAdapterFixture>['adapted'], frameIndex: number) {
    const target = descriptor(source, 'rig-root');
    const result = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      frameIndex,
      `rig-child-frame-${frameIndex}`,
    );
    if (!result.ok) return result;
    const childLayer = result.value.layers.find((candidate) => candidate.name === 'child');
    return { ...result, childLayer, element: childLayer?.elements[0] };
  }

  it.each([
    { pivotCase: 'missing', pivots: {} },
    {
      pivotCase: 'explicit zero',
      pivots: { parentStartPivot: { x: 0, y: 0 }, parentEndPivot: { x: 0, y: 0 } },
    },
  ])('uses rigging id and applies the parent pose once with $pivotCase pivots', ({ pivots }) => {
    const source = buildRiggingAdapterFixture(pivots);
    const start = childAt(source, 0);
    const middle = childAt(source, 2);
    const end = childAt(source, 4);

    expect(start.ok).toBe(true);
    expect(middle.ok).toBe(true);
    expect(end.ok).toBe(true);
    for (const [frameIndex, result] of [[0, start], [2, middle], [4, end]] as const) {
      expect(result.ok, `frame ${frameIndex}`).toBe(true);
      if (!result.ok) continue;
      expect(result.element?.kind).toBe('symbol');
      if (result.element?.kind !== 'symbol' || !result.element.localTransform) continue;
      if (frameIndex === 0) {
        expect(result.element.localTransform).toMatchObject({ tx: 10, ty: 0, a: 1, b: 0 });
      } else if (frameIndex === 2) {
        expect(result.element.localTransform.tx).toBeCloseTo(Math.SQRT1_2 * 10, 9);
        expect(result.element.localTransform.ty).toBeCloseTo(Math.SQRT1_2 * 10, 9);
        expect(result.element.localTransform.a).toBeCloseTo(Math.SQRT1_2, 9);
        expect(result.element.localTransform.b).toBeCloseTo(Math.SQRT1_2, 9);
      } else {
        expect(result.element.localTransform).toMatchObject({ tx: 0, ty: 10, a: 0, b: 1 });
      }
    }
  });

  it('keeps a parent pivot on its path through a transformed three-level Rig chain', () => {
    const grandparent = transformedMatrix(0, 1, -1, 0, 100, 20);
    const source = buildRiggingAdapterFixture({
      childTween: false,
      childStartMatrix: transformedMatrix(0, 1, -1, 0, 100, 30),
      parentStartMatrix: grandparent,
      parentMatrix: transformedMatrix(-1, 0, 0, -1, 140, 60),
      parentStartPivot: { x: 40, y: 0 },
      parentEndPivot: { x: 40, y: 0 },
      parentFrameParent: '8',
      withGrandparent: true,
      grandparentMatrix: grandparent,
    });
    const target = descriptor(source, 'rig-root');
    const contextAt = (frameIndex: number) => source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      frameIndex,
      `rig-pivot-frame-${frameIndex}`,
    );
    const atStart = contextAt(0);
    const atMiddle = contextAt(2);
    const atEnd = contextAt(4);

    expect(atStart.ok).toBe(true);
    expect(atMiddle.ok).toBe(true);
    expect(atEnd.ok).toBe(true);
    if (!atStart.ok || !atMiddle.ok || !atEnd.ok) return;

    const expected = [
      {
        frameIndex: 0,
        context: atStart.value,
        parent: { a: 0, b: 1, c: -1, d: 0, tx: 100, ty: 20 },
        child: { a: 0, b: 1, c: -1, d: 0, tx: 100, ty: 30 },
      },
      {
        frameIndex: 2,
        context: atMiddle.value,
        parent: {
          a: -Math.SQRT1_2,
          b: Math.SQRT1_2,
          c: -Math.SQRT1_2,
          d: -Math.SQRT1_2,
          tx: 128.2842712474619,
          ty: 31.7157287525381,
        },
        child: {
          a: -Math.SQRT1_2,
          b: Math.SQRT1_2,
          c: -Math.SQRT1_2,
          d: -Math.SQRT1_2,
          tx: 121.21320343559643,
          ty: 38.78679656440357,
        },
      },
      {
        frameIndex: 4,
        context: atEnd.value,
        parent: { a: -1, b: 0, c: 0, d: -1, tx: 140, ty: 60 },
        child: { a: -1, b: 0, c: 0, d: -1, tx: 130, ty: 60 },
      },
    ] as const;
    type TestMatrix = {
      readonly a: number;
      readonly b: number;
      readonly c: number;
      readonly d: number;
      readonly tx: number;
      readonly ty: number;
    };
    const expectMatrix = (
      actual: TestMatrix,
      expectedMatrix: TestMatrix,
    ) => {
      expect(actual.a).toBeCloseTo(expectedMatrix.a, 9);
      expect(actual.b).toBeCloseTo(expectedMatrix.b, 9);
      expect(actual.c).toBeCloseTo(expectedMatrix.c, 9);
      expect(actual.d).toBeCloseTo(expectedMatrix.d, 9);
      expect(actual.tx).toBeCloseTo(expectedMatrix.tx, 9);
      expect(actual.ty).toBeCloseTo(expectedMatrix.ty, 9);
    };

    for (const { frameIndex, context, parent: expectedParent, child: expectedChild } of expected) {
      const parentElement = context.layers.find((layer) => layer.name === 'parent')?.elements[0];
      const childElement = context.layers.find((layer) => layer.name === 'child')?.elements[0];
      expect(parentElement?.kind, `parent frame ${frameIndex}`).toBe('symbol');
      expect(childElement?.kind, `child frame ${frameIndex}`).toBe('symbol');
      if (parentElement?.kind !== 'symbol' || !parentElement.localTransform ||
          childElement?.kind !== 'symbol' || !childElement.localTransform) continue;

      const parentMatrix = parentElement.localTransform;
      const childMatrix = childElement.localTransform;
      expectMatrix(parentMatrix, expectedParent);
      expectMatrix(childMatrix, expectedChild);
      expect(parentMatrix.a * 40 + parentMatrix.tx).toBeCloseTo(100, 9);
      expect(parentMatrix.b * 40 + parentMatrix.ty).toBeCloseTo(60, 9);
    }
  });

  it('moves a held world-space child by the parent pose delta', () => {
    const result = childAt(buildRiggingAdapterFixture({ childTween: false }), 2);
    expect(result.ok).toBe(true);
    if (!result.ok || result.element?.kind !== 'symbol' || !result.element.localTransform) return;
    expect(result.element.localTransform.tx).toBeCloseTo(Math.SQRT1_2 * 10, 9);
    expect(result.element.localTransform.ty).toBeCloseTo(Math.SQRT1_2 * 10, 9);
    expect(result.element.localTransform.a).toBeCloseTo(Math.SQRT1_2, 9);
    expect(result.element.localTransform.b).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('memoizes repeated successful layer/frame poses inside one Graphic evaluation', () => {
    const source = buildRiggingAdapterFixture({ withGrandparent: true, parentFrameParent: '8' });
    const target = descriptor(source, 'rig-root');
    const computed: Array<{ layerIndex: number; frameIndex: number }> = [];
    const result = source.buildGraphicFrameContext(
      target.timelineXml,
      target.frameSpanIndex,
      2,
      'rig-matrix-cache',
      { onRigMatrixComputed: (layerIndex, frameIndex) => computed.push({ layerIndex, frameIndex }) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const child = result.value.layers.find((layer) => layer.name === 'child')?.elements[0];
    expect(child?.kind).toBe('symbol');
    if (child?.kind !== 'symbol' || !child.localTransform) return;
    expect(child.localTransform.tx).toBeCloseTo(Math.SQRT1_2 * 10, 9);
    expect(child.localTransform.ty).toBeCloseTo(Math.SQRT1_2 * 10, 9);
    for (const frameIndex of [0, 2, 4]) {
      expect(computed.filter((pose) => pose.layerIndex === 2 && pose.frameIndex === frameIndex)).toHaveLength(1);
    }
  });

  it('does not displace a held child when its parent pose is static', () => {
    const result = childAt(buildRiggingAdapterFixture({ childTween: false, parentTween: false }), 2);
    expect(result.ok).toBe(true);
    if (!result.ok || result.element?.kind !== 'symbol' || !result.element.localTransform) return;
    expect(result.element.localTransform).toMatchObject({ tx: 10, ty: 0, a: 1, b: 0, c: 0, d: 1 });
  });

  it('rejects Rig parent chains beyond the bounded depth', () => {
    const result = buildRiggingDepthFixtureResult(9);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Rig parent chain exceeds depth 8');
  });

  it.each([
    {
      label: 'unknown parent id',
      options: { childRigParent: '99' },
      message: 'DOMFrame Rig parent id 99 has no DOMLayer.layerRiggingIndex match',
    },
    {
      label: 'duplicate Rig id',
      options: { childRigId: '7' },
      message: 'DOMLayer.layerRiggingIndex 7 is ambiguous',
    },
    {
      label: 'non-numeric parent id',
      options: { childRigParent: 'rig-x' },
      message: 'is not a numeric Rig id',
    },
    {
      label: 'parent cycle',
      options: { childRigId: '8', parentFrameParent: '8' },
      message: 'Rig parent cycle detected',
    },
    {
      label: 'multiple parent objects',
      options: { parentObjectCount: 2 },
      message: 'parent frame must contain exactly one display object',
    },
    {
      label: 'malformed propagation matrix metadata',
      options: { rigPropagationMatrix: 'not-json' },
      message: 'rigPropagationMatrix is not valid JSON',
    },
    {
      label: 'singular parent endpoint',
      options: { parentMatrix: transformedMatrix(0, 0, 0, 0, 0, 0) },
      message: 'Rig parent endpoint matrix is singular',
    },
  ])('fails closed for $label with a local reason', ({ options, message }) => {
    const adapted = buildRiggingAdapterFixtureResult(options);
    const result = adapted.ok
      ? childAt(adapted.source, 2)
      : adapted;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });
});

describe('Scene parent span tween metadata (#722)', () => {
  function sceneElement(tweenType: string) {
    const sceneFrame =
      `<DOMFrame index="0" duration="4" tweenType="${tweenType}"><elements>${symbol('child', 1, 2)}</elements></DOMFrame>`;
    const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
      layer('scene', sceneFrame),
    ])}</timelines></DOMDocument>`;
    const adapted = adaptFlaXflDisplaySource(documentXml, [
      { name: 'LIBRARY/child.xml', xml: graphic('child', [layer('child-layer', frame(0, shape()))]) },
    ]);
    if (!adapted.ok) throw new Error(`Scene fixture failed: ${adapted.message}`);
    const element = adapted.source.sceneTimelines[0]?.frameContext.layers[0]?.elements[0];
    if (!element || element.kind !== 'symbol') throw new Error('Missing Scene symbol element');
    return element;
  }

  it('marks a static Scene-owned span as none and a tweened Scene-owned span as motion', () => {
    expect(sceneElement('none')).toMatchObject({
      kind: 'symbol',
      libraryItemName: 'child',
      sourceParentSpanTweenType: 'none',
    });
    const tweened = sceneElement('motion');
    expect(tweened.sourceParentSpanTweenType).toBe('motion');
    expect(tweened.sourceParentSpanTweenType).not.toBe('none');
  });

  it('defaults a Scene-owned span with no tween type attribute to none', () => {
    const sceneFrame = `<DOMFrame index="0" duration="4"><elements>${symbol('child', 1, 2)}</elements></DOMFrame>`;
    const documentXml = `<DOMDocument width="200" height="100"><timelines>${timeline('Scene 1', [
      layer('scene', sceneFrame),
    ])}</timelines></DOMDocument>`;
    const adapted = adaptFlaXflDisplaySource(documentXml, [
      { name: 'LIBRARY/child.xml', xml: graphic('child', [layer('child-layer', frame(0, shape()))]) },
    ]);
    if (!adapted.ok) throw new Error(`Scene fixture failed: ${adapted.message}`);
    const element = adapted.source.sceneTimelines[0]?.frameContext.layers[0]?.elements[0];
    expect(element).toMatchObject({ kind: 'symbol', libraryItemName: 'child', sourceParentSpanTweenType: 'none' });
  });
});
