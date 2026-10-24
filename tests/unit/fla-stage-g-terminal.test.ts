import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  FlaStageGImporting,
  flaStageGImportingMessage,
  FlaStageGRecovery,
  FlaStageGRasterSuccess,
  FlaStageGSequenceSuccess,
  FlaStageGSnapshotSuccess,
  mapFlaStageGRecovery,
} from '../../src/renderer/fla-import/FlaStageGTerminal';

const noop = vi.fn();
const terminalStyles = readFileSync(
  new URL(
    '../../src/renderer/styles/features/fla-import/status/s03-01--terminal-g.css',
    import.meta.url,
  ),
  'utf8',
);

describe('Issue #405 Stage G presentation contracts', () => {
  it('maps stale candidates, stale projects, retry-safe failures, and unsafe aftermath distinctly', () => {
    expect(mapFlaStageGRecovery('STALE_PREVIEW', false)).toMatchObject({
      kind: 'stale-preview',
      primaryLabel: '重新预览',
    });
    expect(mapFlaStageGRecovery('STALE_SEQUENCE', false)).toMatchObject({
      kind: 'stale-sequence',
      primaryLabel: '重新生成',
    });
    expect(mapFlaStageGRecovery('STALE_PROJECT_REVISION', true)).toMatchObject({
      kind: 'stale-project',
      primaryLabel: '返回素材库',
    });
    expect(mapFlaStageGRecovery('ASSET_COMMIT_FAILED', true)).toMatchObject({
      kind: 'retry',
      primaryLabel: '重新尝试',
    });
    expect(mapFlaStageGRecovery('ASSET_COMMIT_FAILED', false).kind).toBe('return');
    expect(mapFlaStageGRecovery('ROLLBACK_FAILED', true)).toMatchObject({
      kind: 'unsafe',
      primaryLabel: '返回素材库',
    });
  });

  it('renders one operation-aware importing sentence without extra copy or a card', () => {
    expect(flaStageGImportingMessage('animation')).toBe('正在导入动画素材…');
    expect(flaStageGImportingMessage('image')).toBe('正在导入图片素材…');
    expect(flaStageGImportingMessage('mixed')).toBe('正在导入素材…');

    const htmlByKind = (importKind: 'animation' | 'image' | 'mixed') =>
      renderToStaticMarkup(createElement(FlaStageGImporting, {
        route: 'sequence',
        importKind,
      }));
    const animationHtml = htmlByKind('animation');
    const imageHtml = htmlByKind('image');
    const mixedHtml = htmlByKind('mixed');

    expect(animationHtml).toContain('正在导入动画素材…');
    expect(imageHtml).toContain('正在导入图片素材…');
    expect(mixedHtml).toContain('正在导入素材…');
    for (const html of [animationHtml, imageHtml, mixedHtml]) {
      expect(html).toContain('data-stage-g-state="importing"');
      expect(html).toContain('data-fake-percent="false"');
      expect(html).toContain('data-fake-commit-cancel="false"');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain('Panda Stage');
      expect(html).not.toContain('walk.fla');
      expect(html).not.toContain('24 帧序列');
      expect(html).not.toContain('正在安全写入项目');
      expect(html).not.toContain('%');
      expect(html).not.toContain('<button');
      expect(html).not.toContain('<output');
      expect(html.match(/<p\b/gu)).toHaveLength(1);
    }

    expect(terminalStyles).toMatch(
      /\.fla-stage-g-importing\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/u,
    );
    expect(terminalStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(terminalStyles).toContain('animation: none;');
  });

  it('renders route-specific success receipts with only the Asset Library exit', () => {
    const rasterResponse = {
      ok: true,
      status: 'completed',
      summary: { selectedCount: 67, importedCount: 61, duplicateCount: 6, renamedCount: 2 },
    } as Parameters<typeof FlaStageGRasterSuccess>[0]['response'];
    const snapshotResponse = {
      ok: true,
      status: 'completed',
      result: { status: 'duplicate', targetFileName: '小黑子-frame0012.png', renamed: false },
    } as Parameters<typeof FlaStageGSnapshotSuccess>[0]['response'];
    const sequenceResponse = {
      ok: true,
      status: 'completed',
      result: {
        summary: {
          requestedFrameCount: 24,
          importedCount: 20,
          duplicateCount: 4,
          renamedCount: 2,
          netNewImageAssetCount: 20,
        },
      },
    } as Parameters<typeof FlaStageGSequenceSuccess>[0]['response'];

    const rasterHtml = renderToStaticMarkup(createElement(FlaStageGRasterSuccess, { response: rasterResponse, onReturn: noop }));
    const snapshotHtml = renderToStaticMarkup(createElement(FlaStageGSnapshotSuccess, { response: snapshotResponse, onReturn: noop }));
    const sequenceHtml = renderToStaticMarkup(createElement(FlaStageGSequenceSuccess, {
      response: sequenceResponse,
      rangeStart: 0,
      rangeEnd: 23,
      onReturn: noop,
    }));

    expect(rasterHtml).toContain('新增');
    expect(rasterHtml).toContain('复用已有素材');
    expect(rasterHtml).toContain('重命名');
    expect(snapshotHtml).toContain('已复用已有素材');
    expect(snapshotHtml).toContain('没有创建重复文件');
    expect(snapshotHtml).not.toContain('当前帧已导入');
    expect(sequenceHtml).toContain('新增');
    expect(sequenceHtml).toContain('范围');
    for (const html of [rasterHtml, snapshotHtml, sequenceHtml]) {
      expect(html).toContain('返回素材库');
      expect((html.match(/<button/gu) ?? [])).toHaveLength(1);
      expect(html).not.toContain('fla-frame-sequence-filmstrip');
      expect(html).not.toContain('fla-snapshot-frame-controls');
    }
  });

  it('keeps raw codes and residual paths behind technical disclosure', () => {
    const html = renderToStaticMarkup(createElement(FlaStageGRecovery, {
      route: 'snapshot',
      code: 'ROLLBACK_FAILED',
      message: 'rollback failed',
      residualPaths: ['D:\\acceptance\\residual.png'],
      candidateStillCurrent: false,
      onPrimary: noop,
      onClose: noop,
    }));
    expect(html).toContain('导入未能安全完成');
    expect(html).toContain('查看技术详情');
    expect(html).toContain('D:\\acceptance\\residual.png');
    expect(html).not.toContain('重新尝试');
    expect((html.match(/<button/gu) ?? [])).toHaveLength(1);
  });
});
