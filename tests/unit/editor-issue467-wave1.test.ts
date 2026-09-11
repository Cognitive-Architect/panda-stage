import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatAssetImportStatus,
} from '../../src/renderer/features/assets/applyAssetImportResponse';
import type { AssetImportResult } from '../../src/shared/asset-import-api';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

function result(
  status: AssetImportResult['status'],
  sourceName: string,
): AssetImportResult {
  return {
    sourceName,
    status,
    sha256: null,
    asset: null,
    duplicateOfAssetId: null,
    code: null,
    message: '详情',
  };
}

describe('Issue #467 Wave 1 subtitle and feedback cleanup', () => {
  it('keeps the pending subtitle action row small and places its actions correctly', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const styles = source('src/renderer/styles.css');

    expect(sheet).toContain('Info');
    expect(sheet).toContain('<Info');
    expect(sheet).toContain('可手动拖入');
    expect(sheet).toContain('自动加入');
    expect(sheet).toContain('<GripVertical size={14} />');
    expect(styles).toContain('.dialogue-sheet-right-workspace .dialogue-untimed-action-strip');
    expect(styles).toContain('.dialogue-untimed-action-info');
    expect(styles).toContain('.quick-action-drawer-rest-state');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(styles).toContain('justify-content: flex-end;');
    expect(styles).toContain('font-size: 12px;');
  });

  it('removes redundant no-voice copy and keeps the seconds summary tied to ms', () => {
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(inspector).not.toContain('还没有配音');
    expect(inspector).not.toContain('为这条字幕选择角色配音。');
    expect(inspector).toContain("'选择配音'");
    expect(inspector).toContain('formatHumanAudioDuration');
    expect(inspector).toContain('音频');
    expect(inspector).toContain('秒');
  });

  it('keeps import acknowledgements concise and partial failures actionable', () => {
    expect(formatAssetImportStatus([result('imported', 'voice.mp3')])).toBe(
      '已导入：voice.mp3',
    );
    expect(
      formatAssetImportStatus([
        result('imported', 'voice.mp3'),
        result('imported', 'music.wav'),
        result('imported', 'bg.png'),
      ]),
    ).toBe('已导入 3 个素材');
    expect(
      formatAssetImportStatus([
        result('imported', 'voice.mp3'),
        result('failed', 'broken.wav'),
      ]),
    ).toBe('已导入 1 个素材；另有 1 个素材未导入，请查看下方详情。');
  });

  it('exposes save state outside the collapsed drawer and leaves defaults text-only', () => {
    const drawer = source('src/renderer/shell/CompactProjectBar.tsx');
    const layout = source('src/shared/preview/subtitle-layout.ts');
    const project = source('src/main/services/ProjectService.ts');
    const migration = source('src/domain/migrations/index.ts');

    expect(drawer).toContain('project-save-state-rest');
    expect(drawer).toContain('saveStateLabel');
    expect(layout).toContain("DEFAULT_BACKGROUND_COLOR = '#0a141100'");
    expect(project).toContain("backgroundColor: '#0a141100'");
    expect(migration).toContain("backgroundColor: '#0a141100'");
  });
});
