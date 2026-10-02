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
 * The edge decoder below is a verbatim copy of
 * src/renderer/fla-import/parser-core/edge-decoder.ts:decodeEdgesWithStyleChanges
 * at commit 3c47a4ee8af07e834338b223fcb3260a4c6dddbc (the pinned
 * lifeart/fla-viewer parser closure). Reusing the bytes keeps R1
 * bit-identical to the R0 spike output for the same input.
 *
 * This module is a pure function on FLA bytes + a target identity.
 * It performs NO filesystem access, NO network access, NO
 * ActionScript execution, and NO Project mutation.
 */

import crypto from 'node:crypto';
import JSZip from 'jszip';
import { FLA_IMPORT_LIMITS } from '../../shared/fla-import-api';
import type {
  FlaRenderTarget,
  FlaStaticSnapshotPreviewErrorCode,
} from '../../shared/fla-static-snapshot-api';
import { FLA_STATIC_SNAPSHOT_LIMITS } from '../../shared/fla-static-snapshot-api';
import type {
  FlaResolvedDisplayList,
  FlaResolvedDisplayNode,
  FlaDisplayListResolverInput,
} from './fla-display-list-resolver';
import {
  resolveFlaDisplayList,
  type FlaDisplayListResolverResult,
} from './fla-display-list-resolver';
import {
  adaptFlaXflDisplaySource,
  type FlaStaticSnapshotDisplaySource,
} from './fla-static-snapshot-display-list-adapter';

// ---- Limits (subset of FLA_IMPORT_LIMITS used by the R1 SVG builder) ----
const MAX_SOURCE_BYTES = FLA_IMPORT_LIMITS.maxSourceBytes; // 256 MiB
const MAX_XML_BYTES = FLA_IMPORT_LIMITS.maxXmlBytes; // 32 MiB
const MAX_OUTPUT_WIDTH = 4_096;
const MAX_OUTPUT_HEIGHT = 4_096;
const MAX_OUTPUT_PIXELS = 16_777_216;
const MAX_TARGETS = 64;
const MAX_EDGE_CHARS = 64 * 1024 * 1024; // 64 MiB; matches maxSnapshotBytes cap
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
}

export interface BuildSvgFailure {
  ok: false;
  code: FlaStaticSnapshotPreviewErrorCode;
  message: string;
}

export type BuildSvgResult = BuildSvgSuccess | BuildSvgFailure;

export interface BuildCatalogSuccess {
  ok: true;
  // Discoverable renderable targets. The renderer previews one of
  // these; the commit pins one of these as the source of truth.
  entries: Array<{
    target: FlaRenderTarget;
    previewSupported: boolean;
    unsupportedReason?: string;
  }>;
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
}

async function parseArchive(bytes: Uint8Array): Promise<{ ok: true; archive: ParsedArchive } | { ok: false; code: FlaStaticSnapshotPreviewErrorCode; message: string }> {
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
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    return { ok: false, code: 'RENDER_FAILED', message: `Failed to open FLA archive: ${String(error)}` };
  }
  const names = Object.keys(zip.files);
  const docDocEntry = zip.file('DOMDocument.xml');
  if (!docDocEntry) {
    return { ok: false, code: 'RENDER_FAILED', message: 'FLA has no DOMDocument.xml' };
  }
  const docXml = await docDocEntry.async('string');
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
    if (xml.length > MAX_XML_BYTES) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: `LIBRARY entry too large: ${name}` };
    }
    libraryXmlEntries.push({ name, xml });
    if (/<Script\b/.test(xml) || /<DOMScript\b/.test(xml) || /actionscript|doabc/iu.test(xml)) {
      hasActionScript = true;
    }
  }
  if (/<Script\b/.test(docXml) || /<DOMScript\b/.test(docXml)) {
    hasActionScript = true;
  }
  return { ok: true, archive: { docXml, libraryXmlEntries, hasActionScript } };
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

// ---- Edge decoder (verbatim copy of src/renderer/fla-import/parser-core/edge-decoder.ts
//      at commit 3c47a4e, Pinned FLAParser closure.) ----
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
    return (signed >= 0 ? signed + fracPart : signed - fracPart) / COORD_SCALE;
  }
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return NaN;
  return parsed / COORD_SCALE;
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

interface DecodedEdges {
  commands: Array<
    | { type: 'M'; x: number; y: number }
    | { type: 'L'; x: number; y: number }
    | { type: 'Q'; cx: number; cy: number; x: number; y: number }
    | { type: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
    | { type: 'Z' }
  >;
}

function decodeEdgesWithStyleChanges(edgeStr: string): DecodedEdges {
  const commands: DecodedEdges['commands'] = [];
  const tokens = tokenize(edgeStr);
  let i = 0;
  let currentX = NaN;
  let currentY = NaN;
  let startX = NaN;
  let startY = NaN;
  const EPSILON = 0.5;
  const MAX_COORD = 200_000;
  while (i < tokens.length) {
    const token = tokens[i] as string;
    switch (token) {
      case '!': {
        if (i + 2 < tokens.length) {
          const x = decodeCoord(tokens[i + 1] as string);
          const y = decodeCoord(tokens[i + 2] as string);
          if (!Number.isFinite(x) || !Number.isFinite(y) ||
              Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) { i += 3; break; }
          if (Number.isNaN(currentX) || Math.abs(x - currentX) > EPSILON || Math.abs(y - currentY) > EPSILON) {
            commands.push({ type: 'M', x, y });
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
          if (Math.abs(x - currentX) > EPSILON || Math.abs(y - currentY) > EPSILON) {
            commands.push({ type: 'L', x, y });
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
          commands.push({ type: 'Q', cx, cy, x, y });
          currentX = x; currentY = y;
          i += 5;
        } else { i++; }
        break;
      }
      case '(;': {
        i++;
        while (i < tokens.length && tokens[i] !== 'q' && tokens[i] !== 'Q' &&
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
              commands.push({ type: 'C', c1x, c1y, c2x, c2y, x, y });
              currentX = x; currentY = y;
              i += 6;
            } else break;
          } else break;
        }
        break;
      }
      case '(': {
        i++;
        while (i < tokens.length && tokens[i] !== ';') i++;
        if (i < tokens.length && tokens[i] === ';') i++;
        while (i < tokens.length && tokens[i] !== 'q' && tokens[i] !== 'Q' &&
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
              commands.push({ type: 'C', c1x, c1y, c2x, c2y, x, y });
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
        while (i < tokens.length && tokens[i] !== ');' && tokens[i] !== ')' &&
               tokens[i] !== '!' && tokens[i] !== '|' && tokens[i] !== '[') i++;
        break;
      }
      case ');':
      case ')': i++; break;
      case 'S': {
        if (i + 1 < tokens.length) {
          const styleIndex = parseInt(tokens[i + 1] as string, 10);
          if (!Number.isNaN(styleIndex)) i += 2;
          else i++;
        } else i++;
        break;
      }
      case '/': {
        commands.push({ type: 'Z' });
        startX = NaN; startY = NaN;
        i++;
        break;
      }
      default: i++;
    }
  }
  if (!Number.isNaN(startX) && !Number.isNaN(currentX) &&
      Math.abs(currentX - startX) < EPSILON && Math.abs(currentY - startY) < EPSILON) {
    const last = commands[commands.length - 1];
    if (last && last.type !== 'Z') commands.push({ type: 'Z' });
  }
  return { commands };
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

function parseFillStyle(block: string): { type: string; index: number; color: string; alpha: number } {
  const type = (block.match(/<FillStyle\b[^>]*\btype="([^"]*)"/) ?? ['', 'solid'])[1] as string;
  const idx = (block.match(/<FillStyle\b[^>]*\bindex="([^"]*)"/) ?? ['', '0'])[1];
  const solidMatch = block.match(/<SolidColor\b[^>]*\bcolor="([^"]*)"(?:\s+[^>]*\balpha="([^"]*)")?/);
  if (solidMatch) {
    return { type, index: Number(idx), color: solidMatch[1] as string, alpha: solidMatch[2] ? Number(solidMatch[2]) : 1 };
  }
  const gradMatch = block.match(/<GradientEntry\b[^>]*\bcolor="([^"]*)"/);
  if (gradMatch) {
    return { type, index: Number(idx), color: gradMatch[1] as string, alpha: 1 };
  }
  return { type, index: Number(idx), color: '#808080', alpha: 1 };
}

interface Matrix2D { a: number; b: number; c: number; d: number; tx: number; ty: number; }

function matrixToSvgTransform(m: Matrix2D): string {
  return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.tx} ${m.ty})`;
}

interface ParsedShape {
  matrix: Matrix2D | null;
  fillColor: string | null;
  fillOpacity: number;
  edgeStrings: Array<{ cubics: string; edges: string }>;
}

function parseShapeAt(block: string): ParsedShape {
  const result: ParsedShape = { matrix: null, fillColor: null, fillOpacity: 1, edgeStrings: [] };
  const matrixBlock = extractBalancedBlocks(block, 'matrix')[0];
  if (matrixBlock) {
    const m = matrixBlock.match(/<Matrix\b([^/>]*)\/?>/);
    if (m) {
      const attrs = m[1] as string;
      const get = (k: string): number => {
        const x = attrs.match(new RegExp('\\b' + k + '="([^"]*)"'));
        return x ? Number(x[1]) : 0;
      };
      result.matrix = { a: get('a'), b: get('b'), c: get('c'), d: get('d'), tx: get('tx'), ty: get('ty') };
    }
  }
  const fillsBlock = extractBalancedBlocks(block, 'fills')[0];
  if (fillsBlock) {
    const fillStyleBlocks = extractBalancedBlocks(fillsBlock, 'FillStyle');
    if (fillStyleBlocks.length > 0) {
      const fill = parseFillStyle(fillStyleBlocks[0] as string);
      result.fillColor = fill.color;
      result.fillOpacity = Number.isFinite(fill.alpha) ? Math.max(0, Math.min(1, fill.alpha)) : 1;
    }
  }
  const edgesBlock = extractBalancedBlocks(block, 'edges')[0];
  if (edgesBlock) {
    const edgeBlocks = extractSelfClosingTags(edgesBlock, 'Edge');
    for (const eb of edgeBlocks) {
      const cubics = ((eb.match(/\bcubics="([^"]*)"/) ?? ['', ''])[1]) as string;
      const edges = ((eb.match(/\bedges="([^"]*)"/) ?? ['', ''])[1]) as string;
      result.edgeStrings.push({ cubics, edges });
    }
  }
  return result;
}

// ---- Renderable target discovery and Main-side C01/C02 build path ----
/**
 * R2 corrective (#309): catalog discovery and frame-source assembly can run
 * at different times, so target ids derive from source bytes and a logical
 * target key rather than from catalog build order.
 */
function stableRenderTargetId(bytes: Uint8Array, logicalTargetKey: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(bytes)
    .update('\u0000', 'utf8')
    .update(logicalTargetKey, 'utf8')
    .digest('hex');
  return 'fla-render-target-' + digest;
}

function displaySourceFromArchive(
  archive: ParsedArchive,
): { readonly ok: true; readonly source: FlaStaticSnapshotDisplaySource } | BuildSvgFailure {
  // ActionScript is never interpreted; static display-list extraction does
  // not need to reject otherwise renderable frames that happen to contain it.
  const adapted = adaptFlaXflDisplaySource(archive.docXml, archive.libraryXmlEntries);
  if (!adapted.ok) return adapted;
  return { ok: true, source: adapted.source };
}

function mapResolverFailure(result: FlaDisplayListResolverResult): BuildSvgFailure {
  if (result.ok) return { ok: false, code: 'RENDER_FAILED', message: 'Expected a failed display-list resolution' };
  const code = result.code === 'MAX_RECURSION_DEPTH_EXCEEDED' ||
      result.code === 'MAX_RESOLVED_NODES_EXCEEDED'
    ? 'BUDGET_EXCEEDED'
    : result.code === 'MISSING_SYMBOL' || result.code === 'SYMBOL_CYCLE' ||
        result.code === 'UNSUPPORTED_SYMBOL_TYPE'
      ? 'TARGET_UNSUPPORTED'
      : 'RENDER_FAILED';
  return { ok: false, code, message: (result.message + ' (' + result.sourcePath + ')').slice(0, 1_000) };
}

function resolveTargetDisplayList(
  source: FlaStaticSnapshotDisplaySource,
  target: FlaRenderTarget,
): { readonly ok: true; readonly displayList: FlaResolvedDisplayList } | BuildSvgFailure {
  let root: FlaDisplayListResolverInput['root'];
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
    const frameContext = selectedFrameIndex === 0
      ? { ok: true as const, value: descriptor.frameContext }
      : source.buildGraphicFrameContext(
          descriptor.timelineXml,
          descriptor.frameSpanIndex,
          selectedFrameIndex,
          'graphic:' + descriptor.sourceLibraryItemName,
        );
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
    if (selectedFrameIndex >= target.frameCount || selectedFrameIndex >= descriptor.frameCount) {
      return { ok: false, code: 'TARGET_OUT_OF_RANGE', message: 'selectedFrameIndex ' + selectedFrameIndex + ' >= frameCount ' + target.frameCount };
    }
    const frameContext = selectedFrameIndex === 0
      ? { ok: true as const, value: descriptor.frameContext }
      : source.buildSceneFrameContext(descriptor.xml, selectedFrameIndex, 'scene:' + timelineIndex);
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

  const resolved = resolveFlaDisplayList({ root, symbols: source.symbols });
  if (!resolved.ok) return mapResolverFailure(resolved);
  return { ok: true, displayList: resolved.displayList };
}

function catalogSupportReason(
  source: FlaStaticSnapshotDisplaySource,
  displayList: FlaResolvedDisplayList,
  resolveBitmapMedia: FlaStaticSnapshotBitmapMediaLookup,
  allowBlankFrame = false,
): string | null {
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
    const shapeBlock = source.shapeBlocks.get(node.shapeId);
    const shape = shapeBlock ? parseShapeAt(shapeBlock) : null;
    if (!shape || !shape.edgeStrings.some(({ cubics, edges }) => Boolean(cubics || edges))) {
      reason = 'Shape has no supported path data: ' + node.shapeId;
    }
  };
  for (const layer of displayList.layers) {
    for (const node of layer.children) visit(node);
  }
  if (reason) return reason;
  return drawableCount > 0 || allowBlankFrame
    ? null
    : 'No visible bitmap or vector content is available in this frame';
}

// ---- Public catalog builder ----
export async function buildRenderableTargetCatalog(
  bytes: Uint8Array,
  resolveBitmapMedia: FlaStaticSnapshotBitmapMediaLookup = () => ({ ok: false, reason: 'missing' }),
): Promise<BuildCatalogResult> {
  const archive = await parseArchive(bytes);
  if (!archive.ok) return archive;
  const adapted = displaySourceFromArchive(archive.archive);
  if (!adapted.ok) return adapted;
  const source = adapted.source;
  const entries: BuildCatalogSuccess['entries'] = [];

  // Keep the scene selectable even when it is made from bitmap placements
  // or nested Graphic symbols, and reserve its slot within the target cap.
  const scene = source.sceneTimelines[0];
  if (scene && scene.frameCount > 0 && scene.frameContext.layers.some((layer) => layer.elements.length > 0)) {
    const target: FlaRenderTarget = {
      renderTargetId: stableRenderTargetId(bytes, 'scene\u0000timeline\u0000' + scene.index),
      kind: 'scene',
      userLabel: '\u4e3b\u573a\u666f \u00b7 \u7b2c 1 \u5e27',
      sourceTimelineIndex: scene.index,
      frameCount: Math.min(100_000, scene.frameCount),
      compatibility: ['degraded'],
    };
    const resolved = resolveTargetDisplayList(source, target);
    const unsupportedReason = resolved.ok
      ? catalogSupportReason(source, resolved.displayList, resolveBitmapMedia)
      : resolved.message;
    entries.push({ target, previewSupported: unsupportedReason === null, ...(unsupportedReason ? { unsupportedReason } : {}) });
  }

  // Nested Graphic targets go first so the fixed catalog limit cannot hide
  // the recursion path required by the nested-symbol acceptance corpus.
  const orderedSymbols = [
    ...source.graphicSymbols.filter((symbol) => symbol.hasNestedSymbol),
    ...source.graphicSymbols.filter((symbol) => !symbol.hasNestedSymbol),
  ];
  for (const symbol of orderedSymbols) {
    if (entries.length >= MAX_TARGETS) break;
    if (!symbol.hasPotentialDisplayElements) continue;
    const target: FlaRenderTarget = {
      renderTargetId: stableRenderTargetId(
        bytes,
        'graphic-symbol\u0000' + symbol.sourceLibraryItemName + '\u0000' + symbol.userLabel,
      ),
      kind: 'graphic-symbol',
      userLabel: symbol.userLabel,
      sourceLibraryItemName: symbol.sourceLibraryItemName,
      frameCount: Math.min(100_000, Math.max(1, symbol.frameCount)),
      compatibility: ['degraded'],
    };
    const resolved = resolveTargetDisplayList(source, target);
    const initialFrameIsBlank = symbol.frameContext.layers.every(
      (layer) => !layer.visible || layer.elements.length === 0,
    );
    const unsupportedReason = resolved.ok
      ? catalogSupportReason(source, resolved.displayList, resolveBitmapMedia, initialFrameIsBlank)
      : resolved.message;
    entries.push({ target, previewSupported: unsupportedReason === null, ...(unsupportedReason ? { unsupportedReason } : {}) });
  }

  const summary = entries.length === 0
    ? '\u8fd9\u4e2a FLA \u6ca1\u6709\u53ef\u6e32\u67d3\u5185\u5bb9\u3002'
    : '\u8fd9\u4e2a FLA \u6709 ' + entries.length + ' \u4e2a\u53ef\u9884\u89c8\u76ee\u6807\u3002';
  return { ok: true, entries, summary };
}

// ---- Public SVG builder for a given render target ----
export async function buildSvgForRenderTarget(
  bytes: Uint8Array,
  target: FlaRenderTarget,
  resolveBitmapMedia: FlaStaticSnapshotBitmapMediaLookup = () => ({ ok: false, reason: 'missing' }),
): Promise<BuildComposedSvgResult> {
  const archive = await parseArchive(bytes);
  if (!archive.ok) return archive;
  const adapted = displaySourceFromArchive(archive.archive);
  if (!adapted.ok) return adapted;
  const resolved = resolveTargetDisplayList(adapted.source, target);
  if (!resolved.ok) return resolved;
  return buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    stageWidth: adapted.source.stageWidth,
    stageHeight: adapted.source.stageHeight,
    shapeBlocks: adapted.source.shapeBlocks,
    resolveBitmapMedia,
  });
}

export interface FlaStaticSnapshotBitmapMedia {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly pngBytes: Uint8Array;
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
    readonly shapeCount: number;
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
  readonly stageWidth: number;
  readonly stageHeight: number;
  /** C01 shape ids map to source DOMShape blocks held in the Main process. */
  readonly shapeBlocks: ReadonlyMap<string, string>;
  /** Resolves names against the Panda-owned inspection-session PNG payloads. */
  readonly resolveBitmapMedia: FlaStaticSnapshotBitmapMediaLookup;
}

interface ComposedLeaf {
  readonly node: Exclude<FlaResolvedDisplayNode, { readonly kind: 'group' }>;
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

function createGraphicViewport(bounds: MutableBounds): GraphicViewport | null {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return null;
  const rawWidth = bounds.maxX - bounds.minX;
  const rawHeight = bounds.maxY - bounds.minY;
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth < 0 || rawHeight < 0) return null;
  const contentWidth = Math.max(1, rawWidth);
  const contentHeight = Math.max(1, rawHeight);
  const contentBounds: Rect2D = { x: bounds.minX, y: bounds.minY, width: rawWidth, height: rawHeight };
  const viewBox: Rect2D = {
    x: bounds.minX - GRAPHIC_CONTENT_PADDING,
    y: bounds.minY - GRAPHIC_CONTENT_PADDING,
    width: contentWidth + GRAPHIC_CONTENT_PADDING * 2,
    height: contentHeight + GRAPHIC_CONTENT_PADDING * 2,
  };
  if (![viewBox.x, viewBox.y, viewBox.width, viewBox.height].every(Number.isFinite) ||
      viewBox.width <= 0 || viewBox.height <= 0) return null;

  const pixelScale = Math.sqrt(MAX_OUTPUT_PIXELS) / Math.sqrt(viewBox.width) / Math.sqrt(viewBox.height);
  const scale = Math.min(1, MAX_OUTPUT_WIDTH / viewBox.width, MAX_OUTPUT_HEIGHT / viewBox.height, pixelScale);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  let outputWidth = Math.max(1, Math.min(MAX_OUTPUT_WIDTH, Math.ceil(viewBox.width * scale)));
  let outputHeight = Math.max(1, Math.min(MAX_OUTPUT_HEIGHT, Math.ceil(viewBox.height * scale)));
  while (outputWidth * outputHeight > MAX_OUTPUT_PIXELS) {
    if (outputWidth / viewBox.width >= outputHeight / viewBox.height && outputWidth > 1) outputWidth -= 1;
    else if (outputHeight > 1) outputHeight -= 1;
    else return null;
  }
  return { contentBounds, viewBox, outputWidth, outputHeight };
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

function validSvgColor(value: string | null): string {
  if (value && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value)) {
    return value;
  }
  return '#808080';
}

function matrixIsFinite(matrix: FlaResolvedDisplayNode['worldTransform']): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].every(Number.isFinite);
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
      for (const child of node.children) {
        const nestedFailure = visit(child, depth + 1);
        if (nestedFailure) return nestedFailure;
      }
      return null;
    }
    leaves.push({ node });
    return null;
  };

  for (const layer of displayList.layers) {
    for (const node of layer.children) {
      const nestedFailure = visit(node, 0);
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
 * leaves are emitted in input order. XFL parser source order is back-to-front,
 * and SVG paints later siblings on top, matching Animate's stacking semantics.
 */
export function buildSvgForResolvedDisplayList(input: BuildComposedSvgInput): BuildComposedSvgResult {
  const { displayList, stageWidth, stageHeight, shapeBlocks, resolveBitmapMedia } = input;
  if (!displayList || !Array.isArray(displayList.layers) || !shapeBlocks ||
      typeof shapeBlocks.get !== 'function' ||
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

  const graphicBounds = framingMode === 'content' ? createBounds() : null;
  const definitions = new Map<string, string>();
  const resolvedMediaByName = new Map<string, FlaStaticSnapshotBitmapMediaLookupResult>();
  const emittedNodes: string[] = [];
  let embeddedPngBytes = 0;
  let emittedContentBytes = 0;
  let pathCommandCount = 0;
  let shapeCount = 0;
  let bitmapInstanceCount = 0;
  let firstFillColor: string | null = null;

  for (const { node } of flattened.leaves) {
    if (node.kind === 'shape') {
      const shapeBlock = shapeBlocks.get(node.shapeId);
      if (!shapeBlock) {
        return { ok: false, code: 'RENDER_FAILED', message: `Resolved shape source not found: ${node.shapeId}` };
      }
      const shape = parseShapeAt(shapeBlock);
      if (shape.edgeStrings.length === 0) {
        return { ok: false, code: 'RENDER_FAILED', message: `Resolved shape has no Edge children: ${node.shapeId}` };
      }
      const commands: DecodedEdges['commands'] = [];
      for (const { cubics, edges } of shape.edgeStrings) {
        const encodedEdges = cubics || edges;
        if (encodedEdges.length > MAX_EDGE_CHARS) {
          return { ok: false, code: 'BUDGET_EXCEEDED', message: `Edge attribute exceeds ${MAX_EDGE_CHARS} chars` };
        }
        const decoded = decodeEdgesWithStyleChanges(encodedEdges);
        commands.push(...decoded.commands);
        if (commands.length > 1_000_000) {
          return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed vector path exceeds the command budget' };
        }
      }
      if (commands.length === 0) {
        return { ok: false, code: 'RENDER_FAILED', message: `Resolved shape has no decoded path: ${node.shapeId}` };
      }
      if (graphicBounds && !includeTransformedPathBounds(graphicBounds, commands, node.worldTransform)) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: `Graphic Shape bounds are not finite: ${node.shapeId}` };
      }
      const fillColor = validSvgColor(shape.fillColor);
      if (firstFillColor === null) firstFillColor = fillColor;
      const pathD = commandsToSvgPath(commands);
      const pathBytes = Buffer.byteLength(pathD, 'utf8');
      if (pathBytes > MAX_EDGE_CHARS || pathBytes + embeddedPngBytes + emittedContentBytes > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG exceeds the output byte budget' };
      }
      const pathNode = `<path d="${pathD}" transform="${matrixToSvgTransform(node.worldTransform)}" fill="${fillColor}" fill-opacity="${shape.fillOpacity}" stroke="none" fill-rule="evenodd"/>`;
      emittedContentBytes += Buffer.byteLength(pathNode, 'utf8');
      emittedNodes.push(pathNode);
      pathCommandCount += commands.length;
      shapeCount += 1;
      continue;
    }

    bitmapInstanceCount += 1;
    let resolution = resolvedMediaByName.get(node.libraryItemName);
    if (!resolution) {
      resolution = resolveBitmapMedia(node.libraryItemName);
      resolvedMediaByName.set(node.libraryItemName, resolution);
    }
    if (!resolution.ok) {
      const reason = resolution.reason === 'ambiguous' ? 'is ambiguous' : 'was not found';
      return {
        ok: false,
        code: 'TARGET_UNSUPPORTED',
        message: `Bitmap media reference ${reason}: ${node.libraryItemName}`,
      };
    }
    const media = resolution.media;
    if (!media.id || !Number.isSafeInteger(media.width) || !Number.isSafeInteger(media.height) ||
        media.width <= 0 || media.height <= 0 || media.width > MAX_OUTPUT_WIDTH ||
        media.height > MAX_OUTPUT_HEIGHT || media.width * media.height > MAX_OUTPUT_PIXELS ||
        !(media.pngBytes instanceof Uint8Array) || media.pngBytes.byteLength <= 0 ||
        media.pngBytes.byteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes ||
        !isPngWithExpectedDimensions(media.pngBytes, media.width, media.height)) {
      return {
        ok: false,
        code: 'RENDER_FAILED',
        message: `Bitmap media payload is not a bounded RGBA PNG: ${node.libraryItemName}`,
      };
    }
    if (graphicBounds && !includeTransformedBitmapBounds(graphicBounds, media.width, media.height, node.worldTransform)) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: `Graphic bitmap bounds are not finite: ${node.libraryItemName}` };
    }
    const mediaKey = crypto.createHash('sha256').update(media.id, 'utf8').digest('hex').slice(0, 24);
    const imageId = `fla-bitmap-${mediaKey}`;
    if (!definitions.has(imageId)) {
      const base64Length = Math.ceil(media.pngBytes.byteLength / 3) * 4;
      const estimatedSvgBytes = embeddedPngBytes + emittedContentBytes + base64Length + 512;
      if (estimatedSvgBytes > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Embedded PNG media exceeds the SVG byte budget' };
      }
      const dataUri = Buffer.from(
        media.pngBytes.buffer,
        media.pngBytes.byteOffset,
        media.pngBytes.byteLength,
      ).toString('base64');
      embeddedPngBytes += dataUri.length;
      definitions.set(
        imageId,
        `<image id="${imageId}" x="0" y="0" width="${media.width}" height="${media.height}" preserveAspectRatio="none" href="data:image/png;base64,${dataUri}"/>`,
      );
    }
    const useNode = `<use href="#${imageId}" transform="${matrixToSvgTransform(node.worldTransform)}"/>`;
    emittedContentBytes += Buffer.byteLength(useNode, 'utf8');
    if (embeddedPngBytes + emittedContentBytes > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG exceeds the output byte budget' };
    }
    emittedNodes.push(useNode);
  }

  const graphicViewport = graphicBounds ? createGraphicViewport(graphicBounds) : null;
  const blankGraphic = framingMode === 'content' && flattened.leaves.length === 0;
  if (framingMode === 'content' && !graphicViewport && !blankGraphic) {
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
  const defs = definitions.size > 0 ? `<defs>${[...definitions.values()].join('')}</defs>` : '';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatRect(viewBox)}" width="${width}" height="${height}">` +
    `<title>FLA composed snapshot — ${title}</title>` +
    `<desc>kind=${displayList.kind} frame=${displayList.frameIndex} resolvedNodes=${displayList.resolvedNodeCount} drawableLeaves=${flattened.leaves.length} groups=${flattened.groupCount} expandedSymbols=${flattened.expandedSymbolCount} bitmapInstances=${bitmapInstanceCount} shapes=${shapeCount} framing=${framingMode} viewBox=${formatRect(viewBox)} output=${width}x${height}${contentBounds ? ` contentBounds=${formatRect(contentBounds)} padding=${GRAPHIC_CONTENT_PADDING}` : ''}</desc>` +
    defs + emittedNodes.join('') + '</svg>\n';
  const svgByteLength = Buffer.byteLength(svg, 'utf8');
  if (svgByteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Composed SVG exceeds the output byte budget' };
  }
  return {
    ok: true,
    svg,
    width,
    height,
    pixelCount: width * height,
    pathCommandCount,
    firstFillColor,
    hasRenderablePath: shapeCount > 0,
    composition: {
      resolvedNodeCount: displayList.resolvedNodeCount,
      bitmapInstanceCount,
      shapeCount,
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
