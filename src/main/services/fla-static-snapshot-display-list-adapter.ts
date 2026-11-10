/**
 * P0-C03 narrow Main-side adapter from the existing bounded XFL archive
 * reader's DOMTimeline/DOMLayer/DOMFrame display elements to the Panda-owned
 * C01 resolver input. XFL layer arrays are authored front/top to back/bottom;
 * this adapter converts them once to Panda's back-to-front painter order.
 * Within-layer elements retain their authored order. Graphic frame selection
 * adds fail-closed Classic Motion interpolation for transforms, color, easing,
 * and one directional frame BlurFilter; unrelated XFL semantics (shape tweens,
 * non-vector/animated masks, other filters, or ActionScript) remain unsupported.
 * Static filled-vector mask layers have a bounded resolver path.
 */

import crypto from 'node:crypto';
import {
  buildFlaTimelineFrameSpanIndex,
  resolveFlaTimelineFrameSpan,
  type FlaNormalizedFrameSpan,
  type FlaTimelineFrameSpanIndex,
} from './fla-timeline-frame-span-resolver';
import {
  interpolateFlaLinearMotionTransform,
  type FlaMotionTweenRotation,
} from './fla-motion-tween-transform-interpolator';
import {
  evaluateFlaViewerClassicTweenProgress,
  type FlaViewerEasePoint,
  type FlaViewerTweenEase,
} from './fla-viewer-tween-evaluator';
import {
  FLA_DISPLAY_LIST_IDENTITY_MATRIX,
  type FlaDisplayListElement,
  type FlaDisplayListBlurFilter,
  type FlaDisplayListFrameContext,
  type FlaDisplayListMatrix,
  type FlaDisplayListRgbTransform,
  type FlaGraphicSymbolDefinition,
} from './fla-display-list-resolver';

const MAX_SOURCE_DISPLAY_NODES = 100_000;
const MAX_SOURCE_GROUP_DEPTH = 64;
const MAX_RIG_PARENT_DEPTH = 8;
const MAX_CLASSIC_MOTION_ROTATION_TURNS = 1_000_000;
const CLASSIC_MOTION_FRAME_ATTRIBUTES = new Set([
  'index',
  'duration',
  'tweenType',
  'motionTweenSnap',
  'keyMode',
  'motionTweenSync',
  'acceleration',
  'motionTweenRotate',
  'motionTweenRotateTimes',
  'parentLayerIndex',
  'rigPropagationMatrix',
]);
const CLASSIC_MOTION_INSTANCE_ATTRIBUTES = new Set([
  'libraryItemName',
  'selected',
  'symbolType',
  'centerPoint3DX',
  'centerPoint3DY',
  'loop',
  'firstFrame',
  'lastFrame',
  'name',
]);
const UNSUPPORTED_MOTION_METADATA_TAGS = new Set([
  'motionobject',
  'motionpath',
  'domtween',
  'animationcore',
  'motionobjectxml',
]);
const UNSUPPORTED_MOTION_METADATA_ATTRIBUTES = new Set([
  'easein',
  'easeout',
  'motionpath',
  'orienttopath',
  'rotate',
  'rotatedirection',
  'rotationdirection',
  'tweeneasing',
]);

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
  /** Restore base-source parsing state before resolving a cached frame-zero context. */
  resetFrameBuildState(): void;
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
  readonly sourceParentFrameIndex: number;
  readonly sourceParentFrameSpanStart: number;
  readonly sourceParentSpanTweenType?: string;
  readonly sourceParentMotionTweenSync?: boolean;
  readonly motionTweenEndpoint?: boolean;
  readonly unsupportedDisplayReasons: string[];
  readonly state: SourceBuildState;
}

interface ClassicMotionColorTransform {
  readonly alphaMultiplier?: number;
  readonly rgbTransform?: FlaDisplayListRgbTransform;
}

type ClassicMotionColorParseResult =
  | { readonly ok: true; readonly transform: ClassicMotionColorTransform | null }
  | { readonly ok: false; readonly message: string };

function classicMotionColorTransform(target: FlaXflElementBlock): ClassicMotionColorParseResult {
  const colorWrappers = getFlaXflDirectChildren(target.xml, target.name)
    .filter((child) => child.name === 'color');
  if (colorWrappers.length === 0) return { ok: true, transform: null };
  const unsupported = (reason: string): ClassicMotionColorParseResult => ({
    ok: false,
    message: `Classic Motion contains unsupported Color data: ${reason}`,
  });
  if (colorWrappers.length !== 1) return unsupported('multiple color wrappers');
  const wrapper = colorWrappers[0]!;
  if (Object.keys(wrapper.attributes).length > 0) return unsupported('color wrapper has attributes');
  const values = getFlaXflDirectChildren(wrapper.xml, wrapper.name);
  const color = values[0];
  if (values.length !== 1 || color?.name !== 'Color' ||
      getFlaXflDirectChildren(color.xml, color.name).length !== 0) {
    return unsupported('malformed Color element structure');
  }

  const attributes = color.attributes;
  const names = Object.keys(attributes);
  if (names.some((name) => name !== 'alphaMultiplier' && name !== 'brightness')) {
    return unsupported(`unsupported Color attribute combination: ${names.join(', ')}`);
  }
  let alphaMultiplier: number | undefined;
  if (attributes.alphaMultiplier !== undefined) {
    const rawAlpha = attributes.alphaMultiplier;
    alphaMultiplier = rawAlpha.trim() === '' ? Number.NaN : Number(rawAlpha);
    if (!Number.isFinite(alphaMultiplier) || alphaMultiplier < 0 || alphaMultiplier > 1) {
      return unsupported('alphaMultiplier must be finite and within 0..1');
    }
  }
  let rgbTransform: FlaDisplayListRgbTransform | undefined;
  if (attributes.brightness !== undefined) {
    const rawBrightness = attributes.brightness;
    const brightness = rawBrightness === undefined || rawBrightness.trim() === ''
      ? Number.NaN
      : Number(rawBrightness);
    if (!Number.isFinite(brightness) || brightness < -1 || brightness > 1) {
      return unsupported('brightness must be finite and within -1..1');
    }
    rgbTransform = brightness >= 0
      ? { multiplier: 1 - brightness, offset: brightness * 255 }
      : { multiplier: 1 + brightness, offset: 0 };
  }
  if (names.length === 0) return unsupported('Color has no supported attributes');
  const effectiveAlpha = alphaMultiplier === 1 ? undefined : alphaMultiplier;
  const effectiveRgb = rgbTransform?.multiplier === 1 && rgbTransform.offset === 0
    ? undefined
    : rgbTransform;
  return {
    ok: true,
    transform: effectiveAlpha === undefined && effectiveRgb === undefined
      ? null
      : {
          ...(effectiveAlpha !== undefined ? { alphaMultiplier: effectiveAlpha } : {}),
          ...(effectiveRgb ? { rgbTransform: effectiveRgb } : {}),
        },
  };
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
      if (context.unsupportedDisplayReasons.length === 0) {
        context.unsupportedDisplayReasons.push(
          'Visible display content is outside the supported static preview subset',
        );
      }
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
            sourceParentFrameIndex: context.sourceParentFrameIndex,
            sourceParentFrameSpanStart: context.sourceParentFrameSpanStart,
            ...(context.sourceParentSpanTweenType !== undefined
              ? { sourceParentSpanTweenType: context.sourceParentSpanTweenType }
              : {}),
            ...(context.sourceParentMotionTweenSync !== undefined
              ? { sourceParentMotionTweenSync: context.sourceParentMotionTweenSync }
              : {}),
            ...(context.motionTweenEndpoint ? { motionTweenEndpoint: true } : {}),
            unsupportedDisplayReasons: context.unsupportedDisplayReasons,
            state: context.state,
          })
        : { ok: true as const, value: [] as readonly FlaDisplayListElement[] };
      if (!parsedChildren.ok) return parsedChildren;
      children.push({
        kind: 'group',
        groupId: `fla-group-${crypto.createHash('sha256').update(`${context.scope}\u0000${path}`).digest('hex').slice(0, 24)}`,
        sourceAddress: `${context.scope}/${path}`,
        sourceParentFrameIndex: context.sourceParentFrameIndex,
        sourceParentFrameSpanStart: context.sourceParentFrameSpanStart,
        ...(context.sourceParentSpanTweenType !== undefined
          ? { sourceParentSpanTweenType: context.sourceParentSpanTweenType }
          : {}),
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
      children.push({
        kind: 'shape',
        shapeId,
        sourceAddress: `${context.scope}/${path}`,
        sourceParentFrameIndex: context.sourceParentFrameIndex,
        sourceParentFrameSpanStart: context.sourceParentFrameSpanStart,
        ...(context.sourceParentSpanTweenType !== undefined
          ? { sourceParentSpanTweenType: context.sourceParentSpanTweenType }
          : {}),
        ...(localTransform ? { localTransform } : {}),
      });
      continue;
    }

    const libraryItemName = child.attributes.libraryItemName?.trim();
    if (!libraryItemName) {
      return fail('RENDER_FAILED', `${child.name} is missing libraryItemName`);
    }
    if (child.name === 'DOMBitmapInstance') {
      children.push({
        kind: 'bitmap',
        libraryItemName,
        sourceAddress: `${context.scope}/${path}`,
        sourceParentFrameIndex: context.sourceParentFrameIndex,
        sourceParentFrameSpanStart: context.sourceParentFrameSpanStart,
        ...(context.sourceParentSpanTweenType !== undefined
          ? { sourceParentSpanTweenType: context.sourceParentSpanTweenType }
          : {}),
        ...(localTransform ? { localTransform } : {}),
      });
      continue;
    }

    const sourceSymbolType = (child.attributes.symbolType ?? 'graphic').trim().toLocaleLowerCase('en-US');
    const symbolType = sourceSymbolType === 'graphic'
      ? 'graphic'
      : sourceSymbolType === 'button'
        ? 'button'
        : 'movieclip';
    const resolvedName = resolveSymbolAlias(context.state.symbolAliases, libraryItemName) ?? libraryItemName;
    let alphaMultiplier: number | undefined;
    let rgbTransform: FlaDisplayListRgbTransform | undefined;
    if (context.motionTweenEndpoint) {
      const colorResult = classicMotionColorTransform(child);
      if (!colorResult.ok) return fail('RENDER_FAILED', colorResult.message);
      alphaMultiplier = colorResult.transform?.alphaMultiplier;
      rgbTransform = colorResult.transform?.rgbTransform;
    }
    children.push({
      kind: 'symbol',
      libraryItemName: resolvedName,
      symbolType,
      ...(child.attributes.loop !== undefined ? { playbackMode: child.attributes.loop } : {}),
      ...(child.attributes.firstFrame !== undefined ? { firstFrame: child.attributes.firstFrame } : {}),
      ...(child.attributes.lastFrame !== undefined ? { lastFrame: child.attributes.lastFrame } : {}),
      ...(alphaMultiplier !== undefined ? { alphaMultiplier } : {}),
      ...(rgbTransform ? { rgbTransform } : {}),
      sourceParentFrameIndex: context.sourceParentFrameIndex,
      sourceParentFrameSpanStart: context.sourceParentFrameSpanStart,
      ...(context.sourceParentSpanTweenType !== undefined
        ? { sourceParentSpanTweenType: context.sourceParentSpanTweenType }
        : {}),
      ...(context.sourceParentMotionTweenSync !== undefined
        ? { sourceParentMotionTweenSync: context.sourceParentMotionTweenSync }
        : {}),
      ...(context.motionTweenEndpoint ? { motionTweenEndpoint: true } : {}),
      sourceAddress: `${context.scope}/${path}`,
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
  const maskLayerIds = new Map<number, string>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if ((layer?.attributes.layerType ?? '').toLocaleLowerCase('en-US') === 'mask') {
      maskLayerIds.set(layerIndex, `${scope}/mask-layer-${layerIndex}`);
    }
  }
  const resolvedLayers: FlaDisplayListFrameContext['layers'][number][] = [];
  const unsupportedDisplayReasons: string[] = [];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if (!layer) continue;
    const frames = framesForLayer(layer.xml);
    const frame = frames[frameIndex];
    let elements: readonly FlaDisplayListElement[] = [];
    if (frame) {
      const declaredFrameIndex = Number(frame.attributes.index ?? frameIndex);
      const sourceParentFrameSpanStart = Number.isSafeInteger(declaredFrameIndex) && declaredFrameIndex >= 0
        ? declaredFrameIndex
        : frameIndex;
      const elementContainer = directChild(frame.xml, 'DOMFrame', 'elements') ?? frame;
      if (elementContainer) {
        const parsed = parseDisplayElements(elementContainer, {
          scope,
          parentWorld: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
          depth: 0,
          path: `layer-${layerIndex}-frame-${frameIndex}`,
          sourceParentFrameIndex: frameIndex,
          sourceParentFrameSpanStart,
          // Preserve the Scene keyframe's source span metadata just like the
          // Graphic path; nested playback is evaluated relative to this keyframe.
          sourceParentSpanTweenType: frame.attributes.tweenType ?? 'none',
          unsupportedDisplayReasons,
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
    const parentLayerIndexRaw = layer.attributes.parentLayerIndex;
    let maskedBy: string | undefined;
    if (parentLayerIndexRaw !== undefined) {
      const parentLayerIndex = Number(parentLayerIndexRaw);
      if (!Number.isSafeInteger(parentLayerIndex) || parentLayerIndex < 0 || !maskLayerIds.has(parentLayerIndex)) {
        unsupportedDisplayReasons.push('Masked XFL layer references a missing or unsupported parent mask layer');
      } else {
        maskedBy = maskLayerIds.get(parentLayerIndex);
      }
    }
    resolvedLayers.push({
      name: layer.attributes.name?.trim() || `Layer ${layerIndex + 1}`,
      visible,
      elements,
      ...(layerType === 'mask' ? { maskLayerId: maskLayerIds.get(layerIndex) } : {}),
      ...(maskedBy ? { maskedBy } : {}),
    });
  }
  return {
    ok: true,
    value: {
      frameIndex,
      layers: normalizeXflTimelineLayersForPainterOrder(resolvedLayers),
      ...(unsupportedDisplayReasons[0]
        ? { unsupportedDisplayReason: unsupportedDisplayReasons[0] }
        : {}),
    },
  };
}

function containsUnsupportedMotionMetadata(xml: string): boolean {
  let cursor = 0;
  while (cursor < xml.length) {
    const token = nextTagToken(xml, cursor);
    if (!token) return xml.slice(cursor).trim().length > 0;
    const lowerTagName = token.name.toLocaleLowerCase('en-US');
    if (UNSUPPORTED_MOTION_METADATA_TAGS.has(lowerTagName) ||
        Object.keys(token.attributes).some((name) =>
          UNSUPPORTED_MOTION_METADATA_ATTRIBUTES.has(name.toLocaleLowerCase('en-US')))) {
      return true;
    }
    cursor = token.end;
  }
  return false;
}

type ClassicMotionRotationResult =
  | { readonly ok: true; readonly rotation?: FlaMotionTweenRotation }
  | { readonly ok: false; readonly message: string };

function classicMotionRotationForFrame(frame: FlaXflElementBlock): ClassicMotionRotationResult {
  const direction = frame.attributes.motionTweenRotate;
  const rawTurns = frame.attributes.motionTweenRotateTimes;
  if (direction === undefined && rawTurns === undefined) return { ok: true };
  if (direction !== undefined && !['clockwise', 'counter-clockwise', 'cw', 'ccw', 'auto', 'none'].includes(direction)) {
    return { ok: false, message: `Unsupported motionTweenRotate value: ${direction}` };
  }
  let turns = 0;
  if (rawTurns !== undefined) {
    if (!/^\d+$/u.test(rawTurns.trim())) {
      return { ok: false, message: 'motionTweenRotateTimes must be a non-negative whole number' };
    }
    turns = Number(rawTurns.trim());
  }
  if (!Number.isSafeInteger(turns) || turns < 0 || turns > MAX_CLASSIC_MOTION_ROTATION_TURNS) {
    return {
      ok: false,
      message: `motionTweenRotateTimes must be a whole number from 0 to ${MAX_CLASSIC_MOTION_ROTATION_TURNS}`,
    };
  }
  const normalizedDirection = direction === 'clockwise' || direction === 'cw'
    ? 'clockwise'
    : direction === 'counter-clockwise' || direction === 'ccw'
      ? 'counter-clockwise'
      : undefined;
  return normalizedDirection
    ? { ok: true, rotation: { direction: normalizedDirection, turns } }
    : { ok: true };
}

type ClassicMotionEaseParseResult =
  | { readonly ok: true; readonly acceleration?: number; readonly eases: readonly FlaViewerTweenEase[] }
  | { readonly ok: false; readonly message: string };

function classicMotionEasesForFrame(frame: FlaXflElementBlock): ClassicMotionEaseParseResult {
  let acceleration: number | undefined;
  if (frame.attributes.acceleration !== undefined) {
    const raw = frame.attributes.acceleration.trim();
    if (!/^-?\d+$/u.test(raw)) {
      return { ok: false, message: 'DOMFrame acceleration must be a whole number' };
    }
    acceleration = Number(raw);
    if (!Number.isSafeInteger(acceleration) || acceleration < -100 || acceleration > 100) {
      return { ok: false, message: 'DOMFrame acceleration must be between -100 and 100' };
    }
  }
  const containers = getFlaXflDirectChildren(frame.xml, frame.name)
    .filter((child) => child.name === 'tweens');
  if (containers.length > 1) return { ok: false, message: 'DOMFrame contains multiple tweens containers' };
  if (containers.length === 0) return { ok: true, ...(acceleration !== undefined ? { acceleration } : {}), eases: [] };
  const container = containers[0]!;
  if (Object.keys(container.attributes).length > 0) {
    return { ok: false, message: 'tweens container has unsupported attributes' };
  }
  const easeResults: FlaViewerTweenEase[] = [];
  for (const child of getFlaXflDirectChildren(container.xml, container.name)) {
    const target = child.attributes.target ?? 'all';
    if (child.name === 'Ease') {
      const allowedAttributes = new Set(['target', 'intensity', 'method']);
      if (Object.keys(child.attributes).some((name) => !allowedAttributes.has(name)) ||
          getFlaXflDirectChildren(child.xml, child.name).length > 0) {
        return { ok: false, message: 'Ease contains unsupported attributes or child elements' };
      }
      let intensity: number | undefined;
      if (child.attributes.intensity !== undefined) {
        const raw = child.attributes.intensity.trim();
        if (!/^-?\d+$/u.test(raw)) return { ok: false, message: 'Ease intensity must be a whole number' };
        intensity = Number(raw);
        if (!Number.isSafeInteger(intensity) || intensity < -100 || intensity > 100) {
          return { ok: false, message: 'Ease intensity must be between -100 and 100' };
        }
      }
      easeResults.push({
        target,
        ...(child.attributes.method !== undefined ? { method: child.attributes.method } : {}),
        ...(intensity !== undefined ? { intensity } : {}),
      });
      continue;
    }
    if (child.name === 'CustomEase') {
      if (Object.keys(child.attributes).some((name) => name !== 'target')) {
        return { ok: false, message: 'CustomEase contains unsupported attributes' };
      }
      const points: FlaViewerEasePoint[] = [];
      for (const point of getFlaXflDirectChildren(child.xml, child.name)) {
        if (point.name !== 'Point' || Object.keys(point.attributes).some((name) => name !== 'x' && name !== 'y') ||
            point.attributes.x === undefined || point.attributes.y === undefined ||
            getFlaXflDirectChildren(point.xml, point.name).length > 0) {
          return { ok: false, message: 'CustomEase contains malformed Point data' };
        }
        const x = Number(point.attributes.x);
        const y = Number(point.attributes.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return { ok: false, message: 'CustomEase Point coordinates must be finite' };
        }
        points.push({ x, y });
      }
      easeResults.push({ target, customPoints: points });
      continue;
    }
    return { ok: false, message: `Unsupported tweens element: ${child.name}` };
  }
  return { ok: true, ...(acceleration !== undefined ? { acceleration } : {}), eases: easeResults };
}

function frameDisplayElements(frame: FlaXflElementBlock): readonly FlaXflElementBlock[] {
  const container = directChild(frame.xml, 'DOMFrame', 'elements') ?? frame;
  return getFlaXflDirectChildren(container.xml, container.name);
}

type ClassicMotionFrameBlurResult =
  | { readonly ok: true; readonly filter?: FlaDisplayListBlurFilter }
  | { readonly ok: false; readonly message: string };

function parseClassicMotionBlurValue(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value || !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 255 ? parsed : null;
}

function classicMotionFrameBlurFilter(
  frame: FlaXflElementBlock,
  endpoint: 'start' | 'end',
): ClassicMotionFrameBlurResult {
  const frameChildren = getFlaXflDirectChildren(frame.xml, 'DOMFrame');
  const frameFilterContainers = frameChildren.filter((child) => child.name === 'frameFilters');
  if (frameFilterContainers.length > 1) {
    return { ok: false, message: `${endpoint} frame contains multiple frameFilters containers` };
  }
  const filters = frameFilterContainers.flatMap((container) =>
    getFlaXflDirectChildren(container.xml, container.name));
  if (filters.length === 0) return { ok: true };

  const describeFilter = (filter: FlaXflElementBlock): string => {
    if (filter.name !== 'BlurFilter') return filter.name;
    const blurX = filter.attributes.blurX?.slice(0, 32) ?? 'default';
    const blurY = filter.attributes.blurY?.slice(0, 32) ?? 'default';
    return `BlurFilter (blurX=${blurX}, blurY=${blurY})`;
  };
  const unsupported = (detail?: string): ClassicMotionFrameBlurResult => ({
    ok: false,
    message: `${endpoint} frame contains unsupported frame filter interpolation: ${filters
      .map(describeFilter).join(', ')}${detail ? `; ${detail}` : ''}`,
  });
  if (filters.length !== 1 || filters[0]?.name !== 'BlurFilter') return unsupported();

  const filter = filters[0]!;
  const attributes = Object.keys(filter.attributes).sort();
  if (attributes.length !== 2 || attributes[0] !== 'blurX' || attributes[1] !== 'blurY') {
    return unsupported('BlurFilter must author only blurX and blurY');
  }
  if (getFlaXflDirectChildren(filter.xml, filter.name).length !== 0) {
    return unsupported('BlurFilter child nodes are unsupported');
  }
  const blurX = parseClassicMotionBlurValue(filter.attributes.blurX);
  const blurY = parseClassicMotionBlurValue(filter.attributes.blurY);
  if (blurX === null || blurY === null) {
    return unsupported('blurX and blurY must be finite decimal values in 0..255');
  }
  return {
    ok: true,
    filter: { kind: 'blur', blurX, blurY, quality: 'low', enabled: true },
  };
}

function classicMotionFrameStructureRejectionReason(
  frame: FlaXflElementBlock,
  endpoint: 'start' | 'end',
): string | null {
  const frameChildren = getFlaXflDirectChildren(frame.xml, 'DOMFrame');
  const elementContainers = frameChildren.filter((child) => child.name === 'elements');
  if (elementContainers.length !== 1) {
    return `${endpoint} frame must contain exactly one elements container`;
  }
  const unsupportedFrameChildren = frameChildren.filter((child) =>
    child.name !== 'elements' && child.name !== 'frameFilters' && child.name !== 'tweens');
  if (unsupportedFrameChildren.length > 0) {
    return `${endpoint} frame contains unsupported direct child: ${unsupportedFrameChildren
      .map((child) => child.name).join(', ')}`;
  }

  const filterResult = classicMotionFrameBlurFilter(frame, endpoint);
  return filterResult.ok ? null : filterResult.message;
}

function interpolateClassicMotionFrameBlurFilter(
  startFrame: FlaXflElementBlock,
  endFrame: FlaXflElementBlock,
  progress: number,
): ClassicMotionFrameBlurResult {
  const startFilter = classicMotionFrameBlurFilter(startFrame, 'start');
  if (!startFilter.ok) return startFilter;
  const endFilter = classicMotionFrameBlurFilter(endFrame, 'end');
  if (!endFilter.ok) return endFilter;
  if (!startFilter.filter && !endFilter.filter) return { ok: true };
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    return { ok: false, message: 'motion filter progress must be finite and within 0..1' };
  }
  const from = startFilter.filter ?? { blurX: 0, blurY: 0, quality: 'low' as const, enabled: true as const, kind: 'blur' as const };
  const to = endFilter.filter ?? { blurX: 0, blurY: 0, quality: 'low' as const, enabled: true as const, kind: 'blur' as const };
  return {
    ok: true,
    filter: {
      ...to,
      blurX: from.blurX + (to.blurX - from.blurX) * progress,
      blurY: from.blurY + (to.blurY - from.blurY) * progress,
    },
  };
}

function rigPropagationMatrixRejectionReason(frame: FlaXflElementBlock): string | null {
  const raw = frame.attributes.rigPropagationMatrix;
  if (raw === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'rigPropagationMatrix is not valid JSON';
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'rigPropagationMatrix must be a matrix object';
  }
  const matrix = value as Record<string, unknown>;
  const names = ['a', 'b', 'c', 'd', 'tx', 'ty'];
  if (Object.keys(matrix).some((name) => !names.includes(name)) ||
      names.some((name) => typeof matrix[name] !== 'number' || !Number.isFinite(matrix[name]))) {
    return 'rigPropagationMatrix must contain finite a, b, c, d, tx, and ty values';
  }
  return null;
}

function classicMotionFramePairRejectionReason(
  startFrame: FlaXflElementBlock,
  endFrame: FlaXflElementBlock,
  startIndex: number,
  duration: number,
): string | null {
  type ParsedKeyMode =
    | { readonly kind: 'missing' }
    | { readonly kind: 'invalid' }
    | { readonly kind: 'integer'; readonly value: number };
  type MotionKeyModeFamily = 'motion' | 'sync-motion';
  const parseKeyMode = (raw: string | undefined): ParsedKeyMode => {
    if (raw === undefined) return { kind: 'missing' };
    if (!/^-?\d+$/u.test(raw)) return { kind: 'invalid' };
    const value = Number(raw);
    return Number.isSafeInteger(value) ? { kind: 'integer', value } : { kind: 'invalid' };
  };
  const rawKeyMode = (frame: FlaXflElementBlock): string => frame.attributes.keyMode ?? '(missing)';
  const motionKeyModeFamily = (frame: FlaXflElementBlock): MotionKeyModeFamily | null => {
    if (frame.attributes.tweenType !== 'motion') return null;
    const parsed = parseKeyMode(frame.attributes.keyMode);
    if (parsed.kind !== 'integer') return null;
    // Flare classifies Classic Motion from tweenType and treats Snap separately.
    // 17921 is also present on the failing ordinary, Snap-disabled source span.
    if ((parsed.value === 17921 || parsed.value === 22017) && frame.attributes.motionTweenSync === undefined) {
      return 'motion';
    }
    if (parsed.value === 24065 && frame.attributes.motionTweenSync === 'true') return 'sync-motion';
    return null;
  };
  const isSupportedTerminalKeyMode = (frame: FlaXflElementBlock): boolean => {
    const tweenType = frame.attributes.tweenType;
    if ((tweenType !== undefined && tweenType !== 'none') ||
        frame.attributes.motionTweenSnap !== undefined || frame.attributes.motionTweenSync !== undefined) {
      return false;
    }
    const parsed = parseKeyMode(frame.attributes.keyMode);
    return parsed.kind === 'integer' && (parsed.value === 15872 || parsed.value === 9728);
  };
  const unsupportedFrameAttributes = (frame: FlaXflElementBlock): string[] =>
    Object.keys(frame.attributes).filter((name) =>
      !CLASSIC_MOTION_FRAME_ATTRIBUTES.has(name));
  const validBooleanMetadata = (frame: FlaXflElementBlock): boolean => {
    for (const name of ['motionTweenSync', 'motionTweenSnap']) {
      const value = frame.attributes[name];
      if (value !== undefined && value !== 'true' && value !== 'false') return false;
    }
    return true;
  };
  const unsupportedStartAttributes = unsupportedFrameAttributes(startFrame);
  if (unsupportedStartAttributes.length > 0) {
    return `start frame contains unsupported attributes: ${unsupportedStartAttributes.join(', ')}`;
  }
  const unsupportedEndAttributes = unsupportedFrameAttributes(endFrame);
  if (unsupportedEndAttributes.length > 0) {
    return `end frame contains unsupported attributes: ${unsupportedEndAttributes.join(', ')}`;
  }
  if (!validBooleanMetadata(startFrame) || !validBooleanMetadata(endFrame)) {
    return 'motionTweenSync or motionTweenSnap has an invalid authored value';
  }
  const startRigPropagationRejection = rigPropagationMatrixRejectionReason(startFrame);
  if (startRigPropagationRejection) return startRigPropagationRejection;
  const endRigPropagationRejection = rigPropagationMatrixRejectionReason(endFrame);
  if (endRigPropagationRejection) return endRigPropagationRejection;
  for (const [role, frame] of [['start', startFrame], ['end', endFrame]] as const) {
    if (parseKeyMode(frame.attributes.keyMode).kind === 'invalid') {
      return `${role} frame keyMode=${rawKeyMode(frame)} is not a valid safe integer`;
    }
  }
  const startRotation = classicMotionRotationForFrame(startFrame);
  if (!startRotation.ok) return startRotation.message;
  const startEase = classicMotionEasesForFrame(startFrame);
  if (!startEase.ok) return startEase.message;
  if (!Number.isSafeInteger(duration) || duration <= 0) return 'span duration must be a positive safe integer';
  if (Number(startFrame.attributes.index) !== startIndex) return 'start frame index does not match the selected span';
  if (Number(endFrame.attributes.index) !== startIndex + duration) return 'end frame is not the exact authored span endpoint';
  if (startFrame.attributes.tweenType !== 'motion') return 'start frame is not a motion tween keyframe';
  const startKeyModeFamily = motionKeyModeFamily(startFrame);
  if (!startKeyModeFamily) {
    return `start frame keyMode=${rawKeyMode(startFrame)} is unsupported for Classic Motion; expected 17921 or 22017 without motionTweenSync, or 24065 with motionTweenSync=true`;
  }
  if (endFrame.attributes.tweenType === 'motion') {
    if (!motionKeyModeFamily(endFrame)) {
      return `end frame keyMode=${rawKeyMode(endFrame)} is unsupported for a Classic Motion key; expected 17921 or 22017 without motionTweenSync, or 24065 with motionTweenSync=true`;
    }
  } else if (!isSupportedTerminalKeyMode(endFrame)) {
    return `end frame keyMode=${rawKeyMode(endFrame)} is unsupported for this Classic Motion endpoint role`;
  }
  if (containsUnsupportedMotionMetadata(startFrame.xml) || containsUnsupportedMotionMetadata(endFrame.xml)) {
    return 'frame XML contains unsupported motion metadata';
  }

  const startStructureRejectionReason = classicMotionFrameStructureRejectionReason(startFrame, 'start');
  if (startStructureRejectionReason) return startStructureRejectionReason;
  const endStructureRejectionReason = classicMotionFrameStructureRejectionReason(endFrame, 'end');
  if (endStructureRejectionReason) return endStructureRejectionReason;

  const startElements = frameDisplayElements(startFrame);
  const endElements = frameDisplayElements(endFrame);
  if (startElements.length === 0 || startElements.length !== endElements.length) {
    return 'Classic Motion endpoints must preserve the same non-empty display element count';
  }
  const allowedInstanceAttributes = (target: FlaXflElementBlock): boolean =>
    Object.keys(target.attributes).every((name) => CLASSIC_MOTION_INSTANCE_ATTRIBUTES.has(name));
  for (let index = 0; index < startElements.length; index += 1) {
    const startTarget = startElements[index]!;
    const endTarget = endElements[index]!;
    if (startTarget.name !== 'DOMSymbolInstance' || endTarget.name !== 'DOMSymbolInstance' ||
        !elementIsVisible(startTarget.attributes) || !elementIsVisible(endTarget.attributes)) {
      return `Classic Motion display element ${index} must remain a visible symbol instance`;
    }
    if (!allowedInstanceAttributes(startTarget) || !allowedInstanceAttributes(endTarget)) {
      return `Classic Motion symbol instance ${index} contains unsupported attributes`;
    }
    if (startTarget.attributes.libraryItemName !== endTarget.attributes.libraryItemName ||
        startTarget.attributes.symbolType !== endTarget.attributes.symbolType) {
      return `Classic Motion symbol identity changes at source order ${index}`;
    }
    if (startTarget.attributes.symbolType !== 'graphic') {
      return `Classic Motion symbol ${index} is not a Graphic instance`;
    }
    for (const name of ['centerPoint3DX', 'centerPoint3DY']) {
      for (const target of [startTarget, endTarget]) {
        const raw = target.attributes[name];
        if (raw !== undefined && !Number.isFinite(Number(raw))) {
          return `symbol instance ${name} must be finite`;
        }
      }
    }
    const startColor = classicMotionColorTransform(startTarget);
    if (!startColor.ok) return startColor.message;
    const endColor = classicMotionColorTransform(endTarget);
    if (!endColor.ok) return endColor.message;
  }

  const hasSupportedTransformChildren = (
    target: FlaXflElementBlock,
    allowColorTransform: boolean,
  ): boolean => {
    const children = getFlaXflDirectChildren(target.xml, target.name);
    const matrices = children.filter((child) => child.name === 'matrix');
    const points = children.filter((child) => child.name === 'transformationPoint');
    const colors = children.filter((child) => child.name === 'color');
    if (matrices.length !== 1 || points.length > 1 || colors.length > 1 ||
        children.some((child) => child.name !== 'matrix' && child.name !== 'transformationPoint' &&
          !(allowColorTransform && child.name === 'color'))) {
      return false;
    }
    const matrixValues = getFlaXflDirectChildren(matrices[0]!.xml, 'matrix');
    if (matrixValues.length !== 1 || matrixValues[0]?.name !== 'Matrix') return false;
    if (Object.keys(matrixValues[0].attributes).some((name) =>
      !['a', 'b', 'c', 'd', 'tx', 'ty'].includes(name))) return false;
    if (points.length === 1) {
      const pointValues = getFlaXflDirectChildren(points[0]!.xml, 'transformationPoint');
      if (pointValues.length !== 1 || pointValues[0]?.name !== 'Point' ||
          Object.keys(pointValues[0].attributes).some((name) => name !== 'x' && name !== 'y') ||
          Object.values(pointValues[0].attributes).some((value) => !Number.isFinite(Number(value)))) {
        return false;
      }
    }
    if (colors.length > 0 && !allowColorTransform) return false;
    return true;
  };
  for (let index = 0; index < startElements.length; index += 1) {
    const startTarget = startElements[index]!;
    const endTarget = endElements[index]!;
    if (!hasSupportedTransformChildren(startTarget, true) || !hasSupportedTransformChildren(endTarget, true)) {
      return `symbol instance ${index} matrix, color, or transformation point is outside the supported structure`;
    }
  }
  return null;
}

type RigCalculationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

interface RigEvaluationContext {
  readonly timelineXml: string;
  readonly frameSpanIndex: FlaTimelineFrameSpanIndex<FlaXflElementBlock>;
  readonly layers: readonly FlaXflElementBlock[];
}

interface RigMotionParentPoses {
  readonly parentLayerIndex: number;
  readonly start: FlaDisplayListMatrix;
  readonly end: FlaDisplayListMatrix;
  readonly current: FlaDisplayListMatrix;
}

function isNormalRigLayer(layer: FlaXflElementBlock | undefined): boolean {
  const layerType = (layer?.attributes.layerType ?? '').trim().toLocaleLowerCase('en-US');
  return layerType === '' || layerType === 'normal';
}

/**
 * DOMFrame.parentLayerIndex is the keyframe's Rig id. DOMLayer.parentLayerIndex
 * remains the separate folder/mask/guide hierarchy field.
 */
function rigParentLayerForFrame(
  frame: FlaXflElementBlock,
  childLayerIndex: number,
  layers: readonly FlaXflElementBlock[],
): RigCalculationResult<number | null> {
  const rawRigId = frame.attributes.parentLayerIndex;
  if (rawRigId === undefined) return { ok: true, value: null };
  if (!/^\d+$/u.test(rawRigId) || !Number.isSafeInteger(Number(rawRigId))) {
    return { ok: false, message: `DOMFrame parentLayerIndex=${rawRigId} is not a numeric Rig id` };
  }
  if (!isNormalRigLayer(layers[childLayerIndex])) {
    return { ok: false, message: 'Rig parenting is supported only on normal child layers' };
  }
  const matches = layers.flatMap((layer, layerIndex) =>
    layer.attributes.layerRiggingIndex === rawRigId ? [layerIndex] : [],
  );
  if (matches.length === 0) {
    return { ok: false, message: `DOMFrame Rig parent id ${rawRigId} has no DOMLayer.layerRiggingIndex match` };
  }
  if (matches.length !== 1) {
    return { ok: false, message: `DOMLayer.layerRiggingIndex ${rawRigId} is ambiguous` };
  }
  const parentLayerIndex = matches[0]!;
  if (parentLayerIndex === childLayerIndex) {
    return { ok: false, message: `DOMFrame Rig parent id ${rawRigId} points to its own layer` };
  }
  if (!isNormalRigLayer(layers[parentLayerIndex])) {
    return { ok: false, message: `DOMFrame Rig parent id ${rawRigId} resolves to a non-normal layer` };
  }
  return { ok: true, value: parentLayerIndex };
}

function motionGuideLayerFor(
  layerIndex: number,
  layers: readonly FlaXflElementBlock[],
): RigCalculationResult<number | null> {
  const layer = layers[layerIndex];
  if (!layer) return { ok: false, message: `XFL layer ${layerIndex} is missing` };
  const rawParent = layer.attributes.parentLayerIndex;
  if (rawParent === undefined) return { ok: true, value: null };
  if (!/^\d+$/u.test(rawParent) || !Number.isSafeInteger(Number(rawParent))) {
    return { ok: false, message: `DOMLayer parentLayerIndex=${rawParent} is not a valid layer ordinal` };
  }
  const parentLayerIndex = Number(rawParent);
  if (parentLayerIndex >= layerIndex) return { ok: true, value: null };
  const parentLayer = layers[parentLayerIndex];
  if (!parentLayer) return { ok: true, value: null };
  const parentType = (parentLayer.attributes.layerType ?? '').trim().toLocaleLowerCase('en-US');
  return { ok: true, value: parentType === 'guide' ? parentLayerIndex : null };
}

function soleGraphicFrameMatrix(
  frame: FlaXflElementBlock,
  role: string,
): RigCalculationResult<FlaDisplayListMatrix> {
  const elements = frameDisplayElements(frame);
  if (elements.length !== 1) {
    return { ok: false, message: `${role} parent frame must contain exactly one display object` };
  }
  const instance = elements[0];
  if (!instance || instance.name !== 'DOMSymbolInstance' || !elementIsVisible(instance.attributes)) {
    return { ok: false, message: `${role} parent object must be one visible Graphic instance` };
  }
  const symbolType = (instance.attributes.symbolType ?? 'graphic').trim().toLocaleLowerCase('en-US');
  if (symbolType !== 'graphic') {
    return { ok: false, message: `${role} parent object is not a Graphic instance` };
  }
  const matrix = readDirectMatrix(instance);
  return matrix.ok ? { ok: true, value: matrix.matrix } : { ok: false, message: matrix.message };
}

function rigMotionParentPoses(
  context: RigEvaluationContext,
  childLayerIndex: number,
  startFrame: FlaXflElementBlock,
  endFrame: FlaXflElementBlock,
  frameIndex: number,
  ancestry: readonly number[],
): RigCalculationResult<RigMotionParentPoses | null> {
  const startParent = rigParentLayerForFrame(startFrame, childLayerIndex, context.layers);
  if (!startParent.ok) return startParent;
  const endParent = rigParentLayerForFrame(endFrame, childLayerIndex, context.layers);
  if (!endParent.ok) return endParent;
  if (startParent.value !== endParent.value) {
    return { ok: false, message: 'Classic Motion Rig parent id changes between endpoint keyframes' };
  }
  const parentLayerIndex = startParent.value;
  if (parentLayerIndex === null) return { ok: true, value: null };
  if (ancestry.length > MAX_RIG_PARENT_DEPTH) {
    return { ok: false, message: `Rig parent chain exceeds depth ${MAX_RIG_PARENT_DEPTH}` };
  }
  const start = evaluateRigLayerObjectMatrix(context, parentLayerIndex, Number(startFrame.attributes.index), ancestry);
  if (!start.ok) return start;
  const end = evaluateRigLayerObjectMatrix(context, parentLayerIndex, Number(endFrame.attributes.index), ancestry);
  if (!end.ok) return end;
  const current = evaluateRigLayerObjectMatrix(context, parentLayerIndex, frameIndex, ancestry);
  if (!current.ok) return current;
  return {
    ok: true,
    value: { parentLayerIndex, start: start.value, end: end.value, current: current.value },
  };
}

function classicMotionProgress(
  frame: FlaXflElementBlock,
  frameIndex: number,
  spanIndex: number,
  duration: number,
): RigCalculationResult<{ readonly progress: number; readonly rotation?: FlaMotionTweenRotation }> {
  const rotation = classicMotionRotationForFrame(frame);
  if (!rotation.ok) return { ok: false, message: rotation.message };
  const ease = classicMotionEasesForFrame(frame);
  if (!ease.ok) return { ok: false, message: ease.message };
  const evaluated = evaluateFlaViewerClassicTweenProgress(
    (frameIndex - spanIndex) / duration,
    ease.acceleration,
    ease.eases,
  );
  if (!evaluated.ok) return { ok: false, message: evaluated.message };
  return {
    ok: true,
    value: {
      progress: evaluated.progress,
      ...(rotation.rotation ? { rotation: rotation.rotation } : {}),
    },
  };
}

function evaluateRigLayerObjectMatrix(
  context: RigEvaluationContext,
  layerIndex: number,
  frameIndex: number,
  ancestry: readonly number[] = [],
): RigCalculationResult<FlaDisplayListMatrix> {
  if (ancestry.includes(layerIndex)) {
    return { ok: false, message: `Rig parent cycle detected at layer ${layerIndex}` };
  }
  const layer = context.layers[layerIndex];
  const indexedLayer = context.frameSpanIndex.layers[layerIndex];
  if (!layer || !indexedLayer) return { ok: false, message: `Rig parent layer ${layerIndex} has no frame spans` };
  if (!isNormalRigLayer(layer)) return { ok: false, message: `Rig parent layer ${layerIndex} is not a normal layer` };
  const span = indexedLayer.spans.find((candidate) =>
    candidate.index <= frameIndex && frameIndex < candidate.endExclusive);
  if (!span) return { ok: false, message: `Rig parent layer ${layerIndex} has no authored pose at frame ${frameIndex}` };
  const nextAncestry = [...ancestry, layerIndex];

  if (span.tweenType === 'shape' && frameIndex > span.index) {
    return { ok: false, message: `Rig parent layer ${layerIndex} uses unsupported Shape Tween interpolation` };
  }
  if (span.tweenType === 'motion') {
    const endSpan = indexedLayer.spans.find((candidate) => candidate.index === span.endExclusive);
    if (!endSpan) return { ok: false, message: `Rig parent layer ${layerIndex} is missing its Motion endpoint` };
    const pairRejection = classicMotionFramePairRejectionReason(
      span.sourceFrame,
      endSpan.sourceFrame,
      span.index,
      span.duration,
    );
    if (pairRejection) {
      return { ok: false, message: `Rig parent Classic Motion is unsupported: ${pairRejection}` };
    }
    const guide = motionGuideLayerFor(layerIndex, context.layers);
    if (!guide.ok) return guide;
    if (guide.value !== null) {
      return { ok: false, message: `Rig parent Motion Guide on layer ${guide.value} requires unsupported path evaluation` };
    }
    const startMatrix = soleGraphicFrameMatrix(span.sourceFrame, 'start');
    if (!startMatrix.ok) return startMatrix;
    const endMatrix = soleGraphicFrameMatrix(endSpan.sourceFrame, 'end');
    if (!endMatrix.ok) return endMatrix;
    const parentPoses = rigMotionParentPoses(
      context,
      layerIndex,
      span.sourceFrame,
      endSpan.sourceFrame,
      frameIndex,
      nextAncestry,
    );
    if (!parentPoses.ok) return parentPoses;
    const tween = classicMotionProgress(span.sourceFrame, frameIndex, span.index, span.duration);
    if (!tween.ok) return tween;
    let from = startMatrix.value;
    let to = endMatrix.value;
    if (parentPoses.value) {
      const parentStartInverse = inverse(parentPoses.value.start);
      const parentEndInverse = inverse(parentPoses.value.end);
      if (!parentStartInverse || !parentEndInverse) {
        return { ok: false, message: 'Rig parent endpoint matrix is singular' };
      }
      from = compose(parentStartInverse, from);
      to = compose(parentEndInverse, to);
    }
    const interpolated = interpolateFlaLinearMotionTransform(
      from,
      to,
      tween.value.progress,
      tween.value.rotation,
    );
    if (!interpolated.ok) return { ok: false, message: interpolated.message };
    return {
      ok: true,
      value: parentPoses.value
        ? compose(parentPoses.value.current, interpolated.matrix)
        : interpolated.matrix,
    };
  }

  const authoredMatrix = soleGraphicFrameMatrix(span.sourceFrame, 'authored');
  if (!authoredMatrix.ok) return authoredMatrix;
  const parent = rigParentLayerForFrame(span.sourceFrame, layerIndex, context.layers);
  if (!parent.ok) return parent;
  if (parent.value === null) return authoredMatrix;
  if (nextAncestry.length > MAX_RIG_PARENT_DEPTH) {
    return { ok: false, message: `Rig parent chain exceeds depth ${MAX_RIG_PARENT_DEPTH}` };
  }
  const parentAtStart = evaluateRigLayerObjectMatrix(context, parent.value, span.index, nextAncestry);
  if (!parentAtStart.ok) return parentAtStart;
  const parentAtFrame = evaluateRigLayerObjectMatrix(context, parent.value, frameIndex, nextAncestry);
  if (!parentAtFrame.ok) return parentAtFrame;
  const startInverse = inverse(parentAtStart.value);
  if (!startInverse) return { ok: false, message: 'Rig parent keyframe matrix is singular' };
  return {
    ok: true,
    value: compose(compose(parentAtFrame.value, startInverse), authoredMatrix.value),
  };
}

function applyRigCorrectionToElements(
  context: RigEvaluationContext,
  layerIndex: number,
  frame: FlaXflElementBlock,
  frameIndex: number,
  frameSpanStart: number,
  elements: readonly FlaDisplayListElement[],
): RigCalculationResult<readonly FlaDisplayListElement[]> {
  const parent = rigParentLayerForFrame(frame, layerIndex, context.layers);
  if (!parent.ok) return parent;
  if (parent.value === null) return { ok: true, value: elements };
  const ancestry = [layerIndex];
  if (ancestry.length > MAX_RIG_PARENT_DEPTH) {
    return { ok: false, message: `Rig parent chain exceeds depth ${MAX_RIG_PARENT_DEPTH}` };
  }
  const parentAtStart = evaluateRigLayerObjectMatrix(context, parent.value, frameSpanStart, ancestry);
  if (!parentAtStart.ok) return parentAtStart;
  const parentAtFrame = evaluateRigLayerObjectMatrix(context, parent.value, frameIndex, ancestry);
  if (!parentAtFrame.ok) return parentAtFrame;
  const startInverse = inverse(parentAtStart.value);
  if (!startInverse) return { ok: false, message: 'Rig parent keyframe matrix is singular' };
  const correction = compose(parentAtFrame.value, startInverse);
  return {
    ok: true,
    value: elements.map((element) => ({
      ...element,
      localTransform: compose(correction, element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX),
    })),
  };
}

function isClassicMotionSpan(
  startFrame: FlaXflElementBlock,
  endFrame: FlaXflElementBlock,
  startIndex: number,
  duration: number,
): boolean {
  const rejectionReason = classicMotionFramePairRejectionReason(startFrame, endFrame, startIndex, duration);
  return startIndex >= 0 && rejectionReason === null;
}

type ClassicMotionSyncFrameSpan = FlaNormalizedFrameSpan<FlaXflElementBlock>;

interface ClassicMotionSyncFirstFrameState {
  readonly libraryItemName: string;
  readonly firstFrame: number;
  readonly inherited: boolean;
}

type ClassicMotionSyncFirstFrameResult =
  | { readonly ok: true; readonly firstFrames: readonly (number | undefined)[] }
  | { readonly ok: false; readonly message: string };

function parseAuthoredGraphicFirstFrame(frame: FlaXflElementBlock): number | null {
  const raw = frame.attributes.firstFrame;
  if (raw === undefined) return 0;
  const trimmed = raw.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Resolve the first-frame origin Flare carries through adjacent, synchronized
 * Classic Motion keys. Element order and library identity are both retained;
 * source-authored firstFrame values remain on the parsed display elements.
 */
function classicMotionSyncFirstFrames(
  spans: readonly ClassicMotionSyncFrameSpan[],
  currentSpan: ClassicMotionSyncFrameSpan,
): ClassicMotionSyncFirstFrameResult {
  let currentPosition = spans.indexOf(currentSpan);
  if (currentPosition < 0) {
    currentPosition = spans.findIndex((span) => span.index === currentSpan.index);
  }
  if (currentPosition < 0) return { ok: true, firstFrames: [] };

  const reversedChain = [currentSpan];
  let successor = currentSpan;
  while (currentPosition > 0) {
    const previous = spans[currentPosition - 1];
    if (!previous || previous.tweenType !== 'motion' ||
        previous.sourceFrame.attributes.motionTweenSync !== 'true' ||
        previous.endExclusive !== successor.index ||
        !isClassicMotionSpan(previous.sourceFrame, successor.sourceFrame, previous.index, previous.duration)) {
      break;
    }
    reversedChain.push(previous);
    successor = previous;
    currentPosition -= 1;
  }
  if (reversedChain.length < 2) return { ok: true, firstFrames: [] };

  const chain = reversedChain.reverse();
  const readFrameState = (
    frame: FlaXflElementBlock,
    frameIndex: number,
  ): { readonly ok: true; readonly states: readonly (ClassicMotionSyncFirstFrameState | undefined)[] } |
    { readonly ok: false; readonly message: string } => {
    const elements = frameDisplayElements(frame);
    const states: (ClassicMotionSyncFirstFrameState | undefined)[] = [];
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      if (element?.name !== 'DOMSymbolInstance') {
        states.push(undefined);
        continue;
      }
      const libraryItemName = element.attributes.libraryItemName?.trim();
      const firstFrame = parseAuthoredGraphicFirstFrame(element);
      if (!libraryItemName || firstFrame === null) {
        return {
          ok: false,
          message: `Classic Motion Sync keyframe ${frameIndex} has an invalid Graphic instance identity or firstFrame at element ${elementIndex}`,
        };
      }
      states.push({ libraryItemName, firstFrame, inherited: false });
    }
    return { ok: true, states };
  };

  const firstSpan = chain[0];
  if (!firstSpan) return { ok: true, firstFrames: [] };
  let statesResult = readFrameState(firstSpan.sourceFrame, firstSpan.index);
  if (!statesResult.ok) return statesResult;
  let states = statesResult.states;

  for (let chainIndex = 1; chainIndex < chain.length; chainIndex += 1) {
    const previousSpan = chain[chainIndex - 1];
    const current = chain[chainIndex];
    if (!previousSpan || !current) continue;
    const step = current.index - previousSpan.index;
    if (!Number.isSafeInteger(step) || step <= 0) {
      return { ok: false, message: `Classic Motion Sync keyframe ${current.index} has an invalid frame interval` };
    }
    statesResult = readFrameState(current.sourceFrame, current.index);
    if (!statesResult.ok) return statesResult;
    const authoredStates = statesResult.states;
    const nextStates: (ClassicMotionSyncFirstFrameState | undefined)[] = [];
    for (let elementIndex = 0; elementIndex < authoredStates.length; elementIndex += 1) {
      const authored = authoredStates[elementIndex];
      if (!authored) {
        nextStates.push(undefined);
        continue;
      }
      const previous = states[elementIndex];
      if (previous?.libraryItemName === authored.libraryItemName) {
        const firstFrame = previous.firstFrame + step;
        if (!Number.isSafeInteger(firstFrame)) {
          return {
            ok: false,
            message: `Classic Motion Sync firstFrame exceeds the safe range at keyframe ${current.index}, element ${elementIndex}`,
          };
        }
        nextStates.push({ ...authored, firstFrame, inherited: true });
      } else {
        nextStates.push(authored);
      }
    }
    states = nextStates;
  }

  return {
    ok: true,
    firstFrames: states.map((state) => state?.inherited ? state.firstFrame : undefined),
  };
}

function applyClassicMotionSyncFirstFrames(
  elements: readonly FlaDisplayListElement[],
  firstFrames: readonly (number | undefined)[],
): readonly FlaDisplayListElement[] {
  if (firstFrames.length === 0) return elements;
  return elements.map((element, index) => {
    const synchronizedFirstFrame = firstFrames[index];
    if (element.kind !== 'symbol' || synchronizedFirstFrame === undefined) return element;
    return { ...element, synchronizedFirstFrame };
  });
}

/** XFL lists timeline layers front-to-back; Panda frame contexts paint back-to-front. */
function normalizeXflTimelineLayersForPainterOrder<T>(
  layers: readonly T[],
): readonly T[] {
  return [...layers].reverse();
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
  const rigContext: RigEvaluationContext = { timelineXml, frameSpanIndex, layers };
  const maskLayerIds = new Map<number, string>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if ((layer?.attributes.layerType ?? '').toLocaleLowerCase('en-US') === 'mask') {
      maskLayerIds.set(layerIndex, `${scope}/mask-layer-${layerIndex}`);
    }
  }
  const resolvedLayers: FlaDisplayListFrameContext['layers'][number][] = [];
  const unsupportedDisplayReasons: string[] = [];
  for (const selection of resolution.layers) {
    const layer = layers[selection.layerIndex];
    if (!layer) return fail('RENDER_FAILED', `XFL timeline layer ${selection.layerIndex} is missing`);

    let elements: readonly FlaDisplayListElement[] = [];
    let frameFilter: FlaDisplayListBlurFilter | undefined;
    if (selection.kind === 'authored-frame') {
      const frame = selection.sourceFrame;
      const elementContainer = directChild(frame.xml, 'DOMFrame', 'elements') ?? frame;
      const indexedLayer = frameSpanIndex.layers[selection.layerIndex];
      const selectedLayerSpan = indexedLayer?.spans.find((span) => span.index === selection.span.index);
      const syncFirstFrames = selectedLayerSpan && indexedLayer
        ? classicMotionSyncFirstFrames(indexedLayer.spans, selectedLayerSpan)
        : { ok: true as const, firstFrames: [] as readonly (number | undefined)[] };
      if (!syncFirstFrames.ok) {
        return fail('RENDER_FAILED', `Graphic frame ${frameIndex} has an unsupported Classic Motion Sync chain: ${syncFirstFrames.message}`);
      }
      const incomingMotionSpan = indexedLayer?.spans.find((span) =>
        span.tweenType === 'motion' && span.endExclusive === selection.span.index);
      if (incomingMotionSpan) {
        const authoredFilterResult = classicMotionFrameBlurFilter(frame, 'end');
        if (!authoredFilterResult.ok) return fail('RENDER_FAILED', authoredFilterResult.message);
        if (authoredFilterResult.filter) {
          const incomingPairRejectionReason = classicMotionFramePairRejectionReason(
            incomingMotionSpan.sourceFrame,
            frame,
            incomingMotionSpan.index,
            incomingMotionSpan.duration,
          );
          if (incomingPairRejectionReason) {
            return fail(
              'RENDER_FAILED',
              `Graphic frame ${frameIndex} has an unsupported incoming frame-filter tween: ${incomingPairRejectionReason}`,
            );
          }
          frameFilter = authoredFilterResult.filter;
        }
      }
      let motionSpanMetadata = false;
      let motionSync: boolean | undefined;
      const outgoingMotionSpan = indexedLayer?.spans.find((span) =>
        span.index === selection.span.index && span.tweenType === 'motion');
      const outgoingMotionEndSpan = outgoingMotionSpan
        ? indexedLayer?.spans.find((span) => span.index === outgoingMotionSpan.endExclusive)
        : undefined;
      if (outgoingMotionSpan && outgoingMotionEndSpan && isClassicMotionSpan(
          outgoingMotionSpan.sourceFrame,
          outgoingMotionEndSpan.sourceFrame,
          outgoingMotionSpan.index,
          outgoingMotionSpan.duration,
        )) {
        motionSpanMetadata = true;
        const rawSync = outgoingMotionSpan.sourceFrame.attributes.motionTweenSync;
        motionSync = rawSync === undefined ? undefined : rawSync === 'true';
      }
      if (!motionSpanMetadata) {
        const incomingMotionSpan = indexedLayer?.spans.find((span) =>
          span.tweenType === 'motion' && span.endExclusive === selection.span.index);
        const incomingMotionEndSpan = incomingMotionSpan
          ? indexedLayer?.spans.find((span) => span.index === incomingMotionSpan.endExclusive)
          : undefined;
        if (incomingMotionSpan && incomingMotionEndSpan && isClassicMotionSpan(
          incomingMotionSpan.sourceFrame,
          incomingMotionEndSpan.sourceFrame,
          incomingMotionSpan.index,
          incomingMotionSpan.duration,
        )) {
          motionSpanMetadata = true;
          const rawSync = incomingMotionSpan.sourceFrame.attributes.motionTweenSync;
          motionSync = rawSync === undefined ? undefined : rawSync === 'true';
        }
      }
      const parsed = parseDisplayElements(elementContainer, {
        scope,
        parentWorld: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
        depth: 0,
        path: `layer-${selection.layerIndex}-frame-${selection.span.index}`,
        sourceParentFrameIndex: frameIndex,
        sourceParentFrameSpanStart: selection.span.index,
        sourceParentSpanTweenType: selection.span.tweenType ?? 'none',
        ...(motionSync !== undefined ? { sourceParentMotionTweenSync: motionSync } : {}),
        ...(motionSpanMetadata ? { motionTweenEndpoint: true } : {}),
        unsupportedDisplayReasons,
        state,
      });
      if (!parsed.ok) return parsed;
      const synchronizedElements = applyClassicMotionSyncFirstFrames(parsed.value, syncFirstFrames.firstFrames);
      const riggedElements = applyRigCorrectionToElements(
        rigContext,
        selection.layerIndex,
        frame,
        frameIndex,
        selection.span.index,
        synchronizedElements,
      );
      if (!riggedElements.ok) {
        return fail('RENDER_FAILED', `Graphic frame ${frameIndex} has unsupported Rig parenting: ${riggedElements.message}`);
      }
      elements = riggedElements.value;
    } else if (selection.kind === 'unsupported-tween-interior' && selection.visible) {
      const rejectTween = (reason: string) => fail(
        'RENDER_FAILED',
        `Graphic frame ${frameIndex} requires unsupported ${selection.span.tweenType} tween interpolation on layer ${selection.layerIndex}: ${reason}`,
      );
      if (selection.span.tweenType !== 'motion') return rejectTween('only Classic Motion spans are supported');

      const indexedLayer = frameSpanIndex.layers[selection.layerIndex];
      if (!indexedLayer) return rejectTween('timeline layer span metadata is missing');
      const startSpan = indexedLayer.spans.find((span) => span.index === selection.span.index);
      const endSpan = indexedLayer.spans.find((span) => span.index === selection.span.endExclusive);
      if (!startSpan || !endSpan) return rejectTween('an adjacent authored end keyframe is required');
      const startFrame = startSpan.sourceFrame;
      const endFrame = endSpan.sourceFrame;
      const pairRejectionReason = classicMotionFramePairRejectionReason(
        startFrame,
        endFrame,
        startSpan.index,
        startSpan.duration,
      );
      if (pairRejectionReason) {
        return rejectTween(`source metadata is outside the supported Classic Motion structure: ${pairRejectionReason}`);
      }
      const guide = motionGuideLayerFor(selection.layerIndex, layers);
      if (!guide.ok) return rejectTween(guide.message);
      if (guide.value !== null) {
        return rejectTween(`Motion Guide on layer ${guide.value} requires unsupported guide-path evaluation`);
      }
      const rigParentPoses = rigMotionParentPoses(
        rigContext,
        selection.layerIndex,
        startFrame,
        endFrame,
        frameIndex,
        [selection.layerIndex],
      );
      if (!rigParentPoses.ok) return rejectTween(rigParentPoses.message);
      const syncFirstFrames = classicMotionSyncFirstFrames(indexedLayer.spans, startSpan);
      if (!syncFirstFrames.ok) return rejectTween(syncFirstFrames.message);
      const sourceRotationResult = classicMotionRotationForFrame(startFrame);
      if (!sourceRotationResult.ok) return rejectTween(sourceRotationResult.message);
      const sourceEaseResult = classicMotionEasesForFrame(startFrame);
      if (!sourceEaseResult.ok) return rejectTween(sourceEaseResult.message);
      const linearProgress = (frameIndex - startSpan.index) / startSpan.duration;
      const evaluatedProgress = evaluateFlaViewerClassicTweenProgress(
        linearProgress,
        sourceEaseResult.acceleration,
        sourceEaseResult.eases,
      );
      if (!evaluatedProgress.ok) return rejectTween(evaluatedProgress.message);
      const progress = evaluatedProgress.progress;
      const rawSync = startFrame.attributes.motionTweenSync;
      const sourceMotionSync = rawSync === undefined ? undefined : rawSync === 'true';
      const rigStartInverse = rigParentPoses.value ? inverse(rigParentPoses.value.start) : null;
      const rigEndInverse = rigParentPoses.value ? inverse(rigParentPoses.value.end) : null;
      if (rigParentPoses.value && (!rigStartInverse || !rigEndInverse)) {
        return rejectTween('Rig parent endpoint matrix is singular');
      }

      const parseTweenTarget = (frame: FlaXflElementBlock, sourceFrameIndex: number) => {
        const elementContainer = directChild(frame.xml, 'DOMFrame', 'elements') ?? frame;
        return parseDisplayElements(elementContainer, {
          scope,
          parentWorld: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
          depth: 0,
          path: `layer-${selection.layerIndex}-frame-${sourceFrameIndex}`,
          sourceParentFrameIndex: frameIndex,
          sourceParentFrameSpanStart: startSpan.index,
          sourceParentSpanTweenType: selection.span.tweenType ?? 'motion',
          ...(sourceMotionSync !== undefined ? { sourceParentMotionTweenSync: sourceMotionSync } : {}),
          motionTweenEndpoint: true,
          unsupportedDisplayReasons,
          state,
        });
      };
      const startParsed = parseTweenTarget(startFrame, startSpan.index);
      if (!startParsed.ok) return startParsed;
      const endParsed = parseTweenTarget(endFrame, endSpan.index);
      if (!endParsed.ok) return endParsed;
      const syncedStartElements = applyClassicMotionSyncFirstFrames(startParsed.value, syncFirstFrames.firstFrames);
      if (syncedStartElements.length !== endParsed.value.length || syncedStartElements.length === 0) {
        return rejectTween('Classic Motion endpoints must preserve the same non-empty display element count');
      }
      const interpolatedFrameFilter = interpolateClassicMotionFrameBlurFilter(
        startFrame,
        endFrame,
        progress,
      );
      if (!interpolatedFrameFilter.ok) return rejectTween(interpolatedFrameFilter.message);
      frameFilter = interpolatedFrameFilter.filter;
      const interpolatedElements: FlaDisplayListElement[] = [];
      for (let index = 0; index < syncedStartElements.length; index += 1) {
        const startTarget = syncedStartElements[index];
        const endTarget = endParsed.value[index];
        if (startTarget?.kind !== 'symbol' || endTarget?.kind !== 'symbol' ||
            startTarget.symbolType !== 'graphic' || endTarget.symbolType !== 'graphic' ||
            startTarget.libraryItemName !== endTarget.libraryItemName ||
            !startTarget.localTransform || !endTarget.localTransform) {
          return rejectTween(`matching Graphic instances with authored matrices are required at source order ${index}`);
        }
        const localStart = rigStartInverse
          ? compose(rigStartInverse, startTarget.localTransform)
          : startTarget.localTransform;
        const localEnd = rigEndInverse
          ? compose(rigEndInverse, endTarget.localTransform)
          : endTarget.localTransform;
        const interpolated = interpolateFlaLinearMotionTransform(
          localStart,
          localEnd,
          progress,
          sourceRotationResult.rotation,
        );
        if (!interpolated.ok) return rejectTween(interpolated.message);
        const worldTransform = rigParentPoses.value
          ? compose(rigParentPoses.value.current, interpolated.matrix)
          : interpolated.matrix;
        const startAlpha = startTarget.alphaMultiplier ?? 1;
        const endAlpha = endTarget.alphaMultiplier ?? 1;
        const interpolatedAlpha = startAlpha + (endAlpha - startAlpha) * progress;
        const rgbTransform = {
          multiplier: (startTarget.rgbTransform?.multiplier ?? 1) +
            ((endTarget.rgbTransform?.multiplier ?? 1) - (startTarget.rgbTransform?.multiplier ?? 1)) * progress,
          offset: (startTarget.rgbTransform?.offset ?? 0) +
            ((endTarget.rgbTransform?.offset ?? 0) - (startTarget.rgbTransform?.offset ?? 0)) * progress,
        };
        const effectiveRgbTransform = rgbTransform.multiplier === 1 && rgbTransform.offset === 0
          ? undefined
          : rgbTransform;
        interpolatedElements.push({
          ...startTarget,
          ...(interpolatedAlpha !== 1 ? { alphaMultiplier: interpolatedAlpha } : {}),
          ...(effectiveRgbTransform ? { rgbTransform: effectiveRgbTransform } : {}),
          localTransform: worldTransform,
        });
      }
      elements = interpolatedElements;
    }

    let maskedBy: string | undefined;
    const parentLayerIndexRaw = layer.attributes.parentLayerIndex;
    if (parentLayerIndexRaw !== undefined) {
      const parentLayerIndex = Number(parentLayerIndexRaw);
      if (!Number.isSafeInteger(parentLayerIndex) || parentLayerIndex < 0 || !maskLayerIds.has(parentLayerIndex)) {
        unsupportedDisplayReasons.push('Masked XFL layer references a missing or unsupported parent mask layer');
      } else {
        maskedBy = maskLayerIds.get(parentLayerIndex);
      }
    }
    resolvedLayers.push({
      name: layer.attributes.name?.trim() || `Layer ${selection.layerIndex + 1}`,
      visible: selection.visible,
      elements,
      ...(maskLayerIds.has(selection.layerIndex)
        ? { maskLayerId: maskLayerIds.get(selection.layerIndex) }
        : {}),
      ...(frameFilter ? { frameFilter } : {}),
      ...(maskedBy ? { maskedBy } : {}),
    });
  }
  return {
    ok: true,
    value: {
      frameIndex,
      layers: normalizeXflTimelineLayersForPainterOrder(resolvedLayers),
      ...(unsupportedDisplayReasons[0]
        ? { unsupportedDisplayReason: unsupportedDisplayReasons[0] }
        : {}),
    },
  };
}

function countNestedSymbols(elements: readonly FlaDisplayListElement[]): boolean {
  return elements.some((element) =>
    element.kind === 'symbol' || (element.kind === 'group' && countNestedSymbols(element.elements)),
  );
}

function frameHasPotentialDisplayElements(frame: FlaXflElementBlock): boolean {
  const elementContainer = directChild(frame.xml, 'DOMFrame', 'elements') ?? frame;
  return getFlaXflDirectChildren(elementContainer.xml, elementContainer.name)
    .some((element) => element.name.startsWith('DOM') && elementIsVisible(element.attributes));
}

/**
 * Catalog eligibility is a bounded structural check across authored spans.
 * It never builds/rasterizes each timeline frame; visible DOM display nodes,
 * including unknown ones, keep the candidate inspectable and fail closed.
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

export interface FlaStaticSnapshotDisplaySourceExecution {
  readonly shouldContinue: () => boolean;
  readonly yieldToEventLoop: () => Promise<void>;
}

function* adaptFlaXflDisplaySourceSteps(
  docXml: string,
  libraryXmlEntries: readonly { readonly name: string; readonly xml: string }[],
): Generator<void, FlaStaticSnapshotDisplaySourceBuildResult, void> {
  const shapeBlocks = new Map<string, string>();
  const state: SourceBuildState = {
    shapeBlocks,
    symbolAliases: { exact: new Map(), basename: new Map() },
    visitedNodeCount: 0,
  };
  const sceneSources = timelineDescriptors(docXml, 'DOMDocument');
  if (!sceneSources.ok) return sceneSources;
  yield;

  const shells: GraphicSymbolShell[] = [];
  for (const library of libraryXmlEntries) {
    yield;
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
  yield;
  const symbols = new Map<string, FlaGraphicSymbolDefinition>();
  const graphicSymbols: FlaXflGraphicSymbolDescriptor[] = [];
  for (const shell of shells) {
    yield;
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
  yield;

  const sceneTimelines: FlaXflTimelineDescriptor[] = [];
  for (const scene of sceneSources.value) {
    yield;
    const parsed = buildFrameContext(scene.xml, 0, `scene:${scene.index}`, state);
    if (!parsed.ok) return parsed;
    sceneTimelines.push({ ...scene, frameContext: parsed.value });
  }
  yield;

  // The prepared source can serve several authored-frame resolutions. Keep
  // each resolution's node budget and shape table scoped to that frame so a
  // reused source behaves like a fresh adapter invocation.
  const baseShapeBlocks = new Map(shapeBlocks);
  const baseVisitedNodeCount = state.visitedNodeCount;
  let frameBuildStateIsBase = true;
  const resetFrameBuildState = (): void => {
    if (frameBuildStateIsBase) return;
    state.visitedNodeCount = baseVisitedNodeCount;
    shapeBlocks.clear();
    for (const [shapeId, xml] of baseShapeBlocks) shapeBlocks.set(shapeId, xml);
    frameBuildStateIsBase = true;
  };

  return {
    ok: true,
    source: {
      stageWidth: parseStageDimension(docXml, 'width', 550),
      stageHeight: parseStageDimension(docXml, 'height', 400),
      sceneTimelines,
      graphicSymbols,
      symbols,
      shapeBlocks,
      resetFrameBuildState,
      buildSceneFrameContext: (timelineXml, frameIndex, scope) => {
        resetFrameBuildState();
        frameBuildStateIsBase = false;
        return buildFrameContext(timelineXml, frameIndex, scope, state);
      },
      buildGraphicFrameContext: (timelineXml, frameSpanIndex, frameIndex, scope) => {
        resetFrameBuildState();
        frameBuildStateIsBase = false;
        return buildGraphicFrameContext(timelineXml, frameSpanIndex, frameIndex, scope, state);
      },
    },
  };
}

export function adaptFlaXflDisplaySource(
  docXml: string,
  libraryXmlEntries: readonly { readonly name: string; readonly xml: string }[],
): FlaStaticSnapshotDisplaySourceBuildResult {
  const steps = adaptFlaXflDisplaySourceSteps(docXml, libraryXmlEntries);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export async function adaptFlaXflDisplaySourceCooperatively(
  docXml: string,
  libraryXmlEntries: readonly { readonly name: string; readonly xml: string }[],
  execution: FlaStaticSnapshotDisplaySourceExecution,
): Promise<FlaStaticSnapshotDisplaySourceBuildResult> {
  const steps = adaptFlaXflDisplaySourceSteps(docXml, libraryXmlEntries);
  while (true) {
    if (!execution.shouldContinue()) {
      return fail('RENDER_FAILED', 'Catalog operation was cancelled');
    }
    const step = steps.next();
    if (step.done) return step.value;
    await execution.yieldToEventLoop();
  }
}
