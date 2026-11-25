import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  FLA_STATIC_TEXT_LIMITS,
  FLA_STATIC_TEXT_PLACEHOLDER_BASE64,
  buildCanvasFontSpec,
  buildSafeOfflineFontFamily,
  computeAuthoritativeGraphicViewport,
  countExplicitStaticTextLines,
  hasUnresolvedFlaStaticTextPlaceholder,
  isValidFlaStaticTextGraphicFraming,
  isValidFlaStaticTextRenderItem,
  layoutFlaStaticText,
  splitGraphemes,
  type FlaStaticTextDescriptor,
} from '../../src/shared/fla-static-text';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { captureFlaGraphicStructure } from '../../src/main/services/flaGraphicStructureCapture';

async function buildFlaBytes(
  docXml: string,
  libraryEntries: ReadonlyArray<{ readonly name: string; readonly xml: string }> = [],
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', docXml);
  for (const entry of libraryEntries) {
    zip.file(entry.name, entry.xml);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('FLA Static Text layout & sanitizer (A04)', () => {
  it('lays out multi-run inline CJK + Latin text on one baseline, wraps CJK without spaces, and respects alignment/spacing', () => {
    const descriptor: FlaStaticTextDescriptor = {
      left: 10,
      width: 140,
      height: 80,
      runs: [
        {
          characters: '熊猫',
          alignment: 'center',
          size: 24,
          lineHeight: 28,
          lineSpacing: 6,
          letterSpacing: 2,
          face: 'Microsoft YaHei',
          fillColor: '#d92626',
          alpha: 1,
          bold: true,
          italic: false,
        },
        {
          characters: 'Stage\r第二行中文自动换行测试',
          alignment: 'center',
          size: 16,
          lineHeight: 20,
          lineSpacing: 6,
          letterSpacing: 0,
          face: 'Arial',
          fillColor: '#1d4ed8',
          alpha: 0.85,
          bold: false,
          italic: true,
        },
      ],
    };

    const layout = layoutFlaStaticText(descriptor);
    expect(layout.truncated).toBe(false);
    // Line 0 has both '熊猫' (24px red) and 'Stage' (16px blue) on the SAME line!
    expect(layout.lines.length).toBeGreaterThanOrEqual(3);
    const firstLine = layout.lines[0]!;
    expect(firstLine.fragments.map((f) => f.text)).toEqual(['熊猫', 'Stage']);
    expect(firstLine.fragments[0]!.run.fillColor).toBe('#d92626');
    expect(firstLine.fragments[1]!.run.fillColor).toBe('#1d4ed8');
    expect(firstLine.fragments[1]!.x).toBeGreaterThan(firstLine.fragments[0]!.x);
    // Center alignment pushes start X right of descriptor.left when lineWidth < descriptor.width.
    expect(firstLine.fragments[0]!.x).toBeGreaterThan(descriptor.left);

    // Explicit \r breaks to line 1, and CJK line wraps across lines 1 and 2 without spaces.
    const wrappedText = layout.lines.slice(1).map((l) => l.fragments.map((f) => f.text).join('')).join('');
    expect(wrappedText).toBe('第二行中文自动换行测试');
    expect(layout.lines[1]!.baselineY - layout.lines[0]!.baselineY).toBeGreaterThanOrEqual(28 + 6 - 10);

    // Right alignment places the line's right edge at left + width.
    const rightAligned = layoutFlaStaticText({
      ...descriptor,
      runs: [{ ...descriptor.runs[0]!, characters: '右对齐', alignment: 'right', letterSpacing: 4 }],
    });
    const rLine = rightAligned.lines[0]!;
    const rFrag = rLine.fragments[0]!;
    expect(rFrag.x + rFrag.width).toBeCloseTo(descriptor.left + descriptor.width, 4);

    // Positive letterSpacing widens the measured run compared to 0 letterSpacing.
    const tight = layoutFlaStaticText({
      ...descriptor,
      runs: [{ ...descriptor.runs[0]!, characters: 'ABCD', alignment: 'left', letterSpacing: 0 }],
    });
    const spaced = layoutFlaStaticText({
      ...descriptor,
      runs: [{ ...descriptor.runs[0]!, characters: 'ABCD', alignment: 'left', letterSpacing: 6 }],
    });
    expect(spaced.lines[0]!.width).toBeGreaterThan(tight.lines[0]!.width + 15);
  });

  it('preserves Unicode surrogate pairs during grapheme splitting and sanitizes font names for offline fallback', () => {
    const graphemes = splitGraphemes('🐼文字A');
    expect(graphemes).toEqual(['🐼', '文', '字', 'A']);

    const safeFont = buildSafeOfflineFontFamily('Arial"; url(https://evil.example/font.woff2); <script>');
    expect(safeFont).not.toContain('http://');
    expect(safeFont).not.toContain('https://');
    expect(safeFont).not.toContain('<script>');
    expect(safeFont).not.toContain(';');
    expect(safeFont).toContain('"Microsoft YaHei"');
    expect(safeFont).toContain('sans-serif');

    const fontSpec = buildCanvasFontSpec({
      characters: '测试',
      alignment: 'left',
      size: 20,
      lineHeight: 24,
      lineSpacing: 0,
      letterSpacing: 0,
      face: 'NonExistentAnimateFont',
      fillColor: '#000000',
      alpha: 1,
      bold: true,
      italic: true,
    });
    expect(fontSpec.startsWith('italic bold 20px "NonExistentAnimateFont",')).toBe(true);
  });

  it('validates static text IPC render items strictly at the preload boundary', () => {
    const valid = {
      placeholderId: 'fla-text-0123456789abcdef01234567',
      scaleHint: 2,
      descriptor: {
        left: 0,
        width: 200,
        height: 40,
        runs: [{
          characters: '招牌文字',
          alignment: 'left',
          size: 24,
          lineHeight: 28,
          lineSpacing: 0,
          letterSpacing: 0,
          fillColor: '#112233',
          alpha: 1,
          bold: false,
          italic: false,
        }],
      },
    };
    expect(isValidFlaStaticTextRenderItem(valid)).toBe(true);
    expect(isValidFlaStaticTextRenderItem({ ...valid, placeholderId: 'evil"><script>' })).toBe(false);
    expect(isValidFlaStaticTextRenderItem({ ...valid, scaleHint: 99 })).toBe(false);
    expect(isValidFlaStaticTextRenderItem({
      ...valid,
      descriptor: { ...valid.descriptor, runs: [{ ...valid.descriptor.runs[0]!, fillColor: 'url(javascript:alert(1))' }] },
    })).toBe(false);
    expect(isValidFlaStaticTextRenderItem({
      ...valid,
      descriptor: { ...valid.descriptor, runs: [{ ...valid.descriptor.runs[0]!, size: FLA_STATIC_TEXT_LIMITS.maxFontSize + 1 }] },
    })).toBe(false);
  });
});

describe('FLA Static Text XFL parsing, display-list, SVG bounds, masks, and fail-closed diagnostics (A04)', () => {
  it('parses DOMStaticText with XML entities, mixed runs, masks, and rotated graphic bounds without markup injection', async () => {
    const docXml =
      '<DOMDocument width="400" height="240" frameRate="24" creatorInfo="Adobe Animate" versionInfo="Saved by Animate 24.0">' +
      '<symbols><Include href="SignSymbol.xml"/></symbols>' +
      '<timelines><DOMTimeline name="Scene 1"><layers>' +
      '<DOMLayer name="Mask" layerType="mask"><frames><DOMFrame index="0"><elements>' +
      '<DOMShape><fills><FillStyle index="1"><SolidColor color="#000000"/></FillStyle></fills>' +
      '<edges><Edge fillStyle1="1" edges="!0 0|6000 0|6000 3200|0 3200|0 0"/></edges></DOMShape>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '<DOMLayer name="MaskedText" parentLayerIndex="0"><frames><DOMFrame index="0"><elements>' +
      '<DOMStaticText left="4" width="220" height="64">' +
      '<matrix><Matrix tx="20" ty="30"/></matrix>' +
      '<textRuns>' +
      '<DOMTextRun><characters>熊猫&lt;招牌&gt;&amp;&quot;1&quot;</characters>' +
      '<textAttrs><DOMTextAttrs alignment="center" size="26" lineHeight="32" lineSpacing="4" letterSpacing="2" face="Microsoft YaHei" fillColor="#e11d48" bold="true"/></textAttrs></DOMTextRun>' +
      '<DOMTextRun><characters> Demo&#xD;第二行中文自动换行</characters>' +
      '<textAttrs><DOMTextAttrs alignment="center" size="18" lineHeight="24" fillColor="#2563ebcc" italic="true"/></textAttrs></DOMTextRun>' +
      '</textRuns></DOMStaticText>' +
      '<DOMStaticText width="100" height="20"><textRuns><DOMTextRun><characters></characters><textAttrs><DOMTextAttrs size="14"/></textAttrs></DOMTextRun></textRuns></DOMStaticText>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timelines></DOMDocument>';

    const signSymbolXml =
      '<DOMSymbolItem name="SignSymbol" symbolType="graphic"><timeline><DOMTimeline name="SignSymbol"><layers>' +
      '<DOMLayer name="Label"><frames><DOMFrame index="0"><elements>' +
      '<DOMStaticText width="180" height="48">' +
      '<matrix><Matrix a="0.866" b="0.5" c="-0.5" d="0.866" tx="40" ty="20"/></matrix>' +
      '<textRuns><DOMTextRun><characters>旋转大字降部gjpqy</characters>' +
      '<textAttrs><DOMTextAttrs size="36" lineHeight="44" fillColor="#111111"/></textAttrs></DOMTextRun></textRuns>' +
      '</DOMStaticText></elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timeline></DOMSymbolItem>';

    const bytes = await buildFlaBytes(docXml, [{ name: 'LIBRARY/SignSymbol.xml', xml: signSymbolXml }]);
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'catalog');
    if (!prepared.ok) throw new Error(prepared.message);

    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);
    const sceneEntry = catalog.entries.find((e) => e.target.kind === 'scene');
    const symbolEntry = catalog.entries.find((e) => e.target.kind === 'graphic-symbol');
    expect(sceneEntry).toMatchObject({ previewSupported: true, isBlank: false });
    expect(symbolEntry).toMatchObject({ previewSupported: true, isBlank: false });

    const sceneSvg = await buildSvgForRenderTarget(bytes, sceneEntry!.target, undefined, prepared.source);
    if (!sceneSvg.ok) throw new Error(sceneSvg.message);
    expect(sceneSvg.staticTexts?.length).toBe(1);
    const textItem = sceneSvg.staticTexts![0]!;
    expect(textItem.descriptor.runs[0]!.characters).toBe('熊猫<招牌>&"1"');
    expect(textItem.descriptor.runs[1]!.characters).toBe(' Demo\r第二行中文自动换行');
    expect(textItem.descriptor.runs[1]!.alpha).toBeCloseTo(0xcc / 255, 3);
    // Masked static text is wrapped in clip-path, and raw markup never leaks into SVG.
    expect(sceneSvg.svg).toContain('clip-path="url(#');
    expect(sceneSvg.svg).toContain(`<use href="#${textItem.placeholderId}"`);
    expect(sceneSvg.svg).not.toContain('<招牌>');

    // Rotated graphic symbol expands contentBounds to accommodate rotated tall text + descenders.
    const symSvg = await buildSvgForRenderTarget(bytes, symbolEntry!.target, undefined, prepared.source);
    if (!symSvg.ok) throw new Error(symSvg.message);
    expect(symSvg.staticTexts?.length).toBe(1);
    expect(symSvg.width).toBeGreaterThan(150);
    expect(symSvg.height).toBeGreaterThan(100);

    // Graphic structure capture emits an opaque text fallback node instead of silently dropping text.
    const symDesc = prepared.source.graphicSymbols[0]!;
    const resolved = resolveFlaDisplayList({
      root: { kind: 'graphic', name: symDesc.sourceLibraryItemName, frameContext: symDesc.frameContext },
      symbols: prepared.source.symbols,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const structure = captureFlaGraphicStructure(resolved.displayList, {});
    expect(structure?.frames[0]?.layers[0]?.nodes[0]).toMatchObject({
      type: 'opaque',
      opaqueKind: 'text',
    });
  });

  it('fails closed locally on dynamic/input/TLF/vertical/over-budget/mask-text while keeping healthy symbols usable', async () => {
    const healthySymbol =
      '<DOMSymbolItem name="HealthyBox" symbolType="graphic"><timeline><DOMTimeline name="HealthyBox"><layers>' +
      '<DOMLayer name="Box"><frames><DOMFrame index="0"><elements>' +
      '<DOMShape><fills><FillStyle index="1"><SolidColor color="#16a34a"/></FillStyle></fills>' +
      '<edges><Edge fillStyle1="1" edges="!0 0|400 0|400 400|0 400|0 0"/></edges></DOMShape>' +
      '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>';

    const unsupportedCases = [
      '<DOMDynamicText width="100" height="20"><textRuns><DOMTextRun><characters>Dynamic</characters></DOMTextRun></textRuns></DOMDynamicText>',
      '<DOMInputText width="100" height="20"><textRuns><DOMTextRun><characters>Input</characters></DOMTextRun></textRuns></DOMInputText>',
      '<DOMTLFText width="100" height="20"/>',
      '<DOMStaticText width="100" height="20" orientation="vertical left to right"><textRuns><DOMTextRun><characters>竖排</characters></DOMTextRun></textRuns></DOMStaticText>',
      `<DOMStaticText width="100" height="20"><textRuns><DOMTextRun><characters>${'字'.repeat(FLA_STATIC_TEXT_LIMITS.maxCharsPerText + 1)}</characters></DOMTextRun></textRuns></DOMStaticText>`,
    ];

    for (const badElement of unsupportedCases) {
      const docXml =
        '<DOMDocument width="300" height="200" frameRate="24">' +
        '<symbols><Include href="HealthyBox.xml"/></symbols>' +
        '<timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L1"><frames><DOMFrame index="0"><elements>' +
        '<DOMShape><fills><FillStyle index="1"><SolidColor color="#cccccc"/></FillStyle></fills>' +
        '<edges><Edge fillStyle1="1" edges="!0 0|200 0|200 200|0 200|0 0"/></edges></DOMShape>' +
        badElement +
        '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>';
      const bytes = await buildFlaBytes(docXml, [{ name: 'LIBRARY/HealthyBox.xml', xml: healthySymbol }]);
      const catalog = await buildRenderableTargetCatalog(bytes);
      if (!catalog.ok) throw new Error(catalog.message);
      expect(catalog.entries.find((e) => e.target.kind === 'scene')).toMatchObject({ previewSupported: false });
      expect(catalog.entries.find((e) => e.target.kind === 'graphic-symbol')).toMatchObject({ previewSupported: true });
    }

    // Text used AS a mask shape must fail closed (never treated as mask geometry).
    const maskTextDoc =
      '<DOMDocument width="300" height="200" frameRate="24">' +
      '<symbols><Include href="HealthyBox.xml"/></symbols>' +
      '<timelines><DOMTimeline name="Scene 1"><layers>' +
      '<DOMLayer name="TextMask" layerType="mask"><frames><DOMFrame index="0"><elements>' +
      '<DOMStaticText width="100" height="30"><textRuns><DOMTextRun><characters>MASK</characters><textAttrs><DOMTextAttrs size="20"/></textAttrs></DOMTextRun></textRuns></DOMStaticText>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '<DOMLayer name="Content" parentLayerIndex="0"><frames><DOMFrame index="0"><elements>' +
      '<DOMShape><fills><FillStyle index="1"><SolidColor color="#ef4444"/></FillStyle></fills>' +
      '<edges><Edge fillStyle1="1" edges="!0 0|1000 0|1000 1000|0 1000|0 0"/></edges></DOMShape>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timelines></DOMDocument>';
    const maskBytes = await buildFlaBytes(maskTextDoc, [{ name: 'LIBRARY/HealthyBox.xml', xml: healthySymbol }]);
    const maskCatalog = await buildRenderableTargetCatalog(maskBytes);
    if (!maskCatalog.ok) throw new Error(maskCatalog.message);
    expect(maskCatalog.entries.find((e) => e.target.kind === 'scene')).toMatchObject({
      previewSupported: false,
      unsupportedReason: expect.stringContaining('mask'),
    });
    expect(maskCatalog.entries.find((e) => e.target.kind === 'graphic-symbol')).toMatchObject({ previewSupported: true });
  });

  it('recomputes authoritative Graphic viewport from real measured text metrics (P2-02) and detects unresolved placeholders (P2-01)', async () => {
    // Narrow box with wide Latin letters 'WWWWWWWW' where real font width exceeds approximate estimate,
    // causing an extra wrapped line.
    const narrowSymbolXml =
      '<DOMSymbolItem name="NarrowWide" symbolType="graphic"><timeline><DOMTimeline name="NarrowWide"><layers>' +
      '<DOMLayer name="Txt"><frames><DOMFrame index="0"><elements>' +
      '<DOMStaticText left="0" width="90" height="30">' +
      '<textRuns><DOMTextRun><characters>WWWWWWWWWWWW</characters>' +
      '<textAttrs><DOMTextAttrs size="24" lineHeight="30" fillColor="#111111"/></textAttrs></DOMTextRun></textRuns>' +
      '</DOMStaticText></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>';
    const docXml =
      '<DOMDocument width="400" height="240" frameRate="24">' +
      '<symbols><Include href="NarrowWide.xml"/></symbols>' +
      '<timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L"><frames><DOMFrame index="0"><elements>' +
      '<DOMSymbolInstance libraryItemName="NarrowWide" symbolType="graphic"/>' +
      '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>';
    const bytes = await buildFlaBytes(docXml, [{ name: 'LIBRARY/NarrowWide.xml', xml: narrowSymbolXml }]);
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);
    const symEntry = catalog.entries.find((e) => e.target.kind === 'graphic-symbol')!;
    const svg = await buildSvgForRenderTarget(bytes, symEntry.target, undefined, prepared.source);
    if (!svg.ok) throw new Error(svg.message);

    // P2-01: placeholder detector flags unresolved SVG and clears once replaced with real PNG.
    expect(hasUnresolvedFlaStaticTextPlaceholder(svg.svg)).toBe(true);
    const resolvedSvg = svg.svg.replace(FLA_STATIC_TEXT_PLACEHOLDER_BASE64, 'REALPNGDATA');
    expect(hasUnresolvedFlaStaticTextPlaceholder(resolvedSvg)).toBe(false);

    // P2-02: graphicFraming is valid and recomputes larger authoritative height when real font is wider.
    expect(svg.graphicFraming).toBeDefined();
    expect(isValidFlaStaticTextGraphicFraming(svg.graphicFraming)).toBe(true);
    const textItem = svg.staticTexts![0]!;
    const wideLayout = layoutFlaStaticText(textItem.descriptor, (t, run) => ({
      width: splitGraphemes(t).length * run.size * 1.15,
      ascent: run.size * 0.9,
      descent: run.size * 0.3,
    }));
    const authoritative = computeAuthoritativeGraphicViewport(
      svg.graphicFraming!,
      new Map([[textItem.placeholderId, wideLayout.bounds]]),
    );
    expect(authoritative).not.toBeNull();
    expect(authoritative!.outputHeight).toBeGreaterThan(svg.height);
    expect(Math.ceil(authoritative!.viewBox.height)).toBe(authoritative!.outputHeight);
  });

  it('allows 256 explicit lines at boundary, rejects 257 explicit lines, and flags auto-wrap truncation (P2-03)', async () => {
    const lines256 = Array.from({ length: 256 }, () => 'a').join('&#xD;');
    const lines257 = Array.from({ length: 257 }, () => 'a').join('&#xD;');
    const makeDoc = (chars: string) =>
      '<DOMDocument width="300" height="300" frameRate="24">' +
      '<timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L"><frames><DOMFrame index="0"><elements>' +
      `<DOMStaticText width="200" height="200"><textRuns><DOMTextRun><characters>${chars}</characters>` +
      '<textAttrs><DOMTextAttrs size="4" lineHeight="5" fillColor="#000000"/></textAttrs></DOMTextRun></textRuns></DOMStaticText>' +
      '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>';

    const bytes256 = await buildFlaBytes(makeDoc(lines256));
    const cat256 = await buildRenderableTargetCatalog(bytes256);
    if (!cat256.ok) throw new Error(cat256.message);
    const scene256 = cat256.entries.find((e) => e.target.kind === 'scene')!;
    expect(scene256.previewSupported).toBe(true);
    const svg256 = await buildSvgForRenderTarget(bytes256, scene256.target);
    expect(svg256.ok).toBe(true);
    if (svg256.ok) {
      expect(countExplicitStaticTextLines(svg256.staticTexts![0]!.descriptor)).toBe(256);
    }

    const bytes257 = await buildFlaBytes(makeDoc(lines257));
    const cat257 = await buildRenderableTargetCatalog(bytes257);
    if (!cat257.ok) throw new Error(cat257.message);
    const scene257 = cat257.entries.find((e) => e.target.kind === 'scene')!;
    expect(scene257.previewSupported).toBe(false);
    expect(scene257.unsupportedReason).toContain('256');

    // Auto-wrap exceeding 256 lines in a narrow box sets truncated=true so the renderer rejects with BUDGET_EXCEEDED.
    const autoWrapOverflow = layoutFlaStaticText({
      left: 0,
      width: 12,
      height: 100,
      runs: [{
        characters: '中'.repeat(300),
        alignment: 'left',
        size: 12,
        lineHeight: 14,
        lineSpacing: 0,
        letterSpacing: 0,
        fillColor: '#000000',
        alpha: 1,
        bold: false,
        italic: false,
      }],
    });
    expect(autoWrapOverflow.truncated).toBe(true);
    expect(autoWrapOverflow.lines.length).toBe(FLA_STATIC_TEXT_LIMITS.maxLinesPerText);
  });

  it('includes A02 variable-width filledOutline bounds in graphicFraming.nonTextBounds (P2-02) and scales 5000px-wide text Graphics within output limits (P2-03)', async () => {
    // P2-02: Graphic mixing a short static text + asymmetric variable-width stroke extending far below its centerline.
    const mixedStrokeXml =
      '<DOMSymbolItem name="TextPlusVarStroke" symbolType="graphic"><timeline><DOMTimeline name="TextPlusVarStroke"><layers>' +
      '<DOMLayer name="L1"><frames><DOMFrame index="0"><elements>' +
      '<DOMShape><matrix><Matrix tx="20" ty="30"/></matrix>' +
      '<strokes><StrokeStyle index="1"><SolidStroke scaleMode="normal" weight="20" caps="butt" joints="round">' +
      '<fill><SolidColor color="#16a34a"/></fill>' +
      '<VariablePointWidth>' +
      '<WidthMarker position="0" left="0.1" right="0.1"/>' +
      '<WidthMarker position="0.5" left="0.1" right="4.0"/>' +
      '<WidthMarker position="1" left="0.1" right="0.1"/>' +
      '</VariablePointWidth></SolidStroke></StrokeStyle></strokes>' +
      '<edges><Edge strokeStyle="1" edges="!0 1000|4000 1000"/></edges></DOMShape>' +
      '<DOMStaticText left="0" width="120" height="30"><matrix><Matrix tx="10" ty="0"/></matrix>' +
      '<textRuns><DOMTextRun><characters>变宽标签</characters>' +
      '<textAttrs><DOMTextAttrs size="18" lineHeight="22" fillColor="#e11d48"/></textAttrs></DOMTextRun></textRuns>' +
      '</DOMStaticText></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>';

    // P2-03: 5,000px-wide, 160px-tall vector Graphic with a short static text title.
    const wideBannerXml =
      '<DOMSymbolItem name="WideBanner5000" symbolType="graphic"><timeline><DOMTimeline name="WideBanner5000"><layers>' +
      '<DOMLayer name="L1"><frames><DOMFrame index="0"><elements>' +
      '<DOMShape><fills><FillStyle index="1"><SolidColor color="#fef3c7"/></FillStyle></fills>' +
      '<edges><Edge fillStyle1="1" edges="!0 0|100000 0|100000 3200|0 3200|0 0"/></edges></DOMShape>' +
      '<DOMStaticText left="0" width="240" height="40"><matrix><Matrix tx="40" ty="40"/></matrix>' +
      '<textRuns><DOMTextRun><characters>超宽横幅标题</characters>' +
      '<textAttrs><DOMTextAttrs size="28" lineHeight="34" fillColor="#1d4ed8"/></textAttrs></DOMTextRun></textRuns>' +
      '</DOMStaticText></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>';

    const docXml =
      '<DOMDocument width="600" height="300" frameRate="24">' +
      '<symbols><Include href="TextPlusVarStroke.xml"/><Include href="WideBanner5000.xml"/></symbols>' +
      '<timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L"><frames><DOMFrame index="0"><elements>' +
      '<DOMSymbolInstance libraryItemName="TextPlusVarStroke" symbolType="graphic"/>' +
      '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>';

    const bytes = await buildFlaBytes(docXml, [
      { name: 'LIBRARY/TextPlusVarStroke.xml', xml: mixedStrokeXml },
      { name: 'LIBRARY/WideBanner5000.xml', xml: wideBannerXml },
    ]);
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);

    // Verify P2-02: centerline is at y = 30 + 50 = 80, right="4.0" * weight=20 expands downward to y = 80 + 80 = 160!
    const strokeEntry = catalog.entries.find((e) => e.target.sourceLibraryItemName === 'TextPlusVarStroke')!;
    expect(strokeEntry.previewSupported).toBe(true);
    const strokeSvg = await buildSvgForRenderTarget(bytes, strokeEntry.target, undefined, prepared.source);
    if (!strokeSvg.ok) throw new Error(strokeSvg.message);
    expect(strokeSvg.graphicFraming?.nonTextBounds).not.toBeNull();
    expect(strokeSvg.graphicFraming!.nonTextBounds!.maxY).toBeGreaterThan(150);

    // Verify P2-03: 5,000px-wide Graphic keeps source viewBox >= 5000 and scales outputWidth to <= 4096.
    const wideEntry = catalog.entries.find((e) => e.target.sourceLibraryItemName === 'WideBanner5000')!;
    expect(wideEntry.previewSupported).toBe(true);
    const wideSvg = await buildSvgForRenderTarget(bytes, wideEntry.target, undefined, prepared.source);
    if (!wideSvg.ok) throw new Error(wideSvg.message);
    expect(wideSvg.width).toBe(4_096);
    expect(wideSvg.height).toBeLessThan(200);
    expect(wideSvg.composition.framing.viewBox.width).toBeGreaterThanOrEqual(5_000);
    const wideText = wideSvg.staticTexts![0]!;
    const measuredWide = computeAuthoritativeGraphicViewport(
      wideSvg.graphicFraming!,
      new Map([[wideText.placeholderId, layoutFlaStaticText(wideText.descriptor).bounds]]),
    );
    expect(measuredWide).not.toBeNull();
    expect(measuredWide!.viewBox.width).toBeGreaterThanOrEqual(5_000);
    expect(measuredWide!.outputWidth).toBe(4_096);
    expect(measuredWide!.outputHeight).toBeLessThan(200);
  });
});
