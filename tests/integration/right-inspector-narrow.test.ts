import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const inspector = readFileSync(
  'src/renderer/shell/RightInspector.tsx',
  'utf8',
);
const shell = readFileSync('src/renderer/shell/EditorShell.tsx', 'utf8');
const dock = readFileSync('src/renderer/shell/ResourceActivityDock.tsx', 'utf8');
const styles = readFileSync('src/renderer/styles.css', 'utf8');

describe('Issue 192 Right Inspector compact rail and drawer', () => {
  it('reuses the left resource workspace narrow seam instead of a second breakpoint', () => {
    expect(inspector).toContain(
      "import { isNarrowViewport, useNarrowViewport } from './ResourceActivityDock'",
    );
    expect(dock).toContain('export function useNarrowViewport');
    expect(dock).toContain('export function isNarrowViewport');
  });

  it('keeps one production Inspector owner with one set of panels in every mode', () => {
    expect(inspector.match(/<LayerTransformPanel/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerOrderControls/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerBackgroundControl/gu)).toHaveLength(1);
    expect(inspector).not.toContain('right-inspector-placeholder');
    expect(inspector).toContain('data-testid="right-inspector"');
    // The compact rail and drawer belong to the same single owner.
    expect(inspector).toContain('className="inspector-rail-handle"');
    expect(inspector).toContain('className="right-inspector-drawer"');
  });

  it('never marks the project dirty when the drawer opens or closes', () => {
    expect(inspector).toContain('editorProjectStore.getSnapshot');
    expect(inspector).not.toContain('editorProjectStore.update');
    expect(inspector).not.toContain('editorProjectStore.replace');
    expect(inspector).not.toContain('history');
  });

  it('collapses the right column symmetrically with the left in the 1100px seam', () => {
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*1100px\)\s*\{[\s\S]*?\.editor-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(52px,\s*56px\)\s*minmax\(0,\s*1fr\)\s*minmax\(52px,\s*56px\);/u,
    );
  });

  it('lets the landscape shell select the compact inspector rail', () => {
    expect(shell).toContain(
      'compact={isPortrait ? portraitPropertiesVisible : undefined}',
    );
    expect(shell).toContain('shellMode={layoutMode}');
    expect(shell).not.toContain(
      'compact={isPortrait && portraitPropertiesVisible}',
    );
  });

  it('renders the compact rail handle and right-side drawer only inside the narrow seam', () => {
    // The rail and drawer are scoped to the same media query as the left dock.
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*1100px\)\s*\{[\s\S]*?\.inspector-rail-handle\s*\{/u,
    );
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*1100px\)\s*\{[\s\S]*?\.right-inspector-drawer\s*\{[\s\S]*?position:\s*absolute;/u,
    );
    // The drawer overlays rather than becoming a permanent third column.
    expect(styles).toMatch(
      /\.right-inspector:not\(\.right-inspector-drawer-open\)\s*\.right-inspector-drawer\s*\{[\s\S]*?visibility:\s*hidden;/u,
    );
  });
});
