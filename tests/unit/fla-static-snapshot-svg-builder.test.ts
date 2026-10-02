import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  type BuildCatalogResult,
  type BuildSvgResult,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import type { FlaRenderTarget } from '../../src/shared/fla-static-snapshot-api';

// ---- Synthetic FLA fixture builder (repo-safe, generated in-memory) ----
//
// Builds a minimal ZIP/XFL container with:
//   - DOMDocument.xml with one main scene timeline
//   - LIBRARY/<symbolname>.xml with one graphic symbol containing
//     a single DOMShape (a simple rectangle path) on frame 0.
//
// The intent is to give the SVG builder a known input that exercises
// the production edge decoder, matrix, fill, and EOCD paths without
// needing a private or large FLA.

const SIMPLE_RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';

interface SyntheticGraphicFrame {
  readonly index: number;
  readonly duration?: number;
  readonly tweenType?: 'none' | 'motion' | 'shape';
  readonly tx?: number;
  readonly color?: string;
  readonly blank?: boolean;
}

async function buildSyntheticFla(
  options: {
    includeLibrary?: boolean;
    symbolName?: string;
    symbolNames?: string[];
    graphicFrameCount?: number;
    graphicFrames?: readonly SyntheticGraphicFrame[];
    includeSceneShape?: boolean;
  } = {},
): Promise<Uint8Array> {
  const includeLibrary = options.includeLibrary ?? true;
  const symbolNames = options.symbolNames ?? [options.symbolName ?? 'synthetic-symbol'];
  const graphicFrames: readonly SyntheticGraphicFrame[] = options.graphicFrames ?? Array.from(
    { length: options.graphicFrameCount ?? 1 },
    (_, index): SyntheticGraphicFrame => ({ index, tx: 10 + index, color: '#336699' }),
  );
  const includeSceneShape = options.includeSceneShape ?? true;
  const zip = new JSZip();

  // Main scene: contains a DOMTimeline that places the graphic symbol.
  const sceneBody = includeLibrary
    ? `<elements>
        ${symbolNames.map((name) => `<DOMSymbolInstance libraryItemName="${name}">
          <matrix a="1" d="1" tx="0" ty="0"/>
        </DOMSymbolInstance>`).join('\n        ')}
      </elements>`
    : (includeSceneShape
        ? `<elements>
             <DOMShape>
               <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
               <fills>
                 <FillStyle index="1"><SolidColor color="#abcdef"/></FillStyle>
               </fills>
               <edges>
                 <Edge cubics="${SIMPLE_RECT_CUBICS}"/>
               </edges>
             </DOMShape>
           </elements>`
        : '<elements></elements>');

  const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="550" height="400" frameRate="24">
  <timelines>
    <DOMTimeline name="scene1">
      <layers>
        <DOMLayer name="layer1">
          <frames>
            <DOMFrame index="0">${sceneBody}</DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`;
  zip.file('DOMDocument.xml', docXml);

  if (includeLibrary) {
    for (const currentSymbolName of symbolNames) {
      const frames = graphicFrames.map((frame) => {
        const attributes = `index="${frame.index}"${frame.duration === undefined ? '' : ` duration="${frame.duration}"`}${frame.tweenType === undefined ? '' : ` tweenType="${frame.tweenType}"`}`;
        if (frame.blank) return `<DOMFrame ${attributes}><elements/></DOMFrame>`;
        return `<DOMFrame ${attributes}>
              <DOMGroup>
                <matrix><Matrix a="2" d="2" tx="${frame.tx ?? 10}" ty="20"/></matrix>
                <members>
                  <DOMShape>
                    <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
                    <fills>
                      <FillStyle index="1"><SolidColor color="${frame.color ?? '#336699'}" alpha="1"/></FillStyle>
                    </fills>
                    <strokes/>
                    <edges>
                      <Edge cubics="${SIMPLE_RECT_CUBICS}"/>
                    </edges>
                  </DOMShape>
                </members>
              </DOMGroup>
            </DOMFrame>`;
      }).join('\n            ');
      const libXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="${currentSymbolName}" symbolType="graphic">
  <timeline>
    <DOMTimeline name="symbolTimeline">
      <layers>
        <DOMLayer name="symbolLayer">
          <frames>
            ${frames}
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timeline>
</DOMSymbolItem>`;
      zip.file(`LIBRARY/${currentSymbolName}.xml`, libXml);
    }
  }

  return await zip.generateAsync({ type: 'uint8array' });
}

// ---- Helpers ----
function pickFirst<T>(arr: ReadonlyArray<T> | undefined): T | null {
  return arr && arr.length > 0 ? arr[0] as T : null;
}

// ---- Tests ----
describe('R1-B SVG builder: catalog discovery', () => {
  it('discovers a graphic symbol target with previewSupported=true', async () => {
    const bytes = await buildSyntheticFla({ includeLibrary: true, symbolName: 'sword' });
    const result: BuildCatalogResult = await buildRenderableTargetCatalog(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graphic = result.entries.find((e) => e.target.kind === 'graphic-symbol');
    expect(graphic).toBeDefined();
    if (!graphic) return;
    expect(graphic.target.userLabel).toBe('sword');
    expect(graphic.target.frameCount).toBe(1);
    expect(graphic.previewSupported).toBe(true);
  });

  it('keeps logical target ids stable across repeated catalog builds', async () => {
    const bytes = await buildSyntheticFla({
      includeLibrary: true,
      symbolNames: ['sword', 'shield'],
      includeSceneShape: false,
    });
    const first = await buildRenderableTargetCatalog(bytes);
    const second = await buildRenderableTargetCatalog(bytes);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.entries.map((entry) => entry.target.userLabel)).toEqual(
      second.entries.map((entry) => entry.target.userLabel),
    );
    expect(first.entries.map((entry) => entry.target.renderTargetId)).toEqual(
      second.entries.map((entry) => entry.target.renderTargetId),
    );
  });

  it('keeps distinct logical targets on distinct stable ids', async () => {
    const bytes = await buildSyntheticFla({
      includeLibrary: true,
      symbolNames: ['sword', 'shield'],
      includeSceneShape: false,
    });
    const result = await buildRenderableTargetCatalog(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const graphicTargets = result.entries
      .filter((entry) => entry.target.kind === 'graphic-symbol')
      .map((entry) => entry.target);
    expect(graphicTargets).toHaveLength(2);
    expect(graphicTargets[0]?.userLabel).not.toBe(graphicTargets[1]?.userLabel);
    expect(graphicTargets[0]?.renderTargetId).not.toBe(graphicTargets[1]?.renderTargetId);
    expect(new Set(graphicTargets.map((target) => target.renderTargetId)).size).toBe(2);
  });

  it('reports a multi-frame graphic target for the R2 bridge fixture', async () => {
    const bytes = await buildSyntheticFla({
      includeLibrary: true,
      symbolName: 'multi-frame',
      graphicFrameCount: 2,
      includeSceneShape: false,
    });
    const result = await buildRenderableTargetCatalog(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graphic = result.entries.find((entry) => entry.target.kind === 'graphic-symbol');
    expect(graphic?.target.frameCount).toBe(2);
  });

  it('discovers the main scene target with kind=scene and frameCount=1', async () => {
    const bytes = await buildSyntheticFla({ includeLibrary: false, includeSceneShape: true });
    const result = await buildRenderableTargetCatalog(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scene = result.entries.find((e) => e.target.kind === 'scene');
    expect(scene).toBeDefined();
    if (!scene) return;
    expect(scene.target.userLabel).toContain('主场景');
    expect(scene.target.frameCount).toBe(1);
  });

  it('returns 0 entries and a beginner-facing summary when no renderable content', async () => {
    const bytes = await buildSyntheticFla({ includeLibrary: false, includeSceneShape: false });
    const result = await buildRenderableTargetCatalog(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toEqual([]);
    expect(result.summary).toContain('没有可渲染');
  });
});

describe('R1-B SVG builder: SVG for a renderable target', () => {
  it('renders a graphic-symbol target into a valid SVG with a <path>', async () => {
    const bytes = await buildSyntheticFla({ includeLibrary: true, symbolName: 'sword' });
    const catalog = await buildRenderableTargetCatalog(bytes);
    if (!catalog.ok) throw new Error('catalog failed');
    const target = pickFirst<FlaRenderTarget>(catalog.entries.filter((e) => e.target.kind === 'graphic-symbol').map((e) => e.target));
    if (!target) throw new Error('no graphic target');
    const result: BuildSvgResult = await buildSvgForRenderTarget(bytes, target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('<path');
    expect(result.svg).toContain('d="');
    expect(result.svg).toContain('fill="#336699"');
    expect(result.pathCommandCount).toBeGreaterThan(0);
    expect(result.hasRenderablePath).toBe(true);
    expect(result.firstFillColor).toBe('#336699');
  });

  it('renders a scene-kind target with the same code path', async () => {
    const bytes = await buildSyntheticFla({ includeLibrary: false, includeSceneShape: true });
    const catalog = await buildRenderableTargetCatalog(bytes);
    if (!catalog.ok) throw new Error('catalog failed');
    const target = pickFirst<FlaRenderTarget>(catalog.entries.filter((e) => e.target.kind === 'scene').map((e) => e.target));
    if (!target) throw new Error('no scene target');
    const result = await buildSvgForRenderTarget(bytes, target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain('<path');
    expect(result.svg).toContain('fill="#abcdef"');
  });

  it('selects Graphic display states by authored spans and uses their true frame count', async () => {
    const bytes = await buildSyntheticFla({
      includeLibrary: true,
      symbolName: 'authored-span-symbol',
      graphicFrames: [
        { index: 0, duration: 3, tx: 10, color: '#336699' },
        { index: 3, duration: 2, tx: 30, color: '#cc3355' },
      ],
      includeSceneShape: false,
    });
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const target = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol')?.target;
    expect(target?.frameCount).toBe(5);
    if (!target) return;

    const first = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 0 });
    const held = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 2 });
    const second = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 3 });
    expect(first.ok).toBe(true);
    expect(held.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !held.ok || !second.ok) return;

    const visiblePath = (svg: string) => svg.match(/<path[^>]*\/>/u)?.[0];
    expect(visiblePath(held.svg)).toBe(visiblePath(first.svg));
    expect(held.width).toBe(first.width);
    expect(held.height).toBe(first.height);
    expect(visiblePath(second.svg)).not.toBe(visiblePath(first.svg));
    expect(second.svg).not.toBe(first.svg);
    expect({ ...target, selectedFrameIndex: 3 }.renderTargetId).toBe(target.renderTargetId);
    expect(first.svg).toContain('fill="#336699"');
    expect(second.svg).toContain('fill="#cc3355"');

    const outOfRange = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 5 });
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.code).toBe('TARGET_OUT_OF_RANGE');

    const targetRange = await buildSvgForRenderTarget(bytes, {
      ...target,
      frameCount: 3,
      selectedFrameIndex: 3,
    });
    expect(targetRange.ok).toBe(false);
    if (!targetRange.ok) expect(targetRange.code).toBe('TARGET_OUT_OF_RANGE');
  });

  it('keeps a blank-first Graphic discoverable and renders its later authored state', async () => {
    const bytes = await buildSyntheticFla({
      includeLibrary: true,
      symbolName: 'blank-first-symbol',
      graphicFrames: [
        { index: 0, duration: 2, blank: true },
        { index: 2, duration: 2, color: '#cc3355' },
      ],
      includeSceneShape: false,
    });
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const entry = catalog.entries.find((candidate) => candidate.target.kind === 'graphic-symbol');
    expect(entry).toBeDefined();
    expect(entry?.previewSupported).toBe(true);
    expect(entry?.target.frameCount).toBe(4);
    if (!entry) return;
    const target = entry.target;

    const blank0 = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 0 });
    const blank1 = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 1 });
    const visible2 = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 2 });
    const visible3 = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 3 });
    expect(blank0.ok).toBe(true);
    expect(blank1.ok).toBe(true);
    expect(visible2.ok).toBe(true);
    expect(visible3.ok).toBe(true);
    if (!blank0.ok || !blank1.ok || !visible2.ok || !visible3.ok) return;

    const visiblePath = (svg: string) => svg.match(/<path[^>]*\/>/u)?.[0];
    expect(blank0.svg).not.toContain('<path');
    expect(blank0.width).toBe(1);
    expect(blank0.height).toBe(1);
    expect(blank0.composition.framing.contentBounds).toBeNull();
    expect(blank1.svg).not.toContain('<path');
    expect(blank1.width).toBe(blank0.width);
    expect(blank1.height).toBe(blank0.height);
    expect(visiblePath(visible2.svg)).toContain('fill="#cc3355"');
    expect(visiblePath(visible3.svg)).toBe(visiblePath(visible2.svg));
    expect(visible2.width).toBe(visible3.width);
    expect(visible2.height).toBe(visible3.height);
    expect(visiblePath(blank0.svg)).not.toBe(visiblePath(visible2.svg));
    expect({ ...target, selectedFrameIndex: 0 }.renderTargetId)
      .toBe({ ...target, selectedFrameIndex: 2 }.renderTargetId);
  });

  it('does not add a wholly blank Graphic timeline to the renderable catalog', async () => {
    const bytes = await buildSyntheticFla({
      includeLibrary: true,
      symbolName: 'wholly-blank-symbol',
      graphicFrames: [{ index: 0, duration: 4, blank: true }],
      includeSceneShape: false,
    });
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    expect(catalog.entries.some((entry) => entry.target.kind === 'graphic-symbol')).toBe(false);
  });

  it('rejects a Graphic tween interior instead of repeating the keyframe state', async () => {
    const bytes = await buildSyntheticFla({
      includeLibrary: true,
      symbolName: 'tween-symbol',
      graphicFrames: [{ index: 0, duration: 3, tweenType: 'motion' }],
      includeSceneShape: false,
    });
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const target = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol')?.target;
    expect(target?.frameCount).toBe(3);
    if (!target) return;

    const keyframe = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 0 });
    const tweenInterior = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 1 });
    expect(keyframe.ok).toBe(true);
    expect(tweenInterior.ok).toBe(false);
    if (!tweenInterior.ok) {
      expect(tweenInterior.code).toBe('RENDER_FAILED');
      expect(tweenInterior.message).toContain('unsupported motion tween interpolation');
    }
  });

  it('honors a non-zero selectedFrameIndex on a scene target', async () => {
    // The synthetic FLA only has frame 0, so selectedFrameIndex=1
    // must reject with TARGET_OUT_OF_RANGE.
    const bytes = await buildSyntheticFla({ includeLibrary: false, includeSceneShape: true });
    const catalog = await buildRenderableTargetCatalog(bytes);
    if (!catalog.ok) throw new Error('catalog failed');
    const target = pickFirst<FlaRenderTarget>(catalog.entries.filter((e) => e.target.kind === 'scene').map((e) => e.target));
    if (!target) throw new Error('no scene target');
    const oob = { ...target, selectedFrameIndex: 99 };
    const result = await buildSvgForRenderTarget(bytes, oob);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TARGET_OUT_OF_RANGE');
  });

  it('rejects an unknown target kind with TARGET_UNSUPPORTED', async () => {
    const bytes = await buildSyntheticFla({ includeLibrary: true, symbolName: 'sword' });
    const catalog = await buildRenderableTargetCatalog(bytes);
    if (!catalog.ok) throw new Error('catalog failed');
    const target = pickFirst<FlaRenderTarget>(catalog.entries.map((e) => e.target));
    if (!target) throw new Error('no target');
    const bad = { ...target, kind: 'unknown' as const };
    const result = await buildSvgForRenderTarget(bytes, bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TARGET_UNSUPPORTED');
  });

  it('rejects a graphic-symbol target whose library item is missing', async () => {
    const bytes = await buildSyntheticFla({ includeLibrary: true, symbolName: 'sword' });
    const target: FlaRenderTarget = {
      renderTargetId: 'fla-render-target-badcafebabe000000',
      kind: 'graphic-symbol',
      userLabel: 'ghost',
      sourceLibraryItemName: 'does-not-exist',
      frameCount: 1,
      compatibility: [],
    };
    const result = await buildSvgForRenderTarget(bytes, target);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TARGET_UNSUPPORTED');
  });

  it('rejects an over-size source with BUDGET_EXCEEDED', async () => {
    // Build a 256 MiB+1 byte zip; the function rejects before jszip.
    const huge = new Uint8Array(256 * 1024 * 1024 + 1);
    const result = await buildRenderableTargetCatalog(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BUDGET_EXCEEDED');
  });

  it('rejects a non-ZIP file with RENDER_FAILED (EOCD not found)', async () => {
    const garbage = new TextEncoder().encode('not a zip file at all');
    const result = await buildRenderableTargetCatalog(garbage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('RENDER_FAILED');
  });
});
