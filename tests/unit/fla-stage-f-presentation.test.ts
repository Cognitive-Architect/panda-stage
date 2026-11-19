import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';
import type { AnimationImportIR, FlaInspectionResponse } from '../../src/shared/fla-import-api';
import type { FlaRenderableTargetCatalogEntry } from '../../src/shared/fla-static-snapshot-api';
import {
  boundedUnsupportedReason,
  FlaStageF1Notice,
  FlaStageF2UnavailableDetails,
  FlaStageF3Blocked,
  getFlaStageF1Warnings,
} from '../../src/renderer/fla-import/FlaStageF';

const compatibility: AnimationImportIR['compatibility'] = [
  { feature: 'basic-tweens', status: 'degraded', reason: 'not all tween details are preserved' },
  { feature: 'video', status: 'unsupported', reason: 'video is outside the current import range' },
  { feature: 'future-feature', status: 'unknown', reason: 'not classified' },
  { feature: 'bitmap-media', status: 'exact', reason: 'supported' },
  { feature: 'text', status: 'not-present', reason: 'not present' },
];

const unavailableEntry: FlaRenderableTargetCatalogEntry = {
  target: {
    renderTargetId: 'fla-render-target-1a2b3c4d5e6f7a8b',
    kind: 'graphic-symbol',
    userLabel: '文本目标',
    frameCount: 2,
    compatibility: ['unsupported'],
  },
  previewSupported: false,
  isBlank: false,
  unsupportedReason: 'shape tween not implemented',
};

const blockedResponse: FlaInspectionResponse = {
  ok: false,
  error: {
    code: 'MALFORMED_ARCHIVE',
    message: 'MALFORMED_ARCHIVE: EOCD mismatch',
  },
  diagnostics: [
    {
      category: 'archive-malformed',
      userMessage: '此 FLA 文件的结构未通过安全检查，Panda 已停止继续读取。',
    },
  ],
  trace: {
    ingestMode: 'strict',
    recoveryApplied: false,
    originalStrictResult: 'reject',
    classifierState: 'REJECT',
    recoveryAttempted: false,
    postNormalizationStrictResult: 'not-run',
    parserResult: 'not-run',
    originalSourceSha256: 'a'.repeat(64),
    originalSourceByteLength: 24,
    classifierReasonCodes: ['EOCD_INCONSISTENT'],
  },
};

describe('Issue #402 Stage F presentation contract', () => {
  it('treats degraded, unsupported, and unknown compatibility as F1 warnings while keeping not-present secondary', () => {
    expect(getFlaStageF1Warnings(compatibility).map((entry) => entry.status)).toEqual([
      'degraded',
      'unsupported',
      'unknown',
    ]);

    const html = renderToStaticMarkup(
      createElement(FlaStageF1Notice, { compatibility }),
    );
    expect(html).toContain('data-testid="fla-stage-f1-warning"');
    expect(html).toContain('部分内容可能与原 FLA 有差异');
    expect(html).toContain('查看 3 项说明');
    expect(html).toContain('data-testid="fla-stage-f1-details"');
    expect(html).toContain('fla-stage-f1-render-notice');
    expect(html).not.toContain('<span>当前流程仍可继续，详情按需查看。</span>');
    expect(html).not.toContain('>F1<');
    expect(html).not.toContain('>not-present<');
  });

  it('does not mount an F1 notice for clear or not-present-only compatibility', () => {
    const html = renderToStaticMarkup(
      createElement(FlaStageF1Notice, {
        compatibility: [
          { feature: 'text', status: 'not-present', reason: 'not present' },
          { feature: 'bitmap-media', status: 'exact', reason: 'supported' },
        ],
      }),
    );
    expect(html).toBe('');
  });

  it('keeps an F2 target visible, non-selectable, and separate from the render authority', () => {
    const html = renderToStaticMarkup(
      createElement(FlaStageF2UnavailableDetails, { entry: unavailableEntry }),
    );
    expect(html).toContain('data-preview-supported="false"');
    expect(html).toContain('暂不可预览');
    expect(html).toContain('文本目标');
    expect(html).toContain('其他可用目标不受影响');
    expect(html).toContain('矢量内容');
    expect(html).not.toContain('shape tween not implemented');
    expect(html).not.toContain('>F2<');
    expect(boundedUnsupportedReason('unknown producer detail')).toBe(
      'Panda 当前无法安全确认该目标的渲染结果。',
    );
  });

  it('places the three F3 elements in a dialog and keeps diagnostics in closed details', () => {
    const html = renderToStaticMarkup(
      createElement(FlaStageF3Blocked, { response: blockedResponse, onClose: () => undefined }),
    );
    const [visible, details] = html.split('<details');
    expect(visible).toContain('data-testid="fla-stage-f3-blocked"');
    expect(visible).toContain('role="dialog"');
    expect(visible).toContain('tabindex="-1"');
    expect(visible).not.toContain('autofocus');
    expect(visible).toContain('role="alert"');
    expect(visible).toContain('>无法读取素材</h1>');
    expect(visible).toContain('aria-label="关闭并返回素材库"');
    expect(visible).toContain('data-ui-size="icon"');
    expect(visible).toContain('lucide-x');
    expect(visible).toContain('lucide-file-exclamation-point');
    expect(visible).not.toContain('lucide-arrow-left');
    expect(html.match(/<button\b/gu)).toHaveLength(1);
    expect(visible).not.toMatch(/\u53ea\u8bfb|\u5b89\u5168\u68c0\u67e5|FLA \u5de5\u4f5c\u53f0|MALFORMED_ARCHIVE|EOCD/u);
    expect(details).toMatch(/^ data-testid="fla-stage-f3-details"><summary><svg[^>]*lucide-chevron-down[\s\S]*?<\/svg>查看详情<\/summary>/u);
    expect(details).toContain('MALFORMED_ARCHIVE: EOCD mismatch');
    expect(details).toContain('EOCD_INCONSISTENT');
    expect(html).not.toContain('data-testid="fla-snapshot-preview"');
    expect(html).not.toContain('data-testid="fla-frame-sequence-render"');
    expect(html).not.toContain('data-testid="fla-unified-import"');
  });

  it('keeps genuine parser details and omits duplicate notes and credential values', () => {
    const message = 'lifeart/fla-viewer: Shape 12 / FillStyle 2 in LIBRARY/Scene.xml';
    const html = renderToStaticMarkup(createElement(FlaStageF3Blocked, {
      response: {
        ...blockedResponse,
        error: { code: 'PARSER_CRASH', message },
        diagnostics: [
          { category: 'archive-malformed', userMessage: 'summary', developerNote: message },
          { category: 'archive-malformed', userMessage: 'summary', developerNote: 'archive read failed; Authorization: Bearer fixture-secret' },
        ],
      },
      onClose: () => undefined,
    }));
    expect(html).toContain('PARSER_CRASH: ' + message);
    expect(html.split(message)).toHaveLength(2);
    expect(html).toContain('archive read failed; Authorization: Bearer [已隐藏]');
    expect(html).not.toContain('fixture-secret');
  });

  it('retains a code-only response and indicates that details were unavailable', () => {
    const html = renderToStaticMarkup(createElement(FlaStageF3Blocked, {
      response: { ok: false, error: { code: 'PARSER_CRASH', message: 'PARSER_CRASH' } },
      onClose: () => undefined,
    }));
    expect(html).toContain('PARSER_CRASH: 未返回更具体原因');
  });
});

describe('Issue #402 integration/source contracts', () => {
  const session = readFileSync('src/renderer/fla-import/FlaCompatibilityReviewSession.tsx', 'utf8');
  const route = readFileSync('src/renderer/fla-import/fla-content-route.ts', 'utf8');
  const snapshot = readFileSync('src/renderer/fla-import/FlaStaticSnapshotReview.tsx', 'utf8');
  const sequence = readFileSync('src/renderer/fla-import/FlaFrameSequenceReview.tsx', 'utf8');
  const unified = readFileSync('src/renderer/fla-import/FlaUnifiedWorkbench.tsx', 'utf8');
  const c03Styles = readFileSync('src/renderer/styles/features/fla-import/c03-unified-workbench.css', 'utf8');
  const builder = readFileSync('src/main/services/fla-static-snapshot-svg-builder.ts', 'utf8');
  const styles = readOrderedStylesheetSource();

  it('preserves routing and mounts F3 only on the existing failed inspection response', () => {
    expect(session).toContain('if (response && !response.ok)');
    expect(session).toContain('<FlaStageF3Blocked response={response} onClose={onClose} />');
    expect(session).toContain('<FlaUnifiedWorkbench');
    expect(session).not.toContain('routeFlaInspection(response)');
    expect(route).toContain("'v2r-target-discovery'");
  });

  it('keeps F2 focus separate from R1/R2 target selection and uses the existing discovery boundary', () => {
    expect(snapshot).toContain('candidateSelection.focusedCandidateId');
    expect(snapshot).toContain('checkedCandidateKeys.has(flaUnifiedCandidateSelectionKey(candidate))');
    expect(snapshot).toContain('<FlaStageF2UnavailableDetails');
    expect(sequence).toContain('focusedTargetId');
    expect(sequence).toContain('fla-frame-sequence-f2-focus-');
    expect(builder).toContain('export async function buildRenderableTargetCatalog');
    expect(builder).toContain('const scene = source.sceneTimelines[0];');
    expect(builder).toContain('entries.push({');
    expect(builder).toContain('isBlank: check.isBlank');
  });

  it('keeps Stage F styling bounded without adding a dominant F1 Workbench row', () => {
    expect(styles).toContain('/* Issue #402 / #403 Problem 1: Stage F severity presentation.');
    expect(styles).toContain('.fla-stage-f2-unavailable-details');
    expect(styles).toContain('.fla-stage-f3-blocked');
    expect(styles).toContain('.fla-render-workbench-header > .fla-stage-f1-render-notice');
    expect(styles).not.toContain(".fla-render-workbench[data-stage-f1='true']");
    expect(styles).not.toContain(".fla-render-workbench[data-stage-f1='true'] {");
  });

  it('keeps the unified header shrink-safe for long source basenames', () => {
    expect(session).toContain('<h1 title={ir.source.basename}>{ir.source.basename}</h1>');
    expect(c03Styles).toMatch(/\.fla-c03-header h1\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/u);
  });

  it('keeps import progress and result feedback in the single C03 footer', () => {
    expect(unified).toContain("testId('footer', 'fla-c03-import-footer')");
    expect(unified).toContain("testId('summary', 'fla-single-mode-summary')");
    expect(unified).toContain('data-testid="fla-unified-import"');
    expect(unified).toContain('data-testid="fla-unified-import-stop"');
    expect(unified).toContain('data-testid="fla-unified-import-receipt"');
    expect(session).toContain('runFlaUnifiedImport({');
    expect(session).toContain('confirmed: true');
    expect(session).not.toContain('data-testid="fla-unified-import-action-bar"');
    expect(session).not.toContain('data-testid="fla-unified-import-progress"');
    expect(session).not.toContain('className="fla-raster-compatibility-summary"');
    expect(styles).toContain('.fla-c03-import-footer');
  });
});
