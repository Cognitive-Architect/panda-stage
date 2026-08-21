/**
 * FLA V1.5-B0 structural probe spike — focused verification.
 *
 * Scope (Issue #275 / Roadmap #272):
 *  - pure, read-only derivation of structural facts from the modern ZIP/XFL source;
 *  - NO Project/Asset mutation, NO production contract change, NO parser-specific
 *    object leakage, NO malformed-EOCD normalization.
 *
 * Real corpus (strict-PASS originals) is probed only when locally accessible and
 * read-only; otherwise those cases skip so the suite stays portable/CI-safe.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  probeFlaStructure,
  probeFlaStructureFromBytes,
  type FlaStructuralFacts,
} from '../helpers/fla-structural-probe';

const CORPUS_DIR = process.env.FLA_REAL_CORPUS_DIR ?? 'D:\\表情合集';

function corpusFile(name: string): string {
  return join(CORPUS_DIR, name);
}

function expectFacts(facts: FlaStructuralFacts, subset: Partial<FlaStructuralFacts>): void {
  for (const [key, value] of Object.entries(subset)) {
    expect(facts[key as keyof FlaStructuralFacts], key).toBe(value);
  }
}

describe('FLA V1.5-B0 structural probe — pure helper (synthetic, deterministic)', () => {
  const domDoc = `
    <DOMDocument width="1920" height="1080" frameRate="30">
      <media>
        <DOMBitmapItem name="b1.png" href="b1.png" bitmapDataHRef="M 1.dat"/>
        <DOMBitmapItem name="b2.png" href="b2.png" bitmapDataHRef="M 2.dat"/>
      </media>
      <symbols/>
      <timelines>
        <DOMTimeline name="场景 1">
          <layers>
            <DOMLayer name="L1">
              <frames>
                <DOMFrame index="0" keyMode="9728">
                  <elements>
                    <DOMBitmapInstance libraryItemName="b1.png"/>
                    <DOMBitmapInstance libraryItemName="b2.png"/>
                  </elements>
                </DOMFrame>
              </frames>
            </DOMLayer>
          </layers>
        </DOMTimeline>
      </timelines>
    </DOMDocument>`;

  const libraryGraphic = `
    <DOMSymbolItem symbolType="graphic" name="sym1">
      <timeline>
        <DOMTimeline name="sym1">
          <layers>
            <DOMLayer name="SL">
              <frames>
                <DOMFrame index="0" keyMode="9728"><elements><DOMBitmapInstance libraryItemName="b1.png"/></elements></DOMFrame>
                <DOMFrame index="1" keyMode="0"><tweenType="motion"/></DOMFrame>
                <DOMFrame index="2" keyMode="9728"/>
              </frames>
            </DOMLayer>
          </layers>
        </DOMTimeline>
      </timeline>
    </DOMSymbolItem>`;

  it('derives top-level + media + placed facts from DOMDocument.xml', () => {
    const facts = probeFlaStructure(domDoc, []);
    expectFacts(facts, {
      bitmapMediaCount: 2,
      sceneCount: 1,
      topLevelTimelineCount: 1,
      symbolCount: 0,
      movieClipCount: 0,
      graphicCount: 0,
      buttonCount: 0,
      layerCount: 1,
      frameCount: 1,
      keyframeCount: 1,
      tweenCount: 0,
      animatedTimelineCandidateCount: 0,
      placedInstanceCount: 2,
      libraryOnlyMediaCount: 0,
    });
  });

  it('counts symbol timeline structure without leaking parser objects', () => {
    const facts = probeFlaStructure(domDoc, [libraryGraphic]);
    expectFacts(facts, {
      bitmapMediaCount: 2, // graphic symbol carries no bitmap of its own
      symbolCount: 1,
      graphicCount: 1,
      movieClipCount: 0,
      buttonCount: 0,
      layerCount: 2, // top layer + symbol layer
      frameCount: 4, // 1 top + 3 symbol
      keyframeCount: 3, // top(1) + symbol(index0, index2)
      tweenCount: 1,
      animatedTimelineCandidateCount: 1, // symbol timeline has frames>1
      placedInstanceCount: 2,
    });
  });

  it('proves zero-raster files still carry structural facts (no misclassification)', () => {
    const zeroRaster = `
      <DOMDocument width="512" height="512" frameRate="24">
        <media/>
        <symbols/>
        <timelines>
          <DOMTimeline name="场景 1">
            <layers>
              <DOMLayer name="L">
                <frames>
                  <DOMFrame index="0" keyMode="9728"/>
                  <DOMFrame index="1" keyMode="0"/>
                </frames>
              </DOMLayer>
            </layers>
          </DOMTimeline>
        </timelines>
      </DOMDocument>`;
    const facts = probeFlaStructure(zeroRaster, [libraryGraphic]);
    expect(facts.bitmapMediaCount).toBe(0);
    expect(facts.frameCount).toBeGreaterThan(0);
    expect(facts.symbolCount).toBeGreaterThan(0);
    // A zero-raster file is NOT "structurally empty".
    expect(facts.layerCount + facts.frameCount + facts.symbolCount).toBeGreaterThan(0);
  });

  it('handles an empty/non-XFL document without throwing or mutating anything', () => {
    const facts = probeFlaStructure('', []);
    expect(facts.bitmapMediaCount).toBe(0);
    expect(facts.sceneCount).toBe(0);
    expect(facts.frameCount).toBe(0);
  });
});

describe('FLA V1.5-B0 structural probe — real corpus (read-only, skip if absent)', () => {
  const fileFla = corpusFile('文件.fla');
  const jianFla = corpusFile('剑.fla');

  it.skipIf(!existsSync(fileFla))('probes strict-PASS 文件.fla raster puppet', async () => {
    const bytes = new Uint8Array(readFileSync(fileFla));
    const result = await probeFlaStructureFromBytes(bytes, '文件.fla');
    // Known-good baseline (handoff #270 / corpus #267 / research #271).
    expect(result.sha256.startsWith('84682EDC')).toBe(true);
    expectFacts(result.facts, {
      bitmapMediaCount: 158,
      sceneCount: 1,
      symbolCount: 0,
      movieClipCount: 0,
      graphicCount: 0,
      layerCount: 1,
      frameCount: 1,
      keyframeCount: 1,
      placedInstanceCount: 156,
      libraryOnlyMediaCount: 2,
    });
  });

  it.skipIf(!existsSync(jianFla))('probes strict-PASS 剑.fla zero-raster vector file', async () => {
    const bytes = new Uint8Array(readFileSync(jianFla));
    const result = await probeFlaStructureFromBytes(bytes, '剑.fla');
    expect(result.sha256.startsWith('E773508C')).toBe(true);
    // Zero raster, but structurally meaningful (mirrors the corpus requirement).
    expectFacts(result.facts, {
      bitmapMediaCount: 0,
      symbolCount: 1,
      graphicCount: 1,
      movieClipCount: 0,
      sceneCount: 1,
      layerCount: 2,
      frameCount: 2,
      keyframeCount: 2,
      placedInstanceCount: 0,
    });
  });
});

describe('FLA V1.5-B0 structural probe — malformed +54 originals stay fail-closed', () => {
  const shadiao = corpusFile('沙雕表情大全（免费分享，短剧慎用）.fla');

  it.skipIf(!existsSync(shadiao))('cannot open +54 malformed original (no normalization in B0)', async () => {
    const bytes = new Uint8Array(readFileSync(shadiao));
    await expect(probeFlaStructureFromBytes(bytes, '沙雕.fla')).rejects.toThrow();
  });
});
