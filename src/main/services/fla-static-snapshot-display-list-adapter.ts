/**
 * P0-C03 narrow Main-side adapter from the existing bounded XFL archive
 * reader's DOMTimeline/DOMLayer/DOMFrame display elements to the Panda-owned
 * C01 resolver input. This intentionally does not parse unrelated XFL
 * semantics (tweens, masks, text, filters, or ActionScript).
 */

import crypto from 'node:crypto';
import {
  buildFlaTimelineFrameSpanIndex,
  resolveFlaTimelineFrameSpan,
  type FlaTimelineFrameSpanIndex,
} from './fla-timeline-frame-span-resolver';
import {
  FLA_DISPLAY_LIST_IDENTITY_MATRIX,
  type FlaDisplayListElement,
  type FlaDisplayListFrameContext,
  type FlaDisplayListMatrix,
  type FlaGraphicSymbolDefinition,
} from './fla-display-list-resolver';

const MAX_SOURCE_DISPLAY_NODES = 100_000;
const MAX_SOURCE_GROUP_DEPTH = 64;

interface XmlToken {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface FlaXflElementBlock {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly xml: string;
}

export interface FlaXflTimelineDescriptor {
  readonly index: number;
  readonly name: string;
  readonly frameCount: number;
  readonly frameSpanIndex?: FlaTimelineFrameSpanIndex<FlaXflElementBlock>;
  readonly xml: string;
  readonly frameContext: FlaDisplayListFrameContext;
}

export interface FlaXflGraphicSymbolDescriptor extends FlaGraphicSymbolDefinition {
  readonly sourceLibraryItemName: string;
  readonly userLabel: string;
  readonly frameCount: number;
  readonly frameSpanIndex: FlaTimelineFrameSpanIndex<FlaXflElementBlock>;
  readonly hasNestedSymbol: boolean;
  readonly hasPotentialDisplayElements: boolean;
  readonly timelineXml: string;
}

export interface FlaStaticSnapshotDisplaySource {
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly sceneTimelines: readonly FlaXflTimelineDescriptor[];
  readonly graphicSymbols: readonly FlaXflGraphicSymbolDescriptor[];
  readonly symbols: ReadonlyMap<string, FlaGraphicSymbolDefinition>;
  readonly shapeBlocks: ReadonlyMap<string, string>;
  /** Build an already-selected Scene frame without changing symbol frame semantics. */
  buildSceneFrameContext(
    timelineXml: string,
    frameIndex: number,
    scope: string,
  ): FlaStaticSnapshotDisplaySourceResult<FlaDisplayListFrameContext>;
  /** Resolve a Graphic's authored frame span before the P0 display-list path. */
  buildGraphicFrameContext(
    timelineXml: string,
    frameSpanIndex: FlaTimelineFrameSpanIndex<FlaXflElementBlock>,
    frameIndex: number,
    scope: string,
  ): FlaStaticSnapshotDisplaySourceResult<FlaDisplayListFrameContext>;
}

export type FlaStaticSnapshotDisplaySourceFailure = {
  readonly ok: false;
  readonly code: 'BUDGET_EXCEEDED' | 'RENDER_FAILED';
  readonly message: string;
};

export type FlaStaticSnapshotDisplaySourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | FlaStaticSnapshotDisplaySourceFailure;

export type FlaStaticSnapshotDisplaySourceBuildResult =
  | { readonly ok: true; readonly source: FlaStaticSnapshotDisplaySource }
  | FlaStaticSnapshotDisplaySourceFailure;

interface SourceBuildState {
  readonly shapeBlocks: Map<string, string>;
  symbolAliases: SymbolAliasIndex;
  visitedNodeCount: number;
}

interface SymbolAliasIndex {
  readonly exact: ReadonlyMap<string, ReadonlySet<string>>;
  readonly basename: ReadonlyMap<string, ReadonlySet<string>>;
}

interface MatrixReadResult {
  readonly ok: true;
  readonly present: boolean;
  readonly matrix: FlaDisplayListMatrix;
}

type MatrixReadFailure = FlaStaticSnapshotDisplaySourceFailure;

function fail(
  code: FlaStaticSnapshotDisplaySourceFailure['code'],
  message: string,
): FlaStaticSnapshotDisplaySourceFailure {
  return { ok: false, code, message };
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    if (!Number.isSafeInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return entity;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  });
}

function findTagEnd(xml: string, start: number): number {
  let quote = '';
  for (let index = start + 1; index < xml.length; index += 1) {
    const char = xml[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index + 1;
  }
  return -1;
}

function parseTagToken(xml: string, start: number): XmlToken | null {
  if (xml[start] !== '<') return null;
  if (xml.startsWith('<!--', start)) {
    const end = xml.indexOf('-->', start + 4);
    return end < 0 ? null : {
      start,
      end: end + 3,
      name: '',
      closing: false,
      selfClosing: true,
      attributes: {},
    };
  }
  if (xml.startsWith('<![CDATA[', start)) {
    const end = xml.indexOf(']]>', start + 9);
    return end < 0 ? null : {
      start,
      end: end + 3,
      name: '',
      closing: false,
      selfClosing: true,
      attributes: {},
    };
  }
  if (xml.startsWith('<?', start)) {
    const end = xml.indexOf('?>', start + 2);
    return end < 0 ? null : {
      start,
      end: end + 2,
      name: '',
      closing: false,
      selfClosing: true,
      attributes: {},
    };
  }
  if (xml.startsWith('<!', start)) {
    const end = findTagEnd(xml, start);
    return end < 0 ? null : {
      start,
      end,
      name: '',
      closing: false,
      selfClosing: true,
      attributes: {},
    };
  }

  const end = findTagEnd(xml, start);
  if (end < 0) return null;
  const body = xml.slice(start + 1, end - 1).trim();
  const closing = body.startsWith('/');
  const content = closing ? body.slice(1).trim() : body;
  const nameMatch = content.match(/^([^\s/>]+)/u);
  if (!nameMatch) return null;
  const name = nameMatch[1] as string;
  const selfClosing = !closing && /\/\s*$/u.test(content);
  const attributeText = content.slice(name.length).replace(/\/\s*$/u, '');
  const attributes: Record<string, string> = {};
  const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  for (const match of attributeText.matchAll(attributePattern)) {
    const key = match[1];
    if (!key) continue;
    attributes[key] = decodeXmlEntities((match[2] ?? match[3] ?? '') as string);
  }
  return { start, end, name, closing, selfClosing, attributes };
}

function nextTagToken(xml: string, from: number): XmlToken | null {
  let cursor = from;
  for (;;) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) return null;
    const token = parseTagToken(xml, start);
    if (!token) return null;
    if (token.name) return token;
    cursor = token.end;
  }
}

function matchingElementEnd(xml: string, opening: XmlToken): number {
  if (opening.selfClosing) return opening.end;
  let depth = 1;
  let cursor = opening.end;
  while (cursor < xml.length) {
    const token = nextTagToken(xml, cursor);
    if (!token) return -1;
    if (token.name === opening.name) {
      if (token.closing) depth -= 1;
      else if (!token.selfClosing) depth += 1;
      if (depth === 0) return token.end;
    }
    cursor = token.end;
  }
  return -1;
}

function firstElementToken(xml: string, name?: string): XmlToken | null {
  let cursor = 0;
  while (cursor < xml.length) {
    const token = nextTagToken(xml, cursor);
    if (!token) return null;
    if (!token.closing && (!name || token.name === name)) return token;
    cursor = token.end;
  }
  return null;
}

/** Returns only immediate children and skips each child's complete subtree. */
export function getFlaXflDirectChildren(
  elementXml: string,
  parentName: string,
): readonly FlaXflElementBlock[] {
  const opening = firstElementToken(elementXml, parentName);
  if (!opening) return [];
  const parentEnd = matchingElementEnd(elementXml, opening);
  if (parentEnd < 0) return [];
  const children: FlaXflElementBlock[] = [];
  let cursor = opening.end;
  while (cursor < parentEnd) {
    const token = nextTagToken(elementXml, cursor);
    if (!token || token.start >= parentEnd) break;
    if (token.closing) {
      cursor = token.end;
      continue;
    }
    const childEnd = matchingElementEnd(elementXml, token);
    if (childEnd < 0 || childEnd > parentEnd) return [];
    children.push({
      name: token.name,
      attributes: token.attributes,
      xml: elementXml.slice(token.start, childEnd),
    });
    cursor = childEnd;
  }
  return children;
}

function directChild(elementXml: string, parentName: string, childName: string): FlaXflElementBlock | undefined {
  return getFlaXflDirectChildren(elementXml, parentName).find((child) => child.name === childName);
}

function timelineBlocks(parentXml: string, parentName: string): readonly FlaXflElementBlock[] {
  const wrappers = getFlaXflDirectChildren(parentXml, parentName)
    .filter((child) => child.name === 'timelines' || child.name === 'timeline');
  const blocks = wrappers.flatMap((wrapper) =>
    getFlaXflDirectChildren(wrapper.xml, wrapper.name).filter((child) => child.name === 'DOMTimeline'),
  );
  return blocks;
}

function layersForTimeline(timelineXml: string): readonly FlaXflElementBlock[] {
  const wrapper = directChild(timelineXml, 'DOMTimeline', 'layers');
  return wrapper ? getFlaXflDirectChildren(wrapper.xml, 'layers').filter((child) => child.name === 'DOMLayer') : [];
}

function framesForLayer(layerXml: string): readonly FlaXflElementBlock[] {
  const wrapper = directChild(layerXml, 'DOMLayer', 'frames');
  return wrapper ? getFlaXflDirectChildren(wrapper.xml, 'frames').filter((child) => child.name === 'DOMFrame') : [];
}

function sourceLayerIsVisible(layer: FlaXflElementBlock): boolean {
  const layerType = (layer.attributes.layerType ?? '').toLocaleLowerCase('en-US');
  return layer.attributes.visible !== 'false' &&
    layer.attributes.isVisible !== 'false' &&
    layerType !== 'guide' && layerType !== 'folder' && layerType !== 'camera';
}

function timelineFrameSpanIndex(
  timelineXml: string,
): FlaStaticSnapshotDisplaySourceResult<FlaTimelineFrameSpanIndex<FlaXflElementBlock>> {
  const result = buildFlaTimelineFrameSpanIndex(
    layersForTimeline(timelineXml).map((layer) => ({
      visible: sourceLayerIsVisible(layer),
      frames: framesForLayer(layer.xml).map((frame) => ({
        index: frame.attributes.index,
        duration: frame.attributes.duration,
        tweenType: frame.attributes.tweenType,
        sourceFrame: frame,
      })),
    })),
  );
  if (result.ok) return { ok: true, value: result.index };
  const code = result.code === 'FRAME_COUNT_LIMIT_EXCEEDED' ||
      result.code === 'FRAME_SPAN_BUDGET_EXCEEDED'
    ? 'BUDGET_EXCEEDED'
    : 'RENDER_FAILED';
  return fail(code, `Invalid XFL timeline frame spans: ${result.message}`);
}

function frameCountForTimeline(timelineXml: string): number {
  return Math.max(0, ...layersForTimeline(timelineXml).map((layer) => framesForLayer(layer.xml).length));
}

function normalizeReference(value: string): string {
  return value.trim().replaceAll('\\', '/').normalize('NFKC').toLocaleLowerCase('en-US');
}

function referenceBasename(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function libraryItemKey(entryName: string): string {
  const normalized = entryName.replaceAll('\\', '/').replace(/^LIBRARY\//iu, '').replace(/\.xml$/iu, '');
  return normalized.trim();
}

function aliasesForSymbol(
  sourceLibraryItemName: string,
  symbolName: string,
): readonly string[] {
  const libraryPath = `LIBRARY/${sourceLibraryItemName}.xml`;
  return [sourceLibraryItemName, libraryPath, symbolName].filter(Boolean);
}

function makeSymbolAliasIndex(
  symbols: readonly {
    readonly sourceLibraryItemName: string;
    readonly userLabel: string;
  }[],
): SymbolAliasIndex {
  const exact = new Map<string, Set<string>>();
  const basename = new Map<string, Set<string>>();
  const add = (index: Map<string, Set<string>>, alias: string, key: string) => {
    const normalized = normalizeReference(alias);
    if (!normalized) return;
    let values = index.get(normalized);
    if (!values) {
      values = new Set();
      index.set(normalized, values);
    }
    values.add(key);
  };
  for (const symbol of symbols) {
    for (const alias of aliasesForSymbol(symbol.sourceLibraryItemName, symbol.userLabel)) {
      add(exact, alias, symbol.sourceLibraryItemName);
      add(basename, referenceBasename(alias), symbol.sourceLibraryItemName);
    }
  }
  return { exact, basename };
}

function resolveSymbolAlias(aliases: SymbolAliasIndex, reference: string): string | null {
  const exact = aliases.exact.get(normalizeReference(reference));
  if (exact?.size) return exact.size === 1 ? exact.values().next().value as string : null;
  const basename = aliases.basename.get(normalizeReference(referenceBasename(reference)));
  return basename?.size === 1 ? basename.values().next().value as string : null;
}

function readDirectMatrix(element: FlaXflElementBlock): MatrixReadResult | MatrixReadFailure {
  const matrixWrapper = directChild(element.xml, element.name, 'matrix');
  if (!matrixWrapper) {
    return { ok: true, present: false, matrix: FLA_DISPLAY_LIST_IDENTITY_MATRIX };
  }
  const matrixElement = getFlaXflDirectChildren(matrixWrapper.xml, 'matrix')
    .find((child) => child.name === 'Matrix');
  const attributes = matrixElement?.attributes ?? matrixWrapper.attributes;
  if (!matrixElement && Object.keys(attributes).length === 0) {
    return fail('RENDER_FAILED', `Malformed ${element.name} matrix`);
  }
  const parse = (key: string, fallback: number): number => {
    const raw = attributes[key];
    return raw === undefined ? fallback : Number(raw);
  };
  const matrix: FlaDisplayListMatrix = {
    a: parse('a', 1),
    b: parse('b', 0),
    c: parse('c', 0),
    d: parse('d', 1),
    tx: parse('tx', 0),
    ty: parse('ty', 0),
  };
  if (![matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].every(Number.isFinite)) {
    return fail('RENDER_FAILED', `Non-finite ${element.name} matrix`);
  }
  return { ok: true, present: true, matrix };
}

function compose(parent: FlaDisplayListMatrix, local: FlaDisplayListMatrix): FlaDisplayListMatrix {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

function inverse(matrix: FlaDisplayListMatrix): FlaDisplayListMatrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const a = matrix.d / determinant;
  const b = -matrix.b / determinant;
  const c = -matrix.c / determinant;
  const d = matrix.a / determinant;
  return {
    a,
    b,
    c,
    d,
    tx: -(a * matrix.tx + c * matrix.ty),
    ty: -(b * matrix.tx + d * matrix.ty),
  };
}

/** XFL leaf matrices are already absolute within their owning timeline. */
function localizeAbsoluteLeafMatrix(
  parentWorld: FlaDisplayListMatrix,
  sourceAbsolute: FlaDisplayListMatrix,
): FlaStaticSnapshotDisplaySourceResult<FlaDisplayListMatrix> {
  const parentInverse = inverse(parentWorld);
  if (!parentInverse) {
    return fail('RENDER_FAILED', 'Cannot localize an absolute XFL child matrix under a singular parent group');
  }
  const local = compose(parentInverse, sourceAbsolute);
  if (![local.a, local.b, local.c, local.d, local.tx, local.ty].every(Number.isFinite)) {
    return fail('RENDER_FAILED', 'Localized XFL child matrix is not finite');
  }
  return { ok: true, value: local };
}

function elementIsVisible(attributes: Readonly<Record<string, string>>): boolean {
  return attributes.isVisible !== 'false' && attributes.visible !== 'false';
}

interface ElementParseContext {
  readonly scope: string;
  readonly parentWorld: FlaDisplayListMatrix;
  readonly depth: number;
  readonly path: string;
  readonly state: SourceBuildState;
}

function parseDisplayElements(
  container: FlaXflElementBlock,
  context: ElementParseContext,
): FlaStaticSnapshotDisplaySourceResult<readonly FlaDisplayListElement[]> {
  const children: FlaDisplayListElement[] = [];
  const sourceChildren = getFlaXflDirectChildren(container.xml, container.name);
  for (let index = 0; index < sourceChildren.length; index += 1) {
    const child = sourceChildren[index];
    if (!child) continue;
    if (!child.name.startsWith('DOM')) continue;
    context.state.visitedNodeCount += 1;
    if (context.state.visitedNodeCount > MAX_SOURCE_DISPLAY_NODES) {
      return fail('BUDGET_EXCEEDED', `XFL display source exceeds ${MAX_SOURCE_DISPLAY_NODES} nodes`);
    }
    if (!elementIsVisible(child.attributes)) continue;

    const path = `${context.path}/${index}`;
    if (child.name !== 'DOMGroup' && child.name !== 'DOMShape' &&
        child.name !== 'DOMBitmapInstance' && child.name !== 'DOMSymbolInstance') {
      continue;
    }
    const matrixResult = readDirectMatrix(child);
    if (!matrixResult.ok) return matrixResult;
    if (child.name === 'DOMGroup') {
      const nextDepth = context.depth + 1;
      if (nextDepth > MAX_SOURCE_GROUP_DEPTH) {
        return fail('BUDGET_EXCEEDED', `XFL groups exceed recursion depth ${MAX_SOURCE_GROUP_DEPTH}`);
      }
      const groupWorld = compose(context.parentWorld, matrixResult.matrix);
      const members = directChild(child.xml, child.name, 'members');
      const parsedChildren = members
        ? parseDisplayElements(members, {
            scope: context.scope,
            parentWorld: groupWorld,
            depth: nextDepth,
            path,
            state: context.state,
          })
        : { ok: true as const, value: [] as readonly FlaDisplayListElement[] };
      if (!parsedChildren.ok) return parsedChildren;
      children.push({
        kind: 'group',
        groupId: `fla-group-${crypto.createHash('sha256').update(`${context.scope}\u0000${path}`).digest('hex').slice(0, 24)}`,
        localTransform: matrixResult.matrix,
        elements: parsedChildren.value,
      });
      continue;
    }

    let localTransform: FlaDisplayListMatrix | undefined;
    if (matrixResult.present) {
      const localized = localizeAbsoluteLeafMatrix(context.parentWorld, matrixResult.matrix);
      if (!localized.ok) return localized;
      localTransform = localized.value;
    }

    if (child.name === 'DOMShape') {
      const shapeId = `fla-shape-${crypto.createHash('sha256').update(`${context.scope}\u0000${path}`).digest('hex').slice(0, 24)}`;
      context.state.shapeBlocks.set(shapeId, child.xml);
      children.push({ kind: 'shape', shapeId, ...(localTransform ? { localTransform } : {}) });
      continue;
    }

    const libraryItemName = child.attributes.libraryItemName?.trim();
    if (!libraryItemName) {
      return fail('RENDER_FAILED', `${child.name} is missing libraryItemName`);
    }
    if (child.name === 'DOMBitmapInstance') {
      children.push({ kind: 'bitmap', libraryItemName, ...(localTransform ? { localTransform } : {}) });
      continue;
    }

    const sourceSymbolType = (child.attributes.symbolType ?? 'graphic').trim().toLocaleLowerCase('en-US');
    const symbolType = sourceSymbolType === 'graphic'
      ? 'graphic'
      : sourceSymbolType === 'button'
        ? 'button'
        : 'movieclip';
    const resolvedName = resolveSymbolAlias(context.state.symbolAliases, libraryItemName) ?? libraryItemName;
    children.push({
      kind: 'symbol',
      libraryItemName: resolvedName,
      symbolType,
      ...(localTransform ? { localTransform } : {}),
    });
  }
  return { ok: true, value: children };
}

function buildFrameContext(
  timelineXml: string,
  frameIndex: number,
  scope: string,
  state: SourceBuildState,
): FlaStaticSnapshotDisplaySourceResult<FlaDisplayListFrameContext> {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
    return fail('RENDER_FAILED', 'Selected frame index must be a non-negative integer');
  }
  const layers = layersForTimeline(timelineXml);
  const resolvedLayers: FlaDisplayListFrameContext['layers'][number][] = [];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if (!layer) continue;
    const frames = framesForLayer(layer.xml);
    const frame = frames[frameIndex];
    let elements: readonly FlaDisplayListElement[] = [];
    if (frame) {
      const elementContainer = directChild(frame.xml, 'DOMFrame', 'elements') ?? frame;
      if (elementContainer) {
        const parsed = parseDisplayElements(elementContainer, {
          scope,
          parentWorld: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
          depth: 0,
          path: `layer-${layerIndex}-frame-${frameIndex}`,
          state,
        });
        if (!parsed.ok) return parsed;
        elements = parsed.value;
      }
    }
    const layerType = (layer.attributes.layerType ?? '').toLocaleLowerCase('en-US');
    const visible = layer.attributes.visible !== 'false' &&
      layer.attributes.isVisible !== 'false' &&
      layerType !== 'guide' && layerType !== 'folder' && layerType !== 'camera';
    resolvedLayers.push({
      name: layer.attributes.name?.trim() || `Layer ${layerIndex + 1}`,
      visible,
      elements,
    });
  }
  return {
    ok: true,
    value: { frameIndex, layers: resolvedLayers },
  };
}

function buildGraphicFrameContext(
  timelineXml: string,
  frameSpanIndex: FlaTimelineFrameSpanIndex<FlaXflElementBlock>,
  frameIndex: number,
  scope: string,
  state: SourceBuildState,
): FlaStaticSnapshotDisplaySourceResult<FlaDisplayListFrameContext> {
  const resolution = resolveFlaTimelineFrameSpan(frameSpanIndex, frameIndex);
  if (!resolution.ok) return fail('RENDER_FAILED', resolution.message);

  const layers = layersForTimeline(timelineXml);
  const resolvedLayers: FlaDisplayListFrameContext['layers'][number][] = [];
  for (const selection of resolution.layers) {
    const layer = layers[selection.layerIndex];
    if (!layer) return fail('RENDER_FAILED', `XFL timeline layer ${selection.layerIndex} is missing`);
    if (selection.kind === 'unsupported-tween-interior' && selection.visible) {
      return fail(
        'RENDER_FAILED',
        `Graphic frame ${frameIndex} requires unsupported ${selection.span.tweenType} tween interpolation on layer ${selection.layerIndex}`,
      );
    }

    let elements: readonly FlaDisplayListElement[] = [];
    if (selection.kind === 'authored-frame') {
      const frame = selection.sourceFrame;
      const elementContainer = directChild(frame.xml, 'DOMFrame', 'elements') ?? frame;
      const parsed = parseDisplayElements(elementContainer, {
        scope,
        parentWorld: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
        depth: 0,
        path: `layer-${selection.layerIndex}-frame-${selection.span.index}`,
        state,
      });
      if (!parsed.ok) return parsed;
      elements = parsed.value;
    }

    resolvedLayers.push({
      name: layer.attributes.name?.trim() || `Layer ${selection.layerIndex + 1}`,
      visible: selection.visible,
      elements,
    });
  }
  return { ok: true, value: { frameIndex, layers: resolvedLayers } };
}

function countNestedSymbols(elements: readonly FlaDisplayListElement[]): boolean {
  return elements.some((element) =>
    element.kind === 'symbol' || (element.kind === 'group' && countNestedSymbols(element.elements)),
  );
}

function frameHasPotentialDisplayElements(frame: FlaXflElementBlock): boolean {
  const elementContainer = directChild(frame.xml, 'DOMFrame', 'elements') ?? frame;
  return getFlaXflDirectChildren(elementContainer.xml, elementContainer.name)
    .some((element) => element.name === 'DOMGroup' || element.name === 'DOMShape' ||
      element.name === 'DOMBitmapInstance' || element.name === 'DOMSymbolInstance');
}

/**
 * Catalog eligibility is a bounded structural check across authored spans.
 * It never builds/rasterizes each timeline frame; it only checks whether any
 * visible layer span contains a display element understood by this adapter.
 */
function timelineHasPotentialDisplayElements(
  frameSpanIndex: FlaTimelineFrameSpanIndex<FlaXflElementBlock>,
): boolean {
  return frameSpanIndex.layers.some((layer) =>
    layer.visible && layer.spans.some((span) => frameHasPotentialDisplayElements(span.sourceFrame)),
  );
}

function timelineDescriptors(
  xml: string,
  parentName: string,
): FlaStaticSnapshotDisplaySourceResult<readonly Omit<FlaXflTimelineDescriptor, 'frameContext'>[]> {
  const descriptors: Omit<FlaXflTimelineDescriptor, 'frameContext'>[] = [];
  for (const [index, timeline] of timelineBlocks(xml, parentName).entries()) {
    const descriptor = {
      index,
      name: timeline.attributes.name?.trim() || `Timeline ${index + 1}`,
      xml: timeline.xml,
    };
    if (parentName === 'DOMSymbolItem') {
      const frameSpanIndex = timelineFrameSpanIndex(timeline.xml);
      if (!frameSpanIndex.ok) return frameSpanIndex;
      descriptors.push({
        ...descriptor,
        frameCount: frameSpanIndex.value.frameCount,
        frameSpanIndex: frameSpanIndex.value,
      });
    } else {
      // Keep the accepted Scene/Timeline selection path unchanged in C02.
      descriptors.push({ ...descriptor, frameCount: frameCountForTimeline(timeline.xml) });
    }
  }
  return { ok: true, value: descriptors };
}

function parseStageDimension(xml: string, key: 'width' | 'height', fallback: number): number {
  const document = firstElementToken(xml, 'DOMDocument');
  const raw = document?.attributes[key];
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

interface GraphicSymbolShell {
  readonly sourceLibraryItemName: string;
  readonly userLabel: string;
  readonly timelineXml: string;
  readonly frameCount: number;
  readonly frameSpanIndex: FlaTimelineFrameSpanIndex<FlaXflElementBlock>;
}

export function adaptFlaXflDisplaySource(
  docXml: string,
  libraryXmlEntries: readonly { readonly name: string; readonly xml: string }[],
): FlaStaticSnapshotDisplaySourceBuildResult {
  const shapeBlocks = new Map<string, string>();
  const state: SourceBuildState = {
    shapeBlocks,
    symbolAliases: { exact: new Map(), basename: new Map() },
    visitedNodeCount: 0,
  };
  const sceneSources = timelineDescriptors(docXml, 'DOMDocument');
  if (!sceneSources.ok) return sceneSources;

  const shells: GraphicSymbolShell[] = [];
  for (const library of libraryXmlEntries) {
    const root = firstElementToken(library.xml, 'DOMSymbolItem');
    if (!root) continue;
    const symbolType = (root.attributes.symbolType ?? 'graphic').trim().toLocaleLowerCase('en-US');
    if (symbolType !== 'graphic') continue;
    const sourceLibraryItemName = libraryItemKey(library.name);
    const userLabel = root.attributes.name?.trim() || sourceLibraryItemName;
    if (!sourceLibraryItemName || sourceLibraryItemName.length > 500 ||
        !userLabel || userLabel.length > 500) continue;
    const timelines = timelineDescriptors(library.xml, 'DOMSymbolItem');
    if (!timelines.ok) return timelines;
    const timeline = timelines.value[0];
    if (!timeline || !timeline.frameSpanIndex || timeline.frameCount <= 0) continue;
    shells.push({
      sourceLibraryItemName,
      userLabel,
      timelineXml: timeline.xml,
      frameCount: timeline.frameCount,
      frameSpanIndex: timeline.frameSpanIndex,
    });
  }

  const aliases = makeSymbolAliasIndex(shells);
  state.symbolAliases = aliases;
  const symbols = new Map<string, FlaGraphicSymbolDefinition>();
  const graphicSymbols: FlaXflGraphicSymbolDescriptor[] = [];
  for (const shell of shells) {
    const parsed = buildGraphicFrameContext(
      shell.timelineXml,
      shell.frameSpanIndex,
      0,
      `graphic:${shell.sourceLibraryItemName}`,
      state,
    );
    if (!parsed.ok) return parsed;
    const definition: FlaGraphicSymbolDefinition = {
      kind: 'graphic',
      libraryItemName: shell.sourceLibraryItemName,
      frameContext: parsed.value,
    };
    symbols.set(shell.sourceLibraryItemName, definition);
    graphicSymbols.push({
      ...definition,
      sourceLibraryItemName: shell.sourceLibraryItemName,
      userLabel: shell.userLabel,
      frameCount: shell.frameCount,
      frameSpanIndex: shell.frameSpanIndex,
      hasNestedSymbol: countNestedSymbols(parsed.value.layers.flatMap((layer) => layer.elements)),
      hasPotentialDisplayElements: timelineHasPotentialDisplayElements(shell.frameSpanIndex),
      timelineXml: shell.timelineXml,
    });
  }

  const sceneTimelines: FlaXflTimelineDescriptor[] = [];
  for (const scene of sceneSources.value) {
    const parsed = buildFrameContext(scene.xml, 0, `scene:${scene.index}`, state);
    if (!parsed.ok) return parsed;
    sceneTimelines.push({ ...scene, frameContext: parsed.value });
  }

  return {
    ok: true,
    source: {
      stageWidth: parseStageDimension(docXml, 'width', 550),
      stageHeight: parseStageDimension(docXml, 'height', 400),
      sceneTimelines,
      graphicSymbols,
      symbols,
      shapeBlocks,
      buildSceneFrameContext: (timelineXml, frameIndex, scope) =>
        buildFrameContext(timelineXml, frameIndex, scope, state),
      buildGraphicFrameContext: (timelineXml, frameSpanIndex, frameIndex, scope) =>
        buildGraphicFrameContext(timelineXml, frameSpanIndex, frameIndex, scope, state),
    },
  };
}
