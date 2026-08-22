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

// ---- Limits (subset of FLA_IMPORT_LIMITS used by the R1 SVG builder) ----
const MAX_SOURCE_BYTES = FLA_IMPORT_LIMITS.maxSourceBytes; // 256 MiB
const MAX_XML_BYTES = FLA_IMPORT_LIMITS.maxXmlBytes; // 32 MiB
const MAX_OUTPUT_WIDTH = 4_096;
const MAX_OUTPUT_HEIGHT = 4_096;
const MAX_OUTPUT_PIXELS = 16_777_216;
const MAX_TARGETS = 64;
const MAX_EDGE_CHARS = 64 * 1024 * 1024; // 64 MiB; matches maxSnapshotBytes cap

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
  // Whether the source has any path. R1-C honesty: if false, the
  // resulting PNG is the transparent background, NOT a faithful
  // representation of the target.
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

function applyMatrixToPoint(m: Matrix2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
}

interface ParsedShape {
  matrix: Matrix2D | null;
  fillColor: string | null;
  edgeStrings: Array<{ cubics: string; edges: string }>;
}

function parseShapeAt(block: string): ParsedShape {
  const result: ParsedShape = { matrix: null, fillColor: null, edgeStrings: [] };
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
      result.fillColor = parseFillStyle(fillStyleBlocks[0] as string).color;
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

function pathBoundingBoxAfterMatrix(commands: DecodedEdges['commands'], m: Matrix2D | null): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let x = 0, y = 0;
  for (const cmd of commands) {
    if (cmd.type === 'M') { x = cmd.x; y = cmd.y; }
    else if (cmd.type === 'L') { x = cmd.x; y = cmd.y; }
    else if (cmd.type === 'Q') { x = cmd.x; y = cmd.y; }
    else if (cmd.type === 'C') { x = cmd.x; y = cmd.y; }
    else if (cmd.type === 'Z') { /* keep position */ }
    const p = m ? applyMatrixToPoint(m, x, y) : { x, y };
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function stageSize(docXml: string): { width: number; height: number } {
  const widthMatch = docXml.match(/<DOMDocument\b[^>]*\bwidth="([^"]*)"/);
  const heightMatch = docXml.match(/<DOMDocument\b[^>]*\bheight="([^"]*)"/);
  const width = widthMatch ? parseFloat(widthMatch[1] as string) : 550;
  const height = heightMatch ? parseFloat(heightMatch[1] as string) : 400;
  return { width, height };
}

// ---- Renderable target discovery ----
function uuid(): string {
  // crypto.randomUUID is available in Node 19+. This keeps us
  // off jszip's transitive dep and matches the contract's UUID v4.
  return crypto.randomUUID();
}

function findGraphicSymbolShape(libraryXml: string): { shapeBlock: string; matrix: Matrix2D | null; symbolName: string; graphicFrameCount: number } | null {
  const symbolName = (libraryXml.match(/<DOMSymbolItem\b[^>]*\bname="([^"]*)"/) ?? ['', 'unnamed-graphic'])[1] as string;
  const timelines = extractBalancedBlocks(libraryXml, 'DOMTimeline');
  for (const tl of timelines) {
    const layers = extractBalancedBlocks(tl, 'DOMLayer');
    for (const layer of layers) {
      const frames = extractBalancedBlocks(layer, 'DOMFrame');
      for (const frame of frames) {
        const groups = extractBalancedBlocks(frame, 'DOMGroup');
        for (const group of groups) {
          const shapes = extractBalancedBlocks(group, 'DOMShape');
          if (shapes.length > 0) {
            return { shapeBlock: shapes[0] as string, matrix: parseShapeAt(group as string).matrix, symbolName, graphicFrameCount: frames.length };
          }
        }
        const directShapes = extractBalancedBlocks(frame, 'DOMShape');
        if (directShapes.length > 0) {
          return { shapeBlock: directShapes[0] as string, matrix: null, symbolName, graphicFrameCount: frames.length };
        }
      }
    }
  }
  return null;
}

function findSceneTimelineFrameShape(docXml: string, frameIndex: number): { shapeBlock: string; matrix: Matrix2D | null; frameCount: number } | null {
  const timelines = extractBalancedBlocks(docXml, 'DOMTimeline');
  for (const tl of timelines) {
    const layers = extractBalancedBlocks(tl, 'DOMLayer');
    let frameCount = 0;
    for (const layer of layers) {
      const frames = extractBalancedBlocks(layer, 'DOMFrame');
      frameCount = Math.max(frameCount, frames.length);
    }
    if (frameIndex >= frameCount) return null;
    for (const layer of layers) {
      const frames = extractBalancedBlocks(layer, 'DOMFrame');
      const frame = frames[frameIndex];
      if (!frame) continue;
      const groups = extractBalancedBlocks(frame, 'DOMGroup');
      for (const group of groups) {
        const shapes = extractBalancedBlocks(group, 'DOMShape');
        if (shapes.length > 0) {
          return { shapeBlock: shapes[0] as string, matrix: parseShapeAt(group as string).matrix, frameCount };
        }
      }
      const directShapes = extractBalancedBlocks(frame, 'DOMShape');
      if (directShapes.length > 0) {
        return { shapeBlock: directShapes[0] as string, matrix: null, frameCount };
      }
    }
  }
  return null;
}

// ---- Public catalog builder ----
export async function buildRenderableTargetCatalog(bytes: Uint8Array): Promise<BuildCatalogResult> {
  const archive = await parseArchive(bytes);
  if (!archive.ok) return archive;
  const { docXml, libraryXmlEntries } = archive.archive;
  const entries: BuildCatalogSuccess['entries'] = [];
  // 1. graphic symbols
  for (const lib of libraryXmlEntries) {
    const found = findGraphicSymbolShape(lib.xml);
    if (!found) continue;
    const renderTargetId = `fla-render-target-${uuid().replace(/-/g, '').slice(0, 32)}`;
    const target: FlaRenderTarget = {
      renderTargetId,
      kind: 'graphic-symbol',
      userLabel: found.symbolName, // The library item name is the most beginner-readable label.
      sourceLibraryItemName: found.symbolName,
      frameCount: found.graphicFrameCount,
      compatibility: found.graphicFrameCount > 0 ? ['degraded'] : ['unsupported'],
    };
    entries.push({ target, previewSupported: true });
    if (entries.length >= MAX_TARGETS) break;
  }
  // 2. main scene timeline (single scene, frame 0+)
  const sceneShape = findSceneTimelineFrameShape(docXml, 0);
  if (sceneShape) {
    const renderTargetId = `fla-render-target-${uuid().replace(/-/g, '').slice(0, 32)}`;
    const target: FlaRenderTarget = {
      renderTargetId,
      kind: 'scene',
      userLabel: '主场景 · 第 1 帧',
      sourceTimelineIndex: 0,
      frameCount: sceneShape.frameCount,
      compatibility: ['degraded'],
    };
    entries.push({ target, previewSupported: true });
  }
  // If the FLA had 0 renderable targets, surface that honestly.
  const summary = entries.length === 0
    ? '这个 FLA 没有可渲染的矢量内容。'
    : `这个 FLA 有 ${entries.length} 个可渲染的图形。`;
  return { ok: true, entries, summary };
}

// ---- Public SVG builder for a given render target ----
export async function buildSvgForRenderTarget(bytes: Uint8Array, target: FlaRenderTarget): Promise<BuildSvgResult> {
  const archive = await parseArchive(bytes);
  if (!archive.ok) return archive;
  const { docXml, libraryXmlEntries } = archive.archive;
  const stage = stageSize(docXml);

  // 1. Resolve the target to a DOMShape block.
  let shapeBlock: string;
  let groupMatrix: Matrix2D | null;
  if (target.kind === 'graphic-symbol') {
    const lib = libraryXmlEntries.find(l => l.name.endsWith(`/${target.sourceLibraryItemName ?? ''}.xml`) || l.name === `LIBRARY/${target.sourceLibraryItemName ?? ''}.xml`);
    if (!lib) {
      return { ok: false, code: 'TARGET_UNSUPPORTED', message: `Library item not found: ${target.sourceLibraryItemName ?? '(unset)'}` };
    }
    const found = findGraphicSymbolShape(lib.xml);
    if (!found) {
      return { ok: false, code: 'TARGET_UNSUPPORTED', message: `Graphic symbol has no renderable shape: ${target.sourceLibraryItemName}` };
    }
    shapeBlock = found.shapeBlock;
    groupMatrix = found.matrix;
  } else if (target.kind === 'scene' || target.kind === 'timeline') {
    const idx = target.selectedFrameIndex ?? 0;
    if (idx >= target.frameCount) {
      return { ok: false, code: 'TARGET_OUT_OF_RANGE', message: `selectedFrameIndex ${idx} >= frameCount ${target.frameCount}` };
    }
    const found = findSceneTimelineFrameShape(docXml, idx);
    if (!found) {
      return { ok: false, code: 'TARGET_UNSUPPORTED', message: `Scene frame ${idx} has no renderable shape` };
    }
    shapeBlock = found.shapeBlock;
    groupMatrix = found.matrix;
  } else {
    return { ok: false, code: 'TARGET_UNSUPPORTED', message: `Unknown target kind: ${target.kind as string}` };
  }

  // 2. Parse the shape block (matrix + fills + edges).
  const shape = parseShapeAt(shapeBlock);
  if (shape.edgeStrings.length === 0) {
    return { ok: false, code: 'RENDER_FAILED', message: 'DOMShape has no <Edge> children' };
  }

  // 3. Decode all edges, preferring cubics.
  const allCommands: DecodedEdges['commands'] = [];
  for (const { cubics, edges } of shape.edgeStrings) {
    const src = cubics || edges;
    if (!src) continue;
    if (src.length > MAX_EDGE_CHARS) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: `Edge attribute exceeds ${MAX_EDGE_CHARS} chars` };
    }
    const { commands } = decodeEdgesWithStyleChanges(src);
    for (const c of commands) allCommands.push(c);
  }
  if (allCommands.length === 0) {
    return { ok: false, code: 'RENDER_FAILED', message: 'Edge decoder produced no commands' };
  }
  const hasRenderablePath = true;

  // 4. Build SVG with viewBox fitted to transformed bounding box.
  const transform = shape.matrix ? matrixToSvgTransform(shape.matrix) : (groupMatrix ? matrixToSvgTransform(groupMatrix) : '');
  const effectiveMatrix = shape.matrix ?? groupMatrix;
  const bbox = pathBoundingBoxAfterMatrix(allCommands, effectiveMatrix);
  let viewBox: string;
  let width: number;
  let height: number;
  if (bbox) {
    const w = Math.max(1, bbox.maxX - bbox.minX);
    const h = Math.max(1, bbox.maxY - bbox.minY);
    const margin = Math.max(w, h) * 0.05;
    viewBox = `${bbox.minX - margin} ${bbox.minY - margin} ${w + margin * 2} ${h + margin * 2}`;
    width = w + margin * 2;
    height = h + margin * 2;
  } else {
    viewBox = `0 0 ${stage.width} ${stage.height}`;
    width = stage.width;
    height = stage.height;
  }
  if (width > MAX_OUTPUT_WIDTH || height > MAX_OUTPUT_HEIGHT) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: `Output ${width}x${height} exceeds budget` };
  }
  if (width * height > MAX_OUTPUT_PIXELS) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: `Output pixel count ${width * height} exceeds ${MAX_OUTPUT_PIXELS}` };
  }

  const pathD = commandsToSvgPath(allCommands);
  const fillColor = shape.fillColor ?? '#808080';
  const fillOpacity = 1;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width.toFixed(4)}" height="${height.toFixed(4)}">
  <title>FLA V2-R1 snapshot — ${target.userLabel}</title>
  <desc>target=${target.renderTargetId} kind=${target.kind} frame=${target.selectedFrameIndex ?? 0}</desc>
  <g transform="${transform}">
    <path d="${pathD}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="none" fill-rule="evenodd"/>
  </g>
</svg>
`;

  return {
    ok: true,
    svg,
    width: Math.round(width),
    height: Math.round(height),
    pixelCount: Math.round(width) * Math.round(height),
    pathCommandCount: allCommands.length,
    firstFillColor: fillColor,
    hasRenderablePath,
  };
}
