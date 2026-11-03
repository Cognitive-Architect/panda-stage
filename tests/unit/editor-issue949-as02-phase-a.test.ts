import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DialogueAuthoringDraft } from '../../src/renderer/features/dialogue/dialogueAuthoringDraft';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  if (path === 'src/renderer/styles.css') return readOrderedStylesheetSource();
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const SHOT_A = { projectRoot: 'D:\\panda-a.pandastage', shotId: 'shot-a' };
const SHOT_B = { projectRoot: 'D:\\panda-a.pandastage', shotId: 'shot-b' };
const PROJECT_B = { projectRoot: 'D:\\panda-b.pandastage', shotId: 'shot-a' };

describe('Issue #949 AS-02 Phase A', () => {
  it('adds Auto Subtitles as an in-drawer Tools view and preserves existing tools', () => {
    const tools = source('src/renderer/shell/ProjectToolsDrawer.tsx');

    expect(tools).toContain("type ProjectToolsView = 'home' | 'action-presets' | 'auto-subtitles'");
    expect(tools).toContain('data-testid="project-tools-auto-subtitles"');
    expect(tools).toContain("onClick={() => setView('auto-subtitles')}");
    expect(tools).toContain('data-testid="project-tools-auto-subtitles-back"');
    expect(tools).toContain('<h2 id="project-tools-heading">自动字幕</h2>');
    expect(tools).toContain('data-testid="project-tools-close"');
    expect(tools).toContain("view === 'action-presets'");
    expect(tools).toContain('<LegacyWorkspace />');
    expect(tools).toContain('presentation="auto-subtitle"');
    expect(tools).not.toContain('生成字幕与配音');
  });

  it('keeps the temporary Auto Subtitle draft in RightWorkspace and binds it to project and shot identity', () => {
    const right = source('src/renderer/shell/RightWorkspace.tsx');
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const tools = source('src/renderer/shell/ProjectToolsDrawer.tsx');

    expect(right).toContain('new DialogueAuthoringDraft()');
    expect(right).toContain('autoSubtitleDraft.bindIdentity');
    expect(right).toContain('shotId: currentShotId ?? null');
    expect(right).toContain('projectRoot,');
    expect(right).toContain('autoSubtitleDraftResetNotice');
    expect(right).toContain('autoSubtitleDraft={autoSubtitleDraft}');
    expect(right).not.toContain('updateProject');
    expect(right).not.toContain('HistoryControls');
    expect(tools).toContain('autoSubtitleDraft: DialogueAuthoringDraft');
    expect(sheet).toContain('presentation="subtitle-only"');
    expect(tools).toContain('data-testid="auto-subtitle-draft-reset-notice"');
    expect(tools).toContain('onDismissAutoSubtitleDraftResetNotice');
  });

  it('isolates ordinary batch subtitle creation from the audio planning surface', () => {
    const batch = source('src/renderer/features/dialogue/DialogueBatchPaste.tsx');

    expect(batch).toContain("presentation = 'subtitle-only'");
    expect(batch).toContain('if (!autoSubtitle) return null;');
    expect(batch).toContain('autoSubtitle && rowExpanded && resolvedRow && row ?');
    expect(batch).toContain("!autoSubtitle ? (");
    expect(batch).toContain('dialogueStore.createMany(');
    expect(batch).toContain('<span>添加字幕</span>');
    expect(batch).not.toContain('仅添加字幕（不含配音）');
    expect(batch).toContain('data-testid="auto-subtitle-phase-a-status"');
    expect(batch).toContain('待生成');
    expect(batch).toContain('data-testid="auto-subtitle-input-toggle"');
    expect(batch).toContain('data-testid="dialogue-batch-audio-player"');
    expect(batch).toContain('window.pandaStage.assets.readAudio');
  });

  it('keeps independent drafts within a shot and clears them when project or shot changes', () => {
    const automatic = new DialogueAuthoringDraft();
    const ordinary = new DialogueAuthoringDraft();
    automatic.bindIdentity(SHOT_A);
    ordinary.bindIdentity(SHOT_A);
    automatic.setBatchRaw('Panda：自动字幕台词');
    automatic.setBatchMapping(1, 'character-panda');
    automatic.setBatchAudioSelection(1, {
      assetId: 'audio-panda',
      characterId: 'character-panda',
      durationSeconds: '0.8',
    });

    expect(ordinary.getSnapshot().batchRaw).toBe('');
    expect(ordinary.getSnapshot().batchAudioSelections).toEqual({});
    expect(automatic.getSnapshot().batchRaw).toBe('Panda：自动字幕台词');

    expect(automatic.bindIdentity(SHOT_B)).toBe(true);
    expect(automatic.getSnapshot().batchRaw).toBe('');
    automatic.setBatchRaw('Panda：切镜头后新输入');
    expect(automatic.bindIdentity(PROJECT_B)).toBe(true);
    expect(automatic.getSnapshot().batchRaw).toBe('');
    expect(automatic.getSnapshot().batchMapping).toEqual({});
    expect(automatic.getSnapshot().batchAudioSelections).toEqual({});
  });

  it('provides scrolling, truncates long names, and fits the narrower landscape drawer', () => {
    const styles = source('src/renderer/styles.css');
    const auto = source(
      'src/renderer/styles/features/dialogue/batch/s15-24--auto-subtitles-phase-a.css',
    );
    const narrowWorkspace = source(
      'src/renderer/styles/shell/right-workspace/s02-05--right-workspace-width-1050.css',
    );

    expect(styles).toContain('.project-tools-auto-subtitles-header');
    expect(auto).toContain('overflow-x: hidden;');
    expect(auto).toContain('overflow-y: auto;');
    expect(auto).toContain('text-overflow: ellipsis;');
    expect(auto).toContain('@media (max-width: 340px)');
    expect(narrowWorkspace).toContain('@media (max-width: 1050px)');
    expect(narrowWorkspace).toContain('grid-template-columns: minmax(0, 1fr) 56px;');
  });
});
