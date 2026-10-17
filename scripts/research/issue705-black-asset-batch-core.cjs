'use strict';

const zlib = require('node:zlib');

const ACCEPTED_B2_MANIFEST_SHA256 = 'fd76203dcd24dfb145bc968e9faf6b679e3478bdcbdce3ff50dbf9222980895d';
const B2_SCHEMA_VERSION = 'issue704-black-candidate-manifest/1';
const ADDRESS_CLASSES = new Set([
  'PARENT_COMPOSITE',
  'DIRECT_FULL_CHARACTER_STATE',
  'DIRECT_COMPONENT_STATE',
  'TEMPORAL_ONLY',
  'UNSUPPORTED_OR_UNKNOWN',
]);
const RENDERED_CLASSES = new Set([
  'PARENT_COMPOSITE',
  'DIRECT_FULL_CHARACTER_STATE',
  'DIRECT_COMPONENT_STATE',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeManifestLineEndings(bytes) {
  const utf8 = Buffer.from(bytes).toString('utf8');
  return Buffer.from(utf8.replace(/\r\n/gu, '\n'), 'utf8');
}

function validateB2Manifest(manifest, manifestSha256) {
  invariant(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'B2 manifest must be an object');
  invariant(manifestSha256 === ACCEPTED_B2_MANIFEST_SHA256, 'B2 manifest hash is not the accepted Issue #704 manifest');
  invariant(manifest.schemaVersion === B2_SCHEMA_VERSION && manifest.issue === 704, 'B2 schema or issue identity mismatch');
  invariant(manifest.motherPullRequest === 677, 'B2 manifest is not tied to the current mother PR');
  invariant(manifest.source && /^[a-f0-9]{64}$/iu.test(manifest.source.sha256), 'B2 source hash is missing or malformed');
  invariant(/^[a-f0-9]{64}$/iu.test(manifest.source.normalizedArchiveSha256), 'B2 normalized archive hash is missing or malformed');
  invariant(Array.isArray(manifest.candidates) && manifest.candidates.length === 32, 'B2 candidate list is malformed or incomplete');
  invariant(Array.isArray(manifest.parentRouteProbes) && manifest.parentRouteProbes.length === 12, 'B2 parent-route probe list is malformed or incomplete');

  const byId = new Map();
  for (const candidate of manifest.candidates) {
    invariant(candidate && /^B2-[A-F0-9]{24}$/u.test(candidate.candidateId), 'B2 candidate ID is missing or malformed');
    invariant(!byId.has(candidate.candidateId), `duplicate B2 candidate ID: ${candidate.candidateId}`);
    byId.set(candidate.candidateId, candidate);
    invariant(Array.isArray(candidate.sourceStateClasses) && candidate.sourceStateClasses.length > 0, `source-state class missing for ${candidate.candidateId}`);
    invariant(ADDRESS_CLASSES.has(candidate.renderAddressClass), `unknown render-address class for ${candidate.candidateId}`);
    invariant(candidate.sourceProvenance?.sourceSha256 === manifest.source.sha256, `source provenance mismatch for ${candidate.candidateId}`);
    invariant(candidate.renderAddress && candidate.sourceProvenance?.authoredState, `source/render address missing for ${candidate.candidateId}`);

    if (RENDERED_CLASSES.has(candidate.renderAddressClass)) {
      const expectedDisposition = candidate.renderAddressClass === 'DIRECT_COMPONENT_STATE' ? 'SUPPORTED_COMPONENT' : 'SUPPORTED';
      invariant(candidate.disposition === expectedDisposition, `supported route/disposition mismatch for ${candidate.candidateId}`);
      invariant(candidate.renderability?.semanticRenderSupported === true, `supported renderability missing for ${candidate.candidateId}`);
      invariant(/^[a-f0-9]{64}$/iu.test(candidate.evidence?.render?.svgSha256 ?? ''), `B2 SVG evidence missing for ${candidate.candidateId}`);
      invariant(/^[a-f0-9]{64}$/iu.test(candidate.evidence?.render?.pngSha256 ?? ''), `B2 PNG evidence missing for ${candidate.candidateId}`);
    } else if (candidate.renderAddressClass === 'TEMPORAL_ONLY') {
      invariant(candidate.disposition === 'ROUTE_TO_ISSUE694', `temporal route was promoted for ${candidate.candidateId}`);
    } else {
      invariant(candidate.disposition === 'FAIL_CLOSED', `unsupported route was promoted for ${candidate.candidateId}`);
    }
  }

  const controls = manifest.controls?.knownReferenceAddresses;
  invariant(controls?.A?.length === 1 && controls.B?.length === 1 && controls.C?.length === 1 &&
    controls.D?.length === 1 && controls.E?.length === 1 && controls.unmatchedFullCharacter?.length === 1,
  'B2 A/B/C/D/E/unmatched controls are incomplete');
  for (const [label, ids] of Object.entries({ A: controls.A, B: controls.B, C: controls.C, D: controls.D, E: controls.E,
    unmatchedFullCharacter: controls.unmatchedFullCharacter })) {
    invariant(byId.has(ids[0]), `B2 ${label} control points to a missing candidate`);
  }
  invariant(manifest.controls.componentControls?.head && byId.has(manifest.controls.componentControls.head), 'B2 head component control is missing');
  invariant(manifest.controls.componentControls?.body && byId.has(manifest.controls.componentControls.body), 'B2 body component control is missing');

  const routeStatus = new Map(manifest.parentRouteProbes.map((probe) => [probe.parentFrame, probe.status]));
  invariant(routeStatus.get(0) === 'SUPPORTED_PARENT_COMPOSITE' && routeStatus.get(6) === 'SUPPORTED_PARENT_COMPOSITE' &&
    routeStatus.get(7) === 'SUPPORTED_PARENT_COMPOSITE', 'B2 supported parent-composite controls changed');
  for (const frame of [1, 2, 3, 4, 5, 11]) {
    invariant(routeStatus.get(frame) === 'FAIL_CLOSED', `B2 timing boundary ${frame} is not fail-closed`);
  }
  for (const frame of [8, 9, 10]) {
    const probe = manifest.parentRouteProbes.find((item) => item.parentFrame === frame);
    invariant(probe?.status === 'REJECTED_NON_PREFERRED' && probe.rejectionRender, `B2 rejected parent route ${frame} changed`);
  }

  return { candidatesById: byId, candidateCount: byId.size };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function analyzePng(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  invariant(bytes.length >= 57 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'invalid PNG signature or truncated PNG');

  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  let sawImageData = false;
  let sawEnd = false;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    invariant(dataEnd + 4 <= bytes.length, `truncated PNG chunk: ${type}`);
    const typeAndData = bytes.subarray(offset + 4, dataEnd);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    invariant(crc32(typeAndData) === expectedCrc, `PNG chunk CRC mismatch: ${type}`);
    const data = bytes.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      invariant(header === null && offset === 8 && length === 13, 'invalid PNG IHDR');
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data);
    } else if (type === 'IDAT') {
      invariant(header !== null && !sawEnd, 'PNG image data is out of order');
      sawImageData = true;
      compressed.push(data);
    } else if (type === 'IEND') {
      invariant(length === 0, 'invalid PNG IEND');
      sawEnd = true;
      offset = dataEnd + 4;
      break;
    } else if (type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90 && !['sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(type)) {
      invariant(false, `unsupported critical PNG chunk: ${type}`);
    }
    offset = dataEnd + 4;
  }

  invariant(header && sawImageData && sawEnd && offset === bytes.length, 'PNG is incomplete or has trailing data');
  const { width, height, bitDepth, colorType, compression, filter, interlace } = header;
  invariant(width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 16_777_216, 'PNG dimensions exceed the accepted render budget');
  invariant(bitDepth === 8 && compression === 0 && filter === 0 && interlace === 0, 'unsupported PNG encoding from the production rasterizer');
  const channelsByColorType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  invariant(channels, `unsupported PNG color type: ${colorType}`);
  if (colorType === 3) invariant(palette && palette.length % 3 === 0, 'indexed PNG palette is missing or malformed');

  const rowBytes = width * channels;
  const expectedInflatedBytes = (rowBytes + 1) * height;
  const raw = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedInflatedBytes });
  invariant(raw.length === expectedInflatedBytes, 'PNG scanline byte count does not match its dimensions');

  let previous = Buffer.alloc(rowBytes);
  let visiblePixelCount = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowBytes + 1);
    const filterType = raw[rowOffset];
    invariant(filterType <= 4, `unsupported PNG row filter: ${filterType}`);
    const row = Buffer.from(raw.subarray(rowOffset + 1, rowOffset + rowBytes + 1));
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= channels ? row[index - channels] : 0;
      const up = previous[index];
      const upperLeft = index >= channels ? previous[index - channels] : 0;
      let predictor = 0;
      if (filterType === 1) predictor = left;
      else if (filterType === 2) predictor = up;
      else if (filterType === 3) predictor = Math.floor((left + up) / 2);
      else if (filterType === 4) predictor = paeth(left, up, upperLeft);
      row[index] = (row[index] + predictor) & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = x * channels;
      let alpha = 255;
      if (colorType === 6) alpha = row[pixelOffset + 3];
      else if (colorType === 4) alpha = row[pixelOffset + 1];
      else if (colorType === 3) alpha = transparency?.[row[pixelOffset]] ?? 255;
      else if (colorType === 0 && transparency?.length === 2 && row[pixelOffset] === transparency.readUInt16BE(0)) alpha = 0;
      else if (colorType === 2 && transparency?.length === 6 && row[pixelOffset] === transparency.readUInt16BE(0) &&
        row[pixelOffset + 1] === transparency.readUInt16BE(2) && row[pixelOffset + 2] === transparency.readUInt16BE(4)) alpha = 0;
      if (alpha > 0) {
        visiblePixelCount += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    previous = row;
  }

  const visibleBounds = visiblePixelCount === 0
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return {
    width,
    height,
    bitDepth,
    colorType,
    visiblePixelCount,
    visibleBounds,
    isBlank: visiblePixelCount === 0,
  };
}

function compareCandidateIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const DEFAULT_SECTION_DEFINITIONS = [
  { id: 'FULL_CHARACTER_ASSETS', title: 'FULL CHARACTER ASSETS' },
  { id: 'COMPONENT_ASSETS', title: 'COMPONENT ASSETS' },
];

function normalizeSectionDefinitions(input) {
  const sections = input ?? DEFAULT_SECTION_DEFINITIONS;
  invariant(Array.isArray(sections) && sections.length > 0, 'contact-sheet section definitions must be a non-empty array');
  const ids = new Set();
  for (const section of sections) {
    invariant(section && typeof section.id === 'string' && /^[A-Z0-9_]{1,80}$/u.test(section.id), 'contact-sheet section id is invalid');
    invariant(typeof section.title === 'string' && section.title.trim().length > 0 && section.title.length <= 120, `contact-sheet section title is invalid: ${section.id}`);
    invariant(!ids.has(section.id), `duplicate contact-sheet section: ${section.id}`);
    ids.add(section.id);
  }
  return sections;
}

function finalizeBatchResults(inputRows, options = {}) {
  const sectionDefinitions = normalizeSectionDefinitions(options.sectionDefinitions);
  const sectionIds = new Set(sectionDefinitions.map((section) => section.id));
  const rows = inputRows.map((row) => ({ ...row }));
  const ids = new Set();
  for (const row of rows) {
    invariant(typeof row.candidateId === 'string' && row.candidateId.length > 0, 'batch result candidate ID is missing');
    invariant(!ids.has(row.candidateId), `duplicate batch result candidate ID: ${row.candidateId}`);
    ids.add(row.candidateId);
    row.duplicateGroupId ??= null;
    row.representativeCandidateId ??= null;
    row.previewIncluded = false;
  }

  const groups = new Map();
  for (const row of rows) {
    if (row.status !== 'RENDER_PENDING') continue;
    invariant(/^[a-f0-9]{64}$/iu.test(row.pngSha256 ?? ''), `PNG hash is missing for ${row.candidateId}`);
    invariant(/^[a-f0-9]{64}$/iu.test(row.svgSha256 ?? ''), `SVG hash is missing for ${row.candidateId}`);
    if (row.isBlank) {
      row.status = 'BLANK';
      row.previewIncluded = false;
      continue;
    }
    const group = groups.get(row.pngSha256) ?? [];
    group.push(row);
    groups.set(row.pngSha256, group);
  }

  const duplicateGroups = [];
  for (const [pngSha256, members] of [...groups.entries()].sort(([left], [right]) => compareCandidateIds(left, right))) {
    members.sort((left, right) => compareCandidateIds(left.candidateId, right.candidateId));
    const representative = members[0].candidateId;
    if (members.length === 1) {
      members[0].status = 'RENDERED_UNIQUE';
      members[0].representativeCandidateId = representative;
      members[0].previewIncluded = true;
      continue;
    }

    const duplicateGroupId = `B3-PNG-${pngSha256.toUpperCase()}`;
    const svgHashes = [...new Set(members.map((member) => member.svgSha256))].sort(compareCandidateIds);
    const record = {
      duplicateGroupId,
      evidenceKind: 'EXACT_PNG_SHA256',
      pngSha256,
      memberCandidateIds: members.map((member) => member.candidateId),
      members: members.map((member) => ({
        candidateId: member.candidateId,
        sourceAddress: member.sourceAddress,
        renderAddress: member.renderAddress,
        sourceStateClasses: member.sourceStateClasses,
        renderAddressClass: member.renderAddressClass,
        svgSha256: member.svgSha256,
      })),
      representativeCandidateId: representative,
      memberSvgHashes: svgHashes,
      svgHashesIdentical: svgHashes.length === 1,
    };
    duplicateGroups.push(record);
    for (const member of members) {
      member.status = 'RENDERED_EXACT_DUPLICATE';
      member.duplicateGroupId = duplicateGroupId;
      member.representativeCandidateId = representative;
      member.previewIncluded = member.candidateId === representative;
    }
  }

  const sectionOrder = new Map(sectionDefinitions.map((section, index) => [section.id, index]));
  const previewTiles = rows.filter((row) => row.previewIncluded).map((row) => ({
    candidateId: row.candidateId,
    duplicateGroupId: row.duplicateGroupId,
    representativeCandidateId: row.representativeCandidateId,
    renderAddressClass: row.renderAddressClass,
    sourceStateClasses: row.sourceStateClasses,
    sourceAddressLabel: row.sourceAddressLabel,
    displayLabel: row.displayLabel,
    pngBytes: row.pngBytes,
    pngInfo: row.pngInfo,
    section: row.artifactSection ?? (row.renderAddressClass === 'DIRECT_COMPONENT_STATE' ? 'COMPONENT_ASSETS' : 'FULL_CHARACTER_ASSETS'),
  }));
  for (const tile of previewTiles) {
    invariant(sectionIds.has(tile.section), `unknown contact-sheet section for ${tile.candidateId}: ${tile.section}`);
  }
  previewTiles.sort((left, right) =>
    (sectionOrder.get(left.section) - sectionOrder.get(right.section)) || compareCandidateIds(left.candidateId, right.candidateId),
  );

  return { results: rows, duplicateGroups, previewTiles };
}

function padBounds(bounds, imageWidth, imageHeight) {
  const pad = Math.max(4, Math.ceil(Math.max(bounds.width, bounds.height) * 0.04));
  const left = Math.max(0, bounds.x - pad);
  const top = Math.max(0, bounds.y - pad);
  const right = Math.min(imageWidth, bounds.x + bounds.width + pad);
  const bottom = Math.min(imageHeight, bounds.y + bounds.height + pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function roundLayoutNumber(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildContactSheetLayout(tiles, options = {}) {
  const sheetWidth = options.sheetWidth ?? 1740;
  const columns = options.columns ?? 4;
  const margin = options.margin ?? 40;
  const gap = options.gap ?? 20;
  const tileHeight = options.tileHeight ?? 280;
  const tileWidth = (sheetWidth - 2 * margin - (columns - 1) * gap) / columns;
  const headerHeight = options.headerHeight ?? 58;
  const sectionGap = options.sectionGap ?? 24;
  invariant(Number.isInteger(sheetWidth) && sheetWidth > 0 && Number.isInteger(columns) && columns > 0, 'invalid contact-sheet dimensions');

  const sectionDefinitions = normalizeSectionDefinitions(options.sectionDefinitions);
  const sectionIds = new Set(sectionDefinitions.map((section) => section.id));
  for (const tile of tiles) invariant(sectionIds.has(tile.section), `unknown contact-sheet section for ${tile.candidateId}: ${tile.section}`);
  const sections = sectionDefinitions
    .map((section) => ({ ...section, items: tiles.filter((tile) => tile.section === section.id) }))
    .filter((section) => section.items.length > 0);
  let y = margin;
  let tileIndex = 0;
  const sectionLayouts = [];
  const tileLayouts = [];
  for (const section of sections) {
    const headerY = y;
    y += headerHeight;
    const firstTileIndex = tileIndex;
    for (let index = 0; index < section.items.length; index += 1) {
      const tile = section.items[index];
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + column * (tileWidth + gap);
      const tileY = y + row * (tileHeight + gap);
      const imageBox = { x: x + 14, y: tileY + 14, width: tileWidth - 28, height: 186 };
      const bounds = tile.pngInfo.visibleBounds;
      invariant(bounds && !tile.pngInfo.isBlank, `blank image reached the contact sheet: ${tile.candidateId}`);
      const sourceCrop = padBounds(bounds, tile.pngInfo.width, tile.pngInfo.height);
      const scale = Math.min(imageBox.width / sourceCrop.width, imageBox.height / sourceCrop.height);
      const translateX = imageBox.x + (imageBox.width - sourceCrop.width * scale) / 2 - sourceCrop.x * scale;
      const translateY = imageBox.y + (imageBox.height - sourceCrop.height * scale) / 2 - sourceCrop.y * scale;
      const layout = {
        tileIndex: tileIndex + 1,
        candidateId: tile.candidateId,
        section: section.id,
        x,
        y: tileY,
        width: tileWidth,
        height: tileHeight,
        imageBox,
        originalImageSize: { width: tile.pngInfo.width, height: tile.pngInfo.height },
        visibleBounds: bounds,
        sourceCrop,
        presentationTransform: {
          scale: roundLayoutNumber(scale),
          translateX: roundLayoutNumber(translateX),
          translateY: roundLayoutNumber(translateY),
          fit: 'contain-alpha-visible-bounds',
        },
      };
      tileLayouts.push(layout);
      tileIndex += 1;
    }
    const rowCount = Math.ceil(section.items.length / columns);
    sectionLayouts.push({
      id: section.id,
      title: section.title,
      headerY,
      firstTileIndex: firstTileIndex + 1,
      tileCount: section.items.length,
      rowCount,
    });
    y += rowCount * tileHeight + Math.max(0, rowCount - 1) * gap + sectionGap;
  }

  return {
    width: sheetWidth,
    height: Math.max(1, Math.ceil(y - sectionGap + margin)),
    columns,
    tileWidth,
    tileHeight,
    sections: sectionLayouts,
    tiles: tileLayouts,
    order: tileLayouts.map((tile) => tile.candidateId),
  };
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function buildContactSheetSvg(layout, tiles) {
  const tileById = new Map(tiles.map((tile) => [tile.candidateId, tile]));
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
    '<defs>',
    '<pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#F5F6F8"/><rect width="8" height="8" fill="#E6E9ED"/><rect x="8" y="8" width="8" height="8" fill="#E6E9ED"/></pattern>',
  ];
  for (const tile of layout.tiles) {
    parts.push(`<clipPath id="clip-${tile.tileIndex}"><rect x="${tile.imageBox.x}" y="${tile.imageBox.y}" width="${tile.imageBox.width}" height="${tile.imageBox.height}" rx="5"/></clipPath>`);
  }
  parts.push('</defs><rect width="100%" height="100%" fill="#F0F2F4"/>');
  for (const section of layout.sections) {
    parts.push(`<text x="40" y="${section.headerY + 33}" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#20252B">${escapeXml(section.title)}</text>`);
    parts.push(`<text x="${layout.width - 40}" y="${section.headerY + 32}" text-anchor="end" font-family="Arial,sans-serif" font-size="13" fill="#626B75">${section.tileCount} preview${section.tileCount === 1 ? '' : 's'}</text>`);
  }
  for (const tileLayout of layout.tiles) {
    const tile = tileById.get(tileLayout.candidateId);
    invariant(tile && Buffer.isBuffer(tile.pngBytes), `contact-sheet PNG is missing for ${tileLayout.candidateId}`);
    const x = tileLayout.x;
    const y = tileLayout.y;
    const box = tileLayout.imageBox;
    const transform = tileLayout.presentationTransform;
    const repMarker = tile.duplicateGroupId ? ` · DUP ${tile.duplicateGroupId.slice(-10)}` : '';
    const classLabel = tile.sourceStateClasses.slice().sort(compareCandidateIds).join(' + ');
    parts.push(`<g data-candidate-id="${escapeXml(tile.candidateId)}" data-section="${tileLayout.section}">`);
    parts.push(`<title>${escapeXml(`${tile.candidateId} · ${tile.sourceAddressLabel} · ${tile.renderAddressClass}`)}</title>`);
    parts.push(`<rect x="${x}" y="${y}" width="${tileLayout.width}" height="${tileLayout.height}" rx="9" fill="#FFFFFF" stroke="#D5DAE0"/>`);
    parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="5" fill="url(#checker)"/>`);
    parts.push(`<g clip-path="url(#clip-${tileLayout.tileIndex})"><image x="0" y="0" width="${tile.pngInfo.width}" height="${tile.pngInfo.height}" transform="translate(${transform.translateX} ${transform.translateY}) scale(${transform.scale})" href="data:image/png;base64,${tile.pngBytes.toString('base64')}"/></g>`);
    parts.push(`<text x="${x + 14}" y="${y + 221}" font-family="Consolas,monospace" font-size="12" font-weight="700" fill="#1C2228">${escapeXml(tile.candidateId)}${escapeXml(repMarker)}</text>`);
    parts.push(`<text x="${x + 14}" y="${y + 241}" font-family="Arial,sans-serif" font-size="11" fill="#404952">${escapeXml(tile.renderAddressClass)}</text>`);
    parts.push(`<text x="${x + 14}" y="${y + 259}" font-family="Arial,sans-serif" font-size="10" fill="#69727C">${escapeXml(classLabel)}</text>`);
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}

async function isolateCandidateFailures(candidates, renderOne) {
  const results = [];
  for (const candidate of candidates) {
    try {
      results.push(await renderOne(candidate));
    } catch (error) {
      results.push({
        candidateId: candidate.candidateId,
        status: 'RENDER_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

module.exports = {
  ACCEPTED_B2_MANIFEST_SHA256,
  ADDRESS_CLASSES,
  DEFAULT_SECTION_DEFINITIONS,
  analyzePng,
  buildContactSheetLayout,
  buildContactSheetSvg,
  finalizeBatchResults,
  isolateCandidateFailures,
  normalizeManifestLineEndings,
  validateB2Manifest,
};
