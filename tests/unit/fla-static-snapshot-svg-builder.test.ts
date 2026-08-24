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

async function buildSyntheticFla(
  options: {
    includeLibrary?: boolean;
    symbolName?: string;
    symbolNames?: string[];
    graphicFrameCount?: number;
    includeSceneShape?: boolean;
  } = {},
): Promise<Uint8Array> {
  const includeLibrary = options.includeLibrary ?? true;
  const symbolNames = options.symbolNames ?? [options.symbolName ?? 'synthetic-symbol'];
  const graphicFrameCount = options.graphicFrameCount ?? 1;
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
      const frames = Array.from({ length: graphicFrameCount }, (_, frameIndex) => `<DOMFrame index="${frameIndex}">
              <DOMGroup>
                <matrix><Matrix a="2" d="2" tx="10" ty="20"/></matrix>
                <members>
                  <DOMShape>
                    <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
                    <fills>
                      <FillStyle index="1"><SolidColor color="#336699" alpha="1"/></FillStyle>
                    </fills>
                    <strokes/>
                    <edges>
                      <Edge cubics="${SIMPLE_RECT_CUBICS}"/>
                    </edges>
                  </DOMShape>
                </members>
              </DOMGroup>
            </DOMFrame>`).join('\n            ');
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
    expect(result.entries[0]?.target.frameCount).toBe(2);
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
