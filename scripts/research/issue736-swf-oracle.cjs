#!/usr/bin/env node
'use strict';

// Narrow Issue #736 SWF DefineShape reader and exact XFL geometry matcher.
// It does not render SWF or alter the published file.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MAX_TAGS = 2_000_000;
const MAX_SHAPES = 250_000;
const MAX_SHAPE_RECORDS = 2_000_000;
const MAX_RECURSION_DEPTH = 64;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function parseArgs(argv) {
  const options = { swf: null, receipt: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--swf') options.swf = argv[++index] ?? null;
    else if (argv[index] === '--receipt') options.receipt = argv[++index] ?? null;
    else if (argv[index] === '--out') options.out = argv[++index] ?? null;
    else if (argv[index] === '--help' || argv[index] === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/research/issue736-swf-oracle.cjs --swf <published.swf> --receipt <issue736-xfl-panda-oracle.json> [--out <receipt.json>]',
    '',
    'Reads FWS/CWS DefineShape records and matches exact, color-owned geometry from the XFL/Panda receipt.',
    'ZWS/LZMA is rejected explicitly. No coordinates are snapped or approximated.',
  ].join('\n');
}

class Reader {
  constructor(buffer, start = 0, end = buffer.length) {
    this.buffer = buffer;
    this.offset = start;
    this.end = end;
    this.bitOffset = 0;
  }

  ensureBytes(count) {
    this.alignByte();
    if (this.offset + count > this.end) throw new Error(`Unexpected end of data at byte ${this.offset}`);
  }

  ensureBits(count) {
    if (count < 0 || count > 32) throw new Error(`Unsupported bit-field width: ${count}`);
    if (this.offset >= this.end && count > 0) throw new Error(`Unexpected end of data at byte ${this.offset}`);
  }

  alignByte() {
    if (this.bitOffset !== 0) {
      this.offset += 1;
      this.bitOffset = 0;
    }
  }

  readUB(count) {
    this.ensureBits(count);
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      if (this.offset >= this.end) throw new Error(`Unexpected end of data at byte ${this.offset}`);
      const bit = (this.buffer[this.offset] >> (7 - this.bitOffset)) & 1;
      value = value * 2 + bit;
      this.bitOffset += 1;
      if (this.bitOffset === 8) {
        this.offset += 1;
        this.bitOffset = 0;
      }
    }
    return value;
  }

  readSB(count) {
    if (count === 0) return 0;
    const value = this.readUB(count);
    const sign = 2 ** (count - 1);
    return value >= sign ? value - 2 ** count : value;
  }

  readU8() {
    this.ensureBytes(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readU16() {
    this.ensureBytes(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  readU32() {
    this.ensureBytes(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readBytes(count) {
    this.ensureBytes(count);
    const value = this.buffer.subarray(this.offset, this.offset + count);
    this.offset += count;
    return value;
  }
}

function readColor(reader, withAlpha) {
  const red = reader.readU8();
  const green = reader.readU8();
  const blue = reader.readU8();
  const alpha = withAlpha ? reader.readU8() : 255;
  return {
    rgb: `#${[red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase(),
    alpha,
  };
}

function readRect(reader) {
  const bits = reader.readUB(5);
  const rect = {
    xMin: reader.readSB(bits),
    xMax: reader.readSB(bits),
    yMin: reader.readSB(bits),
    yMax: reader.readSB(bits),
  };
  reader.alignByte();
  return rect;
}

function readMatrix(reader) {
  const matrix = { scale: null, rotateSkew: null, translate: null };
  if (reader.readUB(1)) {
    const bits = reader.readUB(5);
    matrix.scale = [reader.readSB(bits), reader.readSB(bits)];
  }
  if (reader.readUB(1)) {
    const bits = reader.readUB(5);
    matrix.rotateSkew = [reader.readSB(bits), reader.readSB(bits)];
  }
  const translateBits = reader.readUB(5);
  matrix.translate = [reader.readSB(translateBits), reader.readSB(translateBits)];
  reader.alignByte();
  return matrix;
}

function readGradient(reader, shapeCode, focal) {
  const flags = reader.readU8();
  const count = flags & 0x0f;
  if (count > 15) throw new Error(`Invalid gradient stop count: ${count}`);
  const stops = [];
  for (let index = 0; index < count; index += 1) {
    stops.push({ ratio: reader.readU8(), color: readColor(reader, shapeCode >= 32) });
  }
  const result = {
    spreadMode: (flags >> 6) & 0x03,
    interpolationMode: (flags >> 4) & 0x03,
    stops,
  };
  if (focal) result.focalPointFixed8 = reader.readU16();
  return result;
}

function readFillStyle(reader, shapeCode) {
  const type = reader.readU8();
  if (type === 0x00) return { type: 'solid', color: readColor(reader, shapeCode >= 32) };
  if (type === 0x10 || type === 0x12 || type === 0x13) {
    if (type === 0x13 && shapeCode !== 83) throw new Error(`Focal gradient is invalid for DefineShape tag ${shapeCode}`);
    return {
      type: type === 0x10 ? 'linear-gradient' : (type === 0x12 ? 'radial-gradient' : 'focal-gradient'),
      matrix: readMatrix(reader),
      gradient: readGradient(reader, shapeCode, type === 0x13),
    };
  }
  if (type >= 0x40 && type <= 0x43) {
    return {
      type: 'bitmap',
      bitmapType: type,
      bitmapId: reader.readU16(),
      matrix: readMatrix(reader),
    };
  }
  throw new Error(`Unsupported SWF FillStyle type 0x${type.toString(16)}`);
}

function readArrayCount(reader, supportsExtendedCount) {
  const count = reader.readU8();
  if (count !== 0xff) return count;
  if (!supportsExtendedCount) throw new Error('Extended style count is invalid for this DefineShape version');
  return reader.readU16();
}

function readFillStyleArray(reader, shapeCode) {
  const count = readArrayCount(reader, shapeCode >= 22);
  if (count > 65535) throw new Error(`FillStyle count exceeds parser bound: ${count}`);
  const styles = [];
  for (let index = 0; index < count; index += 1) {
    styles.push({ index: index + 1, ...readFillStyle(reader, shapeCode) });
  }
  return styles;
}

function readLineStyle(reader, shapeCode) {
  const widthTwips = reader.readU16();
  if (shapeCode !== 83) {
    return { widthTwips, color: readColor(reader, shapeCode >= 32), hasFill: false };
  }
  const flags = reader.readUB(16);
  const joinStyle = (flags >> 12) & 0x03;
  const hasFill = ((flags >> 11) & 1) !== 0;
  const miterLimitFixed8 = joinStyle === 2 ? reader.readU16() : null;
  const value = { widthTwips, flags, joinStyle, hasFill, miterLimitFixed8 };
  if (hasFill) value.fill = readFillStyle(reader, shapeCode);
  else value.color = readColor(reader, true);
  return value;
}

function readLineStyleArray(reader, shapeCode) {
  const count = readArrayCount(reader, shapeCode >= 22);
  if (count > 65535) throw new Error(`LineStyle count exceeds parser bound: ${count}`);
  const styles = [];
  for (let index = 0; index < count; index += 1) {
    styles.push({ index: index + 1, ...readLineStyle(reader, shapeCode) });
  }
  return styles;
}

function colorFor(styles, index) {
  if (!index) return null;
  const style = styles[index - 1];
  return style?.type === 'solid' ? style.color : null;
}

function readDefineShape(body, tagCode, bodyOffset) {
  const reader = new Reader(body);
  const shape = {
    shapeId: reader.readU16(),
    tagCode,
    tagName: `DefineShape${tagCode === 2 ? '' : (tagCode === 22 ? '2' : (tagCode === 32 ? '3' : '4'))}`,
    tagBodyOffset: bodyOffset,
    bounds: readRect(reader),
    edgeBounds: null,
    shapeFlags: null,
    styleSets: [],
    styleChanges: [],
    newStyleChanges: [],
    records: [],
    edges: [],
    endShapeRecordFound: false,
    endShapeRecordIndex: null,
  };
  if (tagCode === 83) {
    shape.edgeBounds = readRect(reader);
    shape.shapeFlags = reader.readU8();
  }

  let styleSetId = 0;
  let fillStyles = readFillStyleArray(reader, tagCode);
  let lineStyles = readLineStyleArray(reader, tagCode);
  shape.styleSets.push({ id: styleSetId, fillStyles, lineStyles });
  let fillBits = reader.readUB(4);
  let lineBits = reader.readUB(4);
  let current = { x: 0, y: 0 };
  let fillStyle0 = 0;
  let fillStyle1 = 0;
  let lineStyle = 0;
  let recordIndex = 0;

  while (reader.offset < reader.end || reader.bitOffset !== 0) {
    recordIndex += 1;
    if (recordIndex > MAX_SHAPE_RECORDS) throw new Error('Shape record safety limit reached');
    const typeFlag = reader.readUB(1);
    if (typeFlag === 0) {
      const flags = reader.readUB(5);
      if (flags === 0) {
        shape.endShapeRecordFound = true;
        shape.endShapeRecordIndex = recordIndex;
        shape.records.push({ recordIndex, recordType: 'end-shape' });
        reader.alignByte();
        break;
      }
      const previousState = { ...current, fillStyle0, fillStyle1, lineStyle, styleSetId };
      const hasNewStyles = (flags & 0x10) !== 0;
      const hasLineStyle = (flags & 0x08) !== 0;
      const hasFillStyle1 = (flags & 0x04) !== 0;
      const hasFillStyle0 = (flags & 0x02) !== 0;
      const hasMoveTo = (flags & 0x01) !== 0;

      if (hasMoveTo) {
        const moveBits = reader.readUB(5);
        current = { x: reader.readSB(moveBits), y: reader.readSB(moveBits) };
      }
      if (hasFillStyle0) fillStyle0 = reader.readUB(fillBits);
      if (hasFillStyle1) fillStyle1 = reader.readUB(fillBits);
      if (hasLineStyle) lineStyle = reader.readUB(lineBits);
      if (hasNewStyles) {
        if (tagCode !== 22 && tagCode !== 32) {
          throw new Error(`StateNewStyles is invalid for DefineShape tag ${tagCode}`);
        }
        reader.alignByte();
        styleSetId += 1;
        fillStyles = readFillStyleArray(reader, tagCode);
        lineStyles = readLineStyleArray(reader, tagCode);
        shape.styleSets.push({ id: styleSetId, fillStyles, lineStyles });
        shape.newStyleChanges.push({ recordIndex, styleSetId, fillStyleCount: fillStyles.length, lineStyleCount: lineStyles.length });
        fillBits = reader.readUB(4);
        lineBits = reader.readUB(4);
      }
      const styleChange = {
        recordIndex,
        recordType: 'style-change',
        flags,
        moveTo: hasMoveTo ? { ...current } : null,
        fillStyle0Changed: hasFillStyle0,
        fillStyle1Changed: hasFillStyle1,
        lineStyleChanged: hasLineStyle,
        newStylesChanged: hasNewStyles,
        before: previousState,
        after: { ...current, fillStyle0, fillStyle1, lineStyle, styleSetId },
      };
      shape.styleChanges.push(styleChange);
      shape.records.push(styleChange);
      continue;
    }

    const straight = reader.readUB(1) === 1;
    const bits = reader.readUB(4) + 2;
    const from = { ...current };
    let control = null;
    let to;
    let edgeType;
    if (straight) {
      const generalLine = reader.readUB(1) === 1;
      let deltaX = 0;
      let deltaY = 0;
      if (generalLine) {
        deltaX = reader.readSB(bits);
        deltaY = reader.readSB(bits);
      } else {
        const verticalLine = reader.readUB(1) === 1;
        if (verticalLine) deltaY = reader.readSB(bits);
        else deltaX = reader.readSB(bits);
      }
      to = { x: from.x + deltaX, y: from.y + deltaY };
      edgeType = 'line';
    } else {
      const controlDelta = { x: reader.readSB(bits), y: reader.readSB(bits) };
      const anchorDelta = { x: reader.readSB(bits), y: reader.readSB(bits) };
      control = { x: from.x + controlDelta.x, y: from.y + controlDelta.y };
      to = { x: control.x + anchorDelta.x, y: control.y + anchorDelta.y };
      edgeType = 'quadratic';
    }

    const edge = {
      recordIndex,
      recordType: 'edge',
      edgeIndex: shape.edges.length,
      styleSetId,
      type: edgeType,
      from,
      control,
      to,
      fillStyle0,
      fillStyle1,
      lineStyle,
      fillStyle0Color: colorFor(fillStyles, fillStyle0),
      fillStyle1Color: colorFor(fillStyles, fillStyle1),
      lineStyleColor: lineStyle ? (lineStyles[lineStyle - 1]?.color ?? null) : null,
    };
    shape.edges.push(edge);
    shape.records.push(edge);
    current = to;
  }

  if (!shape.endShapeRecordFound) throw new Error('Shape record stream ended without EndShapeRecord');
  return shape;
}

function parseTagStream(buffer, start, end, shapes, errors, counters, depth = 0) {
  if (depth > MAX_RECURSION_DEPTH) throw new Error('DefineSprite nesting safety limit reached');
  const reader = new Reader(buffer, start, end);
  while (reader.offset + 2 <= end) {
    counters.tagCount += 1;
    if (counters.tagCount > MAX_TAGS) throw new Error('SWF tag safety limit reached');
    const header = reader.readU16();
    const tagCode = header >> 6;
    let tagLength = header & 0x3f;
    if (tagLength === 0x3f) tagLength = reader.readU32();
    const bodyStart = reader.offset;
    const bodyEnd = bodyStart + tagLength;
    if (bodyEnd > end) throw new Error(`Tag ${tagCode} extends beyond its containing timeline`);
    if (tagCode === 0) break;

    if (tagCode === 2 || tagCode === 22 || tagCode === 32 || tagCode === 83) {
      if (shapes.length >= MAX_SHAPES) throw new Error('DefineShape safety limit reached');
      counters.defineShapeCount += 1;
      try {
        shapes.push(readDefineShape(buffer.subarray(bodyStart, bodyEnd), tagCode, bodyStart));
      } catch (error) {
        errors.push({ tagCode, tagBodyOffset: bodyStart, message: String(error.message || error) });
      }
    } else if (tagCode === 39) {
      try {
        const spriteReader = new Reader(buffer, bodyStart, bodyEnd);
        spriteReader.readU16();
        spriteReader.readU16();
        parseTagStream(buffer, spriteReader.offset, bodyEnd, shapes, errors, counters, depth + 1);
      } catch (error) {
        errors.push({ tagCode, tagBodyOffset: bodyStart, message: String(error.message || error) });
      }
    }
    reader.offset = bodyEnd;
    reader.bitOffset = 0;
  }
}

function decompressSwf(fileBytes) {
  if (fileBytes.length < 8) throw new Error('SWF is shorter than its header');
  const signature = fileBytes.toString('ascii', 0, 3);
  const version = fileBytes[3];
  const declaredLength = fileBytes.readUInt32LE(4);
  if (declaredLength < 8) throw new Error(`Invalid declared SWF length ${declaredLength}`);
  let bytes;
  if (signature === 'FWS') bytes = fileBytes;
  else if (signature === 'CWS') {
    const inflatedBody = zlib.inflateSync(fileBytes.subarray(8));
    bytes = Buffer.concat([fileBytes.subarray(0, 8), inflatedBody]);
  } else if (signature === 'ZWS') {
    throw new Error('ZWS/LZMA-compressed SWF is outside this focused helper; republish with zlib compression before retrying');
  } else {
    throw new Error(`Unknown SWF signature ${JSON.stringify(signature)}`);
  }
  if (bytes.length !== declaredLength) {
    throw new Error(`SWF length mismatch: header declares ${declaredLength}, decoded bytes are ${bytes.length}`);
  }
  return { signature, version, declaredLength, bytes };
}

function geometryPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('XFL geometry contains a non-finite coordinate');
  // Keep fractional twips exact as decoded. SWF integer coordinates will then
  // compare unequal when publish changed geometry; do not round them together.
  return { x: point.x * 20, y: point.y * 20 };
}

function tokenizeRawXfl(text) {
  const tokens = [];
  let current = '';
  const flush = () => {
    if (current.trim()) tokens.push(current.trim());
    current = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if ((character === '(' || character === ')') && next === ';') {
      flush();
      tokens.push(`${character};`);
      index += 1;
    } else if (character === '(' || character === ')' || character === ';') {
      flush();
      tokens.push(character);
    } else if ('!|[/SqQ'.includes(character)) {
      flush();
      tokens.push(character);
    } else if (character === ',' || /\s/u.test(character)) {
      flush();
    } else {
      current += character;
    }
  }
  flush();
  return tokens;
}

function decodeRawXflCoordinate(token) {
  if (token.startsWith('#')) {
    const [rawInteger, rawFraction = ''] = token.slice(1).split('.');
    const integerHex = rawInteger || '0';
    if (!/^[0-9a-f]+$/iu.test(integerHex) || (rawFraction && !/^[0-9a-f]+$/iu.test(rawFraction))) {
      throw new Error(`Malformed hexadecimal XFL coordinate ${token}`);
    }
    const bitWidth = integerHex.length * 4;
    let integer = BigInt(`0x${integerHex}`);
    if (integerHex.length >= 6 && integer >= (1n << BigInt(bitWidth - 1))) {
      integer -= 1n << BigInt(bitWidth);
    }
    let fraction = 0;
    if (rawFraction) fraction = Number(BigInt(`0x${rawFraction}`)) / (2 ** (rawFraction.length * 4));
    // The hexadecimal fractional field remains a positive fixed-point fraction
    // when the signed integer field is negative; subtracting it decodes one
    // small real-corpus control point incorrectly.
    const decoded = Number(integer) + fraction;
    if (!Number.isFinite(decoded)) throw new Error(`Non-finite hexadecimal XFL coordinate ${token}`);
    return decoded;
  }
  const decoded = Number.parseFloat(token);
  if (!Number.isFinite(decoded)) throw new Error(`Malformed XFL coordinate ${token}`);
  return decoded;
}

function decodeRawXflEdgeText(text, sourceEdgeIndex, style0, style1, sourceAttribute) {
  const tokens = tokenizeRawXfl(text);
  const segments = [];
  let current = null;
  let subpathStart = null;
  let explicitCloseCount = 0;
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token === '!') {
      if (index + 2 >= tokens.length) throw new Error(`Edge ${sourceEdgeIndex} has a truncated XFL move command`);
      current = { x: decodeRawXflCoordinate(tokens[index + 1]), y: decodeRawXflCoordinate(tokens[index + 2]) };
      subpathStart = current;
      index += 3;
      continue;
    }
    if (token === '|') {
      if (index + 2 >= tokens.length || !current) throw new Error(`Edge ${sourceEdgeIndex} has a line without a complete current point`);
      const to = { x: decodeRawXflCoordinate(tokens[index + 1]), y: decodeRawXflCoordinate(tokens[index + 2]) };
      segments.push({
        sourceEdgeIndex,
        sourceSegmentIndex: segments.length,
        sourceAttribute,
        type: 'line',
        from: current,
        control: null,
        to,
        fillStyle0: style0,
        fillStyle1: style1,
        targetOnFillStyle0: null,
        targetOnFillStyle1: null,
      });
      current = to;
      index += 3;
      continue;
    }
    if (token === '[') {
      if (index + 4 >= tokens.length || !current) throw new Error(`Edge ${sourceEdgeIndex} has a quadratic without a complete current point`);
      const control = { x: decodeRawXflCoordinate(tokens[index + 1]), y: decodeRawXflCoordinate(tokens[index + 2]) };
      const to = { x: decodeRawXflCoordinate(tokens[index + 3]), y: decodeRawXflCoordinate(tokens[index + 4]) };
      segments.push({
        sourceEdgeIndex,
        sourceSegmentIndex: segments.length,
        sourceAttribute,
        type: 'quadratic',
        from: current,
        control,
        to,
        fillStyle0: style0,
        fillStyle1: style1,
        targetOnFillStyle0: null,
        targetOnFillStyle1: null,
      });
      current = to;
      index += 5;
      continue;
    }
    if (token === 'S') {
      const selection = tokens[index + 1];
      if (!/^\d+$/u.test(selection || '') || Number(selection) < 1 || Number(selection) > 7) {
        throw new Error(`Edge ${sourceEdgeIndex} has an unsupported XFL selection marker`);
      }
      index += 2;
      continue;
    }
    if (token === '/') {
      explicitCloseCount += 1;
      current = subpathStart;
      subpathStart = null;
      index += 1;
      continue;
    }
    if (token === 'q' || token === 'Q') {
      throw new Error(`Edge ${sourceEdgeIndex} contains an XFL mid-edge style change; exact raw fill ownership is unresolved`);
    }
    if (token === '(' || token === '(;' || token === ')' || token === ');' || token === ';') {
      if (token === '(' || token === '(;') throw new Error(`Edge ${sourceEdgeIndex} contains cubic syntax outside this focused target parser`);
      index += 1;
      continue;
    }
    throw new Error(`Edge ${sourceEdgeIndex} contains unrecognized XFL token ${JSON.stringify(token)}`);
  }
  return { segments, explicitCloseCount, tokenCount: tokens.length };
}

function extractRawXflSegments(rawXfl, fillStyleIndex, fillColor) {
  if (!Array.isArray(rawXfl?.edgeRecords)) throw new Error('XFL receipt has no raw Edge record array');
  const result = [];
  let explicitCloseCount = 0;
  let contributingEdgeRecordCount = 0;
  for (const edge of rawXfl.edgeRecords) {
    const style0 = edge.fillStyle0;
    const style1 = edge.fillStyle1;
    if (style0 !== fillStyleIndex && style1 !== fillStyleIndex) continue;
    const hasEdges = typeof edge.edges === 'string' && edge.edges.length > 0;
    const hasCubics = typeof edge.cubics === 'string' && edge.cubics.length > 0;
    if (hasEdges && hasCubics) throw new Error(`Raw XFL Edge ${edge.edgeIndex} has both edges and cubics attributes; stream order cannot be inferred`);
    const sourceAttribute = hasCubics ? 'cubics' : 'edges';
    const sourceText = hasCubics ? edge.cubics : (edge.edges || '');
    const decoded = decodeRawXflEdgeText(sourceText, edge.edgeIndex, style0, style1, sourceAttribute);
    explicitCloseCount += decoded.explicitCloseCount;
    if (decoded.segments.length > 0) contributingEdgeRecordCount += 1;
    for (const segment of decoded.segments) {
      segment.targetOnFillStyle0 = style0 === fillStyleIndex;
      segment.targetOnFillStyle1 = style1 === fillStyleIndex;
      segment.targetColor = fillColor;
      segment.geometry = canonicalGeometry(segment);
      result.push(segment);
    }
  }
  if (result.length === 0) throw new Error(`Raw XFL contains no decoded geometry for FillStyle ${fillStyleIndex}`);
  return { segments: result, explicitCloseCount, contributingEdgeRecordCount };
}

function extractPandaSegments(pandaInterpretation, fillStyleIndex) {
  const result = [];
  for (const decodedEdge of pandaInterpretation?.decodedStyleRuns || []) {
    for (const run of decodedEdge.currentPandaRuns || []) {
      let current = null;
      let subpathStart = null;
      for (const command of run.commands || []) {
        if (command.type === 'M') {
          current = geometryPoint({ x: command.x, y: command.y });
          subpathStart = current;
          continue;
        }
        if (command.type === 'Z') {
          current = subpathStart;
          continue;
        }
        if (command.type !== 'L' && command.type !== 'Q' && command.type !== 'C') continue;
        if (!current) throw new Error(`Panda Edge ${decodedEdge.edgeIndex} has a draw command without a current point`);
        const style0 = run.fillStyle0;
        const style1 = run.fillStyle1;
        if (style0 === fillStyleIndex || style1 === fillStyleIndex) {
          let control = null;
          if (command.type === 'Q') control = geometryPoint({ x: command.cx, y: command.cy });
          if (command.type === 'C') control = [
            geometryPoint({ x: command.c1x, y: command.c1y }),
            geometryPoint({ x: command.c2x, y: command.c2y }),
          ];
          const segment = {
            sourceEdgeIndex: decodedEdge.edgeIndex,
            sourceSegmentIndex: result.length,
            type: command.type === 'L' ? 'line' : (command.type === 'Q' ? 'quadratic' : 'cubic'),
            from: current,
            control,
            to: geometryPoint({ x: command.x, y: command.y }),
            fillStyle0: style0,
            fillStyle1: style1,
          };
          result.push(segment);
        }
        current = geometryPoint({ x: command.x, y: command.y });
      }
    }
  }
  return result;
}

function auditRawXflAgainstPanda(rawSegments, pandaSegments) {
  const byEdge = segments => {
    const map = new Map();
    for (const segment of segments) {
      const list = map.get(segment.sourceEdgeIndex) || [];
      list.push(segment);
      map.set(segment.sourceEdgeIndex, list);
    }
    return map;
  };
  const rawByEdge = byEdge(rawSegments);
  const pandaByEdge = byEdge(pandaSegments);
  const edgeIndexes = [...new Set([...rawByEdge.keys(), ...pandaByEdge.keys()])].sort((left, right) => left - right);
  const perEdge = edgeIndexes.map(edgeIndex => {
    const raw = rawByEdge.get(edgeIndex) || [];
    const panda = pandaByEdge.get(edgeIndex) || [];
    const segmentMismatches = [];
    for (let index = 0; index < Math.max(raw.length, panda.length); index += 1) {
      const rawSegment = raw[index];
      const pandaSegment = panda[index];
      const same = rawSegment && pandaSegment &&
        JSON.stringify([rawSegment.type, rawSegment.from, rawSegment.control, rawSegment.to, rawSegment.fillStyle0, rawSegment.fillStyle1]) ===
        JSON.stringify([pandaSegment.type, pandaSegment.from, pandaSegment.control, pandaSegment.to, pandaSegment.fillStyle0, pandaSegment.fillStyle1]);
      if (!same) segmentMismatches.push({ index, raw: rawSegment || null, panda: pandaSegment || null });
    }
    return { sourceEdgeIndex: edgeIndex, rawSegmentCount: raw.length, pandaSegmentCount: panda.length, exactGeometryAndSideMatch: segmentMismatches.length === 0, mismatches: segmentMismatches.slice(0, 20) };
  });
  return {
    status: perEdge.every(edge => edge.exactGeometryAndSideMatch) ? 'RAW_XFL_AND_PANDA_DECODE_MATCH' : 'RAW_XFL_AND_PANDA_DECODE_DIFFER',
    rawSubsegmentCount: rawSegments.length,
    pandaSubsegmentCount: pandaSegments.length,
    exactSubsegmentAndFillSideMatch: perEdge.every(edge => edge.exactGeometryAndSideMatch),
    perEdge,
  };
}

function geometryKey(segment, reverse = false) {
  const from = reverse ? segment.to : segment.from;
  const to = reverse ? segment.from : segment.to;
  const control = segment.control;
  return JSON.stringify([segment.type, from, control, to]);
}

function canonicalGeometry(segment) {
  const forward = geometryKey(segment, false);
  const reverse = geometryKey(segment, true);
  return forward <= reverse
    ? { key: forward, reversedForCanonical: false }
    : { key: reverse, reversedForCanonical: true };
}

function endpointGraph(segments) {
  const endpoints = new Map();
  for (const segment of segments) {
    const fromKey = JSON.stringify([segment.from.x, segment.from.y]);
    const toKey = JSON.stringify([segment.to.x, segment.to.y]);
    const from = endpoints.get(fromKey) || { point: segment.from, inDegree: 0, outDegree: 0 };
    from.outDegree += 1;
    endpoints.set(fromKey, from);
    const to = endpoints.get(toKey) || { point: segment.to, inDegree: 0, outDegree: 0 };
    to.inDegree += 1;
    endpoints.set(toKey, to);
  }
  const values = [...endpoints.values()].sort((left, right) =>
    left.point.x - right.point.x || left.point.y - right.point.y);
  return {
    endpointCount: values.length,
    balanced: values.every(point => point.inDegree === point.outDegree),
    allEndpointsOneInOneOut: values.length > 0 && values.every(point => point.inDegree === 1 && point.outDegree === 1),
    imbalancedEndpoints: values.filter(point => point.inDegree !== point.outDegree),
    endpoints: values,
  };
}

function exactCyclesForOneInOneOutGraph(segments, graph) {
  if (segments.length === 0) return { status: 'NO_BOUNDARY_SEGMENTS', cycles: [] };
  if (!graph.allEndpointsOneInOneOut) return { status: 'NOT_DECOMPOSED_BRANCHING_OR_IMBALANCED_GRAPH', cycles: [] };
  const outgoing = new Map();
  for (const segment of segments) {
    const key = JSON.stringify([segment.from.x, segment.from.y]);
    outgoing.set(key, segment);
  }
  const used = new Set();
  const cycles = [];
  for (const first of segments) {
    if (used.has(first.edgeIndex)) continue;
    const startKey = JSON.stringify([first.from.x, first.from.y]);
    const pathEdges = [];
    let currentKey = startKey;
    for (let step = 0; step <= segments.length; step += 1) {
      const edge = outgoing.get(currentKey);
      if (!edge || used.has(edge.edgeIndex)) break;
      used.add(edge.edgeIndex);
      pathEdges.push(edge.edgeIndex);
      currentKey = JSON.stringify([edge.to.x, edge.to.y]);
      if (currentKey === startKey) {
        cycles.push(pathEdges);
        break;
      }
    }
  }
  return {
    status: used.size === segments.length ? 'ALL_SEGMENTS_IN_EXACT_CYCLES' : 'SOME_SEGMENTS_NOT_IN_CYCLES',
    cycles,
    unconsumedEdgeIndexes: segments.filter(segment => !used.has(segment.edgeIndex)).map(segment => segment.edgeIndex),
  };
}

function getFillColor(xml) {
  const match = String(xml || '').match(/\bcolor="(#[0-9a-f]{6})"/iu);
  return match ? match[1].toUpperCase() : null;
}

function compareShape(shape, expected, targetColor) {
  const actual = shape.edges.filter(edge =>
    edge.fillStyle0Color?.rgb === targetColor || edge.fillStyle1Color?.rgb === targetColor);
  const targetBoundarySegments = [];
  let targetInteriorEdgeCount = 0;
  for (const edge of actual) {
    const fill0OwnsTarget = edge.fillStyle0Color?.rgb === targetColor;
    const fill1OwnsTarget = edge.fillStyle1Color?.rgb === targetColor;
    if (fill0OwnsTarget && fill1OwnsTarget) {
      targetInteriorEdgeCount += 1;
      continue;
    }
    const reverse = fill1OwnsTarget;
    targetBoundarySegments.push({
      edgeIndex: edge.edgeIndex,
      recordIndex: edge.recordIndex,
      from: reverse ? edge.to : edge.from,
      to: reverse ? edge.from : edge.to,
      sourceFrom: edge.from,
      sourceTo: edge.to,
      type: edge.type,
      fillStyle0: edge.fillStyle0,
      fillStyle1: edge.fillStyle1,
      fillStyle0Color: edge.fillStyle0Color,
      fillStyle1Color: edge.fillStyle1Color,
      normalizedDirection: reverse ? 'REVERSED_FILLSTYLE1_TO_FILL_ON_LEFT' : 'FORWARD_FILLSTYLE0_ON_LEFT',
    });
  }
  const targetGraph = endpointGraph(targetBoundarySegments);
  const targetCycles = exactCyclesForOneInOneOutGraph(targetBoundarySegments, targetGraph);
  const expectedByKey = new Map();
  for (const segment of expected) {
    const list = expectedByKey.get(segment.geometry.key) || [];
    list.push(segment);
    expectedByKey.set(segment.geometry.key, list);
  }
  const actualByKey = new Map();
  for (const edge of actual) {
    const segment = {
      type: edge.type,
      from: edge.from,
      control: edge.control,
      to: edge.to,
    };
    const canonical = canonicalGeometry(segment);
    const list = actualByKey.get(canonical.key) || [];
    list.push({ edge, segment, canonical });
    actualByKey.set(canonical.key, list);
  }

  let matchedCount = 0;
  let sameDirectionCount = 0;
  let reversedDirectionCount = 0;
  let targetSideOwnershipMatchCount = 0;
  const missing = [];
  const matched = [];
  for (const [key, expectedSegments] of expectedByKey.entries()) {
    const actualSegments = actualByKey.get(key) || [];
    const pairs = Math.min(expectedSegments.length, actualSegments.length);
    for (let index = 0; index < pairs; index += 1) {
      matchedCount += 1;
      const expectedSegment = expectedSegments[index];
      const actualSegment = actualSegments[index];
      const reversed = geometryKey(expectedSegment, false) !== geometryKey(actualSegment.segment, false);
      if (reversed) reversedDirectionCount += 1;
      else sameDirectionCount += 1;
      const expectedTargetSides = [expectedSegment.targetOnFillStyle0, expectedSegment.targetOnFillStyle1];
      const actualTargetSides = [
        actualSegment.edge.fillStyle0Color?.rgb === targetColor,
        actualSegment.edge.fillStyle1Color?.rgb === targetColor,
      ];
      if (reversed) actualTargetSides.reverse();
      const targetSideOwnershipMatches = expectedTargetSides[0] === actualTargetSides[0] &&
        expectedTargetSides[1] === actualTargetSides[1];
      if (targetSideOwnershipMatches) targetSideOwnershipMatchCount += 1;
      matched.push({
        xflSourceEdgeIndex: expectedSegment.sourceEdgeIndex,
        swfShapeEdgeIndex: actualSegment.edge.edgeIndex,
        swfShapeRecordIndex: actualSegment.edge.recordIndex,
        geometryReversed: reversed,
        xflFillStyle0: expectedSegment.fillStyle0,
        xflFillStyle1: expectedSegment.fillStyle1,
        swfFillStyle0: actualSegment.edge.fillStyle0,
        swfFillStyle1: actualSegment.edge.fillStyle1,
        swfFillStyle0Color: actualSegment.edge.fillStyle0Color?.rgb ?? null,
        swfFillStyle1Color: actualSegment.edge.fillStyle1Color?.rgb ?? null,
        xflTargetOnFillStyle0: expectedSegment.targetOnFillStyle0,
        xflTargetOnFillStyle1: expectedSegment.targetOnFillStyle1,
        swfTargetOnFillStyle0: actualSegment.edge.fillStyle0Color?.rgb === targetColor,
        swfTargetOnFillStyle1: actualSegment.edge.fillStyle1Color?.rgb === targetColor,
        targetSideOwnershipMatchesAfterGeometryDirection: targetSideOwnershipMatches,
      });
    }
    for (let index = pairs; index < expectedSegments.length; index += 1) {
      missing.push({ geometryKey: key, xflSourceEdgeIndex: expectedSegments[index].sourceEdgeIndex });
    }
  }
  let extraCount = 0;
  for (const [key, actualSegments] of actualByKey.entries()) {
    extraCount += Math.max(0, actualSegments.length - (expectedByKey.get(key)?.length || 0));
  }
  const missingCount = expected.length - matchedCount;
  const expectedTypeCounts = expected.reduce((counts, segment) => {
    counts[segment.type] = (counts[segment.type] || 0) + 1;
    return counts;
  }, {});
  const actualTypeCounts = actual.reduce((counts, edge) => {
    counts[edge.type] = (counts[edge.type] || 0) + 1;
    return counts;
  }, {});
  const typeCountDelta = [...new Set([...Object.keys(expectedTypeCounts), ...Object.keys(actualTypeCounts)])]
    .reduce((sum, type) => sum + Math.abs((expectedTypeCounts[type] || 0) - (actualTypeCounts[type] || 0)), 0);
  const endpointBounds = segments => {
    if (segments.length === 0) return null;
    const bounds = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity };
    for (const segment of segments) {
      for (const point of [segment.from, segment.to]) {
        bounds.xMin = Math.min(bounds.xMin, point.x);
        bounds.xMax = Math.max(bounds.xMax, point.x);
        bounds.yMin = Math.min(bounds.yMin, point.y);
        bounds.yMax = Math.max(bounds.yMax, point.y);
      }
    }
    return bounds;
  };
  const expectedEndpointBounds = endpointBounds(expected);
  const actualEndpointBounds = endpointBounds(actual.map(edge => ({ from: edge.from, to: edge.to })));
  return {
    shapeId: shape.shapeId,
    tagCode: shape.tagCode,
    tagName: shape.tagName,
    bounds: shape.bounds,
    totalShapeRecordEdgeCount: shape.edges.length,
    targetColorEdgeCount: actual.length,
    targetBoundarySegmentCount: targetBoundarySegments.length,
    targetInteriorEdgeCount,
    targetBoundaryGraph: targetGraph,
    exactBoundaryCycles: targetCycles,
    expectedXflTargetColorEdgeCount: expected.length,
    targetColorEdgeCountDelta: actual.length - expected.length,
    expectedGeometryTypeCounts: expectedTypeCounts,
    swfGeometryTypeCounts: actualTypeCounts,
    geometryTypeCountDelta: typeCountDelta,
    xflEndpointBoundsTwips: expectedEndpointBounds,
    swfEndpointBoundsTwips: actualEndpointBounds,
    endpointBoundsExactMatch: JSON.stringify(expectedEndpointBounds) === JSON.stringify(actualEndpointBounds),
    exactGeometryMultisetMatch: missingCount === 0 && extraCount === 0,
    matchedCount,
    missingCount,
    extraCount,
    sameDirectionCount,
    reversedDirectionCount,
    targetSideOwnershipMatchCount,
    targetSideOwnershipMismatchCount: matchedCount - targetSideOwnershipMatchCount,
    styleSets: shape.styleSets,
    newStyleChanges: shape.newStyleChanges,
    unmatchedXflGeometry: missing.slice(0, 100),
    matchedEdges: matched,
    shapeRecords: shape.records,
  };
}

function analyzeOne(label, shapes, rawXfl, pandaInterpretation, fillStyleIndex, fillXml) {
  const fillColor = getFillColor(fillXml);
  if (!fillColor) throw new Error(`${label}: could not determine target SolidColor from the XFL receipt`);
  const rawAudit = extractRawXflSegments(rawXfl, fillStyleIndex, fillColor);
  const expected = rawAudit.segments;
  const pandaAudit = auditRawXflAgainstPanda(expected, extractPandaSegments(pandaInterpretation, fillStyleIndex));
  const candidates = shapes
    .filter(shape => !shape.parseError)
    .map(shape => compareShape(shape, expected, fillColor))
    .filter(candidate => candidate.targetColorEdgeCount > 0)
    .sort((left, right) => Number(right.exactGeometryMultisetMatch) - Number(left.exactGeometryMultisetMatch) ||
      right.matchedCount - left.matchedCount ||
      Math.abs(left.targetColorEdgeCountDelta) - Math.abs(right.targetColorEdgeCountDelta) ||
      left.geometryTypeCountDelta - right.geometryTypeCountDelta ||
      left.shapeId - right.shapeId);
  const exact = candidates.filter(candidate => candidate.exactGeometryMultisetMatch);
  const top = candidates.slice(0, 8);
  const selected = top.map(candidate => ({
    ...candidate,
    shapeRecords: candidate.exactGeometryMultisetMatch || candidate === top[0]
      ? candidate.shapeRecords
      : candidate.shapeRecords.filter(edge =>
        edge.fillStyle0Color?.rgb === fillColor || edge.fillStyle1Color?.rgb === fillColor),
  }));
  return {
    target: {
      xflFillStyleIndex: fillStyleIndex,
      color: fillColor,
      sourceEdgeRecordCount: rawAudit.contributingEdgeRecordCount,
      rawDecodedSegmentCount: expected.length,
      rawExplicitCloseMarkerCount: rawAudit.explicitCloseCount,
      coordinateComparison: 'Raw XFL Edge attributes decoded to source units and compared directly to SWF twips; fractional coordinates are retained',
      noEndpointToleranceOrSyntheticClosure: true,
      pandaDecoderAudit: pandaAudit,
    },
    status: exact.length === 1 ? 'ONE_EXACT_GEOMETRY_CANDIDATE' :
      (exact.length > 1 ? 'AMBIGUOUS_EXACT_GEOMETRY_CANDIDATES' :
        (candidates.length > 0 ? 'NO_EXACT_MATCH_CLOSEST_CANDIDATES_LISTED' : 'NO_COLOR_MATCHING_SHAPES')),
    exactCandidateCount: exact.length,
    candidateCount: candidates.length,
    candidates: selected,
  };
}

function buildReceipt(options, fileBytes, decodedSwf, shapes, errors, counters, xflReceipt) {
  const target = analyzeOne(
    'failure target',
    shapes,
    xflReceipt.rawXfl,
    xflReceipt.pandaCurrentInterpretation,
    xflReceipt.selected.fillStyleIndex,
    xflReceipt.selected.fillStyleXml,
  );
  const control = analyzeOne(
    'closed control',
    shapes,
    xflReceipt.noOpControl.rawXfl,
    xflReceipt.noOpControl.pandaCurrentInterpretation,
    xflReceipt.noOpControl.selected.fillStyleIndex,
    xflReceipt.noOpControl.selected.fillStyleXml,
  );
  return {
    schemaVersion: 'issue736-swf-oracle/1',
    issue: 736,
    input: {
      swfPath: path.resolve(options.swf),
      swfSha256: sha256(fileBytes),
      signature: decodedSwf.signature,
      version: decodedSwf.version,
      declaredLength: decodedSwf.declaredLength,
      decodedLength: decodedSwf.bytes.length,
    },
    xflReceipt: {
      path: path.resolve(options.receipt),
      sourceSha256: xflReceipt.source.sourceSha256Before,
      shapeId: xflReceipt.selected.shapeId,
      shapeBlockSha256: xflReceipt.selected.shapeBlockSha256,
    },
    parse: {
      tagCount: counters.tagCount,
      defineShapeCount: counters.defineShapeCount,
      parsedShapeCount: shapes.filter(shape => !shape.parseError).length,
      shapeParseErrors: errors,
    },
    publishedSwf: {
      target,
      closedControl: control,
      rawFillSideSemantics: 'SWF records retain both side indices; Adobe specifies FillStyle0 on the left and FillStyle1 on the right of the directed edge. The endpoint graph keeps raw records and orients FillStyle0 forward / FillStyle1 reversed so the selected fill is on the left.',
      conclusion: {
        finalAtoDClassification: null,
        productionImplementationGate: 'REMAIN_NO_GO_PENDING_JSFL_AND_CROSS_STAGE_REVIEW',
      },
    },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.swf || !options.receipt) throw new Error(`${usage()}\nBoth --swf and --receipt are required.`);
  const fileBytes = fs.readFileSync(options.swf);
  const xflReceipt = JSON.parse(fs.readFileSync(options.receipt, 'utf8'));
  if (xflReceipt.issue !== 736 || !xflReceipt.noOpControl?.pandaCurrentInterpretation) {
    throw new Error('The supplied XFL/Panda receipt does not contain the Issue #736 target and closed control');
  }

  const decodedSwf = decompressSwf(fileBytes);
  const timeline = new Reader(decodedSwf.bytes, 8, decodedSwf.bytes.length);
  const frameSize = readRect(timeline);
  const frameRateRaw = timeline.readU16();
  const frameCount = timeline.readU16();
  const shapes = [];
  const errors = [];
  const counters = { tagCount: 0, defineShapeCount: 0 };
  parseTagStream(decodedSwf.bytes, timeline.offset, decodedSwf.bytes.length, shapes, errors, counters);
  const receipt = buildReceipt(options, fileBytes, decodedSwf, shapes, errors, counters, xflReceipt);
  receipt.swfHeader = {
    frameSizeTwips: frameSize,
    frameRate: ((frameRateRaw & 0xff) + ((frameRateRaw >> 8) & 0xff) * 256) / 256,
    frameCount,
  };

  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.out) {
    const outputPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, 'utf8');
    process.stdout.write(JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      swfSha256: receipt.input.swfSha256,
      defineShapeCount: receipt.parse.defineShapeCount,
      shapeParseErrors: receipt.parse.shapeParseErrors.length,
      targetStatus: receipt.publishedSwf.target.status,
      targetExactCandidates: receipt.publishedSwf.target.exactCandidateCount,
      controlStatus: receipt.publishedSwf.closedControl.status,
      controlExactCandidates: receipt.publishedSwf.closedControl.exactCandidateCount,
      outputPath,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(output);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`Issue #736 SWF oracle failed: ${String(error.message || error)}\n`);
  process.exitCode = 1;
}
