import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  if (path === 'src/renderer/styles.css') return readOrderedStylesheetSource();
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('AUTO-02 V0 Batch Adjust tool contract', () => {
  it('reaches Batch Adjust from the existing Tools drawer without a second shell', () => {
    const drawer = source('src/renderer/shell/ProjectToolsDrawer.tsx');

    expect(drawer).toContain("'batch-adjust'");
    expect(drawer).toContain('data-testid="project-tools-batch-adjust"');
    expect(drawer).toContain('data-testid="project-tools-batch-adjust-view"');
    expect(drawer).toContain('<BatchDialogueMovePanel');
    expect(drawer).toContain('data-testid="project-tools-back"');
    // The drawer stays a presentation launcher; it never commits Project data.
    expect(drawer).not.toContain('updateProject');
  });

  it('keeps the panel a thin view over one Store call', () => {
    const panel = source(
      'src/renderer/features/dialogue/BatchDialogueMovePanel.tsx',
    );

    expect(panel).toContain('dialogueStore.planMoveMany');
    expect(panel).toContain('dialogueStore.moveMany');
    // Selection is local UI state; nothing writes the Project from the panel.
    expect(panel).not.toContain('updateProject');
    expect(panel).not.toContain('new DialogueService');
    expect(panel).toContain('type="checkbox"');
    expect(panel).toContain('data-testid="batch-adjust-delta"');
    expect(panel).toContain('data-testid="batch-adjust-impact"');
    expect(panel).toContain('data-testid="batch-adjust-apply"');
    expect(panel).toContain('应用移动');
    // Exactly one primary action, and it is disabled until the batch is legal.
    expect(panel.match(/variant="primary"/gu)).toHaveLength(1);
    expect(panel).toContain('disabled={!canApply}');
  });

  it('registers the Batch Adjust stylesheet once', () => {
    const entry = readFileSync('src/renderer/styles.css', 'utf8').replace(
      /\r\n/gu,
      '\n',
    );
    const imports = entry.match(/s18-01--batch-adjust-tool\.css/gu) ?? [];

    expect(imports).toHaveLength(1);
    expect(
      source('src/renderer/styles/shell/tools/s18-01--batch-adjust-tool.css'),
    ).toContain('.batch-adjust-apply');
  });

  it('exposes the batch move to the domain and store layers', () => {
    const service = source('src/domain/services/DialogueService.ts');
    const store = source('src/renderer/stores/dialogueStore.ts');

    expect(service).toContain('planMoveMany(');
    expect(service).toContain('moveMany(');
    expect(service).toContain('DIALOGUE_BATCH_OUT_OF_RANGE');
    expect(service).toContain('DIALOGUE_BATCH_TOO_SMALL');
    expect(store).toContain("updateProject(next, 'Move dialogues together')");
  });
});
