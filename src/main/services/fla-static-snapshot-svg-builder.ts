/**
 * FLA V2-R1 SVG Builder.
 *
 * R1-B (Issue #287) productize-the-render-path. This module is the
 * privileged-side SVG builder. The Main process calls
 * `buildSvgForRenderTarget(bytes, target)` to obtain a bounded SVG
 * string for a given renderable target, then sends the SVG to a
 * sandboxed BrowserWindow to rasterize into a PNG.
 *
 * The output is the JavaScript source-string the BrowserWindow draws.
 * The BrowserWindow does NOT see the FLA bytes, the parser, the
 * session, the project, or any arbitrary filesystem path. R1-B
 * isolation:
 *
 *   - sandbox = true
 *   - contextIsolation = true
 *   - nodeIntegration = false
 *   - no arbitrary renderer FS / network / ActionScript
 *
 * The edge decoder below follows the accepted command grammar from
 * src/renderer/fla-import/parser-core/edge-decoder.ts at commit
 * 3c47a4ee8af07e834338b223fcb3260a4c6dddbc. Per Issue #691, S1..S7 are
 * validated and ignored as non-rendering selection hints; authored style
 * ownership comes only from Edge attributes. S0 is rejected as unsupported.
 * Main does not read the parser's mutable debug or experimental globals.
 *
 * This module is a pure function on FLA bytes + a target identity.
 * It performs NO filesystem access, NO network access, NO
 * ActionScript execution, and NO Project mutation.
 */

import crypto from 'node:crypto';
import { FLA_GRAPHIC_MAX_FRAMES } from '../../domain/models/animation';
import JSZip from 'jszip';
import { FLA_IMPORT_LIMITS } from '../../shared/fla-import-api';
import type {
  FlaRenderableTargetCatalogRole,
  FlaRenderTarget,
  FlaSourceFrameSuggestion,
  FlaSourceFrameSuggestionQuery,
  FlaStaticSnapshotPreviewErrorCode,
} from '../../shared/fla-static-snapshot-api';
import { FLA_SOURCE_FRAME_SUGGESTION_PAGE_SIZE, FLA_STATIC_SNAPSHOT_LIMITS } from '../../shared/fla-static-snapshot-api';
import {
  finishIssue762Profile,
  startIssue762Profile,
} from '../../shared/issue762-performance-profile';
import type {
  FlaResolvedClipPath,
  FlaResolvedDisplayList,
  FlaResolvedDisplayLayer,
  FlaResolvedDisplayNode,
  FlaDisplayListBlurFilter,
  FlaDisplayListElement,
  FlaDisplayListResolverInput,
} from './fla-display-list-resolver';
import {
  DEFAULT_FLA_DISPLAY_LIST_RESOLVER_LIMITS,
  isValidFlaDisplayListRgbTransform,
  resolveFlaDisplayList,
  type FlaDisplayListResolverResult,
} from './fla-display-list-resolver';
import { prepareFlaNestedGraphicFrameSelections } from './fla-nested-graphic-frame-selector';
import {
  FLA_STATIC_TEXT_LIMITS,
  FLA_STATIC_TEXT_PLACEHOLDER_BASE64,
  countExplicitStaticTextLines,
  layoutFlaStaticText,
  type FlaStaticTextDescriptor,
  type FlaStaticTextGraphicFraming,
  type FlaStaticTextRenderItem,
} from '../../shared/fla-static-text';
import {
  computeBoundedFlaGraphicOutputSize,
  FLA_SNAPSHOT_MAX_WIDTH as MAX_OUTPUT_WIDTH,
  FLA_SNAPSHOT_MAX_HEIGHT as MAX_OUTPUT_HEIGHT,
  FLA_SNAPSHOT_MAX_PIXELS as MAX_OUTPUT_PIXELS,
} from '../../shared/fla-snapshot-output-size';
import {
  buildVariableWidthStrokeOutline,
  type VariableWidthMarker,
} from './fla-variable-width-stroke';
import {
  adaptFlaXflDisplaySource,
  adaptFlaXflDisplaySourceCooperatively,
  getFlaXflDirectChildren,
  type FlaStaticSnapshotDisplaySourceExecution,
  type FlaStaticSnapshotDisplaySource,
} from './fla-static-snapshot-display-list-adapter';

// ---- Limits (subset of FLA_IMPORT_LIMITS used by the R1 SVG builder) ----
const MAX_SOURCE_BYTES = FLA_IMPORT_LIMITS.maxSourceBytes; // 256 MiB
const MAX_XML_BYTES = FLA_IMPORT_LIMITS.maxXmlBytes; // 32 MiB
const MAX_TARGETS = 64;
const MAX_EDGE_CHARS = 64 * 1024 * 1024; // 64 MiB; matches maxSnapshotBytes cap
const MAX_STYLE_ENTRIES_PER_SHAPE = 4_096;
const MAX_STYLE_ENTRIES_PER_COMPOSITION = 32_768;
const MAX_STYLE_RUNS_PER_SHAPE = 16_384;
const MAX_STYLE_SOURCE_CHARS_PER_COMPOSITION = 4 * 1024 * 1024;
const MAX_GRADIENT_STOPS_PER_STYLE = 256;
const MAX_GRADIENT_STOPS_PER_COMPOSITION = 16_384;
const MAX_GRADIENT_DEFINITION_BYTES = 4 * 1024 * 1024;
const LINEAR_GRADIENT_HALF_LENGTH = 819.2;
const RADIAL_GRADIENT_RADIUS = 819.2;
const MAX_PATH_COMMANDS_PER_SHAPE = 1_000_000;
const MAX_PATH_COMMANDS_PER_COMPOSITION = 1_000_000;
const MAX_FILL_BOUNDARY_SEGMENTS_PER_SHAPE = MAX_PATH_COMMANDS_PER_SHAPE * 2;
const MAX_FILL_BOUNDARY_SEGMENTS_PER_COMPOSITION = MAX_PATH_COMMANDS_PER_COMPOSITION * 2;
const MAX_STROKE_SEGMENTS_PER_SHAPE = MAX_PATH_COMMANDS_PER_SHAPE;
const MAX_STROKE_SEGMENTS_PER_COMPOSITION = MAX_PATH_COMMANDS_PER_COMPOSITION;
const GRAPHIC_CONTENT_PADDING = 4;

// ---- Public result types (Panda-owned; never cross the Renderer as raw bytes
//      from the FLA source — the Renderer only ever sees the SVG.) ----
export interface BuildSvgSuccess {
  ok: true;
  svg: string;
  width: number;
  height: number;
  pixelCount: number;
  // The decoded path commands count; useful for R1-F fidelity reporting.
  pathCommandCount: number;
  // The first FillStyle color used (hex). R1-C surfaces fidelity notes
  // in the UX; the renderer does not need to inspect it.
  firstFillColor: string | null;
  // Whether any vector path was emitted; a bitmap-only snapshot can still
  // contain visible content when this is false.
  hasRenderablePath: boolean;
  readonly maskWarning?: string;
  readonly ikPoseWarning?: string;
  /** Bounded classic static text items resolved by the sandboxed snapshot rasterizer. */
  readonly staticTexts?: readonly FlaStaticTextRenderItem[];
  /** Graphic content-framing metadata so the rasterizer can recompute authoritative viewport from real font metrics. */
  readonly graphicFraming?: FlaStaticTextGraphicFraming;
}

export interface BuildSvgFailure {
  ok: false;
  code: FlaStaticSnapshotPreviewErrorCode;
  message: string;
}

export type BuildSvgResult = BuildSvgSuccess | BuildSvgFailure;

export interface BuildCatalogSuccess {
  ok: true;
  // Discoverable authored states. The renderer previews one of these; the
  // commit pins the exact target and selected frame as its source of truth.
  entries: Array<{
    target: FlaRenderTarget;
    catalogRole: FlaRenderableTargetCatalogRole;
    previewSupported: boolean;
    isBlank: boolean;
    unsupportedReason?: string;
  }>;
  omittedCandidateCount: number;
  frameSuggestions?: { items: FlaSourceFrameSuggestion[]; hasMore: boolean };
  // Brief beginner-facing summary, e.g.
  // "这个 FLA 有 1 个可渲染图形。"
  summary: string;
}

export interface BuildCatalogFailure {
  ok: false;
  code: FlaStaticSnapshotPreviewErrorCode;
  message: string;
}

export type BuildCatalogResult = BuildCatalogSuccess | BuildCatalogFailure;

export type FlaStaticSnapshotPreparedDisplaySourceResult =
  | {
      readonly ok: true;
      readonly source: FlaStaticSnapshotDisplaySource;
      readonly xmlByteLength: number;
    }
  | BuildSvgFailure;

// ---- EOCD preflight (re-uses the production EOCD guard; R1 does not
//      implement V1.5-C, so over-declared central directories still
//      reject before jszip is invoked). ----
const EOCD_SIGNATURE = 0x06054b50;
const ZIP_COMMENT_LIMIT = 0xffff;

interface EocdResult {
  eocdFound: boolean;
  centralDirectoryDeclaredBytes: number | null;
  centralDirectoryActualBytes: number | null;
  cdEndsExactlyAtEocd: boolean;
}

function detectEocdDiscrepancy(bytes: Uint8Array): EocdResult {
  const buf = bytes;
  let eocdOffset = -1;
  const maxStart = Math.max(0, bytes.byteLength - 22 - ZIP_COMMENT_LIMIT);
  for (let i = bytes.byteLength - 22; i >= maxStart; i -= 1) {
    if (i + 4 > bytes.byteLength) continue;
    const sig = (buf[i] ?? 0) | ((buf[i + 1] ?? 0) << 8) | ((buf[i + 2] ?? 0) << 16) | ((buf[i + 3] ?? 0) << 24);
    if (sig === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    return { eocdFound: false, centralDirectoryDeclaredBytes: null, centralDirectoryActualBytes: null, cdEndsExactlyAtEocd: false };
  }
  const cdSizeDeclared = (buf[eocdOffset + 12] ?? 0) | ((buf[eocdOffset + 13] ?? 0) << 8) | ((buf[eocdOffset + 14] ?? 0) << 16) | ((buf[eocdOffset + 15] ?? 0) << 24);
  const cdOffsetDeclared = (buf[eocdOffset + 16] ?? 0) | ((buf[eocdOffset + 17] ?? 0) << 8) | ((buf[eocdOffset + 18] ?? 0) << 16) | ((buf[eocdOffset + 19] ?? 0) << 24);
  const eocdRecordSize = 22;
  const centralDirectoryActualBytes = Math.max(0, bytes.byteLength - eocdRecordSize - cdOffsetDeclared);
  return {
    eocdFound: true,
    centralDirectoryDeclaredBytes: cdSizeDeclared,
    centralDirectoryActualBytes,
    cdEndsExactlyAtEocd: cdOffsetDeclared + cdSizeDeclared + eocdRecordSize === bytes.byteLength,
  };
}

// ---- Lightweight ZIP reader (Node has no native ZIP; we do not
//      add a new dep for R1 because the R0 spike already uses jszip
//      and Panda's renderer depends on it transitively). ----

interface ParsedArchive {
  docXml: string;
  libraryXmlEntries: Array<{ name: string; xml: string }>;
  hasActionScript: boolean;
  xmlByteLength: number;
}

async function parseArchive(
  bytes: Uint8Array,
  operation: 'catalog' | 'preview',
  execution?: FlaStaticSnapshotDisplaySourceExecution,
): Promise<{ ok: true; archive: ParsedArchive } | { ok: false; code: FlaStaticSnapshotPreviewErrorCode; message: string }> {
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'FLA source exceeds the byte limit' };
  }
  const eocd = detectEocdDiscrepancy(bytes);
  if (!eocd.eocdFound) {
    return { ok: false, code: 'RENDER_FAILED', message: 'EOCD signature not found' };
  }
  if (eocd.centralDirectoryDeclaredBytes !== null && eocd.centralDirectoryActualBytes !== null &&
      eocd.centralDirectoryDeclaredBytes > eocd.centralDirectoryActualBytes) {
    return { ok: false, code: 'RENDER_FAILED', message: 'EOCD over-declares central directory size' };
  }
  let zip: JSZip;
  const zipStartedAt = startIssue762Profile();
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    return { ok: false, code: 'RENDER_FAILED', message: `Failed to open FLA archive: ${String(error)}` };
  }
  finishIssue762Profile(`fla.${operation}.zip-open`, zipStartedAt, {
    sourceByteLength: bytes.byteLength,
  });
  const names = Object.keys(zip.files);
  const docDocEntry = zip.file('DOMDocument.xml');
  if (!docDocEntry) {
    return { ok: false, code: 'RENDER_FAILED', message: 'FLA has no DOMDocument.xml' };
  }
  const xmlExtractionStartedAt = startIssue762Profile();
  const docXml = await docDocEntry.async('string');
  if (execution && !execution.shouldContinue()) {
    return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
  }
  if (docXml.length > MAX_XML_BYTES) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'DOMDocument.xml too large' };
  }
  const libraryXmlEntries: Array<{ name: string; xml: string }> = [];
  let hasActionScript = false;
  for (const name of names) {
    if (!/^LIBRARY\//i.test(name) || !/\.xml$/i.test(name)) continue;
    const entry = zip.files[name];
    if (!entry) continue;
    const xml = await entry.async('string');
    if (execution && !execution.shouldContinue()) {
      return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
    }
    if (xml.length > MAX_XML_BYTES) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: `LIBRARY entry too large: ${name}` };
    }
    libraryXmlEntries.push({ name, xml });
    if (/<Script\b/.test(xml) || /<DOMScript\b/.test(xml) || /actionscript|doabc/iu.test(xml)) {
      hasActionScript = true;
    }
    if (execution) {
      await execution.yieldToEventLoop();
      if (!execution.shouldContinue()) {
        return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
      }
    }
  }
  if (/<Script\b/.test(docXml) || /<DOMScript\b/.test(docXml)) {
    hasActionScript = true;
  }
  const xmlByteLength = Buffer.byteLength(docXml, 'utf8') + libraryXmlEntries.reduce(
    (total, entry) => total + Buffer.byteLength(entry.xml, 'utf8'),
    0,
  );
  finishIssue762Profile(`fla.${operation}.xml-extract`, xmlExtractionStartedAt, {
    libraryXmlEntryCount: libraryXmlEntries.length,
    sourceEntryCount: names.length,
    xmlByteLength,
  });
  return { ok: true, archive: { docXml, libraryXmlEntries, hasActionScript, xmlByteLength } };
}

// ---- Balanced-block extractor (mirrors tests/helpers/fla-structural-probe.ts) ----
function nextTagIndex(xml: string, tag: string, from: number): number {
  const needle = '<' + tag;
  let i = from;
  for (;;) {
    const idx = xml.indexOf(needle, i);
    if (idx === -1) return -1;
    if (idx === 0 || xml[idx - 1] !== '/') return idx;
    i = idx + needle.length;
  }
}

function extractBalancedBlocks(xml: string, tag: string): string[] {
  const close = '</' + tag + '>';
  const blocks: string[] = [];
  const openStack: number[] = [];
  let i = 0;
  for (;;) {
    const oi = nextTagIndex(xml, tag, i);
    const ci = xml.indexOf(close, i);
    if (oi === -1 && ci === -1) break;
    if (ci !== -1 && (oi === -1 || ci < oi)) {
      const start = openStack.pop();
      if (start !== undefined) blocks.push(xml.slice(start, ci + close.length));
      i = ci + close.length;
    } else if (oi !== -1) {
      openStack.push(oi);
      i = oi + tag.length + 1;
    } else {
      break;
    }
  }
  return blocks;
}

function extractSelfClosingTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*\\/>`, 'g');
  return xml.match(re) ?? [];
}

// ---- Main-local bounded edge decoder based on the pinned parser grammar ----
const COORD_SCALE = 20;
function decodeCoord(value: string): number {
  if (value.startsWith('#')) {
    const hex = value.substring(1);
    const dotIndex = hex.indexOf('.');
    let intHex: string;
    let fracHex: string | null = null;
    if (dotIndex !== -1) {
      intHex = hex.substring(0, dotIndex);
      fracHex = hex.substring(dotIndex + 1);
    } else {
      intHex = hex;
    }
    if (intHex.length === 0) intHex = '0';
    const intPart = parseInt(intHex, 16);
    if (Number.isNaN(intPart)) return NaN;
    const numChars = intHex.length;
    let signed = intPart;
    if (numChars >= 6) {
      const bitWidth = numChars * 4;
      const signBit = 1 << (bitWidth - 1);
      if (signed >= signBit) signed = signed - (1 << bitWidth);
    }
    let fracPart = 0;
    if (fracHex && fracHex.length > 0) {
      const fracValue = parseInt(fracHex, 16);
      if (!Number.isNaN(fracValue)) {
        const fracBits = fracHex.length * 4;
        fracPart = fracValue / (1 << fracBits);
      }
    }
    // The integer part carries the sign; the fractional magnitude is unsigned.
    return (signed + fracPart) / COORD_SCALE;
  }
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return NaN;
  return parsed / COORD_SCALE;
}

const EDGE_COMMAND_TOKENS = new Set(['!', '|', '[', '/', 'S', 'q', 'Q', '(;', ');', '(', ')', ';']);

function isCoordinateToken(value: string): boolean {
  if (value.startsWith('#')) {
    return /^#(?:[0-9a-f]+(?:\.[0-9a-f]*)?|\.[0-9a-f]+)$/iu.test(value);
  }
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value);
}

function tokenize(edgeStr: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let i = 0;
  const isCommandChar = (c: string): boolean =>
    c === '!' || c === '|' || c === '[' || c === '/' || c === 'S' || c === 'q' || c === 'Q';
  while (i < edgeStr.length) {
    const char = edgeStr[i] as string;
    if (char === '(' && i + 1 < edgeStr.length && edgeStr[i + 1] === ';') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push('(;');
      current = '';
      i += 2;
      continue;
    }
    if (char === ')' && i + 1 < edgeStr.length && edgeStr[i + 1] === ';') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(');');
      current = '';
      i += 2;
      continue;
    }
    if (char === '(') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push('(');
      current = '';
      i++;
      continue;
    }
    if (char === ')') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(')');
      current = '';
      i++;
      continue;
    }
    if (char === ';') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(';');
      current = '';
      i++;
      continue;
    }
    if (isCommandChar(char)) {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(char);
      current = '';
      i++;
      continue;
    }
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      if (current.trim()) tokens.push(current.trim());
      current = '';
      i++;
      continue;
    }
    if (char === ',') {
      if (current.trim()) tokens.push(current.trim());
      current = '';
      i++;
      continue;
    }
    current += char;
    i++;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

interface DecodedStyleChange {
  readonly commandIndex: number;
  readonly fillStyle1: number;
}

interface DecodedEdges {
  commands: Array<
    | { type: 'M'; x: number; y: number }
    | { type: 'L'; x: number; y: number }
    | { type: 'Q'; cx: number; cy: number; x: number; y: number }
    | { type: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
    | { type: 'Z' }
  >;
  styleChanges: DecodedStyleChange[];
  error: string | null;
}

function decodeEdgesWithStyleChanges(edgeStr: string): DecodedEdges {
  const commands: DecodedEdges['commands'] = [];
  const styleChanges: DecodedStyleChange[] = [];
  let error: string | null = null;
  const pushCommand = (command: DecodedEdges['commands'][number]): void => {
    if (commands.length >= MAX_PATH_COMMANDS_PER_SHAPE) {
      error ??= 'Shape path-command budget exceeded';
      return;
    }
    commands.push(command);
  };
  const tokens = tokenize(edgeStr);
  let i = 0;
  let currentX = NaN;
  let currentY = NaN;
  let startX = NaN;
  let startY = NaN;
  const MAX_COORD = 200_000;
  while (i < tokens.length && !error) {
    const token = tokens[i] as string;
    switch (token) {
      case '!': {
        if (i + 2 < tokens.length) {
          const x = decodeCoord(tokens[i + 1] as string);
          const y = decodeCoord(tokens[i + 2] as string);
          if (!Number.isFinite(x) || !Number.isFinite(y) ||
              Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) { i += 3; break; }
          // Preserve authored subpath boundaries; a visual epsilon changes topology.
          if (Number.isNaN(currentX) || Number.isNaN(startX) || x !== currentX || y !== currentY) {
            pushCommand({ type: 'M', x, y });
            startX = x; startY = y;
          }
          currentX = x; currentY = y;
          i += 3;
        } else { i++; }
        break;
      }
      case '|': {
        if (i + 2 < tokens.length) {
          const x = decodeCoord(tokens[i + 1] as string);
          const y = decodeCoord(tokens[i + 2] as string);
          if (!Number.isFinite(x) || !Number.isFinite(y) ||
              Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) { i += 3; break; }
          // Keep every non-zero authored line even when its rendered length is tiny.
          if (!Number.isNaN(currentX) && (x !== currentX || y !== currentY)) {
            pushCommand({ type: 'L', x, y });
            currentX = x; currentY = y;
          }
          i += 3;
        } else { i++; }
        break;
      }
      case '[': {
        if (i + 4 < tokens.length) {
          const cx = decodeCoord(tokens[i + 1] as string);
          const cy = decodeCoord(tokens[i + 2] as string);
          const x = decodeCoord(tokens[i + 3] as string);
          const y = decodeCoord(tokens[i + 4] as string);
          if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(x) || !Number.isFinite(y) ||
              Math.abs(cx) > MAX_COORD || Math.abs(cy) > MAX_COORD ||
              Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) { i += 5; break; }
          pushCommand({ type: 'Q', cx, cy, x, y });
          currentX = x; currentY = y;
          i += 5;
        } else { i++; }
        break;
      }
      case '(;': {
        i++;
        while (i < tokens.length && !error && tokens[i] !== 'q' && tokens[i] !== 'Q' &&
               tokens[i] !== ');' && tokens[i] !== ')') {
          if (i + 5 < tokens.length) {
            const next = [tokens[i], tokens[i+1], tokens[i+2], tokens[i+3], tokens[i+4], tokens[i+5]];
            const allCoords = next.every(t => !['!', '|', '[', '/', 'S', 'q', 'Q', '(;', ');', '(', ')', ';'].includes(t as string));
            if (allCoords) {
              const c1x = decodeCoord(tokens[i] as string);
              const c1y = decodeCoord(tokens[i+1] as string);
              const c2x = decodeCoord(tokens[i+2] as string);
              const c2y = decodeCoord(tokens[i+3] as string);
              const x = decodeCoord(tokens[i+4] as string);
              const y = decodeCoord(tokens[i+5] as string);
              if ([c1x,c1y,c2x,c2y,x,y].some(c => !Number.isFinite(c) || Math.abs(c) > MAX_COORD)) { i += 6; continue; }
              pushCommand({ type: 'C', c1x, c1y, c2x, c2y, x, y });
              currentX = x; currentY = y;
              i += 6;
            } else break;
          } else break;
        }
        break;
      }
      case '(': {
        i++;
        while (i < tokens.length && !error && tokens[i] !== ';') i++;
        if (i < tokens.length && tokens[i] === ';') i++;
        while (i < tokens.length && !error && tokens[i] !== 'q' && tokens[i] !== 'Q' &&
               tokens[i] !== ');' && tokens[i] !== ')') {
          if (i + 5 < tokens.length) {
            const next = [tokens[i], tokens[i+1], tokens[i+2], tokens[i+3], tokens[i+4], tokens[i+5]];
            const allCoords = next.every(t => !['!', '|', '[', '/', 'S', 'q', 'Q', '(;', ');', '(', ')', ';'].includes(t as string));
            if (allCoords) {
              const c1x = decodeCoord(tokens[i] as string);
              const c1y = decodeCoord(tokens[i+1] as string);
              const c2x = decodeCoord(tokens[i+2] as string);
              const c2y = decodeCoord(tokens[i+3] as string);
              const x = decodeCoord(tokens[i+4] as string);
              const y = decodeCoord(tokens[i+5] as string);
              if ([c1x,c1y,c2x,c2y,x,y].some(c => !Number.isFinite(c) || Math.abs(c) > MAX_COORD)) { i += 6; continue; }
              pushCommand({ type: 'C', c1x, c1y, c2x, c2y, x, y });
              currentX = x; currentY = y;
              i += 6;
            } else break;
          } else break;
        }
        break;
      }
      case ';': i++; break;
      case 'q':
      case 'Q': {
        i++;
        while (i < tokens.length && !error && tokens[i] !== ');' && tokens[i] !== ')' &&
               tokens[i] !== '!' && tokens[i] !== '|' && tokens[i] !== '[') i++;
        break;
      }
      case ');':
      case ')': i++; break;
      case 'S': {
        if (i + 1 < tokens.length) {
          const selectionToken = tokens[i + 1] as string;
          if (!/^\d+$/u.test(selectionToken)) {
            error ??= 'Malformed mid-edge selection marker';
            i += 2;
            break;
          }
          const selectionMask = Number(selectionToken);
          if (!Number.isSafeInteger(selectionMask) || selectionMask < 1 || selectionMask > 7) {
            error ??= selectionMask === 0
              ? 'Unsupported S0 edge marker'
              : 'Unsupported mid-edge selection marker';
            i += 2;
            break;
          }
          // Selection hints do not change authored Edge style ownership or rendering.
          i += 2;
        } else {
          error ??= 'Malformed mid-edge selection marker';
          i++;
        }
        break;
      }
      case '/': {
        const xToken = tokens[i + 1];
        const yToken = tokens[i + 2];
        const nextToken = tokens[i + 3];
        if (!xToken || EDGE_COMMAND_TOKENS.has(xToken)) {
          error ??= 'Unsupported bare slash command';
          i++;
          break;
        }
        if (!yToken || EDGE_COMMAND_TOKENS.has(yToken) ||
            !isCoordinateToken(xToken) || !isCoordinateToken(yToken) ||
            (nextToken !== undefined && !EDGE_COMMAND_TOKENS.has(nextToken))) {
          error ??= 'Malformed coordinate-bearing slash command';
          i++;
          break;
        }
        const x = decodeCoord(xToken);
        const y = decodeCoord(yToken);
        if (!Number.isFinite(x) || !Number.isFinite(y) ||
            Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD ||
            Number.isNaN(currentX) || Number.isNaN(currentY) ||
            Number.isNaN(startX) || Number.isNaN(startY)) {
          error ??= 'Malformed coordinate-bearing slash command';
          i++;
          break;
        }
        // Coordinate-bearing slash records are authored straight Lines. Keep
        // the active subpath and pass non-zero geometry through the same path
        // command budget as the ordinary line operator.
        if (x !== currentX || y !== currentY) {
          pushCommand({ type: 'L', x, y });
          currentX = x;
          currentY = y;
        }
        i += 3;
        break;
      }
      default: i++;
    }
  }
  // Exact endpoint equality adds no geometry; near-equality must stay open.
  if (!error && currentX === startX && currentY === startY) {
    const last = commands[commands.length - 1];
    if (last && last.type !== 'Z') pushCommand({ type: 'Z' });
  }
  return { commands, styleChanges, error };
}

function commandsToSvgPath(commands: DecodedEdges['commands']): string {
  const parts: string[] = [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': parts.push(`M ${cmd.x.toFixed(4)} ${cmd.y.toFixed(4)}`); break;
      case 'L': parts.push(`L ${cmd.x.toFixed(4)} ${cmd.y.toFixed(4)}`); break;
      case 'Q': parts.push(`Q ${cmd.cx.toFixed(4)} ${cmd.cy.toFixed(4)} ${cmd.x.toFixed(4)} ${cmd.y.toFixed(4)}`); break;
      case 'C': parts.push(`C ${cmd.c1x.toFixed(4)} ${cmd.c1y.toFixed(4)} ${cmd.c2x.toFixed(4)} ${cmd.c2y.toFixed(4)} ${cmd.x.toFixed(4)} ${cmd.y.toFixed(4)}`); break;
      case 'Z': parts.push('Z'); break;
    }
  }
  return parts.join(' ');
}

interface ShapeParseIssue {
  readonly code: 'RENDER_FAILED' | 'BUDGET_EXCEEDED';
  readonly message: string;
}

interface ParsedShapeStyle {
  readonly index: number;
  readonly type: string;
  readonly color: string | null;
  readonly alpha: number | null;
  /** Retained only in Main; source style XML is never forwarded to the sandbox. */
  readonly sourceXml: string;
}

interface EdgeStyleReferences {
  readonly fillStyle0: number | null;
  readonly fillStyle1: number | null;
  readonly strokeStyle: number | null;
}

interface ParsedShapeEdge extends EdgeStyleReferences {
  readonly cubics: string;
  readonly edges: string;
}

function attributeFromElement(block: string, tag: string, attribute: string): string | null {
  const openTag = block.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0];
  if (!openTag) return null;
  return xmlAttributes(openTag)?.[attribute] ?? null;
}

function parseNonNegativeInteger(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseShapeStyle(block: string, tag: 'FillStyle' | 'StrokeStyle'): ParsedShapeStyle | ShapeParseIssue {
  const rawIndex = attributeFromElement(block, tag, 'index');
  const index = rawIndex === null ? 1 : parseNonNegativeInteger(rawIndex);
  if (index === null) {
    return { code: 'RENDER_FAILED', message: `Malformed ${tag} index` };
  }

  const explicitType = attributeFromElement(block, tag, 'type');
  const type = explicitType ?? (
    /<RadialGradient\b/u.test(block) ? 'radial' :
    /<LinearGradient\b/u.test(block) ? 'linear' :
    /<(?:BitmapFill|ClippedBitmapFill)\b/u.test(block) ? 'bitmap' :
    'solid'
  );
  const colorBlock = block.match(/<(?:SolidColor|GradientEntry)\b[^>]*>/u)?.[0];
  const rawColor = colorBlock?.match(/\bcolor="([^"]*)"/u)?.[1] ?? null;
  const color = rawColor === null && tag === 'FillStyle' && type === 'solid' && /<SolidColor\b/u.test(block)
    ? '#000000'
    : rawColor;
  const rawAlpha = colorBlock?.match(/\balpha="([^"]*)"/u)?.[1] ?? null;
  const parsedAlpha = rawAlpha === null ? null : Number(rawAlpha);
  return {
    index,
    type,
    color,
    alpha: parsedAlpha !== null && Number.isFinite(parsedAlpha) ? parsedAlpha : null,
    sourceXml: block,
  };
}

interface Matrix2D { a: number; b: number; c: number; d: number; tx: number; ty: number; }

function matrixToSvgTransform(m: Matrix2D): string {
  return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.tx} ${m.ty})`;
}

interface ParsedShape {
  readonly matrix: Matrix2D | null;
  readonly fillStyles: readonly ParsedShapeStyle[];
  readonly strokeStyles: readonly ParsedShapeStyle[];
  readonly edgeStrings: readonly ParsedShapeEdge[];
  readonly issue: ShapeParseIssue | null;
}

function parseShapeAt(block: string): ParsedShape {
  const fillStyles: ParsedShapeStyle[] = [];
  const strokeStyles: ParsedShapeStyle[] = [];
  const edgeStrings: ParsedShapeEdge[] = [];
  let issue: ShapeParseIssue | null = null;
  let matrix: Matrix2D | null = null;
  const result = (): ParsedShape => ({ matrix, fillStyles, strokeStyles, edgeStrings, issue });
  const matrixBlock = extractBalancedBlocks(block, 'matrix')[0];
  if (matrixBlock) {
    const m = matrixBlock.match(/<Matrix\b([^/>]*)\/?>/);
    if (m) {
      const attrs = m[1] as string;
      const get = (k: string): number => {
        const x = attrs.match(new RegExp('\\b' + k + '="([^"]*)"'));
        return x ? Number(x[1]) : 0;
      };
      matrix = { a: get('a'), b: get('b'), c: get('c'), d: get('d'), tx: get('tx'), ty: get('ty') };
    }
  }
  const fillsBlock = extractBalancedBlocks(block, 'fills')[0];
  if (fillsBlock) {
    const fillStyleBlocks = extractBalancedBlocks(fillsBlock, 'FillStyle');
    if (fillStyleBlocks.length > MAX_STYLE_ENTRIES_PER_SHAPE) {
      issue = { code: 'BUDGET_EXCEEDED', message: 'Shape fill-style entry budget exceeded' };
      return result();
    }
    for (const styleBlock of fillStyleBlocks) {
      const style = parseShapeStyle(styleBlock, 'FillStyle');
      if ('code' in style) {
        issue = style;
        return result();
      }
      if (fillStyles.some((entry) => entry.index === style.index)) {
        issue = { code: 'RENDER_FAILED', message: `Duplicate FillStyle index: ${style.index}` };
        return result();
      }
      fillStyles.push(style);
    }
  }
  const strokesBlock = extractBalancedBlocks(block, 'strokes')[0];
  if (strokesBlock) {
    const strokeStyleBlocks = extractBalancedBlocks(strokesBlock, 'StrokeStyle');
    if (strokeStyleBlocks.length > MAX_STYLE_ENTRIES_PER_SHAPE) {
      issue = { code: 'BUDGET_EXCEEDED', message: 'Shape stroke-style entry budget exceeded' };
      return result();
    }
    for (const styleBlock of strokeStyleBlocks) {
      const style = parseShapeStyle(styleBlock, 'StrokeStyle');
      if ('code' in style) {
        issue = style;
        return result();
      }
      if (strokeStyles.some((entry) => entry.index === style.index)) {
        issue = { code: 'RENDER_FAILED', message: `Duplicate StrokeStyle index: ${style.index}` };
        return result();
      }
      strokeStyles.push(style);
    }
  }
  if (fillStyles.length + strokeStyles.length > MAX_STYLE_ENTRIES_PER_SHAPE) {
    issue = { code: 'BUDGET_EXCEEDED', message: 'Shape style-entry budget exceeded' };
    return result();
  }
  const edgesBlock = extractBalancedBlocks(block, 'edges')[0];
  if (edgesBlock) {
    const edgeBlocks = extractSelfClosingTags(edgesBlock, 'Edge');
    for (const eb of edgeBlocks) {
      const cubics = ((eb.match(/\bcubics="([^"]*)"/) ?? ['', ''])[1]) as string;
      const edges = ((eb.match(/\bedges="([^"]*)"/) ?? ['', ''])[1]) as string;
      const refs: Record<keyof EdgeStyleReferences, number | null> = {
        fillStyle0: null,
        fillStyle1: null,
        strokeStyle: null,
      };
      for (const name of ['fillStyle0', 'fillStyle1', 'strokeStyle'] as const) {
        const raw = attributeFromElement(eb, 'Edge', name);
        if (raw === null) continue;
        const parsed = parseNonNegativeInteger(raw);
        if (parsed === null) {
          issue = { code: 'RENDER_FAILED', message: `Malformed Edge ${name} reference` };
          return result();
        }
        refs[name] = parsed === 0 ? null : parsed;
      }
      edgeStrings.push({ cubics, edges, ...refs });
    }
  }
  return result();
}

interface ShapeStyleRun extends EdgeStyleReferences {
  readonly edgeIndex: number;
  readonly commandStart: number;
  readonly commandEnd: number;
  readonly commands: readonly DecodedEdges['commands'][number][];
}

interface RetainedStyleChange {
  readonly edgeIndex: number;
  readonly commandIndex: number;
  readonly fillStyle1: number | null;
}

interface StyleAwareShapeRepresentation {
  readonly fillStyles: readonly ParsedShapeStyle[];
  readonly strokeStyles: readonly ParsedShapeStyle[];
  readonly edgeReferences: readonly EdgeStyleReferences[];
  readonly commands: DecodedEdges['commands'];
  readonly styleRuns: readonly ShapeStyleRun[];
  readonly styleChanges: readonly RetainedStyleChange[];
  readonly styleSourceChars: number;
}

function buildStyleAwareShapeRepresentation(
  shape: ParsedShape,
  shapeId: string,
): { readonly ok: true; readonly representation: StyleAwareShapeRepresentation } | BuildSvgFailure {
  if (shape.issue) {
    return { ok: false, code: shape.issue.code, message: `Shape ${shapeId}: ${shape.issue.message}` };
  }
  const fillStyles = new Map(shape.fillStyles.map((style) => [style.index, style]));
  const strokeStyles = new Map(shape.strokeStyles.map((style) => [style.index, style]));
  const commands: DecodedEdges['commands'] = [];
  const styleRuns: ShapeStyleRun[] = [];
  const styleChanges: RetainedStyleChange[] = [];
  const edgeReferences: EdgeStyleReferences[] = [];
  const styleSourceChars = [...shape.fillStyles, ...shape.strokeStyles]
    .reduce((total, style) => total + style.sourceXml.length, 0);
  if (styleSourceChars > MAX_STYLE_SOURCE_CHARS_PER_COMPOSITION) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Shape style-source budget exceeded' };
  }

  for (let edgeIndex = 0; edgeIndex < shape.edgeStrings.length; edgeIndex += 1) {
    const edge = shape.edgeStrings[edgeIndex];
    if (!edge) continue;
    edgeReferences.push({
      fillStyle0: edge.fillStyle0,
      fillStyle1: edge.fillStyle1,
      strokeStyle: edge.strokeStyle,
    });
    for (const [name, index, styles] of [
      ['fillStyle0', edge.fillStyle0, fillStyles],
      ['fillStyle1', edge.fillStyle1, fillStyles],
      ['strokeStyle', edge.strokeStyle, strokeStyles],
    ] as const) {
      if (index !== null && !styles.has(index)) {
        return {
          ok: false,
          code: 'RENDER_FAILED',
          message: `Shape ${shapeId} Edge ${edgeIndex} references missing ${name} ${index}`,
        };
      }
    }
    const encodedEdges = edge.cubics || edge.edges;
    if (encodedEdges.length > MAX_EDGE_CHARS) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: `Edge attribute exceeds ${MAX_EDGE_CHARS} chars` };
    }
    const decoded = decodeEdgesWithStyleChanges(encodedEdges);
    if (decoded.error) {
      const code = decoded.error.includes('budget') ? 'BUDGET_EXCEEDED' : 'RENDER_FAILED';
      return { ok: false, code, message: `Shape ${shapeId}: ${decoded.error}` };
    }
    for (const change of decoded.styleChanges) {
      if (change.fillStyle1 !== 0 && !fillStyles.has(change.fillStyle1)) {
        return {
          ok: false,
          code: 'RENDER_FAILED',
          message: `Shape ${shapeId} Edge ${edgeIndex} mid-edge change references missing fillStyle1 ${change.fillStyle1}`,
        };
      }
      if (styleChanges.length >= MAX_STYLE_RUNS_PER_SHAPE) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Shape style-run budget exceeded' };
      }
      styleChanges.push({
        edgeIndex,
        commandIndex: change.commandIndex,
        fillStyle1: change.fillStyle1 === 0 ? null : change.fillStyle1,
      });
    }

    const commandOffset = commands.length;
    if (commandOffset + decoded.commands.length > MAX_PATH_COMMANDS_PER_SHAPE) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Shape path-command budget exceeded' };
    }
    commands.push(...decoded.commands);
    let currentRefs: EdgeStyleReferences = {
      fillStyle0: edge.fillStyle0,
      fillStyle1: edge.fillStyle1,
      strokeStyle: edge.strokeStyle,
    };
    let runStart = 0;
    let runBudgetExceeded = false;
    const appendRun = (start: number, end: number): void => {
      if (end <= start || runBudgetExceeded) return;
      if (styleRuns.length >= MAX_STYLE_RUNS_PER_SHAPE) {
        runBudgetExceeded = true;
        return;
      }
      const runCommands = decoded.commands.slice(start, end);
      styleRuns.push({
        edgeIndex,
        commandStart: commandOffset + start,
        commandEnd: commandOffset + end,
        commands: runCommands,
        ...currentRefs,
      });
    };
    for (const change of decoded.styleChanges) {
      appendRun(runStart, change.commandIndex);
      if (runBudgetExceeded) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Shape style-run budget exceeded' };
      }
      currentRefs = {
        ...currentRefs,
        fillStyle1: change.fillStyle1 === 0 ? null : change.fillStyle1,
      };
      runStart = change.commandIndex;
    }
    appendRun(runStart, decoded.commands.length);
    if (runBudgetExceeded) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Shape style-run budget exceeded' };
    }
  }

  return {
    ok: true,
    representation: {
      fillStyles: shape.fillStyles,
      strokeStyles: shape.strokeStyles,
      edgeReferences,
      commands,
      styleRuns,
      styleChanges,
      styleSourceChars,
    },
  };
}

type FillDrawCommand = Extract<DecodedEdges['commands'][number], { type: 'L' | 'Q' | 'C' }>;

interface FillBoundarySegment {
  readonly from: Point2D;
  readonly to: Point2D;
  readonly command: FillDrawCommand;
  readonly order: number;
}

interface ReconstructedFillPaint {
  readonly svgPaint: string;
  readonly firstColor: string;
  readonly opacity: number;
  readonly gradientType: 'linear' | 'radial' | null;
  readonly gradientId: string | null;
  readonly gradientDefinition: string | null;
  readonly gradientStopCount: number;
}

interface BitmapFillPaint {
  readonly bitmapPath: string;
  readonly matrix: Matrix2D;
  readonly clipped: boolean;
  readonly smoothing: boolean;
}

function parseBitmapFillPaint(
  style: ParsedShapeStyle,
  shapeId: string,
): { readonly ok: true; readonly paint: BitmapFillPaint } | BuildSvgFailure {
  const invalid = (reason: string): BuildSvgFailure => ({
    ok: false, code: 'RENDER_FAILED', message: `Shape ${shapeId} FillStyle ${style.index} bitmap fill ${reason}`,
  });
  const children = getFlaXflDirectChildren(style.sourceXml, 'FillStyle');
  const fill = children[0];
  if (children.length !== 1 || (fill?.name !== 'BitmapFill' && fill?.name !== 'ClippedBitmapFill')) {
    return invalid('has invalid paint markup');
  }
  const { bitmapPath, bitmapIsClipped, allowSmoothing } = fill.attributes;
  if (!bitmapPath?.trim() || bitmapPath.includes('\0')) return invalid('has no valid bitmapPath');
  const wrappers = getFlaXflDirectChildren(fill.xml, fill.name);
  let matrix: Matrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  if (wrappers.length > 0) {
    const wrapper = wrappers[0]!;
    const values = getFlaXflDirectChildren(wrapper.xml, 'matrix');
    const value = values[0];
    if (wrappers.length !== 1 || wrapper.name !== 'matrix' || values.length !== 1 ||
        value?.name !== 'Matrix' || getFlaXflDirectChildren(value.xml, 'Matrix').length !== 0 ||
        Object.entries(value.attributes).some(([name, raw]) =>
          !Object.hasOwn(matrix, name) || !raw.trim() || !Number.isFinite(Number(raw)))) {
      return invalid('has an invalid matrix');
    }
    // XFL encodes the linear coefficients as twips per bitmap pixel.
    // Translation is already in shape-local pixels (verified on C-real).
    const attrs = value.attributes;
    matrix = {
      a: Number(attrs.a ?? 1) / COORD_SCALE,
      b: Number(attrs.b ?? 0) / COORD_SCALE,
      c: Number(attrs.c ?? 0) / COORD_SCALE,
      d: Number(attrs.d ?? 1) / COORD_SCALE,
      tx: Number(attrs.tx ?? 0),
      ty: Number(attrs.ty ?? 0),
    };
  }
  return {
    ok: true,
    paint: { bitmapPath, matrix, clipped: fill.name === 'ClippedBitmapFill' || bitmapIsClipped === 'true',
      smoothing: allowSmoothing !== 'false' },
  };
}

interface ReconstructedFill {
  readonly style: ParsedShapeStyle;
  readonly paint: ReconstructedFillPaint | BitmapFillPaint;
  readonly pathD: string;
  readonly contourCount: number;
  readonly boundarySegmentCount: number;
}

interface ReconstructedFills {
  readonly fills: readonly ReconstructedFill[];
  readonly contourCount: number;
  readonly boundarySegmentCount: number;
}

function parseLinearGradientPaint(
  style: ParsedShapeStyle,
  shapeId: string,
  renderTargetId: string,
  frameIndex: number,
  styleKind: 'FillStyle' | 'StrokeStyle' = 'FillStyle',
): { readonly ok: true; readonly paint: ReconstructedFillPaint } | BuildSvgFailure {
  const fail = (code: BuildSvgFailure['code'], message: string): BuildSvgFailure => ({
    ok: false,
    code,
    message: `Shape ${shapeId} ${styleKind} ${style.index} ${message}`,
  });
  const gradientBlocks = extractBalancedBlocks(style.sourceXml, 'LinearGradient');
  if (gradientBlocks.length !== 1) {
    return fail('RENDER_FAILED', 'has a malformed LinearGradient definition');
  }
  const gradientBlock = gradientBlocks[0] as string;
  const rawStopCount = (gradientBlock.match(/<GradientEntry\b/gu) ?? []).length;
  if (rawStopCount > MAX_GRADIENT_STOPS_PER_STYLE) {
    return fail('BUDGET_EXCEEDED', 'exceeds the per-style gradient-stop budget');
  }
  const stopTags = extractSelfClosingTags(gradientBlock, 'GradientEntry');
  if (stopTags.length !== rawStopCount) {
    return fail('RENDER_FAILED', 'has malformed or missing GradientEntry stops');
  }
  if (stopTags.length < 2) {
    return fail('RENDER_FAILED', 'has insufficient GradientEntry stops; at least two are required');
  }
  const stops: Array<{ readonly color: string; readonly alpha: number; readonly ratio: number }> = [];
  let previousRatio = -1;
  for (const stopTag of stopTags) {
    const color = attributeFromElement(stopTag, 'GradientEntry', 'color') ?? '#000000';
    const rawAlpha = attributeFromElement(stopTag, 'GradientEntry', 'alpha');
    const rawRatio = attributeFromElement(stopTag, 'GradientEntry', 'ratio');
    const alphaText = rawAlpha ?? '1';
    const ratioText = rawRatio ?? '0';
    const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
    const alpha = numericPattern.test(alphaText) ? Number(alphaText) : Number.NaN;
    const ratio = numericPattern.test(ratioText) ? Number(ratioText) : Number.NaN;
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(color)) {
      return fail('RENDER_FAILED', 'has an invalid gradient stop color');
    }
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      return fail('RENDER_FAILED', 'has an invalid gradient stop alpha');
    }
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1 || ratio < previousRatio) {
      return fail('RENDER_FAILED', 'has an invalid or out-of-order gradient stop ratio');
    }
    stops.push({ color, alpha, ratio });
    previousRatio = ratio;
  }

  const spreadMethod = attributeFromElement(gradientBlock, 'LinearGradient', 'spreadMethod') ?? 'pad';
  if (spreadMethod !== 'pad' && spreadMethod !== 'reflect' && spreadMethod !== 'repeat') {
    return fail('TARGET_UNSUPPORTED', `uses unsupported spread method "${spreadMethod}"`);
  }
  const interpolationMethod = attributeFromElement(gradientBlock, 'LinearGradient', 'interpolationMethod') ?? 'rgb';
  if (interpolationMethod !== 'rgb' && interpolationMethod !== 'linearRGB') {
    return fail('TARGET_UNSUPPORTED', `uses unsupported interpolation method "${interpolationMethod}"`);
  }

  const matrixWrapperCount = (gradientBlock.match(/<matrix\b/gu) ?? []).length;
  const matrixBlocks = extractBalancedBlocks(gradientBlock, 'matrix');
  const matrixTagCount = (gradientBlock.match(/<Matrix\b/gu) ?? []).length;
  if (matrixWrapperCount !== 1 || matrixBlocks.length !== 1 || matrixTagCount !== 1) {
    return fail('RENDER_FAILED', 'has a malformed or missing gradient matrix');
  }
  const matrixTags = (matrixBlocks[0] as string).match(/<Matrix\b[^>]*\/?\s*>/gu) ?? [];
  if (matrixTags.length !== 1) return fail('RENDER_FAILED', 'has a malformed gradient matrix');
  const matrixTag = matrixTags[0] as string;
  const matrix: Matrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const values: Record<keyof Matrix2D, number> = {
    a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0,
  };
  for (const key of Object.keys(values) as Array<keyof Matrix2D>) {
    const raw = attributeFromElement(matrixTag, 'Matrix', key);
    if (raw === null) continue;
    const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
    const value = numericPattern.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
      return fail('RENDER_FAILED', 'has an invalid gradient matrix value');
    }
    values[key] = value;
  }
  Object.assign(matrix, values);

  const gradientId = `fla-linear-${crypto.createHash('sha256')
    .update(JSON.stringify([renderTargetId, frameIndex, shapeId, style.index, style.sourceXml]), 'utf8')
    .digest('hex')}`;
  const firstColor = stops[0]?.color;
  if (!firstColor) return fail('RENDER_FAILED', 'has no usable gradient stop');
  const stopNodes = stops.map((stop) =>
    `<stop offset="${String(stop.ratio)}" stop-color="${stop.color}" stop-opacity="${String(stop.alpha)}"/>`,
  ).join('');
  const interpolation = interpolationMethod === 'linearRGB' ? 'linearRGB' : 'sRGB';
  const definition = `<linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="-${LINEAR_GRADIENT_HALF_LENGTH}" y1="0" x2="${LINEAR_GRADIENT_HALF_LENGTH}" y2="0" spreadMethod="${spreadMethod}" color-interpolation="${interpolation}" gradientTransform="${matrixToSvgTransform(matrix)}">${stopNodes}</linearGradient>`;
  return {
    ok: true,
    paint: {
      svgPaint: `url(#${gradientId})`,
      firstColor,
      opacity: 1,
      gradientType: 'linear',
      gradientId,
      gradientDefinition: definition,
      gradientStopCount: stops.length,
    },
  };
}

function xmlAttributes(openTag: string | undefined): Record<string, string> | null {
  if (!openTag?.startsWith('<') || !openTag.endsWith('>')) return null;
  const tagName = openTag.match(/^<[A-Za-z_][A-Za-z0-9_.:-]*/u)?.[0];
  if (!tagName) return null;

  let remainder = openTag.slice(tagName.length, -1).trimEnd();
  if (remainder.endsWith('/')) remainder = remainder.slice(0, -1);
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
  let offset = 0;
  while (offset < remainder.length) {
    while (/\s/u.test(remainder[offset] ?? '')) offset += 1;
    if (offset >= remainder.length) break;

    const name = remainder.slice(offset).match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/u)?.[1];
    if (!name || Object.prototype.hasOwnProperty.call(attributes, name)) return null;
    offset += name.length;
    while (/\s/u.test(remainder[offset] ?? '')) offset += 1;
    if (remainder[offset] !== '=') return null;
    offset += 1;
    while (/\s/u.test(remainder[offset] ?? '')) offset += 1;

    const quote = remainder[offset];
    if (quote !== '"' && quote !== "'") return null;
    offset += 1;
    const valueEnd = remainder.indexOf(quote, offset);
    if (valueEnd < 0) return null;
    const value = remainder.slice(offset, valueEnd);
    if (value.includes('<')) return null;
    offset = valueEnd + 1;
    if (offset < remainder.length && !/\s/u.test(remainder[offset] ?? '')) return null;
    attributes[name] = value;
  }
  return attributes;
}

function hasExactAttributeNames(
  attributes: Record<string, string> | null,
  names: readonly string[],
): boolean {
  if (!attributes) return false;
  return Object.keys(attributes).sort().join(',') === [...names].sort().join(',');
}

function hasOnlyExpectedChildElements(
  parentBlock: string,
  parentTag: string,
  expectedChildren: readonly string[],
): boolean {
  const openTag = parentBlock.match(new RegExp(`<${parentTag}\\b[^>]*>`, 'u'))?.[0];
  const closeTag = `</${parentTag}>`;
  const closeIndex = parentBlock.lastIndexOf(closeTag);
  if (!openTag || closeIndex < openTag.length) return false;
  let remainder = parentBlock.slice(openTag.length, closeIndex);
  for (const child of expectedChildren) {
    const childIndex = remainder.indexOf(child);
    if (childIndex < 0) return false;
    remainder = remainder.slice(0, childIndex) + remainder.slice(childIndex + child.length);
  }
  return !/<[A-Za-z_]/u.test(remainder);
}

function hasClosedLinearStrokeStructure(
  style: ParsedShapeStyle,
  solidStrokeXml: string,
  fillBlock: string,
  gradientBlock: string,
  variableWidthBlock: string | null = null,
): boolean {
  const matrixBlocks = extractBalancedBlocks(gradientBlock, 'matrix');
  const stopTags = extractSelfClosingTags(gradientBlock, 'GradientEntry');
  const matrixTags = matrixBlocks.length === 1
    ? (matrixBlocks[0] as string).match(/<Matrix\b[^>]*\/?\s*>/gu) ?? []
    : [];
  if (matrixBlocks.length !== 1 || matrixTags.length !== 1) return false;
  const expectedSolidStrokeChildren = variableWidthBlock ? [fillBlock, variableWidthBlock] : [fillBlock];
  return hasOnlyExpectedChildElements(style.sourceXml, 'StrokeStyle', [solidStrokeXml]) &&
    hasOnlyExpectedChildElements(solidStrokeXml, 'SolidStroke', expectedSolidStrokeChildren) &&
    hasOnlyExpectedChildElements(fillBlock, 'fill', [gradientBlock]) &&
    hasOnlyExpectedChildElements(gradientBlock, 'LinearGradient', [
      matrixBlocks[0] as string,
      ...stopTags,
    ]) &&
    hasOnlyExpectedChildElements(matrixBlocks[0] as string, 'matrix', [matrixTags[0] as string]);
}

// #944 and #952 exact-edge SWF receipts prove omitted values only for these
// exact source signatures. Keep matching content-based: the signatures do not
// establish global defaults for other linear-gradient strokes.
function matchesEvidenceBoundLinearStroke(
  style: ParsedShapeStyle,
  solidStrokeXml: string,
): boolean {
  const evidencedSignatures = [
    {
      strokeAttributes: { scaleMode: 'normal' },
      gradientAttributes: { spreadMethod: 'reflect' },
      matrixAttributes: { a: 0.009490966796875, d: 0.01239013671875, tx: 814.65, ty: 625.65 },
      stops: [
        { color: '#594F45', ratio: 0.152941176470588 },
        { color: '#D7DFD5', ratio: 0.447058823529412 },
        { color: '#A4A79E', ratio: 0.72156862745098 },
        { color: '#FCFDFA', ratio: 1 },
      ],
    },
    {
      strokeAttributes: { scaleMode: 'normal' },
      gradientAttributes: { spreadMethod: 'reflect' },
      matrixAttributes: {
        a: 0.0026702880859375,
        b: 0.000946044921875,
        c: -0.0126190185546875,
        d: 0.034210205078125,
        tx: 867.7,
        ty: 626.45,
      },
      stops: [
        { color: '#594F45', ratio: 0.152941176470588 },
        { color: '#D7DFD5', ratio: 0.447058823529412 },
        { color: '#A4A79E', ratio: 0.72156862745098 },
        { color: '#FCFDFA', ratio: 1 },
      ],
    },
    {
      strokeAttributes: { scaleMode: 'normal', weight: '0.5' },
      gradientAttributes: {},
      matrixAttributes: { a: 0.0386962890625, d: 0.020172119140625, tx: 561.05, ty: 591.1 },
      stops: [
        { color: '#618C84', ratio: 0 },
        { color: '#ADCFD1', ratio: 0.654901960784314 },
        { color: '#80CEB0', ratio: 0.894117647058824 },
      ],
    },
  ] as const;

  const strokeTag = solidStrokeXml.match(/<SolidStroke\b[^>]*>/u)?.[0];
  const strokeAttributes = xmlAttributes(strokeTag);
  if (!strokeAttributes || /<VariablePointWidth\b/u.test(style.sourceXml)) return false;

  const gradientBlocks = extractBalancedBlocks(style.sourceXml, 'LinearGradient');
  if (gradientBlocks.length !== 1) return false;
  const gradientBlock = gradientBlocks[0] as string;
  const gradientTag = gradientBlock.match(/<LinearGradient\b[^>]*>/u)?.[0];
  const gradientAttributes = xmlAttributes(gradientTag);
  if (!gradientAttributes) return false;

  const matrixBlocks = extractBalancedBlocks(gradientBlock, 'matrix');
  const matrixTags = matrixBlocks.length === 1
    ? (matrixBlocks[0] as string).match(/<Matrix\b[^>]*\/?\s*>/gu) ?? []
    : [];
  if ((gradientBlock.match(/<matrix\b/gu) ?? []).length !== 1 || matrixTags.length !== 1) return false;
  const matrixAttributes = xmlAttributes(matrixTags[0]);
  if (!matrixAttributes) return false;
  const stopTags = extractSelfClosingTags(gradientBlock, 'GradientEntry');
  const matchesStringAttributes = (
    actual: Record<string, string>,
    expected: Readonly<Record<string, string>>,
  ): boolean => hasExactAttributeNames(actual, Object.keys(expected)) &&
    Object.entries(expected).every(([key, value]) => actual[key] === value);
  const matchesNumericAttributes = (
    actual: Record<string, string>,
    expected: Readonly<Record<string, number>>,
  ): boolean => hasExactAttributeNames(actual, Object.keys(expected)) &&
    Object.entries(expected).every(([key, value]) => Number(actual[key]) === value);

  return evidencedSignatures.some((signature) => {
    if (!matchesStringAttributes(strokeAttributes, signature.strokeAttributes) ||
        !matchesStringAttributes(gradientAttributes, signature.gradientAttributes) ||
        !matchesNumericAttributes(matrixAttributes, signature.matrixAttributes) ||
        stopTags.length !== signature.stops.length) return false;
    return stopTags.every((tag, index) => {
      const attributes = xmlAttributes(tag);
      const expected = signature.stops[index];
      return attributes !== null && expected !== undefined &&
        hasExactAttributeNames(attributes, ['color', 'ratio']) &&
        attributes.color === expected.color &&
        Number(attributes.ratio) === expected.ratio;
    });
  });
}

function hasExplicitSafeLinearStrokeSemantics(
  solidStrokeXml: string,
  gradientBlock: string,
): boolean {
  const strokeTag = solidStrokeXml.match(/<SolidStroke\b[^>]*>/u)?.[0];
  const strokeAttributes = xmlAttributes(strokeTag);
  if (!strokeAttributes || !hasExactAttributeNames(strokeAttributes, [
    'weight', 'caps', 'joints', 'scaleMode', 'pixelHinting',
  ]) && !hasExactAttributeNames(strokeAttributes, [
    'weight', 'caps', 'joints', 'scaleMode', 'pixelHinting', 'miterLimit',
  ])) return false;
  if (strokeAttributes.scaleMode !== 'normal' || strokeAttributes.caps !== 'round' ||
      strokeAttributes.joints !== 'round' || strokeAttributes.pixelHinting !== 'false') return false;
  const weight = Number(strokeAttributes.weight);
  if (!Number.isFinite(weight) || weight <= 0) return false;

  const gradientTag = gradientBlock.match(/<LinearGradient\b[^>]*>/u)?.[0];
  const gradientAttributes = xmlAttributes(gradientTag);
  if (!gradientAttributes || !hasExactAttributeNames(gradientAttributes, ['spreadMethod', 'interpolationMethod']) ||
      gradientAttributes.spreadMethod !== 'reflect' ||
      gradientAttributes.interpolationMethod !== 'rgb') return false;

  const matrixBlocks = extractBalancedBlocks(gradientBlock, 'matrix');
  const matrixTags = matrixBlocks.length === 1
    ? (matrixBlocks[0] as string).match(/<Matrix\b[^>]*\/?\s*>/gu) ?? []
    : [];
  if ((gradientBlock.match(/<matrix\b/gu) ?? []).length !== 1 || matrixTags.length !== 1) return false;
  if (!hasExactAttributeNames(xmlAttributes(matrixTags[0]), ['a', 'b', 'c', 'd', 'tx', 'ty'])) return false;

  const stopTags = extractSelfClosingTags(gradientBlock, 'GradientEntry');
  if (stopTags.length < 2) return false;
  return stopTags.every((tag) => hasExactAttributeNames(xmlAttributes(tag), ['color', 'alpha', 'ratio']));
}

function parseRadialGradientPaint(
  style: ParsedShapeStyle,
  shapeId: string,
  renderTargetId: string,
  frameIndex: number,
  styleKind: 'FillStyle' | 'StrokeStyle' = 'FillStyle',
): { readonly ok: true; readonly paint: ReconstructedFillPaint } | BuildSvgFailure {
  const fail = (code: BuildSvgFailure['code'], message: string): BuildSvgFailure => ({
    ok: false,
    code,
    message: 'Shape ' + shapeId + ' ' + styleKind + ' ' + style.index + ' ' + message,
  });
  const gradientBlocks = extractBalancedBlocks(style.sourceXml, 'RadialGradient');
  if (gradientBlocks.length !== 1) {
    return fail('RENDER_FAILED', 'has a malformed RadialGradient definition');
  }
  const gradientBlock = gradientBlocks[0] as string;
  const rawStopCount = (gradientBlock.match(/<GradientEntry\b/gu) ?? []).length;
  if (rawStopCount > MAX_GRADIENT_STOPS_PER_STYLE) {
    return fail('BUDGET_EXCEEDED', 'exceeds the per-style gradient-stop budget');
  }
  const stopTags = extractSelfClosingTags(gradientBlock, 'GradientEntry');
  if (stopTags.length !== rawStopCount) {
    return fail('RENDER_FAILED', 'has malformed or missing GradientEntry stops');
  }
  if (stopTags.length < 2) {
    return fail('RENDER_FAILED', 'has insufficient GradientEntry stops; at least two are required');
  }
  const stops: Array<{ readonly color: string; readonly alpha: number; readonly ratio: number }> = [];
  let previousRatio = -1;
  for (const stopTag of stopTags) {
    const color = attributeFromElement(stopTag, 'GradientEntry', 'color') ?? '#000000';
    const rawAlpha = attributeFromElement(stopTag, 'GradientEntry', 'alpha');
    const rawRatio = attributeFromElement(stopTag, 'GradientEntry', 'ratio');
    const alphaText = rawAlpha ?? '1';
    const ratioText = rawRatio ?? '0';
    const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
    const alpha = numericPattern.test(alphaText) ? Number(alphaText) : Number.NaN;
    const ratio = numericPattern.test(ratioText) ? Number(ratioText) : Number.NaN;
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(color)) {
      return fail('RENDER_FAILED', 'has an invalid gradient stop color');
    }
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      return fail('RENDER_FAILED', 'has an invalid gradient stop alpha');
    }
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1 || ratio < previousRatio) {
      return fail('RENDER_FAILED', 'has an invalid or out-of-order gradient stop ratio');
    }
    stops.push({ color, alpha, ratio });
    previousRatio = ratio;
  }

  const spreadMethod = attributeFromElement(gradientBlock, 'RadialGradient', 'spreadMethod') ?? 'pad';
  if (spreadMethod !== 'pad' && spreadMethod !== 'reflect' && spreadMethod !== 'repeat') {
    return fail('TARGET_UNSUPPORTED', 'uses unsupported spread method "' + spreadMethod + '"');
  }
  const interpolationMethod = attributeFromElement(gradientBlock, 'RadialGradient', 'interpolationMethod') ?? 'rgb';
  if (interpolationMethod !== 'rgb' && interpolationMethod !== 'linearRGB') {
    return fail('TARGET_UNSUPPORTED', 'uses unsupported interpolation method "' + interpolationMethod + '"');
  }

  const focalPointText = attributeFromElement(gradientBlock, 'RadialGradient', 'focalPointRatio') ?? '0';
  const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
  const focalPointRatio = numericPattern.test(focalPointText) ? Number(focalPointText) : Number.NaN;
  if (!Number.isFinite(focalPointRatio) || focalPointRatio < -1 || focalPointRatio > 1) {
    return fail('RENDER_FAILED', 'has an invalid radial focalPointRatio');
  }

  const matrixWrapperCount = (gradientBlock.match(/<matrix\b/gu) ?? []).length;
  const matrixBlocks = extractBalancedBlocks(gradientBlock, 'matrix');
  const matrixTagCount = (gradientBlock.match(/<Matrix\b/gu) ?? []).length;
  if (matrixWrapperCount !== 1 || matrixBlocks.length !== 1 || matrixTagCount !== 1) {
    return fail('RENDER_FAILED', 'has a malformed or missing gradient matrix');
  }
  const matrixTags = (matrixBlocks[0] as string).match(/<Matrix\b[^>]*\/?\s*>/gu) ?? [];
  if (matrixTags.length !== 1) return fail('RENDER_FAILED', 'has a malformed gradient matrix');
  const matrixTag = matrixTags[0] as string;
  const values: Record<keyof Matrix2D, number> = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  for (const key of Object.keys(values) as Array<keyof Matrix2D>) {
    const raw = attributeFromElement(matrixTag, 'Matrix', key);
    if (raw === null) continue;
    const value = numericPattern.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
      return fail('RENDER_FAILED', 'has an invalid gradient matrix value');
    }
    values[key] = value;
  }
  const matrix: Matrix2D = { ...values };

  const gradientId = 'fla-radial-' + crypto.createHash('sha256')
    .update(JSON.stringify([renderTargetId, frameIndex, shapeId, style.index, style.sourceXml]), 'utf8')
    .digest('hex');
  const firstColor = stops[0]?.color;
  if (!firstColor) return fail('RENDER_FAILED', 'has no usable gradient stop');
  const stopNodes = stops.map((stop) =>
    '<stop offset="' + String(stop.ratio) + '" stop-color="' + stop.color + '" stop-opacity="' + String(stop.alpha) + '"/>',
  ).join('');
  const interpolation = interpolationMethod === 'linearRGB' ? 'linearRGB' : 'sRGB';
  const focalOffset = focalPointRatio * RADIAL_GRADIENT_RADIUS;
  const definition = '<radialGradient id="' + gradientId +
    '" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="' + RADIAL_GRADIENT_RADIUS +
    '" fx="' + String(focalOffset) + '" fy="0" spreadMethod="' + spreadMethod +
    '" color-interpolation="' + interpolation + '" gradientTransform="' +
    matrixToSvgTransform(matrix) + '">' + stopNodes + '</radialGradient>';
  return {
    ok: true,
    paint: {
      svgPaint: 'url(#' + gradientId + ')',
      firstColor,
      opacity: 1,
      gradientType: 'radial',
      gradientId,
      gradientDefinition: definition,
      gradientStopCount: stops.length,
    },
  };
}

function pointKey(point: Point2D): string {
  const part = (value: number): string => Object.is(value, -0) ? '0' : value.toString();
  return `${part(point.x)},${part(point.y)}`;
}

function reverseFillDrawCommand(command: FillDrawCommand, start: Point2D): FillDrawCommand {
  switch (command.type) {
    case 'L': return { type: 'L', x: start.x, y: start.y };
    case 'Q': return { type: 'Q', cx: command.cx, cy: command.cy, x: start.x, y: start.y };
    case 'C': return {
      type: 'C',
      c1x: command.c2x,
      c1y: command.c2y,
      c2x: command.c1x,
      c2y: command.c1y,
      x: start.x,
      y: start.y,
    };
  }
}

function commandStartAngle(segment: FillBoundarySegment): number {
  const { from, to, command } = segment;
  const vectors: readonly Point2D[] = command.type === 'Q'
    ? [{ x: command.cx - from.x, y: command.cy - from.y }, { x: to.x - from.x, y: to.y - from.y }]
    : command.type === 'C'
      ? [
          { x: command.c1x - from.x, y: command.c1y - from.y },
          { x: command.c2x - from.x, y: command.c2y - from.y },
          { x: to.x - from.x, y: to.y - from.y },
        ]
      : [{ x: to.x - from.x, y: to.y - from.y }];
  const vector = vectors.find((candidate) => candidate.x !== 0 || candidate.y !== 0);
  return vector ? Math.atan2(vector.y, vector.x) : Number.NaN;
}

function commandEndAngle(segment: FillBoundarySegment): number {
  const { from, to, command } = segment;
  const vectors: readonly Point2D[] = command.type === 'Q'
    ? [{ x: to.x - command.cx, y: to.y - command.cy }, { x: to.x - from.x, y: to.y - from.y }]
    : command.type === 'C'
      ? [
          { x: to.x - command.c2x, y: to.y - command.c2y },
          { x: to.x - command.c1x, y: to.y - command.c1y },
          { x: to.x - from.x, y: to.y - from.y },
        ]
      : [{ x: to.x - from.x, y: to.y - from.y }];
  const vector = vectors.find((candidate) => candidate.x !== 0 || candidate.y !== 0);
  return vector ? Math.atan2(vector.y, vector.x) : Number.NaN;
}

function nextFillBoundarySegment(
  incoming: FillBoundarySegment,
  candidates: readonly FillBoundarySegment[],
): FillBoundarySegment | null {
  if (candidates.length === 1) return candidates[0] ?? null;
  const endAngle = commandEndAngle(incoming);
  if (!Number.isFinite(endAngle)) return null;
  const reverseAngle = endAngle + Math.PI;
  const ranked = candidates.map((candidate) => {
    const angle = commandStartAngle(candidate);
    if (!Number.isFinite(angle)) return { candidate, delta: Number.NaN };
    let delta = reverseAngle - angle;
    while (delta <= 1e-9) delta += Math.PI * 2;
    while (delta > Math.PI * 2) delta -= Math.PI * 2;
    return { candidate, delta };
  }).sort((left, right) => left.delta - right.delta || left.candidate.order - right.candidate.order);
  const first = ranked[0];
  const second = ranked[1];
  if (!first || !Number.isFinite(first.delta) ||
      (second && Math.abs(first.delta - second.delta) <= 1e-9)) return null;
  return first.candidate;
}

function stitchFillBoundary(
  segments: readonly FillBoundarySegment[],
  shapeId: string,
  fillStyleIndex: number,
): { readonly ok: true; readonly commands: DecodedEdges['commands']; readonly contourCount: number } | BuildSvgFailure {
  const outgoing = new Map<string, FillBoundarySegment[]>();
  for (const segment of segments) {
    const key = pointKey(segment.from);
    const connected = outgoing.get(key) ?? [];
    connected.push(segment);
    outgoing.set(key, connected);
  }

  const commands: DecodedEdges['commands'] = [];
  const visited = new Set<number>();
  let contourCount = 0;
  for (const first of segments) {
    if (visited.has(first.order)) continue;
    const startKey = pointKey(first.from);
    const contour: FillBoundarySegment[] = [];
    let current: FillBoundarySegment | null = first;
    while (current && !visited.has(current.order)) {
      visited.add(current.order);
      contour.push(current);
      if (pointKey(current.to) === startKey) break;
      const nextCandidates = (outgoing.get(pointKey(current.to)) ?? [])
        .filter((candidate) => !visited.has(candidate.order));
      if (nextCandidates.length === 0) {
        return {
          ok: false,
          code: 'TARGET_UNSUPPORTED',
          message: `Shape ${shapeId} FillStyle ${fillStyleIndex} has an open fill boundary`,
        };
      }
      current = nextFillBoundarySegment(current, nextCandidates);
      if (!current) {
        return {
          ok: false,
          code: 'TARGET_UNSUPPORTED',
          message: `Shape ${shapeId} FillStyle ${fillStyleIndex} has ambiguous fill topology`,
        };
      }
    }
    if (pointKey(contour[contour.length - 1]?.to ?? first.from) !== startKey) {
      return {
        ok: false,
        code: 'TARGET_UNSUPPORTED',
        message: `Shape ${shapeId} FillStyle ${fillStyleIndex} has an open fill boundary`,
      };
    }
    commands.push({ type: 'M', x: first.from.x, y: first.from.y });
    for (const segment of contour) commands.push(segment.command);
    commands.push({ type: 'Z' });
    contourCount += 1;
  }
  return { ok: true, commands, contourCount };
}

function reconstructFills(
  representation: StyleAwareShapeRepresentation,
  shapeId: string,
  renderTargetId: string,
  frameIndex: number,
): { readonly ok: true; readonly result: ReconstructedFills } | BuildSvgFailure {
  const stylesByIndex = new Map(representation.fillStyles.map((style) => [style.index, style]));
  const boundaryByStyle = new Map<number, FillBoundarySegment[]>();
  const resolvedStyles = new Map<number, ReconstructedFillPaint | BitmapFillPaint>();
  let segmentCount = 0;
  let nextOrder = 0;
  let currentEdgeIndex = -1;
  let current: Point2D | null = null;
  let subpathStart: Point2D | null = null;

  const addBoundary = (
    fillStyleIndex: number,
    from: Point2D,
    to: Point2D,
    command: FillDrawCommand,
    reverse: boolean,
  ): BuildSvgFailure | null => {
    let paint = resolvedStyles.get(fillStyleIndex);
    if (!paint) {
      const style = stylesByIndex.get(fillStyleIndex);
      if (!style) {
        return {
          ok: false,
          code: 'RENDER_FAILED',
          message: `Shape ${shapeId} references missing FillStyle ${fillStyleIndex}`,
        };
      }
      if (style.type === 'linear') {
        const parsed = parseLinearGradientPaint(style, shapeId, renderTargetId, frameIndex);
        if (!parsed.ok) return parsed;
        paint = parsed.paint;
      } else if (style.type === 'radial') {
        const parsed = parseRadialGradientPaint(style, shapeId, renderTargetId, frameIndex);
        if (!parsed.ok) return parsed;
        paint = parsed.paint;
      } else if (style.type === 'bitmap') {
        const parsed = parseBitmapFillPaint(style, shapeId);
        if (!parsed.ok) return parsed;
        paint = parsed.paint;
      } else if (style.type === 'solid') {
        if (!style.color || !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(style.color)) {
          return {
            ok: false,
            code: 'RENDER_FAILED',
            message: `Shape ${shapeId} FillStyle ${fillStyleIndex} has an invalid solid color`,
          };
        }
        const solidColorTag = style.sourceXml.match(/<SolidColor\b[^>]*>/u)?.[0];
        const rawAlpha = solidColorTag?.match(/\balpha="([^"]*)"/u)?.[1] ?? null;
        const parsedAlpha = rawAlpha === null ? 1 : Number(rawAlpha);
        if (!Number.isFinite(parsedAlpha)) {
          return {
            ok: false,
            code: 'RENDER_FAILED',
            message: `Shape ${shapeId} FillStyle ${fillStyleIndex} has an invalid alpha`,
          };
        }
        paint = {
          svgPaint: style.color,
          firstColor: style.color,
          opacity: Math.max(0, Math.min(1, parsedAlpha)),
          gradientType: null,
          gradientId: null,
          gradientDefinition: null,
          gradientStopCount: 0,
        };
      } else {
        return {
          ok: false,
          code: 'TARGET_UNSUPPORTED',
          message: `Shape ${shapeId} FillStyle ${fillStyleIndex} uses unsupported ${style.type} fill; P2-C05 supports solid, linear, and radial fills`,
        };
      }
      resolvedStyles.set(fillStyleIndex, paint);
    }

    if (segmentCount >= MAX_FILL_BOUNDARY_SEGMENTS_PER_SHAPE) {
      return {
        ok: false,
        code: 'BUDGET_EXCEEDED',
        message: `Shape ${shapeId} fill-boundary segment budget exceeded`,
      };
    }
    const styleSegments = boundaryByStyle.get(fillStyleIndex) ?? [];
    const orientedFrom = reverse ? to : from;
    const orientedTo = reverse ? from : to;
    const orientedCommand = reverse ? reverseFillDrawCommand(command, from) : command;
    styleSegments.push({ from: orientedFrom, to: orientedTo, command: orientedCommand, order: nextOrder });
    boundaryByStyle.set(fillStyleIndex, styleSegments);
    segmentCount += 1;
    nextOrder += 1;
    return null;
  };

  for (const run of representation.styleRuns) {
    if (run.edgeIndex !== currentEdgeIndex) {
      currentEdgeIndex = run.edgeIndex;
      current = null;
      subpathStart = null;
    }
    for (const command of run.commands) {
      if (command.type === 'M') {
        current = { x: command.x, y: command.y };
        subpathStart = current;
        continue;
      }
      if (command.type === 'Z') {
        if (current && subpathStart && pointKey(current) !== pointKey(subpathStart)) {
          if (run.fillStyle0 !== run.fillStyle1) {
            if (run.fillStyle1 !== null) {
              const failure = addBoundary(
                run.fillStyle1,
                current,
                subpathStart,
                { type: 'L', x: subpathStart.x, y: subpathStart.y },
                false,
              );
              if (failure) return failure;
            }
            if (run.fillStyle0 !== null) {
              const failure = addBoundary(
                run.fillStyle0,
                current,
                subpathStart,
                { type: 'L', x: subpathStart.x, y: subpathStart.y },
                true,
              );
              if (failure) return failure;
            }
          }
        }
        current = subpathStart;
        continue;
      }

      const end = { x: command.x, y: command.y };
      if (!current) {
        if (run.fillStyle0 !== null || run.fillStyle1 !== null) {
          return {
            ok: false,
            code: 'TARGET_UNSUPPORTED',
            message: `Shape ${shapeId} has a styled fill edge without a start point`,
          };
        }
        current = end;
        continue;
      }
      if (!Number.isFinite(end.x) || !Number.isFinite(end.y)) {
        return {
          ok: false,
          code: 'RENDER_FAILED',
          message: `Shape ${shapeId} has a non-finite fill edge endpoint`,
        };
      }
      if (run.fillStyle0 !== run.fillStyle1) {
        if (run.fillStyle1 !== null) {
          const failure = addBoundary(run.fillStyle1, current, end, command, false);
          if (failure) return failure;
        }
        if (run.fillStyle0 !== null) {
          const failure = addBoundary(run.fillStyle0, current, end, command, true);
          if (failure) return failure;
        }
      }
      current = end;
    }
  }

  const fills: ReconstructedFill[] = [];
  let contourCount = 0;
  for (const style of representation.fillStyles) {
    const segments = boundaryByStyle.get(style.index);
    if (!segments || segments.length === 0) continue;
    const stitched = stitchFillBoundary(segments, shapeId, style.index);
    if (!stitched.ok) return stitched;
    const paint = resolvedStyles.get(style.index);
    if (!paint) {
      return {
        ok: false,
        code: 'RENDER_FAILED',
        message: `Shape ${shapeId} FillStyle ${style.index} was not resolved`,
      };
    }
    fills.push({
      style,
      paint,
      pathD: commandsToSvgPath(stitched.commands),
      contourCount: stitched.contourCount,
      boundarySegmentCount: segments.length,
    });
    contourCount += stitched.contourCount;
  }
  return {
    ok: true,
    result: { fills, contourCount, boundarySegmentCount: segmentCount },
  };
}

/**
 * Extracts the same bounded filled contours used by the formal SVG builder so
 * persisted Structured Graphic masks do not need a second XFL shape parser.
 */
export function extractFlaGraphicMaskPathData(input: {
  readonly shapeBlock: string;
  readonly shapeId: string;
  readonly renderTargetId: string;
  readonly frameIndex: number;
}): readonly string[] | undefined {
  try {
    const representation = buildStyleAwareShapeRepresentation(
      parseShapeAt(input.shapeBlock),
      input.shapeId,
    );
    if (!representation.ok) return undefined;
    const reconstructed = reconstructFills(
      representation.representation,
      input.shapeId,
      input.renderTargetId,
      input.frameIndex,
    );
    if (!reconstructed.ok || reconstructed.result.fills.length > 256 ||
        reconstructed.result.fills.some(({ paint }) => 'bitmapPath' in paint)) {
      return undefined;
    }
    const pathData = reconstructed.result.fills.map((fill) => fill.pathD);
    const totalLength = pathData.reduce((total, path) => total + path.length, 0);
    return totalLength > 512 * 1024 || pathData.some((path) => path.length === 0)
      ? undefined
      : pathData;
  } catch {
    return undefined;
  }
}

type StrokeCap = 'butt' | 'round' | 'square';
type StrokeJoin = 'miter' | 'round' | 'bevel';
type StrokeScaleMode = 'normal' | 'horizontal';
type StrokeDrawCommand = Extract<DecodedEdges['commands'][number], { type: 'L' | 'Q' | 'C' }>;

interface ParsedSolidStrokeStyle {
  readonly color: string;
  readonly opacity: number;
  readonly gradientPaint: ReconstructedFillPaint | null;
  readonly width: number;
  readonly cap: StrokeCap;
  readonly join: StrokeJoin;
  readonly miterLimit: number;
  readonly scaleMode: StrokeScaleMode;
  readonly variableWidthMarkers?: readonly VariableWidthMarker[];
}

interface StrokeBoundarySegment {
  readonly from: Point2D;
  readonly to: Point2D;
  readonly command: StrokeDrawCommand;
  readonly order: number;
  readonly edgeIndex: number;
  readonly sourceSubpathId: number;
  readonly closesSourceSubpath: boolean;
}

interface ReconstructedStrokePath {
  readonly commands: DecodedEdges['commands'];
  readonly pathD: string;
  readonly segmentCount: number;
  readonly filledOutline?: boolean;
}

interface ReconstructedSolidStroke {
  readonly style: ParsedShapeStyle;
  readonly rendererStyle: ParsedSolidStrokeStyle;
  readonly paths: readonly ReconstructedStrokePath[];
  readonly segmentCount: number;
}

const MAX_VARIABLE_WIDTH_MARKERS = 256;
const MAX_VARIABLE_WIDTH_MULTIPLIER = 100;

function parseVariablePointWidthMarkers(
  solidStrokeXml: string,
  shapeId: string,
  styleIndex: number,
):
  | { readonly ok: true; readonly markers: readonly VariableWidthMarker[] | null; readonly block: string | null }
  | BuildSvgFailure {
  const directChildren = getFlaXflDirectChildren(solidStrokeXml, 'SolidStroke');
  const vpBlocks = directChildren.filter((child) => child.name === 'VariablePointWidth');
  if (vpBlocks.length === 0) {
    if (/<VariablePointWidth\b/u.test(solidStrokeXml)) {
      return {
        ok: false,
        code: 'RENDER_FAILED',
        message: `Shape ${shapeId} StrokeStyle ${styleIndex} has a malformed VariablePointWidth block`,
      };
    }
    return { ok: true, markers: null, block: null };
  }
  if (vpBlocks.length !== 1) {
    return {
      ok: false,
      code: 'RENDER_FAILED',
      message: `Shape ${shapeId} StrokeStyle ${styleIndex} has multiple VariablePointWidth blocks`,
    };
  }
  const vpBlock = vpBlocks[0]!;
  const block = vpBlock.xml;
  const children = getFlaXflDirectChildren(block, 'VariablePointWidth');
  for (const child of children) {
    if (child.name !== 'WidthMarker') {
      return {
        ok: false,
        code: 'TARGET_UNSUPPORTED',
        message: `Shape ${shapeId} StrokeStyle ${styleIndex} has unsupported child <${child.name}> inside VariablePointWidth`,
      };
    }
  }
  if (children.length === 0) {
    return { ok: true, markers: null, block };
  }
  if (children.length > MAX_VARIABLE_WIDTH_MARKERS) {
    return {
      ok: false,
      code: 'BUDGET_EXCEEDED',
      message: `Shape ${shapeId} StrokeStyle ${styleIndex} exceeds VariablePointWidth marker budget`,
    };
  }
  const parsed: Array<VariableWidthMarker & { readonly index: number }> = [];
  for (let i = 0; i < children.length; i += 1) {
    const attrs = children[i]!.attributes;
    const position = attrs.position === undefined ? 0 : Number(attrs.position);
    const left = attrs.left === undefined ? 0 : Number(attrs.left);
    const right = attrs.right === undefined ? 0 : Number(attrs.right);
    if (
      !Number.isFinite(position) || position < 0 || position > 1 ||
      !Number.isFinite(left) || left < 0 || left > MAX_VARIABLE_WIDTH_MULTIPLIER ||
      !Number.isFinite(right) || right < 0 || right > MAX_VARIABLE_WIDTH_MULTIPLIER
    ) {
      return {
        ok: false,
        code: 'RENDER_FAILED',
        message: `Shape ${shapeId} StrokeStyle ${styleIndex} has out-of-range WidthMarker values`,
      };
    }
    const rawType = attrs.type;
    if (rawType !== undefined && rawType !== 'corner' && rawType !== 'normal') {
      return {
        ok: false,
        code: 'TARGET_UNSUPPORTED',
        message: `Shape ${shapeId} StrokeStyle ${styleIndex} has unsupported WidthMarker type "${rawType}"`,
      };
    }
    parsed.push({ position, left, right, corner: rawType === 'corner', index: i });
  }
  parsed.sort((a, b) => (a.position !== b.position ? a.position - b.position : a.index - b.index));
  return {
    ok: true,
    markers: parsed.map(({ position, left, right, corner }) => ({ position, left, right, corner })),
    block,
  };
}

function parseSolidStrokeStyle(
  style: ParsedShapeStyle,
  shapeId: string,
  renderTargetId: string,
  frameIndex: number,
): { readonly ok: true; readonly result: ParsedSolidStrokeStyle } | BuildSvgFailure {
  const unsupported = (detail: string): BuildSvgFailure => ({
    ok: false,
    code: 'TARGET_UNSUPPORTED',
    message: `Shape ${shapeId} StrokeStyle ${style.index} has unsupported ${detail}; P2-C03 supports normal and horizontal SolidStroke semantics only, P2-C06 adds validated normal radial-gradient paint, and P2-C07 adds evidence-bounded fixed-width linear-gradient paint`,
  });
  const malformed = (detail: string): BuildSvgFailure => ({
    ok: false,
    code: 'RENDER_FAILED',
    message: `Shape ${shapeId} StrokeStyle ${style.index} has a malformed ${detail}`,
  });
  const solidStrokeBlocks = extractBalancedBlocks(style.sourceXml, 'SolidStroke');
  if (solidStrokeBlocks.length !== 1) return unsupported('non-SolidStroke construct');
  const solidStrokeXml = solidStrokeBlocks[0] as string;
  const variableWidth = parseVariablePointWidthMarkers(solidStrokeXml, shapeId, style.index);
  if (!variableWidth.ok) return variableWidth;
  const fillBlocks = extractBalancedBlocks(solidStrokeXml, 'fill');
  if (fillBlocks.length !== 1) return malformed('SolidStroke fill');
  const fillBlock = fillBlocks[0] as string;
  const paintTags = fillBlock.match(/<(?:SolidColor|LinearGradient|RadialGradient|BitmapFill|ClippedBitmapFill)\b/gu) ?? [];
  let color: string;
  let opacity: number;
  let gradientPaint: ReconstructedFillPaint | null = null;
  if (style.type === 'radial') {
    if (paintTags.length !== 1 || !/^<RadialGradient\b/u.test(paintTags[0] ?? '')) {
      return malformed('single radial-gradient stroke fill');
    }
    const parsedPaint = parseRadialGradientPaint(style, shapeId, renderTargetId, frameIndex, 'StrokeStyle');
    if (!parsedPaint.ok) return parsedPaint;
    gradientPaint = parsedPaint.paint;
    color = parsedPaint.paint.firstColor;
    opacity = parsedPaint.paint.opacity;
  } else if (style.type === 'linear') {
    if (paintTags.length !== 1 || !/^<LinearGradient\b/u.test(paintTags[0] ?? '')) {
      return malformed('single linear-gradient stroke fill');
    }
    const gradientBlock = extractBalancedBlocks(style.sourceXml, 'LinearGradient')[0];
    if (!gradientBlock) return unsupported('linear-gradient stroke paint structure');
    const matchesEvidence = matchesEvidenceBoundLinearStroke(style, solidStrokeXml);
    const hasExplicitSemantics = hasExplicitSafeLinearStrokeSemantics(solidStrokeXml, gradientBlock);
    const closedStructure = hasClosedLinearStrokeStructure(
      style,
      solidStrokeXml,
      fillBlock,
      gradientBlock,
      variableWidth.block,
    );
    if (!closedStructure || (!matchesEvidence && !hasExplicitSemantics)) {
      const matrixBlocks = extractBalancedBlocks(gradientBlock, 'matrix');
      const matrixTags = matrixBlocks.length === 1
        ? (matrixBlocks[0] as string).match(/<Matrix\b[^>]*\/?\s*>/gu) ?? []
        : [];
      const rawStopCount = (gradientBlock.match(/<GradientEntry\b/gu) ?? []).length;
      const stopTags = extractSelfClosingTags(gradientBlock, 'GradientEntry');
      const hasCompletePaintStructure = (gradientBlock.match(/<matrix\b/gu) ?? []).length === 1 &&
        matrixBlocks.length === 1 && matrixTags.length === 1 &&
        rawStopCount >= 2 && stopTags.length === rawStopCount;
      if (hasCompletePaintStructure) {
        const validation = parseLinearGradientPaint(
          style, shapeId, renderTargetId, frameIndex, 'StrokeStyle',
        );
        if (!validation.ok) return validation;
      }
      return unsupported('linear-gradient SolidStroke semantics with unproven defaults or paint properties');
    }
    const parsedPaint = parseLinearGradientPaint(style, shapeId, renderTargetId, frameIndex, 'StrokeStyle');
    if (!parsedPaint.ok) return parsedPaint;
    gradientPaint = parsedPaint.paint;
    color = parsedPaint.paint.firstColor;
    opacity = parsedPaint.paint.opacity;
  } else if (style.type === 'solid') {
    if (paintTags.length !== 1 || !/^<SolidColor\b/u.test(paintTags[0] ?? '')) {
      return malformed('single solid-color stroke fill');
    }
    const solidColorTag = fillBlock.match(/<SolidColor\b[^>]*>/u)?.[0];
    if (!solidColorTag) return malformed('SolidColor stroke paint');
    const rawColor = solidColorTag.match(/\bcolor="([^"]*)"/u)?.[1] ?? null;
    color = rawColor === null ? '#000000' : rawColor;
    if (!color || !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(color)) {
      return {
        ok: false,
        code: 'RENDER_FAILED',
        message: `Shape ${shapeId} StrokeStyle ${style.index} has an invalid solid color`,
      };
    }
    const rawAlpha = solidColorTag.match(/\balpha="([^"]*)"/u)?.[1] ?? null;
    opacity = rawAlpha === null ? 1 : Number(rawAlpha);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      return {
        ok: false,
        code: 'RENDER_FAILED',
        message: `Shape ${shapeId} StrokeStyle ${style.index} has an invalid alpha`,
      };
    }
  } else {
    return unsupported(`${style.type} stroke fill`);
  }

  const rawWidth = attributeFromElement(solidStrokeXml, 'SolidStroke', 'weight');
  const width = rawWidth === null ? 1 : Number(rawWidth);
  if (!Number.isFinite(width) || width < 0) {
    return {
      ok: false,
      code: 'RENDER_FAILED',
      message: `Shape ${shapeId} StrokeStyle ${style.index} has an invalid weight`,
    };
  }
  if (width === 0) return unsupported('zero-weight hairline stroke');

  const rawCap = attributeFromElement(solidStrokeXml, 'SolidStroke', 'caps') ?? 'round';
  const cap: StrokeCap | null = rawCap === 'none' || rawCap === 'butt' ? 'butt' :
    rawCap === 'round' ? 'round' : rawCap === 'square' ? 'square' : null;
  if (!cap) return unsupported(`cap value "${rawCap}"`);

  const rawJoin = attributeFromElement(solidStrokeXml, 'SolidStroke', 'joints') ?? 'round';
  const join: StrokeJoin | null = rawJoin === 'miter' ? 'miter' :
    rawJoin === 'round' ? 'round' : rawJoin === 'bevel' ? 'bevel' : null;
  if (!join) return unsupported(`join value "${rawJoin}"`);

  const rawMiterLimit = attributeFromElement(solidStrokeXml, 'SolidStroke', 'miterLimit');
  const miterLimit = rawMiterLimit === null ? 3 : Number(rawMiterLimit);
  if (!Number.isFinite(miterLimit) || miterLimit < 1) {
    return {
      ok: false,
      code: 'RENDER_FAILED',
      message: `Shape ${shapeId} StrokeStyle ${style.index} has an invalid miter limit`,
    };
  }

  const scaleMode = attributeFromElement(solidStrokeXml, 'SolidStroke', 'scaleMode') ?? 'normal';
  if (scaleMode !== 'normal' && scaleMode !== 'horizontal') return unsupported(`scaleMode "${scaleMode}"`);
  if (gradientPaint && scaleMode !== 'normal') return unsupported(`gradient scaleMode "${scaleMode}"`);
  if (variableWidth.markers && scaleMode !== 'normal') {
    return unsupported(`variable-width stroke scaleMode "${scaleMode}"`);
  }
  const pixelHinting = attributeFromElement(solidStrokeXml, 'SolidStroke', 'pixelHinting');
  if (pixelHinting !== null && pixelHinting !== 'true' && pixelHinting !== 'false') {
    return {
      ok: false,
      code: 'RENDER_FAILED',
      message: `Shape ${shapeId} StrokeStyle ${style.index} has an invalid pixelHinting value`,
    };
  }
  if (pixelHinting === 'true') return unsupported('pixelHinting');

  return {
    ok: true,
    result: {
      color,
      opacity,
      gradientPaint,
      width,
      cap,
      join,
      miterLimit,
      scaleMode,
      ...(variableWidth.markers ? { variableWidthMarkers: variableWidth.markers } : {}),
    },
  };
}

function stitchSolidStrokeSegments(
  segments: readonly StrokeBoundarySegment[],
  closedSourceSubpaths: ReadonlySet<number>,
  shapeId: string,
  strokeStyleIndex: number,
): { readonly ok: true; readonly paths: readonly ReconstructedStrokePath[] } | BuildSvgFailure {
  const incidentByPoint = new Map<string, number[]>();
  const degreeByPoint = new Map<string, number>();
  const pointByKey = new Map<string, Point2D>();
  const addIncident = (key: string, segmentIndex: number, point: Point2D): void => {
    const incident = incidentByPoint.get(key) ?? [];
    incident.push(segmentIndex);
    incidentByPoint.set(key, incident);
    pointByKey.set(key, point);
  };
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) continue;
    const fromKey = pointKey(segment.from);
    const toKey = pointKey(segment.to);
    addIncident(fromKey, index, segment.from);
    degreeByPoint.set(fromKey, (degreeByPoint.get(fromKey) ?? 0) + 1);
    if (toKey !== fromKey) addIncident(toKey, index, segment.to);
    degreeByPoint.set(toKey, (degreeByPoint.get(toKey) ?? 0) + 1);
  }

  const visited = new Set<number>();
  const paths: ReconstructedStrokePath[] = [];
  for (let seedIndex = 0; seedIndex < segments.length; seedIndex += 1) {
    if (visited.has(seedIndex)) continue;
    const componentSegments = new Set<number>();
    const componentPoints = new Set<string>();
    const pending = [seedIndex];
    while (pending.length > 0) {
      const currentIndex = pending.pop();
      if (currentIndex === undefined || componentSegments.has(currentIndex)) continue;
      const segment = segments[currentIndex];
      if (!segment) continue;
      componentSegments.add(currentIndex);
      for (const key of [pointKey(segment.from), pointKey(segment.to)]) {
        componentPoints.add(key);
        for (const neighbor of incidentByPoint.get(key) ?? []) {
          if (!componentSegments.has(neighbor)) pending.push(neighbor);
        }
      }
    }
    const branched = [...componentPoints].some((key) => (degreeByPoint.get(key) ?? 0) > 2);
    if (branched) {
      const subpathSegments = new Map<number, StrokeBoundarySegment[]>();
      const authoredSegments = [...componentSegments]
        .map((index) => segments[index])
        .filter((segment): segment is StrokeBoundarySegment => segment !== undefined)
        .sort((left, right) => left.order - right.order);
      for (const segment of authoredSegments) {
        const subpath = subpathSegments.get(segment.sourceSubpathId) ?? [];
        subpath.push(segment);
        subpathSegments.set(segment.sourceSubpathId, subpath);
      }
      for (const [sourceSubpathId, sourceSegments] of subpathSegments) {
        const first = sourceSegments[0];
        if (!first) continue;
        const commands: DecodedEdges['commands'] = [{ type: 'M', x: first.from.x, y: first.from.y }];
        for (const segment of sourceSegments) {
          if (!segment.closesSourceSubpath) commands.push(segment.command);
        }
        if (closedSourceSubpaths.has(sourceSubpathId)) commands.push({ type: 'Z' });
        paths.push({
          commands,
          pathD: commandsToSvgPath(commands),
          segmentCount: sourceSegments.length,
        });
      }
      for (const index of componentSegments) visited.add(index);
      continue;
    }
    const endpoints = [...componentPoints]
      .filter((key) => degreeByPoint.get(key) === 1)
      .sort((left, right) => {
        const leftOrder = Math.min(...(incidentByPoint.get(left) ?? []).map((index) => segments[index]?.order ?? Infinity));
        const rightOrder = Math.min(...(incidentByPoint.get(right) ?? []).map((index) => segments[index]?.order ?? Infinity));
        return leftOrder - rightOrder;
      });
    if (endpoints.length !== 0 && endpoints.length !== 2) {
      return {
        ok: false,
        code: 'TARGET_UNSUPPORTED',
        message: `Shape ${shapeId} StrokeStyle ${strokeStyleIndex} has ambiguous stroke endpoints`,
      };
    }

    const firstSegmentIndex = endpoints.length === 2
      ? (incidentByPoint.get(endpoints[0] ?? '') ?? [])[0]
      : [...componentSegments].reduce((first, index) =>
          (segments[index]?.order ?? Infinity) < (segments[first]?.order ?? Infinity) ? index : first,
        seedIndex);
    const firstSegment = firstSegmentIndex === undefined ? undefined : segments[firstSegmentIndex];
    const startKey = endpoints[0] ?? (firstSegment ? pointKey(firstSegment.from) : '');
    const startPoint = pointByKey.get(startKey);
    if (!firstSegment || !startPoint) {
      return {
        ok: false,
        code: 'TARGET_UNSUPPORTED',
        message: `Shape ${shapeId} StrokeStyle ${strokeStyleIndex} has incomplete stroke topology`,
      };
    }

    const commands: DecodedEdges['commands'] = [{ type: 'M', x: startPoint.x, y: startPoint.y }];
    const pathSegmentIds = new Set<number>();
    let currentKey = startKey;
    let currentIndex = firstSegmentIndex as number;
    let closed = false;
    while (true) {
      const segment = segments[currentIndex];
      if (!segment || pathSegmentIds.has(currentIndex)) {
        return {
          ok: false,
          code: 'TARGET_UNSUPPORTED',
          message: `Shape ${shapeId} StrokeStyle ${strokeStyleIndex} has ambiguous stroke traversal`,
        };
      }
      const fromKey = pointKey(segment.from);
      const toKey = pointKey(segment.to);
      const forward = fromKey === currentKey;
      if (!forward && toKey !== currentKey) {
        return {
          ok: false,
          code: 'TARGET_UNSUPPORTED',
          message: `Shape ${shapeId} StrokeStyle ${strokeStyleIndex} has disconnected stroke segments`,
        };
      }
      commands.push(forward ? segment.command : reverseFillDrawCommand(segment.command, segment.from));
      pathSegmentIds.add(currentIndex);
      visited.add(currentIndex);
      currentKey = forward ? toKey : fromKey;
      if (currentKey === startKey) {
        closed = true;
        break;
      }
      const available = (incidentByPoint.get(currentKey) ?? [])
        .filter((neighbor) => neighbor !== currentIndex && !pathSegmentIds.has(neighbor));
      if (available.length === 0) break;
      if (available.length !== 1) {
        return {
          ok: false,
          code: 'TARGET_UNSUPPORTED',
          message: `Shape ${shapeId} StrokeStyle ${strokeStyleIndex} has ambiguous stroke joins`,
        };
      }
      currentIndex = available[0] as number;
    }
    if (pathSegmentIds.size !== componentSegments.size) {
      return {
        ok: false,
        code: 'TARGET_UNSUPPORTED',
        message: `Shape ${shapeId} StrokeStyle ${strokeStyleIndex} has disconnected stroke traversal`,
      };
    }
    if (closed) commands.push({ type: 'Z' });
    paths.push({
      commands,
      pathD: commandsToSvgPath(commands),
      segmentCount: pathSegmentIds.size,
    });
  }
  return { ok: true, paths };
}

function buildVariableWidthStrokePaths(
  segments: readonly StrokeBoundarySegment[],
  closedSourceSubpaths: ReadonlySet<number>,
  style: ParsedSolidStrokeStyle,
  remainingCommandBudget: { remaining: number },
): { readonly ok: true; readonly paths: readonly ReconstructedStrokePath[] } | BuildSvgFailure {
  const markers = style.variableWidthMarkers!;
  // Group directed segments in exact authored order within each original <Edge>,
  // splitting whenever a segment starts a new Edge, a new sourceSubpath, or
  // disconnects from the previous segment's endpoint.
  const subpaths: Array<{ readonly subpathId: number; readonly segments: StrokeBoundarySegment[] }> = [];
  for (const seg of segments) {
    const prev = subpaths[subpaths.length - 1];
    const prevSeg = prev?.segments[prev.segments.length - 1];
    if (
      prev &&
      prevSeg &&
      prevSeg.edgeIndex === seg.edgeIndex &&
      prev.subpathId === seg.sourceSubpathId &&
      pointKey(prevSeg.to) === pointKey(seg.from)
    ) {
      prev.segments.push(seg);
    } else {
      subpaths.push({ subpathId: seg.sourceSubpathId, segments: [seg] });
    }
  }

  const paths: ReconstructedStrokePath[] = [];
  for (const subpath of subpaths) {
    const first = subpath.segments[0]!;
    const last = subpath.segments[subpath.segments.length - 1]!;
    const closed =
      closedSourceSubpaths.has(subpath.subpathId) ||
      (subpath.segments.length >= 2 && pointKey(first.from) === pointKey(last.to));
    const outline = buildVariableWidthStrokeOutline(subpath.segments, {
      weight: style.width,
      markers,
      cap: style.cap,
      join: style.join,
      miterLimit: style.miterLimit,
      closed,
      maxOutlineCommands: remainingCommandBudget.remaining,
    });
    if (!outline.ok) return outline;
    if (outline.pathD) {
      if (outline.commands.length > remainingCommandBudget.remaining) {
        return {
          ok: false,
          code: 'BUDGET_EXCEEDED',
          message: 'Composition path-command budget exceeded during variable-width stroke expansion',
        };
      }
      remainingCommandBudget.remaining -= outline.commands.length;
      paths.push({
        commands: [...outline.commands],
        pathD: outline.pathD,
        segmentCount: subpath.segments.length,
        filledOutline: true,
      });
    }
  }
  return { ok: true, paths };
}

function reconstructSolidStrokes(
  representation: StyleAwareShapeRepresentation,
  shapeId: string,
  renderTargetId: string,
  frameIndex: number,
  remainingCommandBudget: { remaining: number },
): { readonly ok: true; readonly result: readonly ReconstructedSolidStroke[] } | BuildSvgFailure {
  const boundaryByStyle = new Map<number, StrokeBoundarySegment[]>();
  let currentEdgeIndex = -1;
  let current: Point2D | null = null;
  let subpathStart: Point2D | null = null;
  let segmentCount = 0;
  let nextOrder = 0;
  let currentSourceSubpathId: number | null = null;
  let nextSourceSubpathId = 0;
  const closedSourceSubpaths = new Set<number>();

  const addSegment = (
    fillStyleIndex: number,
    from: Point2D,
    to: Point2D,
    command: StrokeDrawCommand,
    edgeIndex: number,
    sourceSubpathId: number,
    closesSourceSubpath = false,
  ): BuildSvgFailure | null => {
    if (segmentCount >= MAX_STROKE_SEGMENTS_PER_SHAPE) {
      return {
        ok: false,
        code: 'BUDGET_EXCEEDED',
        message: `Shape ${shapeId} stroke-segment budget exceeded`,
      };
    }
    const styleSegments = boundaryByStyle.get(fillStyleIndex) ?? [];
    styleSegments.push({
      from,
      to,
      command,
      order: nextOrder,
      edgeIndex,
      sourceSubpathId,
      closesSourceSubpath,
    });
    boundaryByStyle.set(fillStyleIndex, styleSegments);
    segmentCount += 1;
    nextOrder += 1;
    return null;
  };

  for (const run of representation.styleRuns) {
    if (run.edgeIndex !== currentEdgeIndex) {
      currentEdgeIndex = run.edgeIndex;
      current = null;
      subpathStart = null;
      currentSourceSubpathId = null;
    }
    if (run.strokeStyle === null) continue;
    for (const command of run.commands) {
      if (command.type === 'M') {
        current = { x: command.x, y: command.y };
        subpathStart = current;
        currentSourceSubpathId = nextSourceSubpathId;
        nextSourceSubpathId += 1;
        continue;
      }
      if (command.type === 'Z') {
        if (currentSourceSubpathId !== null) closedSourceSubpaths.add(currentSourceSubpathId);
        if (current && subpathStart && pointKey(current) !== pointKey(subpathStart)) {
          if (currentSourceSubpathId === null) {
            return {
              ok: false,
              code: 'TARGET_UNSUPPORTED',
              message: `Shape ${shapeId} StrokeStyle ${run.strokeStyle} closes without a source subpath`,
            };
          }
          const failure = addSegment(
            run.strokeStyle,
            current,
            subpathStart,
            { type: 'L', x: subpathStart.x, y: subpathStart.y },
            run.edgeIndex,
            currentSourceSubpathId,
            true,
          );
          if (failure) return failure;
        }
        current = subpathStart;
        continue;
      }
      if (!current) {
        return {
          ok: false,
          code: 'TARGET_UNSUPPORTED',
          message: `Shape ${shapeId} StrokeStyle ${run.strokeStyle} starts without a path point`,
        };
      }
      if (currentSourceSubpathId === null) {
        return {
          ok: false,
          code: 'TARGET_UNSUPPORTED',
          message: `Shape ${shapeId} StrokeStyle ${run.strokeStyle} starts without a source subpath`,
        };
      }
      const end = { x: command.x, y: command.y };
      if (!Number.isFinite(end.x) || !Number.isFinite(end.y)) {
        return {
          ok: false,
          code: 'RENDER_FAILED',
          message: `Shape ${shapeId} StrokeStyle ${run.strokeStyle} has a non-finite endpoint`,
        };
      }
      const failure = addSegment(run.strokeStyle, current, end, command, run.edgeIndex, currentSourceSubpathId);
      if (failure) return failure;
      current = end;
    }
  }

  const stylesByIndex = new Map(representation.strokeStyles.map((style) => [style.index, style]));
  const strokes: ReconstructedSolidStroke[] = [];
  for (const style of representation.strokeStyles) {
    const segments = boundaryByStyle.get(style.index);
    if (!segments || segments.length === 0) continue;
    const parsed = parseSolidStrokeStyle(style, shapeId, renderTargetId, frameIndex);
    if (!parsed.ok) return parsed;
    const builtPaths = parsed.result.variableWidthMarkers
      ? buildVariableWidthStrokePaths(segments, closedSourceSubpaths, parsed.result, remainingCommandBudget)
      : stitchSolidStrokeSegments(segments, closedSourceSubpaths, shapeId, style.index);
    if (!builtPaths.ok) return builtPaths;
    if (!stylesByIndex.has(style.index)) {
      return {
        ok: false,
        code: 'RENDER_FAILED',
        message: `Shape ${shapeId} StrokeStyle ${style.index} was not resolved`,
      };
    }
    strokes.push({
      style,
      rendererStyle: parsed.result,
      paths: builtPaths.paths,
      segmentCount: segments.length,
    });
  }
  return { ok: true, result: strokes };
}

// ---- Renderable target discovery and Main-side C01/C02 build path ----
/**
 * R2 corrective (#309): catalog discovery and frame-source assembly can run
 * at different times, so target ids derive from source bytes and a logical
 * target key rather than from catalog build order.
 */
export function stableRenderTargetId(bytes: Uint8Array, logicalTargetKey: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(bytes)
    .update('\u0000', 'utf8')
    .update(logicalTargetKey, 'utf8')
    .digest('hex');
  return 'fla-render-target-' + digest;
}

interface VisibleSceneGraphicReference {
  readonly libraryItemName: string;
  readonly selectedFrameIndex: number | null;
}

function sceneGraphicFrameIndex(firstFrame: string | undefined): number | null {
  if (firstFrame === undefined) return 0;
  const normalized = firstFrame.trim();
  if (!/^(0|[1-9]\d*)$/u.test(normalized)) return null;
  const frameIndex = Number(normalized);
  return Number.isSafeInteger(frameIndex) ? frameIndex : null;
}

function collectVisibleSceneGraphicReferences(
  elements: readonly FlaDisplayListElement[],
  result: VisibleSceneGraphicReference[],
): void {
  for (const element of elements) {
    if (element.visible === false) continue;
    if (element.kind === 'symbol' && element.symbolType === 'graphic') {
      result.push({
        libraryItemName: element.libraryItemName,
        selectedFrameIndex: sceneGraphicFrameIndex(element.firstFrame),
      });
    } else if (element.kind === 'group') {
      collectVisibleSceneGraphicReferences(element.elements, result);
    }
  }
}

async function displaySourceFromArchive(
  archive: ParsedArchive,
  execution?: FlaStaticSnapshotDisplaySourceExecution,
): Promise<{ readonly ok: true; readonly source: FlaStaticSnapshotDisplaySource } | BuildSvgFailure> {
  // ActionScript is never interpreted; static display-list extraction does
  // not need to reject otherwise renderable frames that happen to contain it.
  const adapted = execution
    ? await adaptFlaXflDisplaySourceCooperatively(archive.docXml, archive.libraryXmlEntries, execution)
    : adaptFlaXflDisplaySource(archive.docXml, archive.libraryXmlEntries);
  if (!adapted.ok) return adapted;
  return { ok: true, source: adapted.source };
}

function mapResolverFailure(result: FlaDisplayListResolverResult): BuildSvgFailure {
  if (result.ok) return { ok: false, code: 'RENDER_FAILED', message: 'Expected a failed display-list resolution' };
  const code = result.code === 'MAX_RECURSION_DEPTH_EXCEEDED' ||
      result.code === 'MAX_RESOLVED_NODES_EXCEEDED'
    ? 'BUDGET_EXCEEDED'
    : result.code === 'MISSING_SYMBOL' || result.code === 'SYMBOL_CYCLE' ||
        result.code === 'UNSUPPORTED_SYMBOL_TYPE' ||
        result.code === 'UNSUPPORTED_DISPLAY_CONTENT'
      ? 'TARGET_UNSUPPORTED'
      : 'RENDER_FAILED';
  return { ok: false, code, message: (result.message + ' (' + result.sourcePath + ')').slice(0, 1_000) };
}

function resolveTargetDisplayList(
  source: FlaStaticSnapshotDisplaySource,
  target: FlaRenderTarget,
): {
  readonly ok: true;
  readonly displayList: FlaResolvedDisplayList;
  readonly shapeBlocks: ReadonlyMap<string, string>;
  readonly staticTextBlocks: ReadonlyMap<string, FlaStaticTextDescriptor>;
} | BuildSvgFailure {
  let root: FlaDisplayListResolverInput['root'];
  let playbackFrameIndex: number | undefined;
  if (target.kind === 'graphic-symbol') {
    const sourceName = target.sourceLibraryItemName;
    const descriptor = sourceName
      ? source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === sourceName)
      : undefined;
    if (!descriptor) {
      return { ok: false, code: 'TARGET_UNSUPPORTED', message: 'Graphic symbol not found: ' + (sourceName ?? '(unset)') };
    }
    const selectedFrameIndex = target.selectedFrameIndex ?? 0;
    const frameCount = Math.min(target.frameCount, descriptor.frameCount);
    if (selectedFrameIndex >= frameCount) {
      return { ok: false, code: 'TARGET_OUT_OF_RANGE', message: 'selectedFrameIndex ' + selectedFrameIndex + ' >= frameCount ' + frameCount };
    }
    // The adapter already resolved index 0 to populate the accepted P0
    // symbol table and catalog descriptor. Reuse that frame-local context so
    // a normal first-frame preview does not spend the bounded source-node
    // budget parsing the same source elements a second time.
    let frameContext: ReturnType<FlaStaticSnapshotDisplaySource['buildGraphicFrameContext']>;
    if (selectedFrameIndex === 0) {
      source.resetFrameBuildState();
      frameContext = { ok: true, value: descriptor.frameContext };
    } else {
      frameContext = source.buildGraphicFrameContext(
          descriptor.timelineXml,
          descriptor.frameSpanIndex,
          selectedFrameIndex,
          'graphic:' + descriptor.sourceLibraryItemName,
        );
    }
    if (!frameContext.ok) {
      return {
        ok: false,
        code: frameContext.code === 'BUDGET_EXCEEDED' ? 'BUDGET_EXCEEDED' : 'RENDER_FAILED',
        message: frameContext.message,
      };
    }
    root = {
      kind: 'graphic',
      name: descriptor.sourceLibraryItemName,
      frameContext: frameContext.value,
    };
  } else if (target.kind === 'scene' || target.kind === 'timeline') {
    const timelineIndex = target.sourceTimelineIndex ?? 0;
    const descriptor = source.sceneTimelines.find((timeline) => timeline.index === timelineIndex);
    if (!descriptor) {
      return { ok: false, code: 'TARGET_UNSUPPORTED', message: 'Scene timeline not found: ' + timelineIndex };
    }
    const selectedFrameIndex = target.selectedFrameIndex ?? 0;
    if (selectedFrameIndex >= target.frameCount ||
        selectedFrameIndex >= (descriptor.playbackFrameCount ?? descriptor.frameCount)) {
      return { ok: false, code: 'TARGET_OUT_OF_RANGE', message: 'selectedFrameIndex ' + selectedFrameIndex + ' >= frameCount ' + target.frameCount };
    }
    let frameContext: ReturnType<FlaStaticSnapshotDisplaySource['buildSceneFrameContext']>;
    if (selectedFrameIndex === 0 || descriptor.playbackFrameCount !== undefined) {
      source.resetFrameBuildState();
      frameContext = { ok: true, value: descriptor.frameContext };
      playbackFrameIndex = selectedFrameIndex;
    } else {
      frameContext = source.buildSceneFrameContext(descriptor.xml, selectedFrameIndex, 'scene:' + timelineIndex);
    }
    if (!frameContext.ok) {
      return {
        ok: false,
        code: frameContext.code === 'BUDGET_EXCEEDED' ? 'BUDGET_EXCEEDED' : 'RENDER_FAILED',
        message: frameContext.message,
      };
    }
    root = {
      kind: 'scene',
      name: descriptor.name,
      frameContext: frameContext.value,
    };
  } else {
    return { ok: false, code: 'TARGET_UNSUPPORTED', message: 'Unknown target kind: ' + (target.kind as string) };
  }

  // Selected-frame parsing resets the adapter's mutable source map each time.
  // Keep only base blocks plus Shape/Text blocks referenced by selected contexts.
  const shapeBlocks = new Map(source.shapeBlocks);
  const staticTextBlocks = new Map<string, FlaStaticTextDescriptor>(source.staticTextBlocks ?? []);
  const shapeBlockLimit = DEFAULT_FLA_DISPLAY_LIST_RESOLVER_LIMITS.maxResolvedNodeCount;
  let shapeBlockBudgetExceeded = false;
  const captureShapeBlocks = (elements: readonly FlaDisplayListElement[]): string | null => {
    for (const element of elements) {
      if (element.visible === false) continue;
      if (element.kind === 'shape') {
        if (shapeBlocks.has(element.shapeId)) continue;
        const xml = source.shapeBlocks.get(element.shapeId);
        if (xml === undefined) return `Selected Graphic shape source not found: ${element.shapeId}`;
        if (shapeBlocks.size >= shapeBlockLimit) {
          shapeBlockBudgetExceeded = true;
          return `Nested Graphic shape-source blocks exceeded ${shapeBlockLimit}`;
        }
        shapeBlocks.set(element.shapeId, xml);
      } else if (element.kind === 'text') {
        if (staticTextBlocks.has(element.textId)) continue;
        const descriptor = source.staticTextBlocks?.get(element.textId);
        if (descriptor === undefined) return `Selected Graphic static text source not found: ${element.textId}`;
        if (staticTextBlocks.size >= FLA_STATIC_TEXT_LIMITS.maxTextNodesPerComposition * 4) {
          shapeBlockBudgetExceeded = true;
          return `Nested Graphic static text blocks exceeded budget`;
        }
        staticTextBlocks.set(element.textId, descriptor);
      } else if (element.kind === 'group') {
        const nestedError = captureShapeBlocks(element.elements);
        if (nestedError) return nestedError;
      }
    }
    return null;
  };
  const selectionSource: FlaStaticSnapshotDisplaySource = {
    ...source,
    buildGraphicFrameContext: (timelineXml, frameSpanIndex, frameIndex, scope) => {
      const frameContext = source.buildGraphicFrameContext(
        timelineXml,
        frameSpanIndex,
        frameIndex,
        scope,
      );
      if (!frameContext.ok) return frameContext;
      for (const layer of frameContext.value.layers) {
        if (!layer.visible && !layer.maskLayerId) continue;
        const captureError = captureShapeBlocks(layer.elements);
        if (captureError) {
          return {
            ok: false,
            code: shapeBlockBudgetExceeded ? 'BUDGET_EXCEEDED' : 'RENDER_FAILED',
            message: captureError,
          };
        }
      }
      return frameContext;
    },
  };
  const nested = prepareFlaNestedGraphicFrameSelections(selectionSource, root,
    playbackFrameIndex === undefined ? {} : { playbackFrameIndex });
  if (shapeBlockBudgetExceeded) {
    return {
      ok: false,
      code: 'BUDGET_EXCEEDED',
      message: `Nested Graphic shape-source blocks exceeded ${shapeBlockLimit}`,
    };
  }
  if (!nested.ok) {
    const code = nested.code === 'BUDGET_EXCEEDED'
      ? 'BUDGET_EXCEEDED'
      : nested.code === 'FRAME_CONTEXT_FAILED'
        ? 'RENDER_FAILED'
        : 'TARGET_UNSUPPORTED';
    const sourceAddress = nested.sourceAddress ? ` (${nested.sourceAddress})` : '';
    return {
      ok: false,
      code,
      message: `${nested.code}: ${nested.message}${sourceAddress}`.slice(0, 1_000),
    };
  }

  const resolved = resolveFlaDisplayList(nested.resolverInput);
  if (!resolved.ok) return mapResolverFailure(resolved);
  return { ok: true, displayList: resolved.displayList, shapeBlocks, staticTextBlocks };
}

function catalogSupportReason(
  shapeBlocks: ReadonlyMap<string, string>,
  displayList: FlaResolvedDisplayList,
  resolveBitmapMedia: FlaStaticSnapshotBitmapMediaLookup,
  allowBlankFrame = false,
  staticTextBlocks?: ReadonlyMap<string, FlaStaticTextDescriptor>,
): { unsupportedReason: string | null; isBlank: boolean } {
  let drawableCount = 0;
  let reason: string | null = null;
  const visit = (node: FlaResolvedDisplayNode): void => {
    if (reason) return;
    if (node.kind === 'group') {
      for (const child of node.children) visit(child);
      return;
    }
    drawableCount += 1;
    if (node.kind === 'bitmap') {
      const media = resolveBitmapMedia(node.libraryItemName);
      if (!media.ok) reason = 'Bitmap media ' + (media.reason === 'ambiguous' ? 'is ambiguous: ' : 'was not found: ') + node.libraryItemName;
      return;
    }
    if (node.kind === 'text') {
      if (!staticTextBlocks?.has(node.textId)) {
        reason = 'Static text source not found: ' + node.textId;
      }
      return;
    }
    const shapeBlock = shapeBlocks.get(node.shapeId);
    const shape = shapeBlock ? parseShapeAt(shapeBlock) : null;
    if (!shape) {
      reason = 'Shape has no supported path data: ' + node.shapeId;
      return;
    }
    if (shape.issue) {
      reason = shape.issue.message;
      return;
    }
    if (!shape.edgeStrings.some(({ cubics, edges }) => Boolean(cubics || edges))) {
      reason = 'Shape has no supported path data: ' + node.shapeId;
    }
  };
  for (const layer of displayList.layers) {
    for (const node of layer.children) visit(node);
  }
  if (reason) return { unsupportedReason: reason, isBlank: false };
  const isBlank = drawableCount === 0;
  return {
    unsupportedReason: isBlank && !allowBlankFrame
      ? 'No visible bitmap or vector content is available in this frame'
      : null,
    isBlank,
  };
}

export async function prepareFlaStaticSnapshotDisplaySource(
  bytes: Uint8Array,
  operation: 'catalog' | 'preview',
  execution?: FlaStaticSnapshotDisplaySourceExecution,
): Promise<FlaStaticSnapshotPreparedDisplaySourceResult> {
  const archive = await parseArchive(bytes, operation, execution);
  if (!archive.ok) return archive;
  const adaptStartedAt = startIssue762Profile();
  const adapted = await displaySourceFromArchive(archive.archive, execution);
  if (!adapted.ok) return adapted;
  finishIssue762Profile(`fla.${operation}.display-source-adapt`, adaptStartedAt, {
    libraryXmlEntryCount: archive.archive.libraryXmlEntries.length,
    xmlByteLength: archive.archive.xmlByteLength,
  });
  return {
    ok: true,
    source: adapted.source,
    xmlByteLength: archive.archive.xmlByteLength,
  };
}

export function readFlaSourceFrameLabel({ name, labelType }: {
  name?: string;
  labelType?: string;
}): FlaSourceFrameSuggestion['label'] {
  const text = name?.trim().slice(0, 120);
  return text && (labelType === 'name' || labelType === 'comment' || labelType === 'anchor')
    ? { text, type: labelType } : undefined;
}

/** Work on the selected source's authored spans without resolving any display lists. */
function listSourceFrameSuggestions(
  source: FlaStaticSnapshotDisplaySource,
  query: FlaSourceFrameSuggestionQuery,
): NonNullable<BuildCatalogSuccess['frameSuggestions']> {
  const index = query.sourceLibraryItemName !== undefined
    ? source.graphicSymbols.find(symbol => symbol.sourceLibraryItemName === query.sourceLibraryItemName)?.frameSpanIndex
    : source.sceneTimelines.find(timeline => timeline.index === query.sourceTimelineIndex)?.frameSpanIndex;
  const byKey = new Map<string, FlaSourceFrameSuggestion>();
  const search = query.search.trim().toLocaleLowerCase('en-US');
  for (const layer of index?.layers ?? []) {
    for (const span of layer.spans) {
      const label = readFlaSourceFrameLabel(span.sourceFrame.attributes);
      if (!layer.visible && !label) continue;
      const sourceFrameIndex = span.index;
      if (search && !label?.text.toLocaleLowerCase('en-US').includes(search) &&
          !String(sourceFrameIndex + 1).includes(search)) continue;
      const key = JSON.stringify([sourceFrameIndex, label?.type, label?.text]);
      byKey.set(key, { sourceFrameIndex, ...(label ? { label } : {}) });
    }
  }
  const suggestions = [...byKey.values()].sort((left, right) =>
    Number(right.label?.type === 'name') - Number(left.label?.type === 'name') ||
    left.sourceFrameIndex - right.sourceFrameIndex,
  );
  const end = query.offset + FLA_SOURCE_FRAME_SUGGESTION_PAGE_SIZE;
  return { items: suggestions.slice(query.offset, end), hasMore: suggestions.length > end };
}

// ---- Public catalog builder ----
export async function buildRenderableTargetCatalog(
  bytes: Uint8Array,
  resolveBitmapMedia: FlaStaticSnapshotBitmapMediaLookup = () => ({ ok: false, reason: 'missing' }),
  options: {
    readonly includeAuthoredStates?: boolean;
    readonly metadataOnlyBitmaps?: boolean;
    readonly frameSuggestionsFor?: FlaSourceFrameSuggestionQuery;
  } = {},
  preparedDisplaySource?: FlaStaticSnapshotDisplaySource,
  execution?: FlaStaticSnapshotDisplaySourceExecution,
): Promise<BuildCatalogResult> {
  const catalogStartedAt = startIssue762Profile();
  if (execution && !execution.shouldContinue()) {
    return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
  }
  const sourceResult = preparedDisplaySource
    ? { ok: true as const, source: preparedDisplaySource }
    : await prepareFlaStaticSnapshotDisplaySource(bytes, 'catalog', execution);
  if (!sourceResult.ok) return sourceResult;
  if (execution && !execution.shouldContinue()) {
    return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
  }
  const source = sourceResult.source;
  if (options.frameSuggestionsFor) {
    return {
      ok: true, entries: [], omittedCandidateCount: 0,
      summary: '源关键帧',
      frameSuggestions: listSourceFrameSuggestions(source, options.frameSuggestionsFor),
    };
  }
  const entries: BuildCatalogSuccess['entries'] = [];
  let omittedCandidateCount: number;
  let candidateIndex = 0;
  const enumerationStartedAt = startIssue762Profile();

  const evaluateCandidate = (
    target: FlaRenderTarget,
    catalogRole: FlaRenderableTargetCatalogRole,
  ): BuildCatalogSuccess['entries'][number] => {
    const candidateStartedAt = startIssue762Profile();
    const currentCandidateIndex = candidateIndex++;
    const candidateDetails = {
      candidateIndex: currentCandidateIndex,
      targetId: target.renderTargetId,
      targetKind: target.kind,
      selectedFrameIndex: target.selectedFrameIndex ?? 0,
    };
    const resolveStartedAt = startIssue762Profile();
    const resolved = resolveTargetDisplayList(source, target);
    finishIssue762Profile('fla.catalog.candidate.resolve', resolveStartedAt, candidateDetails);
    const supportStartedAt = startIssue762Profile();
    const check = resolved.ok
      ? catalogSupportReason(resolved.shapeBlocks, resolved.displayList, resolveBitmapMedia, true, resolved.staticTextBlocks)
      : { unsupportedReason: resolved.message, isBlank: false };
    finishIssue762Profile('fla.catalog.candidate.support-check', supportStartedAt, {
      ...candidateDetails,
      resolved: resolved.ok,
    });
    let unsupportedReason = check.unsupportedReason;
    if (resolved.ok && !unsupportedReason &&
        (!check.isBlank || resolved.displayList.maskDiagnostics?.length || resolved.displayList.ikPoseDiagnostics?.length)) {
      // Use the exact production SVG composition path as the capability
      // check. The previous structural-only check incorrectly marked some
      // gradient-stroke targets as previewable even though this builder
      // rejected them later at Preview time.
      const compositionStartedAt = startIssue762Profile();
      const composed = buildSvgForResolvedDisplayList({
        displayList: resolved.displayList,
        renderTargetId: target.renderTargetId,
        stageWidth: source.stageWidth,
        stageHeight: source.stageHeight,
        shapeBlocks: resolved.shapeBlocks,
        staticTextBlocks: resolved.staticTextBlocks,
        resolveBitmapMedia,
        metadataOnlyBitmaps: options.metadataOnlyBitmaps,
      });
      finishIssue762Profile('fla.catalog.candidate.svg-capability', compositionStartedAt, {
        ...candidateDetails,
        composed: composed.ok,
      });
      if (!composed.ok) unsupportedReason = composed.message;
    }
    const entry = {
      target,
      catalogRole,
      previewSupported: unsupportedReason === null,
      isBlank: check.isBlank,
      ...(unsupportedReason ? { unsupportedReason } : {}),
    };
    finishIssue762Profile('fla.catalog.candidate.total', candidateStartedAt, {
      ...candidateDetails,
      previewSupported: unsupportedReason === null,
      isBlank: check.isBlank,
    });
    return entry;
  };
  const appendCandidate = (target: FlaRenderTarget, role: FlaRenderableTargetCatalogRole): boolean => {
    if (entries.length >= MAX_TARGETS) return false;
    entries.push(evaluateCandidate(target, role));
    return true;
  };

  const scene = source.sceneTimelines[0];
  let sceneEntry: BuildCatalogSuccess['entries'][number] | undefined;
  if (scene && scene.frameCount > 0) {
    const frameZeroHasElements = scene.frameContext.layers.some((layer) => layer.visible && layer.elements.length > 0);
    const coverIndices = frameZeroHasElements ? [0] : scene.laterCoverFrameIndices ?? [];
    for (const frameIndex of coverIndices) {
      const entry = evaluateCandidate({
        renderTargetId: stableRenderTargetId(bytes, 'scene\u0000timeline\u0000' + scene.index),
        kind: 'scene',
        userLabel: `主场景 · 第 ${frameIndex + 1} 帧`,
        sourceTimelineIndex: scene.index,
        frameCount: Math.min(100_000, scene.playbackFrameCount ?? scene.frameCount),
        selectedFrameIndex: frameIndex,
        compatibility: ['degraded'],
      }, 'scene');
      if (frameIndex === 0 || (entry.previewSupported && !entry.isBlank)) {
        sceneEntry = entry;
        break;
      }
      if (frameIndex === scene.firstObjectMotionFrameIndex && !entry.previewSupported) sceneEntry = entry;
      if (execution) {
        await execution.yieldToEventLoop();
        if (!execution.shouldContinue()) return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
      }
    }
  }
  if (sceneEntry && !options.includeAuthoredStates) {
    entries.push(sceneEntry);
    if (execution) {
      await execution.yieldToEventLoop();
      if (!execution.shouldContinue()) {
        return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
      }
    }
  }

  // Nested Graphic targets go first so the fixed catalog limit cannot hide
  // the recursion path required by the nested-symbol acceptance corpus.
  const orderedSymbols = [
    ...source.graphicSymbols.filter((symbol) => symbol.hasNestedSymbol),
    ...source.graphicSymbols.filter((symbol) => !symbol.hasNestedSymbol),
  ];
  const sceneRootReferences: VisibleSceneGraphicReference[] = [];
  if (scene) {
    for (const layer of scene.frameContext.layers) {
      if (layer.visible) collectVisibleSceneGraphicReferences(layer.elements, sceneRootReferences);
    }
  }
  const sceneRootFrameZeroSymbols = new Set(
    sceneRootReferences
      .filter((reference) => reference.selectedFrameIndex === 0)
      .map((reference) => reference.libraryItemName),
  );
  const candidateSymbolsBySourceName = new Map<string, typeof orderedSymbols[number] | null>();
  for (const symbol of orderedSymbols) {
    candidateSymbolsBySourceName.set(
      symbol.sourceLibraryItemName,
      candidateSymbolsBySourceName.has(symbol.sourceLibraryItemName) ? null : symbol,
    );
  }
  const candidateSymbols = orderedSymbols.filter(
    (symbol) => symbol.hasPotentialDisplayElements &&
      candidateSymbolsBySourceName.get(symbol.sourceLibraryItemName) === symbol,
  );
  const createGraphicTarget = (symbol: typeof candidateSymbols[number], frameIndex: number): FlaRenderTarget => ({
    renderTargetId: stableRenderTargetId(
      bytes,
      'graphic-symbol\u0000' + symbol.sourceLibraryItemName + '\u0000' + symbol.userLabel +
        (frameIndex === 0 ? '' : '\u0000frame\u0000' + frameIndex),
    ),
    kind: 'graphic-symbol',
    userLabel: symbol.userLabel,
    sourceLibraryItemName: symbol.sourceLibraryItemName,
    frameCount: Math.min(100_000, Math.max(1, symbol.frameCount)),
    selectedFrameIndex: frameIndex,
    compatibility: ['degraded'],
  });

  if (!options.includeAuthoredStates) {
    const availableGraphicSlots = Math.max(0, MAX_TARGETS - entries.length);
    const selectedSymbols = candidateSymbols.slice(0, availableGraphicSlots);
    const selectedSymbolNames = new Set(selectedSymbols.map((symbol) => symbol.sourceLibraryItemName));
    // Preserve every already-listed candidate and its order. When a visible
    // Scene root would otherwise fall beyond the 64-target cap, replace only
    // the last selected non-root candidate and append that root at the end.
    for (const symbol of candidateSymbols) {
      if (!sceneRootFrameZeroSymbols.has(symbol.sourceLibraryItemName) || selectedSymbolNames.has(symbol.sourceLibraryItemName)) {
        continue;
      }
      let replaceIndex = -1;
      for (let index = selectedSymbols.length - 1; index >= 0; index -= 1) {
        const candidate = selectedSymbols[index];
        if (candidate && !sceneRootFrameZeroSymbols.has(candidate.sourceLibraryItemName)) {
          replaceIndex = index;
          break;
        }
      }
      if (replaceIndex < 0) continue;
      const [displaced] = selectedSymbols.splice(replaceIndex, 1);
      if (displaced) selectedSymbolNames.delete(displaced.sourceLibraryItemName);
      selectedSymbols.push(symbol);
      selectedSymbolNames.add(symbol.sourceLibraryItemName);
    }
    for (const symbol of selectedSymbols) {
      appendCandidate(
        createGraphicTarget(symbol, 0),
        sceneRootFrameZeroSymbols.has(symbol.sourceLibraryItemName)
          ? 'scene-referenced-graphic'
          : 'graphic-state',
      );
      if (execution) {
        await execution.yieldToEventLoop();
        if (!execution.shouldContinue()) {
          return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
        }
      }
    }
    omittedCandidateCount = candidateSymbols.length - selectedSymbols.length;
  } else {
    const authoredFramesBySymbol = new Map<string, number[]>();
    let totalGraphicCandidateCount = 0;
    for (const symbol of candidateSymbols) {
      const authoredFrameIndices = [...new Set(
          symbol.frameSpanIndex.layers
            .filter((layer) => layer.visible)
            .flatMap((layer) => layer.spans.map((span) => span.index)),
        )].sort((left, right) => left - right);
      authoredFramesBySymbol.set(symbol.sourceLibraryItemName, authoredFrameIndices);
      totalGraphicCandidateCount += authoredFrameIndices.length;
    }

    const prioritizedRootKeys = new Set<string>();
    const listedLongTargets = new Set<string>();
    const isLongSymbol = (symbol: typeof candidateSymbols[number]): boolean =>
      symbol.frameCount > FLA_GRAPHIC_MAX_FRAMES;
    const appendRootReferences = async (): Promise<boolean> => {
      for (const reference of sceneRootReferences) {
        const frameIndex = reference.selectedFrameIndex;
        if (frameIndex === null) continue;
        const symbol = candidateSymbolsBySourceName.get(reference.libraryItemName);
        if (!symbol) continue;
        const authoredFrameIndices = authoredFramesBySymbol.get(symbol.sourceLibraryItemName) ?? [];
        if (!authoredFrameIndices.includes(frameIndex)) continue;
        const key = `${symbol.sourceLibraryItemName}\u0000${frameIndex}`;
        if (prioritizedRootKeys.has(key) || listedLongTargets.has(symbol.sourceLibraryItemName)) continue;
        if (!appendCandidate(createGraphicTarget(symbol, frameIndex), 'scene-referenced-graphic')) break;
        prioritizedRootKeys.add(key);
        if (isLongSymbol(symbol)) listedLongTargets.add(symbol.sourceLibraryItemName);
        if (execution) {
          await execution.yieldToEventLoop();
          if (!execution.shouldContinue()) return false;
        }
      }
      return true;
    };

    if (!await appendRootReferences()) {
      return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
    }

    if (sceneEntry && entries.length < MAX_TARGETS) {
      entries.push(sceneEntry);
      if (execution) {
        await execution.yieldToEventLoop();
        if (!execution.shouldContinue()) {
          return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
        }
      }
    }

    if (entries.length < MAX_TARGETS) {
      outer: for (const symbol of candidateSymbols) {
        if (listedLongTargets.has(symbol.sourceLibraryItemName)) continue;
        const authoredFrameIndices = authoredFramesBySymbol.get(symbol.sourceLibraryItemName) ?? [];
        const coverIndices = isLongSymbol(symbol) ? authoredFrameIndices.slice(0, 1) : authoredFrameIndices;
        for (const frameIndex of coverIndices) {
          const key = `${symbol.sourceLibraryItemName}\u0000${frameIndex}`;
          if (prioritizedRootKeys.has(key)) continue;
          appendCandidate(createGraphicTarget(symbol, frameIndex), 'graphic-state');
          if (entries.length >= MAX_TARGETS) break outer;
          if (execution) {
            await execution.yieldToEventLoop();
            if (!execution.shouldContinue()) {
              return { ok: false, code: 'RENDER_FAILED', message: 'Catalog operation was cancelled' };
            }
          }
        }
      }
    }
    omittedCandidateCount = Number(sceneEntry !== undefined) + totalGraphicCandidateCount - entries.length;
  }

  finishIssue762Profile('fla.catalog.enumeration', enumerationStartedAt, {
    candidateCount: entries.length,
    omittedCandidateCount,
  });

  const supportedCount = entries.filter((entry) => entry.previewSupported && !entry.isBlank).length;
  const unsupportedCount = entries.filter((entry) => !entry.previewSupported).length;
  const blankCount = entries.filter((entry) => entry.isBlank).length;
  const omittedNote = omittedCandidateCount > 0
    ? '；另有 ' + omittedCandidateCount + ' 个候选因数量上限未列出'
    : '';
  const summary = entries.length === 0
    ? '这个 FLA 没有发现可检查的图形状态。'
    : '发现 ' + entries.length + ' 个已列出的状态：' + supportedCount + ' 个可预览、' +
      unsupportedCount + ' 个暂不可预览、' + blankCount + ' 个空白状态' + omittedNote + '。';
  finishIssue762Profile('fla.catalog.total', catalogStartedAt, {
    candidateCount: entries.length,
    omittedCandidateCount,
    supportedCount,
    unsupportedCount,
    blankCount,
    sourceByteLength: bytes.byteLength,
  });
  return { ok: true, entries, omittedCandidateCount, summary };
}

// ---- Public SVG builder for a given render target ----
export async function buildSvgForRenderTarget(
  bytes: Uint8Array,
  target: FlaRenderTarget,
  resolveBitmapMedia: FlaStaticSnapshotBitmapMediaLookup = () => ({ ok: false, reason: 'missing' }),
  preparedDisplaySource?: FlaStaticSnapshotDisplaySource,
  budgetOverrides?: {
    readonly maxPathCommandsPerShape?: number;
    readonly maxPathCommandsPerComposition?: number;
  },
): Promise<BuildComposedSvgResult> {
  const previewStartedAt = startIssue762Profile();
  const details = {
    targetId: target.renderTargetId,
    targetKind: target.kind,
    selectedFrameIndex: target.selectedFrameIndex ?? 0,
  };
  const sourceResult = preparedDisplaySource
    ? { ok: true as const, source: preparedDisplaySource }
    : await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!sourceResult.ok) return sourceResult;
  const source = sourceResult.source;
  const resolveStartedAt = startIssue762Profile();
  const resolved = resolveTargetDisplayList(source, target);
  if (!resolved.ok) return resolved;
  finishIssue762Profile('fla.preview.display-list-resolve', resolveStartedAt, details);
  const svgStartedAt = startIssue762Profile();
  const result = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId: target.renderTargetId,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: resolved.shapeBlocks,
    staticTextBlocks: resolved.staticTextBlocks,
    resolveBitmapMedia,
    ...(budgetOverrides?.maxPathCommandsPerShape !== undefined
      ? { maxPathCommandsPerShape: budgetOverrides.maxPathCommandsPerShape }
      : {}),
    ...(budgetOverrides?.maxPathCommandsPerComposition !== undefined
      ? { maxPathCommandsPerComposition: budgetOverrides.maxPathCommandsPerComposition }
      : {}),
  });
  finishIssue762Profile('fla.preview.svg-compose', svgStartedAt, {
    ...details,
    composed: result.ok,
  });
  finishIssue762Profile('fla.preview.svg-build-total', previewStartedAt, details);
  return result;
}

export interface FlaStaticSnapshotBitmapMedia {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly pngBytes?: Uint8Array;
}

export type FlaStaticSnapshotBitmapMediaLookupResult =
  | { readonly ok: true; readonly media: FlaStaticSnapshotBitmapMedia }
  | { readonly ok: false; readonly reason: 'missing' | 'ambiguous' };

export type FlaStaticSnapshotBitmapMediaLookup = (
  sourceLibraryItemName: string,
) => FlaStaticSnapshotBitmapMediaLookupResult;

export interface BuildComposedSvgSuccess extends BuildSvgSuccess {
  /** Bounded Main-side receipt facts used by acceptance evidence. */
  readonly composition: {
    readonly resolvedNodeCount: number;
    readonly bitmapInstanceCount: number;
    readonly skippedBitmapFillCount: number;
    readonly bitmapFillDiagnostics: readonly {
      readonly shapeId: string;
      readonly fillStyleIndex: number;
      readonly reason: 'missing' | 'ambiguous';
    }[];
    readonly shapeCount: number;
    readonly fillStyleCount: number;
    readonly strokeStyleCount: number;
    readonly styleRunCount: number;
    /** Parsed Edge records, summed over composed shape instances. */
    readonly sourceEdgeCount: number;
    /** Intermediate segmentation, reported without a composition-wide cap. */
    readonly rawStyleRunCount: number;
    /** Distinct fill and stroke style indices with geometry, summed per shape instance. */
    readonly uniqueEffectiveStyleCount: number;
    readonly postReconstructionFillCount: number;
    readonly postReconstructionStrokePathCount: number;
    readonly svgByteLength: number;
    readonly midEdgeStyleChangeCount: number;
    readonly pathCommandCount: number;
    readonly edgeFillStyle0ReferenceCount: number;
    readonly edgeFillStyle1ReferenceCount: number;
    readonly edgeStrokeStyleReferenceCount: number;
    readonly noFillStyle1RunCount: number;
    /** Number of style-indexed solid-fill SVG paths emitted. */
    readonly fillRegionCount: number;
    /** Number of closed style-owned contours emitted across fill paths. */
    readonly fillContourCount: number;
    /** Number of directed source boundary segments used to build those paths. */
    readonly fillBoundarySegmentCount: number;
    /** Number of unique linear-gradient paint servers emitted. */
    readonly linearGradientCount: number;
    /** Number of GradientEntry stops across emitted linear-gradient definitions. */
    readonly linearGradientStopCount: number;
    /** Number of unique radial-gradient paint servers emitted. */
    readonly radialGradientCount: number;
    /** Number of GradientEntry stops across emitted radial-gradient definitions. */
    readonly radialGradientStopCount: number;
    /** Number of connected solid-stroke SVG paths emitted. */
    readonly strokePathCount: number;
    /** Number of authored line/curve segments included in solid strokes. */
    readonly strokeSegmentCount: number;
    readonly groupCount: number;
    readonly expandedSymbolCount: number;
    readonly framing: {
      readonly mode: 'stage' | 'content';
      readonly contentBounds: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      } | null;
      readonly viewBox: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly padding: number;
      readonly outputWidth: number;
      readonly outputHeight: number;
    };
  };
}

export type BuildComposedSvgResult = BuildComposedSvgSuccess | BuildSvgFailure;

export interface BuildComposedSvgInput {
  readonly displayList: FlaResolvedDisplayList;
  /** Stable catalog identity used to scope deterministic SVG paint-server ids. */
  readonly renderTargetId: string;
  readonly stageWidth: number;
  readonly stageHeight: number;
  /** C01 shape ids map to source DOMShape blocks held in the Main process. */
  readonly shapeBlocks: ReadonlyMap<string, string>;
  /** Classic DOMStaticText descriptors held in the Main process. */
  readonly staticTextBlocks?: ReadonlyMap<string, FlaStaticTextDescriptor>;
  /** Resolves names against the Panda-owned inspection-session PNG payloads. */
  readonly resolveBitmapMedia: FlaStaticSnapshotBitmapMediaLookup;
  /** Optional tighter path-command caps (clamped to production ceilings) for deterministic budget tests. */
  readonly maxPathCommandsPerShape?: number;
  readonly maxPathCommandsPerComposition?: number;
  /** Only the catalog capability check may compose without the actual pixels. */
  readonly metadataOnlyBitmaps?: boolean;
}

interface ComposedLeaf {
  readonly layer: FlaResolvedDisplayLayer;
  readonly node: Exclude<FlaResolvedDisplayNode, { readonly kind: 'group' }>;
  readonly compositeGroups: readonly Extract<FlaResolvedDisplayNode, { readonly kind: 'group' }>[];
}

interface Point2D {
  readonly x: number;
  readonly y: number;
}

interface MutableBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Rect2D {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface GraphicViewport {
  readonly contentBounds: Rect2D;
  readonly viewBox: Rect2D;
  readonly outputWidth: number;
  readonly outputHeight: number;
}

function createBounds(): MutableBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function includePoint(bounds: MutableBounds, point: Point2D): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
  return true;
}

function transformPoint(matrix: Matrix2D, point: Point2D): Point2D {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

function transformCommandsForHorizontalStroke(
  commands: DecodedEdges['commands'],
  matrix: Matrix2D,
): string | null {
  const transformed: DecodedEdges['commands'][number][] = [];
  const finite = (point: Point2D): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
  for (const command of commands) {
    if (command.type === 'Z') {
      transformed.push(command);
      continue;
    }
    const endpoint = transformPoint(matrix, command);
    if (!finite(endpoint)) return null;
    if (command.type === 'M' || command.type === 'L') {
      transformed.push({ type: command.type, x: endpoint.x, y: endpoint.y });
      continue;
    }
    if (command.type === 'Q') {
      const control = transformPoint(matrix, { x: command.cx, y: command.cy });
      if (!finite(control)) return null;
      transformed.push({ type: 'Q', cx: control.x, cy: control.y, x: endpoint.x, y: endpoint.y });
      continue;
    }
    const first = transformPoint(matrix, { x: command.c1x, y: command.c1y });
    const second = transformPoint(matrix, { x: command.c2x, y: command.c2y });
    if (!finite(first) || !finite(second)) return null;
    transformed.push({
      type: 'C',
      c1x: first.x,
      c1y: first.y,
      c2x: second.x,
      c2y: second.y,
      x: endpoint.x,
      y: endpoint.y,
    });
  }
  return commandsToSvgPath(transformed);
}

function quadraticValue(start: number, control: number, end: number, t: number): number {
  const inverse = 1 - t;
  return inverse * inverse * start + 2 * inverse * t * control + t * t * end;
}

function cubicValue(start: number, first: number, second: number, end: number, t: number): number {
  const inverse = 1 - t;
  return inverse * inverse * inverse * start +
    3 * inverse * inverse * t * first +
    3 * inverse * t * t * second +
    t * t * t * end;
}

function quadraticExtremum(start: number, control: number, end: number): number | null {
  const denominator = start - 2 * control + end;
  if (!Number.isFinite(denominator)) return Number.NaN;
  if (denominator === 0) return null;
  const t = (start - control) / denominator;
  return t > 0 && t < 1 ? t : null;
}

function cubicExtrema(
  start: number,
  first: number,
  second: number,
  end: number,
): readonly number[] | null {
  const a = -start + 3 * first - 3 * second + end;
  const b = 2 * (start - 2 * first + second);
  const c = first - start;
  if (![a, b, c].every(Number.isFinite)) return null;
  const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
  const epsilon = Number.EPSILON * scale * 8;
  if (Math.abs(a) <= epsilon) {
    if (Math.abs(b) <= epsilon) return [];
    const t = -c / b;
    return t > 0 && t < 1 ? [t] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (!Number.isFinite(discriminant)) return null;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  const q = -0.5 * (b + Math.sign(b || 1) * root);
  const roots = q === 0 ? [-b / (2 * a)] : [q / a, c / q];
  return roots.filter((t) => Number.isFinite(t) && t > 0 && t < 1);
}

function includeQuadraticBounds(
  bounds: MutableBounds,
  start: Point2D,
  control: Point2D,
  end: Point2D,
): boolean {
  if (!includePoint(bounds, start) || !includePoint(bounds, end)) return false;
  const roots = [
    quadraticExtremum(start.x, control.x, end.x),
    quadraticExtremum(start.y, control.y, end.y),
  ];
  if (roots.some((root) => typeof root === 'number' && !Number.isFinite(root))) return false;
  for (const root of roots) {
    if (root === null) continue;
    const point = {
      x: quadraticValue(start.x, control.x, end.x, root),
      y: quadraticValue(start.y, control.y, end.y, root),
    };
    if (!includePoint(bounds, point)) return false;
  }
  return true;
}

function includeCubicBounds(
  bounds: MutableBounds,
  start: Point2D,
  first: Point2D,
  second: Point2D,
  end: Point2D,
): boolean {
  if (!includePoint(bounds, start) || !includePoint(bounds, end)) return false;
  const xRoots = cubicExtrema(start.x, first.x, second.x, end.x);
  const yRoots = cubicExtrema(start.y, first.y, second.y, end.y);
  if (!xRoots || !yRoots) return false;
  for (const t of new Set([...xRoots, ...yRoots])) {
    const point = {
      x: cubicValue(start.x, first.x, second.x, end.x, t),
      y: cubicValue(start.y, first.y, second.y, end.y, t),
    };
    if (!includePoint(bounds, point)) return false;
  }
  return true;
}

function includeTransformedPathBounds(
  bounds: MutableBounds,
  commands: DecodedEdges['commands'],
  matrix: Matrix2D,
): boolean {
  let current: Point2D | null = null;
  let subpathStart: Point2D | null = null;
  const origin = transformPoint(matrix, { x: 0, y: 0 });
  for (const command of commands) {
    if (command.type === 'M') {
      current = transformPoint(matrix, command);
      subpathStart = current;
      if (!includePoint(bounds, current)) return false;
      continue;
    }
    if (command.type === 'Z') {
      if (current && subpathStart && (!includePoint(bounds, current) || !includePoint(bounds, subpathStart))) return false;
      current = subpathStart;
      continue;
    }
    const start = current ?? origin;
    if (command.type === 'L') {
      current = transformPoint(matrix, command);
      if (!includePoint(bounds, start) || !includePoint(bounds, current)) return false;
      continue;
    }
    if (command.type === 'Q') {
      const control = transformPoint(matrix, { x: command.cx, y: command.cy });
      current = transformPoint(matrix, command);
      if (!includeQuadraticBounds(bounds, start, control, current)) return false;
      continue;
    }
    const first = transformPoint(matrix, { x: command.c1x, y: command.c1y });
    const second = transformPoint(matrix, { x: command.c2x, y: command.c2y });
    current = transformPoint(matrix, command);
    if (!includeCubicBounds(bounds, start, first, second, current)) return false;
  }
  return true;
}

function strokeBoundsExpansion(
  style: ParsedSolidStrokeStyle,
  matrix: Matrix2D,
): { readonly x: number; readonly y: number; readonly width: number } | null {
  let width = style.width;
  if (style.scaleMode === 'horizontal') {
    const horizontalScale = Math.hypot(matrix.a, matrix.b);
    width = style.width * horizontalScale;
    if (!Number.isFinite(horizontalScale) || horizontalScale <= 0 ||
        !Number.isFinite(width) || width <= 0 || width > MAX_OUTPUT_WIDTH) return null;
  }
  const capFactor = style.cap === 'square' ? Math.SQRT2 : 1;
  const joinFactor = style.join === 'miter' ? style.miterLimit : 1;
  const radius = (width / 2) * Math.max(capFactor, joinFactor);
  if (style.scaleMode === 'horizontal') {
    return Number.isFinite(radius) ? { x: radius, y: radius, width } : null;
  }
  const x = radius * Math.hypot(matrix.a, matrix.c);
  const y = radius * Math.hypot(matrix.b, matrix.d);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, width } : null;
}

function includeExpandedStrokeBounds(
  bounds: MutableBounds,
  pathBounds: MutableBounds,
  expansion: { readonly x: number; readonly y: number },
): boolean {
  if (![pathBounds.minX, pathBounds.minY, pathBounds.maxX, pathBounds.maxY].every(Number.isFinite)) return false;
  return includePoint(bounds, { x: pathBounds.minX - expansion.x, y: pathBounds.minY - expansion.y }) &&
    includePoint(bounds, { x: pathBounds.maxX + expansion.x, y: pathBounds.maxY + expansion.y });
}

function includeTransformedBitmapBounds(
  bounds: MutableBounds,
  width: number,
  height: number,
  matrix: Matrix2D,
): boolean {
  return [
    transformPoint(matrix, { x: 0, y: 0 }),
    transformPoint(matrix, { x: width, y: 0 }),
    transformPoint(matrix, { x: width, y: height }),
    transformPoint(matrix, { x: 0, y: height }),
  ].every((point) => includePoint(bounds, point));
}

function includeTransformedRectBounds(
  bounds: MutableBounds,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  matrix: Matrix2D,
): boolean {
  return [
    transformPoint(matrix, { x: rect.x, y: rect.y }),
    transformPoint(matrix, { x: rect.x + rect.width, y: rect.y }),
    transformPoint(matrix, { x: rect.x + rect.width, y: rect.y + rect.height }),
    transformPoint(matrix, { x: rect.x, y: rect.y + rect.height }),
  ].every((point) => includePoint(bounds, point));
}

function createGraphicViewport(
  bounds: MutableBounds,
  filterExpansion: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): GraphicViewport | null {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return null;
  if (![filterExpansion.x, filterExpansion.y].every((value) => Number.isFinite(value) && value >= 0)) return null;
  const rawWidth = bounds.maxX - bounds.minX;
  const rawHeight = bounds.maxY - bounds.minY;
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth < 0 || rawHeight < 0) return null;
  const contentBounds: Rect2D = {
    x: bounds.minX - filterExpansion.x,
    y: bounds.minY - filterExpansion.y,
    width: rawWidth + filterExpansion.x * 2,
    height: rawHeight + filterExpansion.y * 2,
  };
  const contentWidth = Math.max(1, contentBounds.width);
  const contentHeight = Math.max(1, contentBounds.height);
  const viewBox: Rect2D = {
    x: contentBounds.x - GRAPHIC_CONTENT_PADDING,
    y: contentBounds.y - GRAPHIC_CONTENT_PADDING,
    width: contentWidth + GRAPHIC_CONTENT_PADDING * 2,
    height: contentHeight + GRAPHIC_CONTENT_PADDING * 2,
  };
  if (![viewBox.x, viewBox.y, viewBox.width, viewBox.height].every(Number.isFinite) ||
      viewBox.width <= 0 || viewBox.height <= 0) return null;

  const size = computeBoundedFlaGraphicOutputSize(viewBox.width, viewBox.height);
  return size ? { contentBounds, viewBox, ...size } : null;
}

function formatSvgNumber(value: number): string {
  return Object.is(value, -0) ? '0' : value.toString();
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function matrixIsFinite(matrix: FlaResolvedDisplayNode['worldTransform']): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].every(Number.isFinite);
}

function isSupportedFrameBlurFilter(value: unknown): value is FlaDisplayListBlurFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const filter = value as Record<string, unknown>;
  return Object.keys(filter).every((key) => ['kind', 'blurX', 'blurY', 'quality', 'enabled'].includes(key)) &&
    filter.kind === 'blur' &&
    typeof filter.blurX === 'number' && Number.isFinite(filter.blurX) && filter.blurX >= 0 && filter.blurX <= 255 &&
    typeof filter.blurY === 'number' && Number.isFinite(filter.blurY) && filter.blurY >= 0 && filter.blurY <= 255 &&
    filter.quality === 'low' && filter.enabled === true;
}

function isPngWithExpectedDimensions(
  bytes: Uint8Array,
  width: number,
  height: number,
): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 33 || signature.some((value, index) => bytes[index] !== value)) return false;
  const readUint32 = (offset: number): number =>
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0);
  return readUint32(16) === width && readUint32(20) === height && bytes[25] === 6;
}

function flattenResolvedDisplayList(
  displayList: FlaResolvedDisplayList,
): {
  readonly ok: true;
  readonly leaves: readonly ComposedLeaf[];
  readonly groupCount: number;
  readonly expandedSymbolCount: number;
} | BuildSvgFailure {
  const leaves: ComposedLeaf[] = [];
  let visited = 0;
  let groupCount = 0;
  let expandedSymbolCount = 0;
  const visit = (
    node: FlaResolvedDisplayNode,
    depth: number,
    layer: FlaResolvedDisplayLayer,
    compositeGroups: readonly Extract<FlaResolvedDisplayNode, { readonly kind: 'group' }>[] = [],
  ): BuildSvgFailure | null => {
    visited += 1;
    if (visited > 100_000) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Resolved display list exceeds the node budget' };
    }
    if (depth > 64) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Resolved display list exceeds the recursion budget' };
    }
    if (!matrixIsFinite(node.worldTransform)) {
      return { ok: false, code: 'RENDER_FAILED', message: 'Resolved display list contains a non-finite transform' };
    }
    if (node.kind === 'group') {
      groupCount += 1;
      if (node.symbolLibraryItemName) expandedSymbolCount += 1;
      if (node.opacity !== undefined &&
          (!Number.isFinite(node.opacity) || node.opacity < 0 || node.opacity > 1)) {
        return { ok: false, code: 'RENDER_FAILED', message: 'Resolved display list contains an invalid group opacity' };
      }
      if (node.rgbTransform !== undefined && !isValidFlaDisplayListRgbTransform(node.rgbTransform)) {
        return { ok: false, code: 'RENDER_FAILED', message: 'Resolved display list contains an invalid group RGB transform' };
      }
      const childCompositeGroups = node.opacity !== undefined && node.opacity < 1 || node.rgbTransform !== undefined
        ? [...compositeGroups, node]
        : compositeGroups;
      for (const child of node.children) {
        const nestedFailure = visit(child, depth + 1, layer, childCompositeGroups);
        if (nestedFailure) return nestedFailure;
      }
      return null;
    }
    leaves.push({ layer, node, compositeGroups });
    return null;
  };

  for (const layer of displayList.layers) {
    for (const node of layer.children) {
      const nestedFailure = visit(node, 0, layer);
      if (nestedFailure) return nestedFailure;
    }
  }
  if (displayList.resolvedNodeCount > 100_000 || visited > displayList.resolvedNodeCount) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Resolved display-list count is inconsistent or exceeds its budget' };
  }
  return { ok: true, leaves, groupCount, expandedSymbolCount };
}

/**
 * C02 compositor for an already-resolved C01 tree. It flattens drawable leaves
 * and applies each absolute worldTransform once; group transforms are never
 * nested around descendants that already carry absolute matrices. Layers and
 * leaves are emitted in input order. The XFL adapter supplies layers in
 * back-to-front painter order, and SVG paints later siblings on top.
 */
export function buildSvgForResolvedDisplayList(input: BuildComposedSvgInput): BuildComposedSvgResult {
  const { displayList, renderTargetId, stageWidth, stageHeight, shapeBlocks, staticTextBlocks, resolveBitmapMedia } = input;
  if (!displayList || !Array.isArray(displayList.layers) || !shapeBlocks ||
      typeof shapeBlocks.get !== 'function' ||
      typeof renderTargetId !== 'string' || renderTargetId.length === 0 || renderTargetId.length > 512 ||
      typeof resolveBitmapMedia !== 'function') {
    return { ok: false, code: 'RENDER_FAILED', message: 'Invalid composed display-list input' };
  }
  if (!Number.isFinite(stageWidth) || !Number.isFinite(stageHeight) || stageWidth <= 0 || stageHeight <= 0) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Stage dimensions must be finite and positive' };
  }
  const framingMode = displayList.kind === 'graphic' ? 'content' : 'stage';
  const stageOutputWidth = Math.ceil(stageWidth);
  const stageOutputHeight = Math.ceil(stageHeight);
  if (framingMode === 'stage') {
    if (stageOutputWidth > MAX_OUTPUT_WIDTH || stageOutputHeight > MAX_OUTPUT_HEIGHT) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: `Output ${stageOutputWidth}x${stageOutputHeight} exceeds budget` };
    }
    if (stageOutputWidth * stageOutputHeight > MAX_OUTPUT_PIXELS) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: `Output pixel count ${stageOutputWidth * stageOutputHeight} exceeds ${MAX_OUTPUT_PIXELS}` };
    }
  }

  const flattened = flattenResolvedDisplayList(displayList);
  if (!flattened.ok) return flattened;

  const frameBlurIdByLayer = new Map<FlaResolvedDisplayLayer, string>();
  const frameBlurById = new Map<string, FlaDisplayListBlurFilter>();
  let maxFrameBlurExpansionX = 0;
  let maxFrameBlurExpansionY = 0;
  for (const [layerIndex, layer] of displayList.layers.entries()) {
    if (!layer.frameFilter) continue;
    if (!isSupportedFrameBlurFilter(layer.frameFilter)) {
      return { ok: false, code: 'TARGET_UNSUPPORTED', message: `Layer ${layer.name} contains an unsupported frame filter` };
    }
    if (!flattened.leaves.some((leaf) => leaf.layer === layer)) continue;
    const filterId = `fla-frame-blur-${crypto.createHash('sha256')
      .update(`${renderTargetId}\u0000${layerIndex}`)
      .digest('hex').slice(0, 24)}`;
    frameBlurIdByLayer.set(layer, filterId);
    frameBlurById.set(filterId, layer.frameFilter);
    maxFrameBlurExpansionX = Math.max(maxFrameBlurExpansionX, Math.ceil(layer.frameFilter.blurX * 3));
    maxFrameBlurExpansionY = Math.max(maxFrameBlurExpansionY, Math.ceil(layer.frameFilter.blurY * 3));
  }

  const graphicBounds = framingMode === 'content' ? createBounds() : null;
  const nonTextGraphicBounds = framingMode === 'content' ? createBounds() : null;
  const staticTextTransforms: Array<{
    readonly placeholderId: string;
    readonly worldTransform: Matrix2D;
  }> = [];
  const definitions = new Map<string, string>();
  const colorTransformFilterIdByGroup = new Map<
    Extract<FlaResolvedDisplayNode, { readonly kind: 'group' }>,
    string
  >();
  const colorTransformGroups = new Set<Extract<FlaResolvedDisplayNode, { readonly kind: 'group' }>>();
  for (const leaf of flattened.leaves) {
    for (const group of leaf.compositeGroups) {
      if (group.rgbTransform) colorTransformGroups.add(group);
    }
  }
  for (const group of colorTransformGroups) {
    const transform = group.rgbTransform!;
    const offsets = transform.channelOffsets ?? [transform.offset, transform.offset, transform.offset];
    const identity = [transform.multiplier, ...(transform.channelOffsets ?? [transform.offset])]
      .map(formatSvgNumber).join('\u0000');
    const id = `fla-rgb-transform-${crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 24)}`;
    const existingDefinition = definitions.get(id);
    const multiplier = formatSvgNumber(transform.multiplier);
    const [red, green, blue] = offsets.map((offset) => formatSvgNumber(offset / 255));
    const values = [
      multiplier, '0', '0', '0', red,
      '0', multiplier, '0', '0', green,
      '0', '0', multiplier, '0', blue,
      '0', '0', '0', '1', '0',
    ].join(' ');
    const definition = `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="${values}"/></filter>`;
    if (existingDefinition && existingDefinition !== definition) {
      return { ok: false, code: 'RENDER_FAILED', message: 'RGB color-transform filter id collision detected' };
    }
    definitions.set(id, definition);
    colorTransformFilterIdByGroup.set(group, id);
  }
  const resolvedMediaByName = new Map<string, FlaStaticSnapshotBitmapMediaLookupResult>();
  const maxPathCommandsPerShape = Math.min(
    MAX_PATH_COMMANDS_PER_SHAPE,
    Math.max(0, input.maxPathCommandsPerShape ?? MAX_PATH_COMMANDS_PER_SHAPE),
  );
  const maxPathCommandsPerComposition = Math.min(
    MAX_PATH_COMMANDS_PER_COMPOSITION,
    Math.max(0, input.maxPathCommandsPerComposition ?? MAX_PATH_COMMANDS_PER_COMPOSITION),
  );
  const emittedNodes: string[] = [];
  let bitmapDefinitionBytes = 0;
  let gradientDefinitionBytes = 0;
  let clipDefinitionBytes = 0;
  let gradientStopCount = 0;
  let emittedContentBytes = 0;
  let pathCommandCount = 0;
  let shapeCount = 0;
  let bitmapInstanceCount = 0;
  let staticTextNodeCount = 0;
  let staticTextCharCount = 0;
  const staticTexts: FlaStaticTextRenderItem[] = [];
  const staticTextIdsSeen = new Set<string>();
  let skippedBitmapFillCount = 0;
  const bitmapFillDiagnostics: BuildComposedSvgSuccess['composition']['bitmapFillDiagnostics'][number][] = [];
  let catalogHasUnknownBitmapDimensions = false;
  let fillStyleCount = 0;
  let strokeStyleCount = 0;
  let styleRunCount = 0;
  let sourceEdgeCount = 0;
  let uniqueEffectiveStyleCount = 0;
  let midEdgeStyleChangeCount = 0;
  let edgeFillStyle0ReferenceCount = 0;
  let edgeFillStyle1ReferenceCount = 0;
  let edgeStrokeStyleReferenceCount = 0;
  let noFillStyle1RunCount = 0;
  let fillRegionCount = 0;
  let fillContourCount = 0;
  let fillBoundarySegmentCount = 0;
  let linearGradientCount = 0;
  let linearGradientStopCount = 0;
  let radialGradientCount = 0;
  let radialGradientStopCount = 0;
  let strokePathCount = 0;
  let strokeSegmentCount = 0;
  let styleSourceChars = 0;
  let firstFillColor: string | null = null;

  const registerGradientPaint = (paint: ReconstructedFillPaint): BuildSvgFailure | null => {
    if (paint.gradientId === null && paint.gradientDefinition === null) return null;
    if (paint.gradientId === null || paint.gradientDefinition === null) {
      return { ok: false, code: 'RENDER_FAILED', message: 'Gradient definition is incomplete' };
    }
    const existingDefinition = definitions.get(paint.gradientId);
    if (existingDefinition && existingDefinition !== paint.gradientDefinition) {
      return { ok: false, code: 'RENDER_FAILED', message: 'Gradient id collision detected' };
    }
    if (existingDefinition) return null;
    const definitionBytes = Buffer.byteLength(paint.gradientDefinition, 'utf8');
    if (gradientStopCount + paint.gradientStopCount > MAX_GRADIENT_STOPS_PER_COMPOSITION) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composition gradient-stop budget exceeded' };
    }
    if (gradientDefinitionBytes + definitionBytes > MAX_GRADIENT_DEFINITION_BYTES) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composition gradient-definition byte budget exceeded' };
    }
    if (gradientDefinitionBytes + clipDefinitionBytes + definitionBytes + bitmapDefinitionBytes + emittedContentBytes > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG exceeds the output byte budget' };
    }
    definitions.set(paint.gradientId, paint.gradientDefinition);
    gradientDefinitionBytes += definitionBytes;
    gradientStopCount += paint.gradientStopCount;
    if (paint.gradientType === 'linear') {
      linearGradientCount += 1;
      linearGradientStopCount += paint.gradientStopCount;
    } else if (paint.gradientType === 'radial') {
      radialGradientCount += 1;
      radialGradientStopCount += paint.gradientStopCount;
    }
    return null;
  };

  const lookupBitmapMedia = (reference: string): FlaStaticSnapshotBitmapMediaLookupResult => {
    const cached = resolvedMediaByName.get(reference);
    if (cached) return cached;
    const result = resolveBitmapMedia(reference);
    resolvedMediaByName.set(reference, result);
    return result;
  };

  const registerBitmapDefinition = (id: string, definition: string): BuildSvgFailure | null => {
    const existing = definitions.get(id);
    if (existing) {
      return existing === definition ? null :
        { ok: false, code: 'RENDER_FAILED', message: 'Bitmap paint definition id collision detected' };
    }
    const definitionBytes = Buffer.byteLength(definition, 'utf8');
    if (gradientDefinitionBytes + clipDefinitionBytes + bitmapDefinitionBytes + emittedContentBytes +
        definitionBytes > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Bitmap paint exceeds the SVG byte budget' };
    }
    bitmapDefinitionBytes += definitionBytes;
    definitions.set(id, definition);
    return null;
  };

  const registerBitmapImage = (
    media: FlaStaticSnapshotBitmapMedia,
    reference: string,
  ): { readonly ok: true; readonly id: string } | BuildSvgFailure => {
    if (!media.id || !Number.isSafeInteger(media.width) || !Number.isSafeInteger(media.height) ||
        media.width <= 0 || media.height <= 0 || media.width > MAX_OUTPUT_WIDTH ||
        media.height > MAX_OUTPUT_HEIGHT || media.width * media.height > MAX_OUTPUT_PIXELS ||
        !(media.pngBytes instanceof Uint8Array) || media.pngBytes.byteLength <= 0 ||
        media.pngBytes.byteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes ||
        !isPngWithExpectedDimensions(media.pngBytes, media.width, media.height)) {
      return { ok: false, code: 'RENDER_FAILED', message: `Bitmap media payload is not a bounded RGBA PNG: ${reference}` };
    }
    const mediaKey = crypto.createHash('sha256').update(media.id, 'utf8').digest('hex').slice(0, 24);
    const id = `fla-bitmap-${mediaKey}`;
    if (!definitions.has(id)) {
      const base64Length = Math.ceil(media.pngBytes.byteLength / 3) * 4;
      if (gradientDefinitionBytes + clipDefinitionBytes + bitmapDefinitionBytes + emittedContentBytes +
          base64Length + 512 > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Embedded PNG media exceeds the SVG byte budget' };
      }
      const dataUri = Buffer.from(media.pngBytes.buffer, media.pngBytes.byteOffset, media.pngBytes.byteLength).toString('base64');
      const failure = registerBitmapDefinition(id,
        `<image id="${id}" x="0" y="0" width="${media.width}" height="${media.height}" preserveAspectRatio="none" href="data:image/png;base64,${dataUri}"/>`);
      if (failure) return failure;
    }
    return { ok: true, id };
  };

  const registeredClips = new Map<FlaResolvedClipPath, RegisteredClip>();
  const maskWarnings = new Set(displayList.maskDiagnostics);
  let emittedLeafCount = 0;
  type RegisteredClip = { readonly ok: true; readonly id: string; readonly geometry: string };
  const clipId = (identity: string) =>
    `fla-mask-clip-${crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 24)}`;
  const registerClipDefinition = (id: string, definition: string): BuildSvgFailure | null => {
    const existing = definitions.get(id);
    if (existing) {
      return existing === definition ? null
        : { ok: false, code: 'RENDER_FAILED', message: 'Mask definition id collision detected' };
    }
    const definitionBytes = Buffer.byteLength(definition, 'utf8');
    if (clipDefinitionBytes + definitionBytes + gradientDefinitionBytes + bitmapDefinitionBytes + emittedContentBytes >
        FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG exceeds the output byte budget' };
    }
    definitions.set(id, definition);
    clipDefinitionBytes += definitionBytes;
    return null;
  };

  const registerClipPath = (
    clipPath: FlaResolvedClipPath,
    depth = 0,
  ): RegisteredClip | BuildSvgFailure => {
    const existing = registeredClips.get(clipPath);
    if (existing) return existing;
    if (depth >= 64 || clipPath.shapes.length > 100_000) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'XFL mask exceeds its nesting or geometry budget' };
    }
    const clipNodes: string[] = [];
    let clipPathByteLength = 0;
    for (const clipShape of clipPath.shapes) {
      const shapeBlock = shapeBlocks.get(clipShape.shapeId);
      if (!shapeBlock) {
        return { ok: false, code: 'TARGET_UNSUPPORTED', message: `XFL mask shape source is missing: ${clipShape.shapeId}` };
      }
      const shape = parseShapeAt(shapeBlock);
      const styleAware = buildStyleAwareShapeRepresentation(shape, clipShape.shapeId);
      if (!styleAware.ok) return styleAware;
      if (shape.edgeStrings.length === 0 || styleAware.representation.commands.length === 0) {
        return { ok: false, code: 'TARGET_UNSUPPORTED', message: `XFL mask shape has no supported filled vector geometry: ${clipShape.shapeId}` };
      }
      const reconstructed = reconstructFills(
        styleAware.representation,
        clipShape.shapeId,
        renderTargetId,
        displayList.frameIndex,
      );
      if (!reconstructed.ok) return reconstructed;
      if (reconstructed.result.fills.length === 0) {
        return { ok: false, code: 'TARGET_UNSUPPORTED', message: `XFL mask shape contains no filled vector area: ${clipShape.shapeId}` };
      }
      let enclosingId: string | undefined;
      for (const enclosure of clipShape.clipPaths ?? []) {
        const nested = registerClipPath(enclosure, depth + 1);
        if (!nested.ok) return nested;
        if (!enclosingId) {
          enclosingId = nested.id;
          continue;
        }
        const intersectionId = clipId(`${enclosingId}&${nested.id}`);
        const problem = registerClipDefinition(intersectionId,
          `<clipPath id="${intersectionId}" clipPathUnits="userSpaceOnUse" clip-path="url(#${enclosingId})">${nested.geometry}</clipPath>`);
        if (problem) return problem;
        enclosingId = intersectionId;
      }
      for (const fill of reconstructed.result.fills) {
        if ('bitmapPath' in fill.paint) {
          return { ok: false, code: 'TARGET_UNSUPPORTED', message: 'XFL bitmap-filled mask is unsupported' };
        }
        const pathBytes = Buffer.byteLength(fill.pathD, 'utf8');
        if (pathBytes <= 0 || pathBytes > MAX_EDGE_CHARS) {
          return { ok: false, code: 'BUDGET_EXCEEDED', message: 'XFL mask path exceeds the geometry byte budget' };
        }
        const attributes = `d="${fill.pathD}" transform="${matrixToSvgTransform(clipShape.worldTransform)}" fill="white" fill-rule="nonzero" clip-rule="nonzero"`;
        let clipNode = `<path ${attributes}/>`;
        if (enclosingId) {
          // The reference carries the shape transform. The clip on the use
          // therefore stays in the same world coordinates as the enclosing mask.
          const shapeId = `${clipId(attributes)}-shape`;
          const problem = registerClipDefinition(shapeId, `<path id="${shapeId}" ${attributes}/>`);
          if (problem) return problem;
          clipNode = `<use href="#${shapeId}" clip-path="url(#${enclosingId})"/>`;
        }
        clipPathByteLength += Buffer.byteLength(clipNode, 'utf8');
        if (clipPathByteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
          return { ok: false, code: 'BUDGET_EXCEEDED', message: 'XFL mask geometry exceeds the snapshot byte budget' };
        }
        clipNodes.push(clipNode);
      }
    }
    const geometry = clipNodes.join('');
    const id = clipId(geometry);
    const problem = registerClipDefinition(id, `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${geometry}</clipPath>`);
    if (problem) return problem;
    const result = { ok: true as const, id, geometry };
    registeredClips.set(clipPath, result);
    return result;
  };

  const appendEmittedNode = (
    node: string,
    clipPaths: readonly FlaResolvedClipPath[] = [],
  ): BuildSvgFailure | null => {
    let wrappedNode = node;
    for (const clipPath of clipPaths) {
      const registered = registerClipPath(clipPath);
      if (!registered.ok) {
        if (registered.code !== 'TARGET_UNSUPPORTED') return registered;
        maskWarnings.add(`${clipPath.sourcePath ?? '遮罩'}: ${registered.message}`);
        return null;
      }
      wrappedNode = `<g clip-path="url(#${registered.id})">${wrappedNode}</g>`;
    }
    emittedLeafCount += 1;
    const nodeBytes = Buffer.byteLength(wrappedNode, 'utf8');
    if (gradientDefinitionBytes + clipDefinitionBytes + bitmapDefinitionBytes + emittedContentBytes + nodeBytes > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG exceeds the output byte budget' };
    }
    emittedNodes.push(wrappedNode);
    emittedContentBytes += nodeBytes;
    return null;
  };

  const appendCompositeGroupTag = (markup: string): BuildSvgFailure | null => {
    const markupBytes = Buffer.byteLength(markup, 'utf8');
    if (gradientDefinitionBytes + clipDefinitionBytes + bitmapDefinitionBytes + emittedContentBytes + markupBytes > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG exceeds the output byte budget' };
    }
    emittedNodes.push(markup);
    emittedContentBytes += markupBytes;
    return null;
  };

  const openCompositeGroups: Extract<FlaResolvedDisplayNode, { readonly kind: 'group' }>[] = [];
  let openLayer: FlaResolvedDisplayLayer | null = null;
  let openLayerFilter = false;
  for (const { layer, node, compositeGroups } of flattened.leaves) {
    if (openLayer !== layer) {
      while (openCompositeGroups.length > 0) {
        const closeFailure = appendCompositeGroupTag('</g>');
        if (closeFailure) return closeFailure;
        openCompositeGroups.pop();
      }
      if (openLayerFilter) {
        const closeFailure = appendCompositeGroupTag('</g>');
        if (closeFailure) return closeFailure;
        openLayerFilter = false;
      }
      openLayer = layer;
      const filterId = frameBlurIdByLayer.get(layer);
      if (filterId) {
        const openFailure = appendCompositeGroupTag(`<g filter="url(#${filterId})">`);
        if (openFailure) return openFailure;
        openLayerFilter = true;
      }
    }
    let sharedGroupCount = 0;
    while (sharedGroupCount < openCompositeGroups.length &&
        sharedGroupCount < compositeGroups.length &&
        openCompositeGroups[sharedGroupCount] === compositeGroups[sharedGroupCount]) {
      sharedGroupCount += 1;
    }
    for (let index = openCompositeGroups.length - 1; index >= sharedGroupCount; index -= 1) {
      const closeFailure = appendCompositeGroupTag('</g>');
      if (closeFailure) return closeFailure;
      openCompositeGroups.pop();
    }
    for (let index = sharedGroupCount; index < compositeGroups.length; index += 1) {
      const group = compositeGroups[index]!;
      const attributes: string[] = [];
      if (group.opacity !== undefined) attributes.push(`opacity="${formatSvgNumber(group.opacity)}"`);
      const colorFilterId = colorTransformFilterIdByGroup.get(group);
      if (colorFilterId) attributes.push(`filter="url(#${colorFilterId})"`);
      const openFailure = appendCompositeGroupTag(`<g ${attributes.join(' ')}>`);
      if (openFailure) return openFailure;
      openCompositeGroups.push(group);
    }

    if (node.kind === 'shape') {
      const shapeBlock = shapeBlocks.get(node.shapeId);
      if (!shapeBlock) {
        return { ok: false, code: 'RENDER_FAILED', message: `Resolved shape source not found: ${node.shapeId}` };
      }
      const shape = parseShapeAt(shapeBlock);
      const styleAware = buildStyleAwareShapeRepresentation(shape, node.shapeId);
      if (!styleAware.ok) return styleAware;
      if (shape.edgeStrings.length === 0) {
        return { ok: false, code: 'RENDER_FAILED', message: `Resolved shape has no Edge children: ${node.shapeId}` };
      }
      const representation = styleAware.representation;
      const commands = representation.commands;
      if (commands.length === 0) {
        return { ok: false, code: 'RENDER_FAILED', message: `Resolved shape has no decoded path: ${node.shapeId}` };
      }
      fillStyleCount += representation.fillStyles.length;
      strokeStyleCount += representation.strokeStyles.length;
      styleRunCount += representation.styleRuns.length;
      sourceEdgeCount += shape.edgeStrings.length;
      midEdgeStyleChangeCount += representation.styleChanges.length;
      for (const reference of representation.edgeReferences) {
        if (reference.fillStyle0 !== null) edgeFillStyle0ReferenceCount += 1;
        if (reference.fillStyle1 !== null) edgeFillStyle1ReferenceCount += 1;
        if (reference.strokeStyle !== null) edgeStrokeStyleReferenceCount += 1;
      }
      noFillStyle1RunCount += representation.styleRuns
        .filter((run) => run.fillStyle1 === null).length;
      styleSourceChars += representation.styleSourceChars;
      if (fillStyleCount + strokeStyleCount > MAX_STYLE_ENTRIES_PER_COMPOSITION) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composition style-entry budget exceeded' };
      }
      if (styleSourceChars > MAX_STYLE_SOURCE_CHARS_PER_COMPOSITION) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composition style-source budget exceeded' };
      }
      if (commands.length > maxPathCommandsPerShape) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: `Shape ${node.shapeId} path-command budget exceeded` };
      }
      if (pathCommandCount + commands.length > maxPathCommandsPerComposition) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composition path-command budget exceeded' };
      }
      if (graphicBounds && !includeTransformedPathBounds(graphicBounds, commands, node.worldTransform)) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: `Graphic Shape bounds are not finite: ${node.shapeId}` };
      }
      if (nonTextGraphicBounds) {
        includeTransformedPathBounds(nonTextGraphicBounds, commands, node.worldTransform);
      }
      const reconstructed = reconstructFills(
        representation,
        node.shapeId,
        renderTargetId,
        displayList.frameIndex,
      );
      if (!reconstructed.ok) return reconstructed;
      if (fillBoundarySegmentCount + reconstructed.result.boundarySegmentCount > MAX_FILL_BOUNDARY_SEGMENTS_PER_COMPOSITION) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composition fill-boundary segment budget exceeded' };
      }
      fillBoundarySegmentCount += reconstructed.result.boundarySegmentCount;
      fillContourCount += reconstructed.result.contourCount;
      for (const fill of reconstructed.result.fills) {
        const { paint } = fill;
        const pathBytes = Buffer.byteLength(fill.pathD, 'utf8');
        if (pathBytes > MAX_EDGE_CHARS) {
          return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG path exceeds the geometry byte budget' };
        }
        if ('bitmapPath' in paint) {
          const resolution = lookupBitmapMedia(paint.bitmapPath);
          if (!resolution.ok) {
            skippedBitmapFillCount += 1;
            if (bitmapFillDiagnostics.length < 64) {
              bitmapFillDiagnostics.push({
                shapeId: node.shapeId, fillStyleIndex: fill.style.index, reason: resolution.reason,
              });
            }
            continue;
          }
          const media = resolution.media;
          if (input.metadataOnlyBitmaps && !media.pngBytes) {
            // The catalog can validate fill geometry before the bitmap is decoded.
            const outline = `<path d="${fill.pathD}" fill="none"/>`;
            const failure = appendEmittedNode(outline, node.clipPaths);
            if (failure) return failure;
            fillRegionCount += 1;
            continue;
          }
          const image = registerBitmapImage(media, paint.bitmapPath);
          if (!image.ok) return image;
          const bitmapTransform = matrixToSvgTransform(paint.matrix);
          const sampling = paint.smoothing ? '' : ' image-rendering="pixelated"';
          const shapeTransform = matrixToSvgTransform(node.worldTransform);
          let markup: string;
          if (paint.clipped) {
            const clipId = 'fla-bitmap-clip-' + crypto.createHash('sha256').update(fill.pathD).digest('hex').slice(0, 24);
            const clip = `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><path d="${fill.pathD}" clip-rule="nonzero"/></clipPath>`;
            const failure = registerBitmapDefinition(clipId, clip);
            if (failure) return failure;
            markup = `<g transform="${shapeTransform}"><g clip-path="url(#${clipId})"><use href="#${image.id}" transform="${bitmapTransform}"${sampling}/></g></g>`;
          } else {
            const identity = JSON.stringify([image.id, bitmapTransform, paint.smoothing]);
            const patternId = 'fla-bitmap-pattern-' + crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
            const pattern = `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="${media.width}" height="${media.height}" patternTransform="${bitmapTransform}"><use href="#${image.id}"${sampling}/></pattern>`;
            const failure = registerBitmapDefinition(patternId, pattern);
            if (failure) return failure;
            markup = `<path d="${fill.pathD}" transform="${shapeTransform}" fill="url(#${patternId})" stroke="none" fill-rule="nonzero"/>`;
          }
          const failure = appendEmittedNode(markup, node.clipPaths);
          if (failure) return failure;
          fillRegionCount += 1;
          continue;
        }
        const gradientFailure = registerGradientPaint(paint);
        if (gradientFailure) return gradientFailure;
        const pathNode = `<path d="${fill.pathD}" transform="${matrixToSvgTransform(node.worldTransform)}" fill="${paint.svgPaint}" fill-opacity="${formatSvgNumber(paint.opacity)}" stroke="none" fill-rule="nonzero"/>`;
        const appendFailure = appendEmittedNode(pathNode, node.clipPaths);
        if (appendFailure) return appendFailure;
        fillRegionCount += 1;
        if (firstFillColor === null) firstFillColor = paint.firstColor;
      }
      const strokeCommandBudget = {
        remaining: Math.min(
          maxPathCommandsPerShape - commands.length,
          maxPathCommandsPerComposition - (pathCommandCount + commands.length),
        ),
      };
      const reconstructedStrokes = reconstructSolidStrokes(
        representation,
        node.shapeId,
        renderTargetId,
        displayList.frameIndex,
        strokeCommandBudget,
      );
      if (!reconstructedStrokes.ok) return reconstructedStrokes;
      uniqueEffectiveStyleCount += reconstructed.result.fills.length + reconstructedStrokes.result.length;
      const shapeStrokeSegmentCount = reconstructedStrokes.result
        .reduce((total, stroke) => total + stroke.segmentCount, 0);
      if (strokeSegmentCount + shapeStrokeSegmentCount > MAX_STROKE_SEGMENTS_PER_COMPOSITION) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composition stroke-segment budget exceeded' };
      }
      strokeSegmentCount += shapeStrokeSegmentCount;
      for (const stroke of reconstructedStrokes.result) {
        const style = stroke.rendererStyle;
        if (style.gradientPaint) {
          const gradientFailure = registerGradientPaint(style.gradientPaint);
          if (gradientFailure) return gradientFailure;
        }
        const expansion = strokeBoundsExpansion(style, node.worldTransform);
        if (!expansion) {
          return { ok: false, code: 'BUDGET_EXCEEDED', message: `Graphic stroke bounds are not finite: ${node.shapeId}` };
        }
        for (const path of stroke.paths) {
          if (path.filledOutline) {
            if (graphicBounds && !includeTransformedPathBounds(graphicBounds, path.commands, node.worldTransform)) {
              return { ok: false, code: 'BUDGET_EXCEEDED', message: `Graphic variable-width stroke bounds are not finite: ${node.shapeId}` };
            }
            if (nonTextGraphicBounds) {
              includeTransformedPathBounds(nonTextGraphicBounds, path.commands, node.worldTransform);
            }
            const pathBytes = Buffer.byteLength(path.pathD, 'utf8');
            if (pathBytes > MAX_EDGE_CHARS) {
              return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG path exceeds the geometry byte budget' };
            }
            const strokePaint = style.gradientPaint?.svgPaint ?? style.color;
            const pathNode = `<path d="${path.pathD}" transform="${matrixToSvgTransform(node.worldTransform)}" fill="${strokePaint}" fill-opacity="${formatSvgNumber(style.opacity)}" stroke="none" fill-rule="nonzero"/>`;
            const appendFailure = appendEmittedNode(pathNode, node.clipPaths);
            if (appendFailure) return appendFailure;
            pathCommandCount += path.commands.length;
            strokePathCount += 1;
            continue;
          }
          if (graphicBounds) {
            const strokePathBounds = createBounds();
            if (!includeTransformedPathBounds(strokePathBounds, path.commands, node.worldTransform) ||
                !includeExpandedStrokeBounds(graphicBounds, strokePathBounds, expansion)) {
              return { ok: false, code: 'BUDGET_EXCEEDED', message: `Graphic stroke bounds are not finite: ${node.shapeId}` };
            }
            if (nonTextGraphicBounds) {
              includeExpandedStrokeBounds(nonTextGraphicBounds, strokePathBounds, expansion);
            }
          }
          const pathD = style.scaleMode === 'horizontal'
            ? transformCommandsForHorizontalStroke(path.commands, node.worldTransform)
            : path.pathD;
          if (pathD === null) {
            return { ok: false, code: 'BUDGET_EXCEEDED', message: `Graphic horizontal stroke coordinates are not finite: ${node.shapeId}` };
          }
          const pathBytes = Buffer.byteLength(pathD, 'utf8');
          if (pathBytes > MAX_EDGE_CHARS) {
            return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG path exceeds the geometry byte budget' };
          }
          const transformAttribute = style.scaleMode === 'normal'
            ? ` transform="${matrixToSvgTransform(node.worldTransform)}"`
            : '';
          const strokePaint = style.gradientPaint?.svgPaint ?? style.color;
          const pathNode = `<path d="${pathD}"${transformAttribute} fill="none" stroke="${strokePaint}" stroke-opacity="${formatSvgNumber(style.opacity)}" stroke-width="${formatSvgNumber(expansion.width)}" stroke-linecap="${style.cap}" stroke-linejoin="${style.join}" stroke-miterlimit="${formatSvgNumber(style.miterLimit)}"/>`;
          const appendFailure = appendEmittedNode(pathNode, node.clipPaths);
          if (appendFailure) return appendFailure;
          strokePathCount += 1;
        }
      }
      pathCommandCount += commands.length;
      shapeCount += 1;
      continue;
    }

    if (node.kind === 'text') {
      const descriptor = staticTextBlocks?.get(node.textId);
      if (!descriptor) {
        return { ok: false, code: 'RENDER_FAILED', message: `Resolved static text source not found: ${node.textId}` };
      }
      staticTextNodeCount += 1;
      if (staticTextNodeCount > FLA_STATIC_TEXT_LIMITS.maxTextNodesPerComposition) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: `Composition static text node budget (${FLA_STATIC_TEXT_LIMITS.maxTextNodesPerComposition}) exceeded` };
      }
      const nodeCharCount = descriptor.runs.reduce((sum, run) => sum + run.characters.length, 0);
      staticTextCharCount += nodeCharCount;
      if (staticTextCharCount > FLA_STATIC_TEXT_LIMITS.maxCharsPerComposition) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: `Composition static text character budget (${FLA_STATIC_TEXT_LIMITS.maxCharsPerComposition}) exceeded` };
      }
      if (countExplicitStaticTextLines(descriptor) > FLA_STATIC_TEXT_LIMITS.maxLinesPerText) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: `Static text exceeds maximum ${FLA_STATIC_TEXT_LIMITS.maxLinesPerText} lines` };
      }
      const estimatedLayout = layoutFlaStaticText(descriptor);
      if (graphicBounds && !includeTransformedRectBounds(graphicBounds, estimatedLayout.bounds, node.worldTransform)) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: `Graphic static text bounds are not finite: ${node.textId}` };
      }
      const worldScale = Math.max(
        Math.hypot(node.worldTransform.a, node.worldTransform.b),
        Math.hypot(node.worldTransform.c, node.worldTransform.d),
      );
      const scaleHint = Math.min(4, Math.max(2, Math.ceil((Number.isFinite(worldScale) ? worldScale : 1) * 2) / 2));
      const placeholderId = `fla-text-${crypto.createHash('sha256')
        .update(`${node.textId}\u0000${scaleHint}`, 'utf8')
        .digest('hex')
        .slice(0, 24)}`;
      if (!staticTextIdsSeen.has(placeholderId)) {
        staticTextIdsSeen.add(placeholderId);
        const placeholderTag =
          `<image id="${placeholderId}" x="${formatSvgNumber(estimatedLayout.bounds.x)}" y="${formatSvgNumber(estimatedLayout.bounds.y)}" ` +
          `width="${formatSvgNumber(estimatedLayout.bounds.width)}" height="${formatSvgNumber(estimatedLayout.bounds.height)}" ` +
          `preserveAspectRatio="none" href="data:image/png;base64,${FLA_STATIC_TEXT_PLACEHOLDER_BASE64}"/>`;
        const defFailure = registerBitmapDefinition(placeholderId, placeholderTag);
        if (defFailure) return defFailure;
        staticTexts.push({ placeholderId, descriptor, scaleHint });
      }
      if (framingMode === 'content') {
        staticTextTransforms.push({ placeholderId, worldTransform: node.worldTransform });
      }
      const useNode = `<use href="#${placeholderId}" transform="${matrixToSvgTransform(node.worldTransform)}"/>`;
      const appendFailure = appendEmittedNode(useNode, node.clipPaths);
      if (appendFailure) return appendFailure;
      continue;
    }

    bitmapInstanceCount += 1;
    const resolution = lookupBitmapMedia(node.libraryItemName);
    if (!resolution.ok) {
      const reason = resolution.reason === 'ambiguous' ? 'is ambiguous' : 'was not found';
      return {
        ok: false,
        code: 'TARGET_UNSUPPORTED',
        message: `Bitmap media reference ${reason}: ${node.libraryItemName}`,
      };
    }
    const media = resolution.media;
    if (input.metadataOnlyBitmaps && !media.pngBytes) {
      // Keep clip/geometry capability checks active without embedding image data.
      if (media.width === 0 || media.height === 0) {
        catalogHasUnknownBitmapDimensions = true;
      } else if (graphicBounds && !includeTransformedBitmapBounds(graphicBounds, media.width, media.height, node.worldTransform)) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Graphic bitmap bounds are not finite' };
      }
      const appendFailure = appendEmittedNode('<g/>', node.clipPaths);
      if (appendFailure) return appendFailure;
      continue;
    }
    const image = registerBitmapImage(media, node.libraryItemName);
    if (!image.ok) return image;
    if (graphicBounds && !includeTransformedBitmapBounds(graphicBounds, media.width, media.height, node.worldTransform)) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: `Graphic bitmap bounds are not finite: ${node.libraryItemName}` };
    }
    if (nonTextGraphicBounds) {
      includeTransformedBitmapBounds(nonTextGraphicBounds, media.width, media.height, node.worldTransform);
    }
    const useNode = `<use href="#${image.id}" transform="${matrixToSvgTransform(node.worldTransform)}"/>`;
    const appendFailure = appendEmittedNode(useNode, node.clipPaths);
    if (appendFailure) return appendFailure;
  }

  while (openCompositeGroups.length > 0) {
    const closeFailure = appendCompositeGroupTag('</g>');
    if (closeFailure) return closeFailure;
    openCompositeGroups.pop();
  }

  if (openLayerFilter) {
    const closeFailure = appendCompositeGroupTag('</g>');
    if (closeFailure) return closeFailure;
  }

  const graphicViewport = graphicBounds
    ? createGraphicViewport(graphicBounds, { x: maxFrameBlurExpansionX, y: maxFrameBlurExpansionY })
    : null;
  const blankGraphic = framingMode === 'content' && flattened.leaves.length === 0;
  if (framingMode === 'content' && !graphicViewport && !blankGraphic && !catalogHasUnknownBitmapDimensions) {
    return { ok: false, code: 'RENDER_FAILED', message: 'Graphic has no finite drawable content bounds' };
  }
  // A truly blank Graphic frame has no content bounds to frame. Represent it
  // as a bounded transparent pixel so it remains a valid authored state.
  const width = graphicViewport?.outputWidth ?? (blankGraphic ? 1 : stageOutputWidth);
  const height = graphicViewport?.outputHeight ?? (blankGraphic ? 1 : stageOutputHeight);
  const viewBox = graphicViewport?.viewBox ?? (blankGraphic
    ? { x: 0, y: 0, width: 1, height: 1 }
    : { x: 0, y: 0, width: stageOutputWidth, height: stageOutputHeight });
  const contentBounds = graphicViewport?.contentBounds ?? null;
  const formatRect = (rect: Rect2D): string =>
    `${formatSvgNumber(rect.x)} ${formatSvgNumber(rect.y)} ${formatSvgNumber(rect.width)} ${formatSvgNumber(rect.height)}`;
  const title = escapeXmlText(displayList.sourceName);
  const frameBlurDefinitions = [...frameBlurById.entries()].map(([id, filter]) =>
    `<filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" ` +
    `x="${formatSvgNumber(viewBox.x)}" y="${formatSvgNumber(viewBox.y)}" ` +
    `width="${formatSvgNumber(viewBox.width)}" height="${formatSvgNumber(viewBox.height)}" ` +
    `color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" ` +
    `stdDeviation="${formatSvgNumber(filter.blurX)} ${formatSvgNumber(filter.blurY)}"/></filter>`);
  const allDefinitions = [...definitions.values(), ...frameBlurDefinitions];
  const defs = allDefinitions.length > 0 ? `<defs>${allDefinitions.join('')}</defs>` : '';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatRect(viewBox)}" width="${width}" height="${height}">` +
    `<title>FLA composed snapshot — ${title}</title>` +
    `<desc>kind=${displayList.kind} frame=${displayList.frameIndex} resolvedNodes=${displayList.resolvedNodeCount} drawableLeaves=${flattened.leaves.length} groups=${flattened.groupCount} expandedSymbols=${flattened.expandedSymbolCount} bitmapInstances=${bitmapInstanceCount} shapes=${shapeCount} fillStyles=${fillStyleCount} strokeStyles=${strokeStyleCount} styleRuns=${styleRunCount} styleChanges=${midEdgeStyleChangeCount} pathCommands=${pathCommandCount} edgeFillStyle0Refs=${edgeFillStyle0ReferenceCount} edgeFillStyle1Refs=${edgeFillStyle1ReferenceCount} edgeStrokeStyleRefs=${edgeStrokeStyleReferenceCount} noFillStyle1Runs=${noFillStyle1RunCount} fillRegions=${fillRegionCount} fillContours=${fillContourCount} fillBoundarySegments=${fillBoundarySegmentCount} linearGradients=${linearGradientCount} linearGradientStops=${linearGradientStopCount} radialGradients=${radialGradientCount} radialGradientStops=${radialGradientStopCount} strokePaths=${strokePathCount} strokeSegments=${strokeSegmentCount} framing=${framingMode} viewBox=${formatRect(viewBox)} output=${width}x${height}${skippedBitmapFillCount ? ` skippedBitmapFills=${skippedBitmapFillCount}` : ''}${contentBounds ? ` contentBounds=${formatRect(contentBounds)} padding=${GRAPHIC_CONTENT_PADDING}` : ''}</desc>` +
    defs + emittedNodes.join('') + '</svg>\n';
  const svgByteLength = Buffer.byteLength(svg, 'utf8');
  if (svgByteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG exceeds the output byte budget' };
  }
  const ikPoseWarning = displayList.ikPoseDiagnostics?.join('；').slice(0, 500);
  if ((maskWarnings.size || ikPoseWarning) && emittedLeafCount === 0) {
    return { ok: false, code: 'TARGET_UNSUPPORTED', message: [...maskWarnings, ikPoseWarning].filter(Boolean).join('；').slice(0, 500) };
  }
  const graphicFraming: FlaStaticTextGraphicFraming | undefined =
    framingMode === 'content' && staticTexts.length > 0
      ? {
          nonTextBounds:
            nonTextGraphicBounds &&
            [nonTextGraphicBounds.minX, nonTextGraphicBounds.minY, nonTextGraphicBounds.maxX, nonTextGraphicBounds.maxY].every(Number.isFinite)
              ? {
                  minX: nonTextGraphicBounds.minX,
                  minY: nonTextGraphicBounds.minY,
                  maxX: nonTextGraphicBounds.maxX,
                  maxY: nonTextGraphicBounds.maxY,
                }
              : null,
          textTransforms: staticTextTransforms,
          filterExpansion: { x: maxFrameBlurExpansionX, y: maxFrameBlurExpansionY },
          padding: GRAPHIC_CONTENT_PADDING,
        }
      : undefined;
  return {
    ok: true,
    svg,
    width,
    height,
    pixelCount: width * height,
    pathCommandCount,
    firstFillColor,
    hasRenderablePath: fillRegionCount > 0 || strokePathCount > 0,
    ...(maskWarnings.size ? { maskWarning: [...maskWarnings].join('；').slice(0, 500) } : {}),
    ...(ikPoseWarning ? { ikPoseWarning } : {}),
    ...(staticTexts.length > 0 ? { staticTexts } : {}),
    ...(graphicFraming ? { graphicFraming } : {}),
    composition: {
      resolvedNodeCount: displayList.resolvedNodeCount,
      bitmapInstanceCount,
      skippedBitmapFillCount,
      bitmapFillDiagnostics,
      shapeCount,
      fillStyleCount,
      strokeStyleCount,
      styleRunCount,
      sourceEdgeCount,
      rawStyleRunCount: styleRunCount,
      uniqueEffectiveStyleCount,
      postReconstructionFillCount: fillRegionCount,
      postReconstructionStrokePathCount: strokePathCount,
      svgByteLength,
      midEdgeStyleChangeCount,
      pathCommandCount,
      edgeFillStyle0ReferenceCount,
      edgeFillStyle1ReferenceCount,
      edgeStrokeStyleReferenceCount,
      noFillStyle1RunCount,
      fillRegionCount,
      fillContourCount,
      fillBoundarySegmentCount,
      linearGradientCount,
      linearGradientStopCount,
      radialGradientCount,
      radialGradientStopCount,
      strokePathCount,
      strokeSegmentCount,
      groupCount: flattened.groupCount,
      expandedSymbolCount: flattened.expandedSymbolCount,
      framing: {
        mode: framingMode,
        contentBounds,
        viewBox,
        padding: graphicViewport ? GRAPHIC_CONTENT_PADDING : 0,
        outputWidth: width,
        outputHeight: height,
      },
    },
  };
}
