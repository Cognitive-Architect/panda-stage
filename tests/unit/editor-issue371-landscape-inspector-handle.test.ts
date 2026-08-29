import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const inspector = readFileSync(
  'src/renderer/shell/RightInspector.tsx',
  'utf8',
);
const styles = readFileSync('src/renderer/styles.css', 'utf8');

describe('Issue #371 Cloud Touch landscape inspector handle', () => {
  it('keeps one semantic trigger connected to the existing drawer', () => {
    expect(inspector).toContain('className="inspector-rail-handle"');
    expect(inspector).toContain('data-testid="inspector-rail-handle"');
    expect(inspector).toContain('aria-controls="right-inspector-drawer"');
    expect(inspector).toContain('aria-expanded={drawerOpen}');
    expect(inspector).toContain('onClick={() => setDrawerOpen(!drawerOpen)}');
    expect(inspector).toContain('type="button"');
    expect(inspector).toContain('id="right-inspector-drawer"');
  });

  it('uses a centered compact geometry only for Cloud Touch landscape', () => {
    expect(styles).toMatch(
      /\.editor-shell\[data-editor-device-mode='cloud-touch'\]\[data-editor-shell-layout='landscape'\]\s+\.inspector-rail-handle\s*\{[\s\S]*?top:\s*50%;[\s\S]*?right:\s*0;[\s\S]*?width:\s*56px;[\s\S]*?height:\s*152px;[\s\S]*?min-height:\s*132px;[\s\S]*?max-height:\s*168px;[\s\S]*?transform:\s*translateY\(-50%\);/u,
    );
    expect(styles).toMatch(
      /\.editor-shell\[data-editor-device-mode='cloud-touch'\]\[data-editor-shell-layout='landscape'\]\s+\.right-inspector\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/u,
    );
  });

  it('keeps the existing compact project bar layout stable for regression gates', () => {
    expect(styles).toMatch(
      /\.compact-project-controls\s+\.history-controls\[data-history-presentation='compact'\]\s*\{[\s\S]*?display:\s*flex;[\s\S]*?padding:\s*0;[\s\S]*?background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /\.compact-project-controls\s+\.history-controls\[data-history-presentation='compact'\][\s\S]*?\.history-actions\s*>\s*span,[\s\S]*?\.compact-project-controls\s+\.history-controls\[data-history-presentation='compact'\][\s\S]*?>\s*output\s*\{[\s\S]*?position:\s*absolute;/u,
    );
  });

  it('preserves the existing focus return and non-mutation ownership paths', () => {
    expect(inspector).toContain('drawerRef.current?.focus()');
    expect(inspector).toContain('railRef.current?.focus()');
    expect(inspector).toContain('window.setTimeout');
    expect(inspector).toContain('window.clearTimeout');
    expect(inspector).toContain('editorProjectStore.getSnapshot');
    expect(inspector).not.toContain('editorProjectStore.update');
    expect(inspector).not.toContain('editorProjectStore.replace');
    expect(inspector).not.toContain('history');
    expect(styles).toMatch(
      /\.editor-layout\[data-shell-mode='portrait'\][\s\S]*?\.inspector-rail-handle\s*\{[\s\S]*?display:\s*none;/u,
    );
  });
});
