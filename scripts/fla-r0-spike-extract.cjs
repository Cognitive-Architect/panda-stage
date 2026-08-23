/*
 * FLA V2-R0 spike — pure-Node shape extraction (read-only).
 *
 *   Purpose: drive the R0-A / R0-B / R0-D evidence by extracting the
 *            first non-empty <DOMShape> from 剑.fla and emitting a
 *            standalone SVG that R0 can later rasterize.
 *
 *   Contract (Issue #284):
 *     - never mutates the source FLA bytes;
 *     - never executes ActionScript (we only read XML attributes);
 *     - never reaches network, never touches the Panda Project tree;
 *     - bounded by the same source / XML / entry limits as the production
 *       preflight (src/shared/fla-import-api.ts FLA_IMPORT_LIMITS).
 *
 *   This is a research-only tool. It is NOT wired into the normal FLA
 *   import path. It does not import the production FLAParser runtime;
 *   it derives structural facts from DOMDocument.xml / LIBRARY/*.xml
 *   the same way the V1.5-B0 structural probe (tests/helpers/fla-structural-probe.ts)
 *   does. The edge decoder is a verbatim copy of
 *   src/renderer/fla-import/parser-core/edge-decoder.ts at commit
 *   3c47a4ee8af07e834338b223fcb3260a4c6dddbc.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');

const REPO_ROOT = path.resolve(__dirname, '..');
const FLA_INPUT = process.env.FLA_R0_INPUT || 'D:\\表情合集\\剑.fla';
// Issue #286 §B: default to local external evidence storage; do NOT
// write private real-sample visuals into the tracked repo.
const EVIDENCE_DIR = process.env.FLA_R0_EVIDENCE_DIR
  || 'D:\\PandaStage-Acceptance\\fla-v2-r0';
// The script also emits repo-safe metadata under docs/evidence/issue-284-r0
// (no visual bytes; hashes + dimensions + selectedIdentity only).
const REPO_METADATA_DIR = path.join(REPO_ROOT, 'docs', 'evidence', 'issue-284-r0');
const SVG_OUT = path.join(EVIDENCE_DIR, 'r0-render-sword.svg');
const PNG_OUT = path.join(EVIDENCE_DIR, 'r0-render-sword.png');
const JSON_OUT = path.join(EVIDENCE_DIR, 'r0-extract.json');
const REPO_METADATA_OUT = path.join(REPO_METADATA_DIR, 'r0-extract.json');
const EXPECTED_SHA256 = 'E773508C4079C4FA8235043B69A0F5415BCC1596A3ED345A4C6652B48CE54377';

const LIMITS = {
  maxSourceBytes: 256 * 1024 * 1024,
  maxXmlBytes: 32 * 1024 * 1024,
  maxOutputWidth: 4096,
  maxOutputHeight: 4096,
  maxDecodedPixels: 16_777_216,
  wallClockMs: 30_000,
};

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase(); }

// ---- Balanced-block extractor (mirrors tests/helpers/fla-structural-probe.ts) ----
function nextTagIndex(xml, tag, from) {
  const needle = '<' + tag;
  let i = from;
  for (;;) {
    const idx = xml.indexOf(needle, i);
    if (idx === -1) return -1;
    if (idx === 0 || xml[idx - 1] !== '/') return idx;
    i = idx + needle.length;
  }
}
function extractBalancedBlocks(xml, tag) {
  const close = '</' + tag + '>';
  const blocks = [];
  const openStack = [];
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

// ---- Self-closing tag extractor (for <Edge .../>, <SolidColor .../>, etc.) ----
function extractSelfClosingTags(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*\\/>`, 'g');
  return xml.match(re) || [];
}

// ---- Edge decoder (verbatim copy of decodeEdgesWithStyleChanges,
//      src/renderer/fla-import/parser-core/edge-decoder.ts) ----
const COORD_SCALE = 20;
function decodeCoord(value) {
  if (value.startsWith('#')) {
    const hex = value.substring(1);
    const dotIndex = hex.indexOf('.');
    let intHex;
    let fracHex = null;
    if (dotIndex !== -1) {
      intHex = hex.substring(0, dotIndex);
      fracHex = hex.substring(dotIndex + 1);
    } else { intHex = hex; }
    if (intHex.length === 0) intHex = '0';
    let intPart = parseInt(intHex, 16);
    if (Number.isNaN(intPart)) return NaN;
    const numChars = intHex.length;
    if (numChars >= 6) {
      const bitWidth = numChars * 4;
      const signBit = 1 << (bitWidth - 1);
      if (intPart >= signBit) intPart = intPart - (1 << bitWidth);
    }
    let fracPart = 0;
    if (fracHex && fracHex.length > 0) {
      const fracValue = parseInt(fracHex, 16);
      if (!Number.isNaN(fracValue)) {
        const fracBits = fracHex.length * 4;
        fracPart = fracValue / (1 << fracBits);
      }
    }
    return (intPart >= 0 ? intPart + fracPart : intPart - fracPart) / COORD_SCALE;
  }
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return NaN;
  return parsed / COORD_SCALE;
}
function tokenize(edgeStr) {
  const tokens = [];
  let current = '';
  let i = 0;
  const isCommandChar = (c) => c === '!' || c === '|' || c === '[' || c === '/' || c === 'S' || c === 'q' || c === 'Q';
  while (i < edgeStr.length) {
    const char = edgeStr[i];
    if (char === '(' && i + 1 < edgeStr.length && edgeStr[i + 1] === ';') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push('(;');
      current = ''; i += 2; continue;
    }
    if (char === ')' && i + 1 < edgeStr.length && edgeStr[i + 1] === ';') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(');');
      current = ''; i += 2; continue;
    }
    if (char === '(') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push('('); current = ''; i++; continue;
    }
    if (char === ')') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(')'); current = ''; i++; continue;
    }
    if (char === ';') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(';'); current = ''; i++; continue;
    }
    if (isCommandChar(char)) {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(char); current = ''; i++; continue;
    }
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      if (current.trim()) tokens.push(current.trim());
      current = ''; i++; continue;
    }
    if (char === ',') {
      if (current.trim()) tokens.push(current.trim());
      current = ''; i++; continue;
    }
    current += char; i++;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}
function decodeEdgesWithStyleChanges(edgeStr) {
  const commands = [];
  const styleChanges = [];
  const tokens = tokenize(edgeStr);
  let i = 0;
  let currentX = NaN, currentY = NaN;
  let startX = NaN, startY = NaN;
  const EPSILON = 0.5;
  const MAX_COORD = 200000;
  while (i < tokens.length) {
    const token = tokens[i];
    switch (token) {
      case '!': {
        if (i + 2 < tokens.length) {
          const x = decodeCoord(tokens[i + 1]);
          const y = decodeCoord(tokens[i + 2]);
          if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) { i += 3; break; }
          if (Number.isNaN(currentX) || Math.abs(x - currentX) > EPSILON || Math.abs(y - currentY) > EPSILON) {
            commands.push({ type: 'M', x, y });
            startX = x; startY = y;
          }
          currentX = x; currentY = y;
          i += 3;
        } else i++; break;
      }
      case '|': {
        if (i + 2 < tokens.length) {
          const x = decodeCoord(tokens[i + 1]);
          const y = decodeCoord(tokens[i + 2]);
          if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) { i += 3; break; }
          if (Math.abs(x - currentX) > EPSILON || Math.abs(y - currentY) > EPSILON) {
            commands.push({ type: 'L', x, y });
            currentX = x; currentY = y;
          }
          i += 3;
        } else i++; break;
      }
      case '[': {
        if (i + 4 < tokens.length) {
          const cx = decodeCoord(tokens[i + 1]);
          const cy = decodeCoord(tokens[i + 2]);
          const x = decodeCoord(tokens[i + 3]);
          const y = decodeCoord(tokens[i + 4]);
          if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(x) || !Number.isFinite(y) ||
              Math.abs(cx) > MAX_COORD || Math.abs(cy) > MAX_COORD || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) { i += 5; break; }
          commands.push({ type: 'Q', cx, cy, x, y });
          currentX = x; currentY = y;
          i += 5;
        } else i++; break;
      }
      case '(;': {
        i++;
        while (i < tokens.length && tokens[i] !== 'q' && tokens[i] !== 'Q' && tokens[i] !== ');' && tokens[i] !== ')') {
          if (i + 5 < tokens.length) {
            const next = [tokens[i], tokens[i+1], tokens[i+2], tokens[i+3], tokens[i+4], tokens[i+5]];
            const allCoords = next.every(t => !['!', '|', '[', '/', 'S', 'q', 'Q', '(;', ');', '(', ')', ';'].includes(t));
            if (allCoords) {
              const c1x = decodeCoord(tokens[i]);
              const c1y = decodeCoord(tokens[i+1]);
              const c2x = decodeCoord(tokens[i+2]);
              const c2y = decodeCoord(tokens[i+3]);
              const x = decodeCoord(tokens[i+4]);
              const y = decodeCoord(tokens[i+5]);
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
        while (i < tokens.length && tokens[i] !== 'q' && tokens[i] !== 'Q' && tokens[i] !== ');' && tokens[i] !== ')') {
          if (i + 5 < tokens.length) {
            const next = [tokens[i], tokens[i+1], tokens[i+2], tokens[i+3], tokens[i+4], tokens[i+5]];
            const allCoords = next.every(t => !['!', '|', '[', '/', 'S', 'q', 'Q', '(;', ');', '(', ')', ';'].includes(t));
            if (allCoords) {
              const c1x = decodeCoord(tokens[i]);
              const c1y = decodeCoord(tokens[i+1]);
              const c2x = decodeCoord(tokens[i+2]);
              const c2y = decodeCoord(tokens[i+3]);
              const x = decodeCoord(tokens[i+4]);
              const y = decodeCoord(tokens[i+5]);
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
      case 'q': case 'Q': {
        i++;
        while (i < tokens.length && tokens[i] !== ');' && tokens[i] !== ')' && tokens[i] !== '!' && tokens[i] !== '|' && tokens[i] !== '[') i++;
        break;
      }
      case ');': case ')': i++; break;
      case 'S': {
        if (i + 1 < tokens.length) {
          const styleIndex = parseInt(tokens[i + 1], 10);
          if (!Number.isNaN(styleIndex)) styleChanges.push({ commandIndex: commands.length, fillStyle1: styleIndex });
          i += 2;
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
  return { commands, styleChanges };
}

function commandsToSvgPath(commands) {
  const parts = [];
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

// ---- Parse a <FillStyle> block ----
// XFL actual tags are <FillStyle> (no DOM prefix) with sub-elements
// <SolidColor color="#RRGGBB" alpha=".."/> or
// <LinearGradient><matrix>...<GradientEntry color=.. ratio=../>..</LinearGradient>
function parseFillStyle(block) {
  const type = (block.match(/<FillStyle\b[^>]*\btype="([^"]*)"/) || [])[1] || 'solid';
  const idx = (block.match(/<FillStyle\b[^>]*\bindex="([^"]*)"/) || [])[1];
  const solidMatch = block.match(/<SolidColor\b[^>]*\bcolor="([^"]*)"(?:\s+[^>]*\balpha="([^"]*)")?/);
  if (solidMatch) {
    return { type, index: idx ? Number(idx) : 0, fillKind: 'solid', color: solidMatch[1], alpha: solidMatch[2] ? Number(solidMatch[2]) : 1 };
  }
  // LinearGradient: pick first GradientEntry color
  const gradMatch = block.match(/<GradientEntry\b[^>]*\bcolor="([^"]*)"/);
  if (gradMatch) {
    const alphaMatch = block.match(/<GradientEntry\b[^>]*\balpha="([^"]*)"/);
    return { type, index: idx ? Number(idx) : 0, fillKind: 'linear-gradient', color: gradMatch[1], alpha: alphaMatch ? Number(alphaMatch[1]) : 1 };
  }
  return { type, index: idx ? Number(idx) : 0, fillKind: 'unknown', color: '#808080', alpha: 1 };
}

// ---- Parse a <StrokeStyle> block ----
function parseStrokeStyle(block) {
  const weight = Number((block.match(/\bweight="([^"]*)"/) || [])[1] || '1');
  const idx = (block.match(/<StrokeStyle\b[^>]*\bindex="([^"]*)"/) || [])[1];
  const colorMatch = block.match(/<SolidColor\b[^>]*\bcolor="([^"]*)"/);
  const color = colorMatch ? colorMatch[1] : '#000000';
  return { weight, index: idx ? Number(idx) : 0, color };
}

// ---- Walk DOMGroup → DOMShape → fills/strokes/edges ----
function parseShapeAt(block) {
  const result = { matrix: null, fills: [], strokes: [], edgeStrings: [] };
  // Matrix
  const matrixBlock = (extractBalancedBlocks(block, 'matrix'))[0];
  if (matrixBlock) {
    const m = matrixBlock.match(/<Matrix\b([^/>]*)\/?>/);
    if (m) {
      const attrs = m[1];
      const get = (k) => { const x = attrs.match(new RegExp('\\b' + k + '="([^"]*)"')); return x ? Number(x[1]) : 0; };
      result.matrix = { a: get('a'), b: get('b'), c: get('c'), d: get('d'), tx: get('tx'), ty: get('ty') };
    }
  }
  // Fills
  const fillsBlock = (extractBalancedBlocks(block, 'fills'))[0];
  if (fillsBlock) {
    const fillStyleBlocks = extractBalancedBlocks(fillsBlock, 'FillStyle');
    result.fills = fillStyleBlocks.map(parseFillStyle);
  }
  // Strokes
  const strokesBlock = (extractBalancedBlocks(block, 'strokes'))[0];
  if (strokesBlock) {
    const strokeStyleBlocks = extractBalancedBlocks(strokesBlock, 'StrokeStyle');
    result.strokes = strokeStyleBlocks.map(parseStrokeStyle);
  }
  // Edges
  const edgesBlock = (extractBalancedBlocks(block, 'edges'))[0];
  if (edgesBlock) {
    const edgeBlocks = extractSelfClosingTags(edgesBlock, 'Edge');
    for (const eb of edgeBlocks) {
      const cubics = (eb.match(/\bcubics="([^"]*)"/) || [])[1] || '';
      const edges = (eb.match(/\bedges="([^"]*)"/) || [])[1] || '';
      result.edgeStrings.push({ cubics, edges });
    }
  }
  return result;
}

// ---- Find first DOMShape inside a graphic symbol ----
function findFirstShape(libraryXmlEntries) {
  for (const libXml of libraryXmlEntries) {
    const symMatch = libXml.match(/<DOMSymbolItem\b[^>]*\bsymbolType="graphic"/);
    if (!symMatch) continue;
    const symbolName = (libXml.match(/<DOMSymbolItem\b[^>]*\bname="([^"]*)"/) || [])[1] || 'unnamed-graphic';
    const timelines = extractBalancedBlocks(libXml, 'DOMTimeline');
    for (let ti = 0; ti < timelines.length; ti++) {
      const layers = extractBalancedBlocks(timelines[ti], 'DOMLayer');
      for (let li = 0; li < layers.length; li++) {
        const frames = extractBalancedBlocks(layers[li], 'DOMFrame');
        for (let fi = 0; fi < frames.length; fi++) {
          // Find DOMGroup (which wraps DOMShape in this FLA)
          const groups = extractBalancedBlocks(frames[fi], 'DOMGroup');
          for (let gi = 0; gi < groups.length; gi++) {
            const shapes = extractBalancedBlocks(groups[gi], 'DOMShape');
            if (shapes.length > 0) {
              return {
                symbolName,
                timelineIndex: ti,
                layerIndex: li,
                frameIndex: fi,
                groupIndex: gi,
                shapeIndex: 0,
                shapeBlock: shapes[0],
                groupBlock: groups[gi],
              };
            }
          }
          // Fallback: maybe DOMShape is directly under DOMFrame
          const directShapes = extractBalancedBlocks(frames[fi], 'DOMShape');
          if (directShapes.length > 0) {
            return {
              symbolName,
              timelineIndex: ti,
              layerIndex: li,
              frameIndex: fi,
              groupIndex: -1,
              shapeIndex: 0,
              shapeBlock: directShapes[0],
              groupBlock: null,
            };
          }
        }
      }
    }
  }
  return null;
}

function detectEocdDiscrepancy(bytes) {
  const buf = Buffer.from(bytes);
  const SIG = 0x06054b50;
  let eocdOffset = -1;
  const maxStart = Math.max(0, buf.byteLength - 22 - 0xffff);
  for (let i = buf.byteLength - 22; i >= maxStart; i--) {
    if (buf.readUInt32LE(i) === SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) {
    return { eocdFound: false, centralDirectoryDeclaredBytes: null, centralDirectoryActualBytes: null, cdEndsExactlyAtEocd: null };
  }
  const cdSizeDeclared = buf.readUInt32LE(eocdOffset + 12);
  const cdOffsetDeclared = buf.readUInt32LE(eocdOffset + 16);
  const eocdRecordSize = 22;
  const centralDirectoryActualBytes = Math.max(0, buf.byteLength - eocdRecordSize - cdOffsetDeclared);
  return {
    eocdFound: true,
    centralDirectoryDeclaredBytes: cdSizeDeclared,
    centralDirectoryActualBytes,
    cdEndsExactlyAtEocd: cdOffsetDeclared + cdSizeDeclared + eocdRecordSize === buf.byteLength,
  };
}

function matrixToSvgTransform(m) {
  // SVG transform: matrix(a b c d e f) where e=tx, f=ty
  // Note XFL Y axis: matrix tx/ty are usually the translation; Y goes down in XFL flash.
  return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.tx} ${m.ty})`;
}

function applyMatrixToPoint(m, x, y) {
  // Panda's matrix: tx/ty are translation in PIXELS (after decoder already divided by 20).
  // SVG: matrix(a b c d e f) → x' = a*x + c*y + e, y' = b*x + d*y + f
  return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
}

function pathBoundingBoxAfterMatrix(commands, m) {
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

async function main() {
  const startedAt = Date.now();
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.mkdirSync(REPO_METADATA_DIR, { recursive: true });

  // 1. Read source.
  const sourceBytes = fs.readFileSync(FLA_INPUT);
  if (sourceBytes.byteLength > LIMITS.maxSourceBytes) {
    throw new Error(`FLA source ${sourceBytes.byteLength} bytes exceeds limit ${LIMITS.maxSourceBytes}`);
  }
  const sourceHashBefore = sha256(sourceBytes);

  // 2. EOCD preflight.
  const eocd = detectEocdDiscrepancy(sourceBytes);
  if (!eocd.eocdFound) throw new Error('EOCD not found in source');
  if (eocd.centralDirectoryDeclaredBytes > eocd.centralDirectoryActualBytes) {
    throw new Error(`EOCD over-declares CD size (${eocd.centralDirectoryDeclaredBytes} > ${eocd.centralDirectoryActualBytes})`);
  }

  // 3. Open ZIP.
  const zip = await JSZip.loadAsync(sourceBytes);
  const entryNames = Object.keys(zip.files);
  const domDocEntry = zip.file('DOMDocument.xml');
  if (!domDocEntry) throw new Error('FLA has no DOMDocument.xml');
  const domXml = await domDocEntry.async('string');
  if (domXml.length > LIMITS.maxXmlBytes) throw new Error(`DOMDocument.xml too large: ${domXml.length}`);

  // 4. Stage dimensions.
  const widthMatch = domXml.match(/<DOMDocument\b[^>]*\bwidth="([^"]*)"/);
  const heightMatch = domXml.match(/<DOMDocument\b[^>]*\bheight="([^"]*)"/);
  const docWidth = widthMatch ? parseFloat(widthMatch[1]) : 550;
  const docHeight = heightMatch ? parseFloat(heightMatch[1]) : 400;
  const outputWidth = Math.min(docWidth, LIMITS.maxOutputWidth);
  const outputHeight = Math.min(docHeight, LIMITS.maxOutputHeight);
  if (outputWidth * outputHeight > LIMITS.maxDecodedPixels) {
    throw new Error(`output pixel count ${outputWidth * outputHeight} exceeds ${LIMITS.maxDecodedPixels}`);
  }

  // 5. Read LIBRARY/*.xml.
  const libraryXmlEntries = [];
  for (const name of entryNames) {
    if (/^LIBRARY\//i.test(name) && /\.xml$/i.test(name)) {
      const xml = await zip.files[name].async('string');
      if (xml.length > LIMITS.maxXmlBytes) throw new Error(`LIBRARY entry too large: ${name}`);
      libraryXmlEntries.push({ name, xml });
    }
  }

  // 6. ActionScript presence — never execute, only count.
  const hasActionScript = /<Script\b/.test(domXml) || /<DOMScript\b/.test(domXml)
    || libraryXmlEntries.some(e => /<Script\b/.test(e.xml) || /<DOMScript\b/.test(e.xml));

  // 7. Find first non-empty shape in the first graphic symbol.
  const locator = findFirstShape(libraryXmlEntries.map(e => e.xml));
  if (!locator) throw new Error('No <DOMShape> in any graphic symbol');
  const shapeData = parseShapeAt(locator.shapeBlock);
  const groupData = locator.groupBlock ? parseShapeAt(locator.groupBlock) : null;

  if (shapeData.edgeStrings.length === 0) throw new Error('First DOMShape has no <Edge> children');

  // 8. Decode all edges, prefer cubics.
  const allCommands = [];
  let usedCubic = 0;
  let usedEdge = 0;
  for (const { cubics, edges } of shapeData.edgeStrings) {
    const src = cubics || edges;
    if (!src) continue;
    if (cubics) usedCubic++; else usedEdge++;
    const { commands } = decodeEdgesWithStyleChanges(src);
    for (const c of commands) allCommands.push(c);
  }
  if (allCommands.length === 0) throw new Error('Edge decoder produced no commands for any edge');

  // 9. Build combined SVG path from all edges.
  const pathD = commandsToSvgPath(allCommands);

  // 10. Pick first fill from shape; if none, fall back to group's fills.
  let fill = (shapeData.fills && shapeData.fills[0]) || (groupData && groupData.fills && groupData.fills[0]);
  if (!fill) fill = { fillKind: 'solid', color: '#808080', alpha: 1 };

  // 11. SVG transform from shape's matrix (or group's).
  const matrix = shapeData.matrix || (groupData && groupData.matrix);
  const transform = matrix ? matrixToSvgTransform(matrix) : '';

  // 12. Build SVG. Use a viewBox that fits the transformed bounding box plus 10% margin,
  // so the whole shape is visible regardless of how the source matrix translates the path.
  const bbox = pathBoundingBoxAfterMatrix(allCommands, matrix);
  let viewBox;
  if (bbox) {
    const w = Math.max(1, bbox.maxX - bbox.minX);
    const h = Math.max(1, bbox.maxY - bbox.minY);
    const margin = Math.max(w, h) * 0.05;
    viewBox = `${bbox.minX - margin} ${bbox.minY - margin} ${w + margin * 2} ${h + margin * 2}`;
  } else {
    viewBox = `0 0 ${outputWidth} ${outputHeight}`;
  }

  const fillColor = fill.color || '#808080';
  const fillOpacity = fill.alpha !== undefined ? String(fill.alpha) : '1';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${outputWidth}" height="${outputHeight}">
  <title>FLA V2-R0 spike — 剑.fla, first non-empty shape</title>
  <desc>selected=${locator.symbolName} / timeline[${locator.timelineIndex}] / layer[${locator.layerIndex}] / frame[${locator.frameIndex}] / group[${locator.groupIndex}] / shape[${locator.shapeIndex}]</desc>
  <g transform="${transform}">
    <path d="${pathD}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="none" fill-rule="evenodd"/>
  </g>
</svg>
`;
  fs.writeFileSync(SVG_OUT, svg, 'utf-8');

  // 13. Verify source hash unchanged.
  const sourceBytesAfter = fs.readFileSync(FLA_INPUT);
  const sourceHashAfter = sha256(sourceBytesAfter);
  if (sourceHashAfter !== sourceHashBefore) {
    throw new Error(`source hash changed during R0 run! before=${sourceHashBefore} after=${sourceHashAfter}`);
  }

  // 14. Save extraction record.
  const cmdTypes = allCommands.reduce((acc, c) => (acc[c.type] = (acc[c.type] || 0) + 1, acc), {});
  const svgHash = sha256(Buffer.from(svg, 'utf-8'));
  const extractRecord = {
    source: {
      path: FLA_INPUT,
      byteLength: sourceBytes.byteLength,
      sha256: sourceHashBefore,
      sha256Unchanged: sourceHashAfter === sourceHashBefore,
      sha256MatchesManifest: sourceHashBefore === EXPECTED_SHA256,
    },
    archive: {
      ...eocd,
      entryCount: entryNames.length,
    },
    document: { width: docWidth, height: docHeight, outputWidth, outputHeight },
    selected: {
      symbolName: locator.symbolName,
      timelineIndex: locator.timelineIndex,
      layerIndex: locator.layerIndex,
      frameIndex: locator.frameIndex,
      groupIndex: locator.groupIndex,
      shapeIndex: locator.shapeIndex,
      selectedIdentity: `LIBRARY/<${locator.symbolName}>, DOMTimeline[${locator.timelineIndex}], DOMLayer[${locator.layerIndex}], DOMFrame[${locator.frameIndex}], DOMGroup[${locator.groupIndex}], DOMShape[${locator.shapeIndex}]`,
      edgeCount: shapeData.edgeStrings.length,
      edgesUsingCubics: usedCubic,
      edgesUsingEdges: usedEdge,
      totalCommands: allCommands.length,
    },
    matrix,
    fillUsed: fill,
    transparency: { backgroundTransparent: true, fillOpacity: fill.alpha },
    securityInvariants: {
      actionScriptDetected: hasActionScript,
      actionScriptExecuted: false,
      sourceRewritten: false,
      networkAccess: false,
      projectMutation: false,
    },
    outputs: {
      svg: { path: SVG_OUT, byteLength: Buffer.byteLength(svg, 'utf-8'), sha256: svgHash },
      png: { path: PNG_OUT, status: 'pending — produced by scripts/fla-r0-spike-rasterize.cjs' },
    },
    path: { svg: pathD.substring(0, 400) + (pathD.length > 400 ? '…(truncated)' : ''), commandTypes: cmdTypes },
    wallClockMs: Date.now() - startedAt,
    budget: LIMITS,
  };
  fs.writeFileSync(JSON_OUT, JSON.stringify(extractRecord, null, 2), 'utf-8');

  // 15. Write a smaller repo-safe metadata record under docs/.
  // Per Issue #286 §B, the tracked repo must not hold private/sample-derived
  // visual bytes. The repo copy contains only metadata: hashes, dimensions,
  // the selected structural identity, the public manifest hash, the
  // command-type distribution, and an explicit LOCAL_ONLY pointer.
  const repoMetadata = {
    source: {
      sha256: sourceHashBefore,
      byteLength: sourceBytes.byteLength,
      sha256MatchesManifest: sourceHashBefore === EXPECTED_SHA256,
      note: 'private path omitted from tracked repo per Issue #286',
    },
    output: {
      svgSha256: svgHash,
      svgByteLength: Buffer.byteLength(svg, 'utf-8'),
      png: { status: 'pending rasterization' },
      pngSha256: null,
      pngByteLength: null,
      width: outputWidth,
      height: outputHeight,
      pixelCount: outputWidth * outputHeight,
      visualPath: 'LOCAL_ONLY (not committed; see D:\\PandaStage-Acceptance\\fla-v2-r0\\)',
    },
    selected: extractRecord.selected,
    fillUsed: fill,
    securityInvariants: extractRecord.securityInvariants,
    transparency: extractRecord.transparency,
  };
  fs.writeFileSync(REPO_METADATA_OUT, JSON.stringify(repoMetadata, null, 2), 'utf-8');

  process.stdout.write(JSON.stringify(extractRecord, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`R0 extract failed: ${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
